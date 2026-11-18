import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { NextRequest } from 'next/server.js';

const stubs={
  'next/server':"export {NextRequest,NextResponse} from 'next/server.js';",
  '@/lib/supabase/server':`
    export const createAnonClient=()=>globalThis.__permissionAuthQA.client;
    export const createServiceClient=()=>{globalThis.__permissionAuthQA.privileged++;throw Error('Auth must finish first');};`,
};
await build({entryPoints:['src/app/api/documentos/[documentId]/permissions/route.ts'],bundle:true,
  platform:'node',format:'cjs',packages:'external',outfile:'.tmp/document-permissions-auth-qa.cjs',
  plugins:[{name:'boundaries',setup(b){
    b.onResolve({filter:/.*/},a=>Object.hasOwn(stubs,a.path)?{path:a.path,namespace:'qa'}:undefined);
    b.onLoad({filter:/.*/,namespace:'qa'},a=>({contents:stubs[a.path],loader:'js',resolveDir:process.cwd()}));
  }}],
});
const {GET}=createRequire(import.meta.url)('../.tmp/document-permissions-auth-qa.cjs');
test.after(()=>delete globalThis.__permissionAuthQA);
async function check(error,expectedStatus,throws=false,token=true){
  const h={privileged:0,client:{auth:{getUser:async()=>{
    if(throws)throw error;
    return {data:{user:null},error};
  }}}};globalThis.__permissionAuthQA=h;
  const response=await GET(new NextRequest('http://localhost/api/documentos/synthetic/permissions',{
    headers:token?{Authorization:'Bearer synthetic-token'}:{},
  }),{params:Promise.resolve({documentId:'synthetic'})});
  assert.equal(response.status,expectedStatus);assert.equal(h.privileged,0);
  return response;
}
test('viewer permissions keep a temporary Auth failure as 503, not invalid credentials',async()=>{
  const response=await check({status:503,name:'AuthRetryableFetchError'},503);
  assert.match((await response.json()).error,/este momento/);
  assert.match(response.headers.get('cache-control'),/no-store/);
});
test('a thrown Auth timeout remains a temporary viewer failure',async()=>{
  await check(new DOMException('Timeout','TimeoutError'),503,true);
});
test('viewer permission checks still deny rejected or missing tokens',async()=>{
  await check({status:401,code:'bad_jwt'},401);
  await check(null,401,false,false);
});
