import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
}}).outputText;
const source = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'App');
function appFunction(name) {
  const node = app.body.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, name);
  return compile(node.getText(tree));
}
const results = [];

// Run the real account-scope effect, not a copy of its reset logic.
const reset = app.body.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
  && n.expression.expression.getText(tree) === 'useEffect'
  && n.expression.arguments[0].getText(tree).includes('setPendingMood'));
const state = { draft: 'A 的待办', quickRecordDraft: 'A 的私密草稿', quickRecordOpen: true, todayDiaryOpen: true, importantDraft: true };
const resetContext = {
  demoSnapshot: { journalText: '', quoteText: '' }, localDateIso: () => '2026-09-28',
  snapshotSequence: { current: 0 }, journalBusy: { current: true }, addingTodoRef: { current: true },
  lastSnapshotJournalText: { current: 'private' }, lastSnapshotQuoteText: { current: 'private' },
  saveNoticeTimer: { current: null }, appToastTimer: { current: null }, clearTimeout,
};
for (const name of reset.getText(tree).match(/\bset[A-Z]\w+/g)) {
  const key = name[3].toLowerCase() + name.slice(4);
  resetContext[name] = value => { state[key] = value; };
}
vm.runInNewContext(`(${reset.expression.arguments[0].getText(tree)})()`, resetContext);
assert.equal(state.draft, ''); assert.equal(state.quickRecordDraft, '');
assert.equal(state.quickRecordOpen, false); assert.equal(state.todayDiaryOpen, false); assert.equal(state.importantDraft, false);
results.push('账号切换清理草稿、弹窗、忙碌状态');

const safety = { exports: {}, Date };
vm.runInNewContext(compile(fs.readFileSync(new URL('../src/lib/snapshotSafety.ts', import.meta.url), 'utf8')), safety);
const expires = seconds => `https://test.invalid/photo?Expires=${Math.floor(Date.now()/1000)+seconds}&Signature=test`;
const old = expires(-1), fresh = expires(900), valid = expires(600);
assert.equal(safety.exports.stablePhotoUrls(['p'], [old], ['p'], [fresh])[0], fresh);
assert.equal(safety.exports.stablePhotoUrls(['p'], [valid], ['p'], [fresh])[0], valid);
assert.equal(safety.exports.stablePhotoUrls(['p'], ['file:///local'], ['p'], [fresh])[0], fresh);
const nextAccount = { profile: { id: 'b' }, journalPhotoPaths: ['p'], journalPhotoUrls: [fresh] };
assert.equal(safety.exports.keepStableSnapshotPhotos({ profile: { id: 'a' } }, nextAccount), nextAccount);
results.push('过期照片链接续期、有效链接稳定、不同账号不复用链接');

let releaseTodo, todoCalls = 0;
const todoContext = {
  requireCheckin: () => true, addingTodoRef: { current: false }, draft: 'test', todos: [], importantDraft: false,
  userId: 'a', demoMode: false, isCurrentAccount: () => true, setAddingTodo: () => {}, setDraft: () => {}, setImportantDraft: () => {},
  createDomesticTodo: async () => { todoCalls++; return new Promise(resolve => { releaseTodo = resolve; }); },
  setSnapshot: () => {}, refreshSnapshot: async () => {}, Alert: { alert: () => {} },
};
vm.runInNewContext(appFunction('addTodo'), todoContext);
const adding = todoContext.addTodo();
await todoContext.addTodo();
assert.equal(todoCalls, 1);
releaseTodo({ id: '1', text: 'test' }); await adding;
assert.equal(todoContext.addingTodoRef.current, false);
results.push('待办连续点击只发送一次请求');

class ApiError extends Error { constructor(status) { super('conflict'); this.status = status; } }
let conflictAlert, currentDraft = '我的草稿', currentBase = { date: '2026-09-28', text: '旧文本' };
const journalContext = {
  requireCheckin: () => true, journalBusy: { current: false }, journalDraft: currentDraft, journalBase: currentBase,
  userId: 'a', demoMode: false, isCurrentAccount: () => true, DomesticApiError: ApiError,
  saveDomesticJournal: async (text, expected, date) => {
    assert.equal(text, '我的草稿'); assert.equal(expected, '旧文本'); assert.equal(date, '2026-09-28'); throw new ApiError(409);
  },
  refreshSnapshot: async () => ({ journalText: '其他设备的新文本', checkinDate: '2026-09-28' }),
  setJournalSaveState: () => {}, setSnapshot: () => {}, showSavedFeedback: () => { throw new Error('must not report saved'); },
  setJournalDraft: value => { currentDraft = value; }, setJournalBase: value => { currentBase = value; }, setJournalEditing: () => {},
  Alert: { alert: (...args) => { conflictAlert = args; } },
};
vm.runInNewContext(appFunction('saveJournal'), journalContext);
await journalContext.saveJournal();
assert.equal(currentDraft, '我的草稿'); assert.equal(currentBase.text, '旧文本');
assert.equal(journalContext.journalBusy.current, false);
conflictAlert[2][1].onPress();
assert.equal(currentDraft, '其他设备的新文本\n我的草稿'); assert.equal(currentBase.text, '其他设备的新文本');
results.push('随笔冲突保留草稿，仅用户选择后合并');

let todoSyncRetry = 0;
const gate = app.body.statements.find(n => ts.isIfStatement(n) && n.expression.getText(tree).includes('!snapshotReady'));
const gateContext = {
  exports: {}, require: name => {
    assert.equal(name, 'react/jsx-runtime'); return { jsx: (type, props) => ({ type, props }) };
  },
  demoMode: false, hasDomesticApiConfig: true, session: {}, snapshotReady: false, snapshotLoading: false,
  snapshotError: '网络断开', AccountLoadingScreen: 'loading', completeSignOut: () => {},
  setSnapshotRetry: action => { todoSyncRetry = action(todoSyncRetry); },
};
vm.runInNewContext(compile(`function render(){${gate.getText(tree)}}; exports.render=render;`), gateContext);
const failureScreen = gateContext.exports.render();
assert.equal(failureScreen.props.error, '网络断开');
failureScreen.props.onRetry(); assert.equal(todoSyncRetry, 1); assert.equal(typeof failureScreen.props.onSignOut, 'function');
results.push('首次同步失败提供错误信息、重试和退出');

const deferredSnapshots = [];
let activeScope = true, appliedSnapshot = { profile: { id: 'a' }, journalText: 'initial' };
const syncContext = {
  userId: 'a', demoMode: false, isCurrentAccount: () => activeScope, StaleSessionError: class extends Error {},
  snapshotSequence: { current: 0 }, snapshotRequests: { current: 0 },
  loadDomesticAppSnapshot: () => new Promise(resolve => deferredSnapshots.push(resolve)),
  setSnapshot: action => { appliedSnapshot = action(appliedSnapshot); }, setSnapshotError: () => {},
  keepStableSnapshotPhotos: (_previous, next) => next,
};
vm.runInNewContext(appFunction('refreshSnapshot'), syncContext);
const firstSync = syncContext.refreshSnapshot(), secondSync = syncContext.refreshSnapshot();
deferredSnapshots[1]({ profile: { id: 'a' }, journalText: 'new' }); await secondSync;
deferredSnapshots[0]({ profile: { id: 'a' }, journalText: 'old' }); await firstSync;
assert.equal(appliedSnapshot.journalText, 'new');
const switchedSync = syncContext.refreshSnapshot(); activeScope = false;
deferredSnapshots[2]({ profile: { id: 'a' }, journalText: 'previous account' });
await assert.rejects(switchedSync);
assert.equal(appliedSnapshot.journalText, 'new'); assert.equal(syncContext.snapshotRequests.current, 0);
results.push('快照乱序不回退、切换账号后的旧快照不应用');

// Native scheduling mock with actual failure, retry and orphan-recovery paths.
const store = new Map();
const notifications = new Map();
const failCancellation = new Set();
let serial = 0;
const native = {
  setNotificationHandler: () => {},
  getPermissionsAsync: async () => ({ granted: true }),
  getAllScheduledNotificationsAsync: async () => [...notifications.values()],
  SchedulableTriggerInputTypes: { DAILY: 'daily' },
  scheduleNotificationAsync: async request => {
    const identifier = `reminder-${++serial}`;
    notifications.set(identifier, { ...request, identifier }); return identifier;
  },
  cancelScheduledNotificationAsync: async id => {
    if (failCancellation.has(id)) throw new Error('native cancel failed');
    notifications.delete(id);
  },
};
const reminderContext = { exports: {}, require: name => {
  if (name === 'expo-notifications') return native;
  if (name === 'react-native') return { Platform: { OS: 'ios' } };
  if (name === '@react-native-async-storage/async-storage') return {
    getItem: async key => store.get(key), setItem: async (key, value) => { store.set(key, value); },
  };
  throw new Error(name);
}};
vm.runInNewContext(compile(fs.readFileSync(new URL('../src/lib/reminderNotifications.ts', import.meta.url), 'utf8')), reminderContext);
const reminders = reminderContext.exports;
const scheduled = await reminders.scheduleDailyReminder('22:30');
const previousStored = store.get('zaifou.reminder.settings.v1');
failCancellation.add(scheduled.notificationId);
await assert.rejects(reminders.disableDailyReminder(), /native cancel failed/);
assert.equal(store.get('zaifou.reminder.settings.v1'), previousStored);
assert.equal((await reminders.getReminderSettings()).enabled, true);
await assert.rejects(reminders.scheduleDailyReminder('21:30'), /native cancel failed/);
assert.equal(notifications.size, 1); // the failed replacement has been rolled back
failCancellation.clear();
await reminders.disableDailyReminder(); assert.equal(notifications.size, 0);
assert.equal((await reminders.getReminderSettings()).enabled, false);
// Recover an old orphan even if its ID was lost from device storage.
notifications.set('orphan', { identifier: 'orphan', content: { data: { source: 'daily-reminder', reminderTime: '20:30' } } });
assert.equal((await reminders.getReminderSettings()).notificationId, 'orphan');
await reminders.disableDailyReminder(); assert.equal(notifications.size, 0);
await Promise.all([reminders.scheduleDailyReminder('21:30'), reminders.scheduleDailyReminder('22:30')]);
assert.equal(notifications.size, 1); assert.equal((await reminders.getReminderSettings()).time, '22:30');
await assert.rejects(reminders.scheduleDailyReminder('99:99'), /提醒时间无效/);
results.push('提醒取消失败不谎报成功、换时间失败回滚、孤立通知恢复、并发变更串行');
console.log(JSON.stringify({ clientBusinessPassed: true, results }));
