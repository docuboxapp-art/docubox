import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const stubs = {
  'server-only': 'export {};',
  'next/headers': 'export const cookies=async()=>({getAll:()=>[],set(){}});',
  '@supabase/ssr': 'export const createServerClient=()=>globalThis.__runtimeAuthQA.client;',
  '@/lib/supabase/server': 'export const createServiceClient=()=>{throw Error("No privileged query allowed before authentication");};',
  '@/lib/security/document-access': 'export const requireDocumentIdentity=()=>{throw Error("Unexpected Bearer flow");};',
};
await build({
  stdin: { contents: "export {caseIdentity,runtimeFailure} from './src/lib/case-files/runtime.server';", resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  outfile: '.tmp/case-runtime-auth-qa.cjs',
  plugins: [{ name: 'auth-boundaries', setup(b) {
    b.onResolve({ filter: /.*/ }, a=>Object.hasOwn(stubs,a.path)?{path:a.path,namespace:'test-auth'}:undefined);
    b.onLoad({ filter: /.*/, namespace:'test-auth' }, a=>({contents:stubs[a.path],loader:'js'}));
  } }],
});
const { caseIdentity, runtimeFailure } = createRequire(import.meta.url)('../.tmp/case-runtime-auth-qa.cjs');
const request = { method:'GET', headers:new Headers() };
test.after(()=>delete globalThis.__runtimeAuthQA);

test('case consultation preserves a temporary Auth failure as 503', async () => {
  for (const error of [{status:503,name:'AuthRetryableFetchError'},new DOMException('Timeout','TimeoutError')]) {
    globalThis.__runtimeAuthQA={client:{auth:{getUser:async()=>({data:{user:null},error})}}};
    await assert.rejects(caseIdentity(request), e=> {
      const failure=runtimeFailure(e);
      return failure.status===503 && failure.body.code==='CASE_AUTH_UNAVAILABLE';
    });
  }
});

test('a thrown transport failure is not an invalid account session', async () => {
  globalThis.__runtimeAuthQA={client:{auth:{getUser:async()=>{throw new TypeError('fetch failed');}}}};
  await assert.rejects(caseIdentity(request), e=>e.status===503 && e.code==='CASE_AUTH_UNAVAILABLE');
});

test('missing or explicitly rejected sessions remain denied', async () => {
  for(const error of [{status:401,code:'bad_jwt'},{status:400,name:'AuthSessionMissingError'}]) {
    globalThis.__runtimeAuthQA={client:{auth:{getUser:async()=>({data:{user:null},error})}}};
    await assert.rejects(caseIdentity(request), e=>e.status===401 && e.code==='CASE_AUTH_REQUIRED');
  }
});

test('a verified cookie session reaches the case consultation identity', async () => {
  const user={id:'synthetic-actor',email:'synthetic@example.invalid'};
  globalThis.__runtimeAuthQA={client:{auth:{getUser:async()=>({data:{user},error:null})}}};
  assert.deepEqual(await caseIdentity(request),user);
});
