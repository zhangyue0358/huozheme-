import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const stored = new Map();
const storage = {
  multiRemove: async keys => { keys.forEach(key=>stored.delete(key)); },
  multiGet: async keys => keys.map(key=>[key,stored.get(key)??null]),
  setItem: async (key,value) => { stored.set(key,value); },
  getItem: async key => stored.get(key) ?? null,
  removeItem: async key => { stored.delete(key); },
};
const secureStore = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device',
  deleteItemAsync: async key => { stored.delete(key); },
  setItemAsync: storage.setItem,
  getItemAsync: storage.getItem,
};
let nextResponse;
const context = {
  exports: {},
  AbortController,
  setTimeout,
  clearTimeout,
  process: {env:{EXPO_PUBLIC_DOMESTIC_API_URL:'https://test.invalid'}},
  require: name => {
    if(name==='@react-native-async-storage/async-storage') return storage;
    if(name==='expo-secure-store') return secureStore;
    throw new Error(`Unexpected import: ${name}`);
  },
  fetch: async (url,options) => typeof nextResponse==='function' ? nextResponse(url,options) : nextResponse,
};
const source = fs.readFileSync(new URL('../src/lib/domesticClient.ts',import.meta.url),'utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
vm.runInNewContext(compiled,context);
const api = context.exports;
const session = token => ({accessToken:token,profile:{id:token}});
const response = (status,error) => ({ok:status<400,status,json:async()=>({error})});
let expired = 0;
api.onDomesticSessionExpired(()=>{expired+=1;});

await api.saveDomesticSession(session('first'));
nextResponse=response(401,'手机号或密码不正确');
await assert.rejects(api.domesticRequest('/auth/password-login',{auth:false}),error=>error.status===401);
assert.equal(expired,0);
assert.equal((await api.getDomesticSession()).accessToken,'first');

nextResponse=response(500,'服务器开小差了，请稍后再试');
await assert.rejects(api.domesticRequest('/me/snapshot'),error=>error.status===500);
assert.equal(expired,0);
assert.equal((await api.getDomesticSession()).accessToken,'first');

let resolveOld;
nextResponse=()=>new Promise(resolve=>{resolveOld=resolve;});
const oldRequest=api.domesticRequest('/me/snapshot');
await new Promise(resolve=>setImmediate(resolve));
await api.saveDomesticSession(session('second'));
resolveOld(response(401,'登录已失效'));
await assert.rejects(oldRequest,error=>error.status===401);
assert.equal(expired,0);
assert.equal((await api.getDomesticSession()).accessToken,'second');

const uploadGuard = api.guardDomesticSession();
nextResponse=()=>new Promise(resolve=>{resolveOld=resolve;});
const staleSuccess=api.domesticRequest('/me/snapshot');
await new Promise(resolve=>setImmediate(resolve));
await api.saveDomesticSession(session('third'));
resolveOld(response(200,''));
await assert.rejects(staleSuccess,error=>error.name==='StaleSessionError');
assert.throws(uploadGuard,error=>error.name==='StaleSessionError');
assert.equal((await api.getDomesticSession()).accessToken,'third');

let firedTimeout;
context.setTimeout=callback=>{firedTimeout=callback;return 1;};
context.clearTimeout=()=>{};
nextResponse=(_url,options)=>new Promise((_resolve,reject)=>{
  options.signal.addEventListener('abort',()=>reject(new Error('AbortError')));
});
const hung=api.domesticRequest('/me/snapshot');
await new Promise(resolve=>setImmediate(resolve));
firedTimeout();
await assert.rejects(hung,/网络请求超时/);
context.setTimeout=setTimeout;
context.clearTimeout=clearTimeout;

nextResponse=response(401,'登录已失效');
const failed=await Promise.allSettled([api.domesticRequest('/me/snapshot'),api.domesticRequest('/me/snapshot')]);
assert.ok(failed.every(result=>result.status==='rejected'));
assert.equal(expired,1);
assert.equal(stored.has('huozhema.domestic.secureSession'),false);
assert.equal(await api.getDomesticSession(),null);
console.log('PASS: 登录错误保持会话、旧401不退出新账号、旧成功响应丢弃、上传切换账号中止、请求超时、失效会话仅通知一次');
