import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const stateKey='__orgCatalogQA';
const boundary=`
export class OrganizationApiError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
export async function authorizeOrganizationRequest(request,workspaceId,permission){const h=globalThis.${stateKey};h.permissions.push({workspaceId,permission});if(h.denied)throw new OrganizationApiError(403,'permission_denied','Denegado');return {user:{id:h.actor},service:h.service,userClient:h.client};}
export async function requireOrganizationReauthentication(request){if(!request.headers.get('x-organization-reauth'))throw new OrganizationApiError(401,'reauthentication_required','Confirma tu identidad');}
export function organizationApiFailure(error){return Response.json({success:false,error:error.status?error.message:'Error interno',code:error.code||'internal_error'},{status:error.status||500});}`;
await build({entryPoints:['src/app/api/organizacion/catalog/route.ts'],outfile:'.tmp/org-catalog-api-qa.cjs',bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'authorized-boundary',setup(b){b.onResolve({filter:/^@\/lib\/organization\/security-alerts.server$/},()=>({path:'alerts',namespace:'notifications-qa'}));b.onLoad({filter:/.*/,namespace:'notifications-qa'},()=>({contents:'export const notifyOrganizationSecurityEvent=async()=>{};',loader:'js'}));b.onResolve({filter:/^@\/lib\/organization\/server$/},()=>({path:'server',namespace:'qa'}));b.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:boundary,loader:'js'}));}}]});
const {GET,POST}=createRequire(import.meta.url)('../.tmp/org-catalog-api-qa.cjs');
const ws='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',foreign='44444444-4444-4444-8444-444444444444';
function setup(tables={}){
  const h={actor,tables,permissions:[],queries:[],mutations:[],denied:false};
  h.client={rpc:async()=>({data:true,error:null})};
  h.service={rpc:async(name,args)=>{h.mutations.push({name,args});return {data:{id:args.record_id||args.permission_id||id},error:null};},from(table){
    const trace={table,filters:[],columns:''};h.queries.push(trace);
    const result=()=>({data:(h.tables[table]||[]).filter(row=>trace.filters.every(([key,value])=>row[key]===value)),error:null});
    const q={select(columns){trace.columns=columns;return q;},eq(...args){trace.filters.push(args);return q;},limit(){return q;},maybeSingle:async()=>{const r=result();return {...r,data:r.data[0]||null};},then(resolve,reject){return Promise.resolve(result()).then(resolve,reject);}};return q;
  }};globalThis[stateKey]=h;return h;
}
const request=(resource,values,{record=id,action='save',status,reauth=true}={})=>new Request('http://localhost/api/organizacion/catalog',{method:'POST',headers:{'content-type':'application/json',...(reauth?{'x-organization-reauth':'synthetic-confirmation'}:{})},body:JSON.stringify({workspace_id:ws,resource,id:record,action,...(values?{values}:{}),...(status?{status}:{})})});
test.after(()=>delete globalThis[stateKey]);

test('denied access stops catalog reads and mutations before service queries',async()=>{
 const h=setup();h.denied=true;assert.equal((await GET(new Request(`http://localhost/api/organizacion/catalog?workspace_id=${ws}&resource=directory`))).status,403);assert.equal((await POST(request('directory',{full_name:'Example'}))).status,403);assert.equal(h.queries.length,0);assert.equal(h.mutations.length,0);
});
test('create validates fields and routes data through the audited transaction',async()=>{
 const h=setup();const response=await POST(request('centers',{code:'qa-op',name:'QA Operations',currency:'mxn',budget:0,alert_threshold_percent:80},{record:null}));assert.equal(response.status,201);assert.equal(h.mutations[0].name,'mutate_organization_catalog');assert.deepEqual(h.mutations[0].args.patch,{code:'QA-OP',name:'QA Operations',currency:'MXN',budget:0,alert_threshold_percent:80});assert.equal(h.mutations[0].args.ws_id,ws);assert.equal(h.mutations[0].args.actor_user_id,actor);
});
test('unknown fields and null required fields cannot change ownership or bypass validation',async()=>{
 for(const values of [{code:'QA',name:'Example',currency:'MXN',workspace_id:foreign},{code:'QA',name:null,currency:'MXN'}]){const h=setup();assert.equal((await POST(request('centers',values,{record:null}))).status,422);assert.equal(h.mutations.length,0);}
});
test('foreign records and relations cannot be edited or linked',async()=>{
 let h=setup({organization_cost_centers:[{id,workspace_id:foreign,name:'Foreign'}]});assert.equal((await POST(request('centers',{name:'Changed'}))).status,404);assert.equal(h.mutations.length,0);
 h=setup({organization_cost_centers:[{id,workspace_id:ws,name:'Existing'}],workspace_members:[{id:foreign,workspace_id:foreign}]});assert.equal((await POST(request('centers',{owner_member_id:foreign}))).status,422);assert.equal(h.mutations.length,0);
});
test('published policies require a new version and sensitive changes require identity confirmation',async()=>{
 let h=setup({organization_signature_policies:[{id,workspace_id:ws,status:'published'}]});assert.equal((await POST(request('policies',{name:'Changed'}))).status,409);assert.equal(h.mutations.length,0);
 h=setup();assert.equal((await POST(request('policies',{name:'Example',security_level:'basic',allowed_signature_types:['autografa']},{record:null,reauth:false}))).status,401);assert.equal(h.queries.length,0);
});
test('invalid network prefixes and impossible validity ranges never mutate data',async()=>{
 let h=setup();assert.equal((await POST(request('networks',{name:'Example',network_cidr:'192.0.2.1/40',mode:'allow'},{record:null}))).status,422);assert.equal(h.mutations.length,0);
 h=setup({organization_directory_people:[{id,workspace_id:ws,valid_from:'2026-12-01',valid_until:'2026-12-31'}]});assert.equal((await POST(request('directory',{valid_until:'2026-11-01'}))).status,422);assert.equal(h.mutations.length,0);
});
test('identity changes invalidate previous identity assertions',async()=>{
 const h=setup({organization_directory_people:[{id,workspace_id:ws,full_name:'Existing',email:'old@example.invalid',identity_status:'identity_verified'}]});assert.equal((await POST(request('directory',{email:'new@example.invalid'}))).status,200);assert.equal(h.mutations[0].args.patch.identity_status,'not_started');
});
test('certificate grant requires exactly one scoped recipient and can be revoked with audit',async()=>{
 let h=setup();assert.equal((await POST(request('certificate_access',{certificate_id:id,member_id:actor,unit_id:foreign},{record:null}))).status,422);assert.equal(h.mutations.length,0);
 h=setup({organization_certificate_permissions:[{id,workspace_id:ws,certificate_id:actor}]});assert.equal((await POST(request('certificate_access',undefined,{action:'remove'}))).status,200);assert.equal(h.mutations[0].name,'remove_organization_certificate_access');
});
test('certificate validity cannot be forged by a status change',async()=>{
 const h=setup({organization_certificates:[{id,workspace_id:ws,status:'pending'}]});assert.equal((await POST(request('certificates',undefined,{action:'status',status:'valid'}))).status,422);assert.equal(h.mutations.length,0);
});
test('a sender must belong to the registered domain and templates increment their revision',async()=>{
 let h=setup({organization_sender_domains:[{id,workspace_id:ws,domain:'example.invalid'}]});assert.equal((await POST(request('domains',{sender_email:'test@other.invalid'}))).status,422);assert.equal(h.mutations.length,0);
 h=setup({organization_communication_templates:[{id,workspace_id:ws,template_key:'organization.invitation',legal_version:2}]});assert.equal((await POST(request('templates',{subject:'Updated subject'}))).status,200);assert.equal(h.mutations[0].args.patch.legal_version,3);
});
test('editor responses select only public editable integration fields',async()=>{
 const h=setup({organization_integrations:[{id,workspace_id:ws,display_name:'Example',status:'disabled'}]});const response=await GET(new Request(`http://localhost/api/organizacion/catalog?workspace_id=${ws}&resource=integrations&id=${id}`));assert.equal(response.status,200);assert.equal(h.queries[0].columns,'id,updated_at,display_name,status');assert.match(response.headers.get('cache-control'),/no-store/);
});

test('stale editor versions cannot overwrite a newer organization record',async()=>{
 const h=setup({organization_cost_centers:[{id,workspace_id:ws,name:'Newer',updated_at:'2026-11-18T01:00:00Z'}]});
 const response=await POST(new Request('http://localhost/api/organizacion/catalog',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspace_id:ws,resource:'centers',id,action:'save',values:{name:'Old edit'},expected_updated_at:'2026-11-18T00:00:00Z'})}));
 assert.equal(response.status,409);assert.equal(h.mutations.length,0);
});
test('fractional counters and unknown alert events are rejected before persistence',async()=>{
 for(const [resource,values] of [['centers',{code:'QA',name:'Example',currency:'MXN',alert_threshold_percent:80.5}],['alerts',{event_key:'unknown.event',display_name:'Unknown',severity:'warning',channels:['in_app']}]] ){
  const h=setup();assert.equal((await POST(request(resource,values,{record:null}))).status,422);assert.equal(h.mutations.length,0);
 }
});
