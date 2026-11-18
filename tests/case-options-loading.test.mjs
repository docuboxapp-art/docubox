import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { NextRequest } from 'next/server.js';

const actor='11111111-1111-4111-8111-111111111111';
const caseId='22222222-2222-4222-8222-222222222222';
const workspace='33333333-3333-4333-8333-333333333333';
const stubs={
  'next/server':"export {NextRequest,NextResponse} from 'next/server.js';",
  '@/lib/supabase/server':'export const createServiceClient=()=>globalThis.__caseOptionsQA.service;',
  '@/lib/case-files/template-builder':'export const parseStoredCaseTemplate=()=>globalThis.__caseOptionsQA.draft;',
  '@/lib/case-files/runtime.server':`
    export class CaseRuntimeError extends Error{constructor(code,message,status){super(message);this.code=code;this.status=status;}}
    export const caseIdentity=async()=>({id:'${actor}'});
    export const caseSnapshot=async()=>globalThis.__caseOptionsQA.snapshot;
    export const rows=x=>x||[];
    export const isUuid=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x);
    export const runtimeHeaders={'Cache-Control':'private,no-store'};
    export const runtimeFailure=e=>({status:e.status||503,body:{error:'No disponible'}});`,
};
await build({entryPoints:['src/app/api/expedientes/opciones/route.ts'],bundle:true,
  platform:'node',format:'cjs',packages:'external',outfile:'.tmp/case-options-qa.cjs',
  plugins:[{name:'boundaries',setup(b){
    b.onResolve({filter:/.*/},a=>Object.hasOwn(stubs,a.path)?{path:a.path,namespace:'qa'}:undefined);
    b.onLoad({filter:/.*/,namespace:'qa'},a=>({contents:stubs[a.path],loader:'js',resolveDir:process.cwd()}));
  }}],
});
const {GET}=createRequire(import.meta.url)('../.tmp/case-options-qa.cjs');
test.after(()=>delete globalThis.__caseOptionsQA);

function setup({denied=false,fail=false}={}) {
  const expected=['user_profiles','workspaces','documentos','form_responses','form_templates','plantillas','enrollment_results'];
  const started=[]; const calls=[]; let release;
  const allStarted=new Promise(r=>{release=r;});
  const fixture={
    case_file_participants:{email:'SUBJECT@example.invalid',user_id:actor},
    workspace_members:denied?[]:[{user_id:actor,role:'member',status:'active'}],
    user_profiles:[{id:actor,full_name:'Sintético',email:'synthetic@example.invalid'}],
    workspaces:{organization_settings:{}}, documentos:[{id:'document'}],
    form_responses:[{id:'response'}],
    form_templates:[{id:'form',requires_signature:true,allowed_signature_types:['efirma_sat']}],
    plantillas:[{requires_efirma:true}],enrollment_results:[],
  };
  const h={calls,started,draft:{name:'Sintético',sections:[{items:[{id:'form-item',kind:'form',sourceId:'form'},
    {id:'template-item',kind:'document_template',sourceId:'template'}]}],verifications:[],reviewPolicy:{}},
    snapshot:{case:{workspace_id:workspace,runtime_subject_id:'subject'},template:{},participants:[{id:'subject',user_id:actor}]},
    service:{from(table){
      const q={select(){return q;},eq(...args){calls.push({table,op:'eq',args});return q;},
        in(...args){calls.push({table,op:'in',args});return q;},is(){return q;},not(){return q;},
        order(){return q;},limit(){return q;},single(){return q;},
        then(resolve,reject){
          return (async()=>{
            if(expected.includes(table)) {
              started.push(table); if(started.length===expected.length)release();
              // A serial implementation never reaches the barrier and times out.
              await allStarted;
            }
            return {data:fixture[table],error:fail&&table==='form_templates'?{code:'57014'}:null};
          })().then(resolve,reject);
        },
      };return q;
    }},
  };
  globalThis.__caseOptionsQA=h;return h;
}
const request=()=>new NextRequest(`http://localhost/api/expedientes/opciones?caseId=${caseId}`);

test('case options load in one wave after membership and retain subject scope', {timeout:2000}, async()=>{
  const h=setup(); const response=await GET(request()); const result=await response.json();
  assert.equal(response.status,200);assert.equal(h.started.length,7);
  assert.deepEqual(result.data.signatureOptions,['efirma_sat']);
  assert.ok(h.calls.some(c=>c.table==='documentos'&&c.args[0]==='owner_id'&&c.args[1]===actor));
  assert.ok(h.calls.some(c=>c.table==='form_responses'&&c.args[0]==='respondent_email'&&c.args[1]==='subject@example.invalid'));
});
test('an unrelated member never reaches the catalog reads',async()=>{
  const h=setup({denied:true});const response=await GET(request());
  assert.equal(response.status,403);assert.deepEqual(h.started,[]);
});
test('a failed catalog never returns partial signing capabilities', {timeout:2000},async()=>{
  setup({fail:true});const response=await GET(request());const body=await response.json();
  assert.equal(response.status,503);assert.equal(body.data,undefined);
});
