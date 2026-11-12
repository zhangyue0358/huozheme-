import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const jsx = (type, props) => ({ type, props });
const native = Object.fromEntries(['ActivityIndicator', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(name => [name, name]));
native.Platform = { OS: 'ios' };
native.StyleSheet = { create: value => value, absoluteFill: {} };
const helpers = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync(new URL('../src/lib/friendRemarks.ts', import.meta.url), 'utf8')), helpers);
const { friendDisplayName, friendRemarkError } = helpers.exports;
assert.equal(friendDisplayName({ name: '王女士', remark: '妈妈' }), '妈妈（王女士）');
assert.equal(friendDisplayName({ name: '王女士', remark: '  ' }), '王女士');
assert.equal(friendDisplayName({ name: '王女士' }), '王女士');
assert.equal(friendRemarkError('😀'.repeat(20)), '');
assert.notEqual(friendRemarkError('😀'.repeat(21)), '');
assert.notEqual(friendRemarkError('换\n行'), '');
const results = ['备注在前、原昵称括号显示；空备注和旧接口回退；中文及 emoji 校验'];

// Execute the real component with a minimal hook/host adapter, like the existing
// client regression suite. No copied submit logic or device/network dependency.
function hooks() {
  const slots = [], cleanups = [];
  let cursor = 0;
  return {
    start() { cursor = 0; }, unmount() { cleanups.forEach(fn => fn?.()); },
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect(effect) { const i = cursor++; if (!(i in slots)) { slots[i] = true; cleanups.push(effect()); } },
  };
}
function all(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(n => all(n, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
}
const first = (node, predicate) => { const match = all(node, predicate)[0]; assert.ok(match, 'missing UI element'); return match; };
const text = node => Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' && node ? text(node.props?.children) : String(node ?? '');
function loadComponents(hook) {
  const ctx = { exports: {}, require: name => {
    if (name === 'react') return hook;
    if (name === 'react-native') return native;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === '../lib/friendRemarks') return helpers.exports;
    throw new Error(name);
  } };
  vm.runInNewContext(compile(fs.readFileSync(new URL('../src/components/FriendRemarks.tsx', import.meta.url), 'utf8')), ctx);
  return ctx.exports;
}
const hook = hooks(), components = loadComponents(hook);
let closeCount = 0, calls = [], resolveSubmit;
const props = { target: { mode: 'edit', id: 'b', name: '王女士', phone: '139****0022', remark: '妈妈' },
  onClose: () => { closeCount++; },
  onSubmit: remark => { calls.push(remark); return new Promise(resolve => { resolveSubmit = resolve; }); },
};
const render = () => { hook.start(); return components.FriendRemarkDialog(props); };
let ui = render();
first(ui, n => n.type === 'TextInput').props.onChangeText('😀'.repeat(21));
ui = render();
assert.equal(first(ui, n => n.type === 'Pressable' && text(n) === '保存备注').props.disabled, true);
first(ui, n => n.type === 'TextInput').props.onChangeText('  老朋友  ');
ui = render();
const save = first(ui, n => n.type === 'Pressable' && text(n) === '保存备注');
const pending = save.props.onPress();
await save.props.onPress();
assert.deepEqual(calls, ['老朋友']);
render().props.onRequestClose(); assert.equal(closeCount, 0, 'busy dialog must not close');
resolveSubmit(false); await pending;
ui = render();
assert.equal(first(ui, n => n.type === 'TextInput').props.value, '  老朋友  ');
assert.equal(closeCount, 0);
first(ui, n => n.type === 'TextInput').props.onChangeText('');
ui = render();
const cleared = first(ui, n => n.type === 'Pressable' && text(n) === '保存备注').props.onPress();
assert.equal(calls.at(-1), ''); resolveSubmit(true); await cleared;
assert.equal(closeCount, 1);
results.push('实际备注弹窗限制长度、防重复提交、保存失败保留草稿、清空成功关闭');
// A request finishing after unmount must not close another account's modal.
ui = render();
const late = first(ui, n => n.type === 'Pressable' && text(n) === '保存备注').props.onPress();
hook.unmount(); resolveSubmit(true); await late;
assert.equal(closeCount, 1);

const source = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = name => tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const screenHooks = hooks();
const screenCtx = { exports: {}, ...screenHooks, ...native, Keyboard: { dismiss() {} }, Alert: { alert() {} },
  styles: new Proxy({}, { get: () => ({}) }), ...components, FriendRow: 'FriendRow', SectionHead: 'SectionHead',
  require: name => { assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx }; },
};
vm.runInNewContext(compile(`${fn('FriendsScreen').getText(tree)}\nexports.Screen = FriendsScreen;`), screenCtx);
let requests = [];
const friend = { id: 'b', name: '王女士', remark: '妈妈', phoneMasked: '139****0022' };
const screenProps = { friends: [friend], friendRequests: [{ id: '1', name: '小林', phoneMasked: '139****0033', direction: 'incoming' }],
  incomingPokes: [], aliveReplyNotices: [], pokedFriendIds: new Set(), repliedFriendIds: new Set(),
  onAcceptRequest: async (...args) => { requests.push(['accept', ...args]); return true; },
  onSendRequest: async (...args) => { requests.push(['send', ...args]); return false; },
  onUpdateRemark: async (...args) => { requests.push(['edit', ...args]); return true; },
};
const screen = () => { screenHooks.start(); return screenCtx.exports.Screen(screenProps); };
ui = screen();
assert.equal(text(ui).includes('修改备注'), false, 'no permanent edit label');
first(ui, n => n.type === 'FriendRow').props.onMore(friend);
ui = screen();
const menu = first(ui, n => n.type === components.FriendRemarkDialog);
assert.equal(menu.props.target.mode, 'menu');
menu.props.onEdit();
ui = screen();
const editor = first(ui, n => n.type === components.FriendRemarkDialog);
assert.equal(editor.props.target.mode, 'edit');
await editor.props.onSubmit('家人');
assert.deepEqual(requests.pop(), ['edit', 'b', '家人']);
editor.props.onClose();
ui = screen();
first(ui, n => n.type === 'Pressable' && text(n) === '接受').props.onPress();
ui = screen();
const accepter = first(ui, n => n.type === components.FriendRemarkDialog);
assert.equal(accepter.props.target.mode, 'accept'); assert.equal(requests.length, 0);
await accepter.props.onSubmit('大学室友');
assert.deepEqual(requests.pop(), ['accept', '1', '大学室友']);
accepter.props.onClose();
ui = screen(); first(ui, n => n.type === 'TextInput').props.onChangeText('13900000022');
ui = screen(); first(ui, n => n.type === 'Pressable' && text(n) === '添加').props.onPress();
ui = screen(); const sender = first(ui, n => n.type === components.FriendRemarkDialog);
assert.equal(sender.props.target.mode, 'send');
await sender.props.onSubmit('新朋友');
assert.deepEqual(requests.pop(), ['send', '13900000022', '新朋友']);
assert.equal(first(screen(), n => n.type === 'TextInput').props.value, '13900000022');
results.push('好友菜单进入编辑；添加和接受先填备注再确认；发送失败保留手机号');

const app = fn('App');
const appFn = name => compile(app.body.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name).getText(tree));
let current = true, fail = false, alerts = 0, updates = 0;
const apiCalls = [];
const ctx = { userId: 'a', demoMode: false, isCurrentAccount: () => current,
  snapshotSequence: { current: 1 },
  setSnapshot: () => { updates++; }, showAppToast() {}, Alert: { alert: () => { alerts++; } },
  updateDomesticFriendRemark: async (...args) => { apiCalls.push(args); if (fail) throw new Error('offline'); return { remark: args[1] }; },
  sendDomesticFriendRequest: async (...args) => { apiCalls.push(args); },
  acceptDomesticFriendRequest: async (...args) => { apiCalls.push(args); },
  refreshSnapshot: async () => { throw new Error('snapshot offline after commit'); },
};
for (const name of ['handleUpdateFriendRemark', 'handleSendFriendRequest', 'handleAcceptFriendRequest']) vm.runInNewContext(appFn(name), ctx);
assert.equal(await ctx.handleUpdateFriendRemark('b', '备注'), true); assert.equal(updates, 1);
assert.equal(ctx.snapshotSequence.current, 2);
fail = true; assert.equal(await ctx.handleUpdateFriendRemark('b', '失败'), false); assert.equal(updates, 1); assert.equal(alerts, 1);
assert.equal(await ctx.handleSendFriendRequest('13900000022', '备注'), true);
assert.equal(await ctx.handleAcceptFriendRequest('1', '备注'), true);
ctx.updateDomesticFriendRemark = async () => { current = false; return { remark: '旧账号' }; };
const before = updates;
assert.equal(await ctx.handleUpdateFriendRemark('b', '旧账号'), false); assert.equal(updates, before); assert.equal(alerts, 1);
const beforeCalls = apiCalls.length;
assert.equal(await ctx.handleSendFriendRequest('13900000022', '旧账号'), false);
assert.equal(await ctx.handleAcceptFriendRequest('1', '旧账号'), false);
assert.equal(apiCalls.length, beforeCalls);
results.push('切换账号丢弃迟到结果；保存失败不假成功；刷新失败不重复已成功的写入');
console.log(JSON.stringify({ clientFriendRemarksPassed: true, results }));
