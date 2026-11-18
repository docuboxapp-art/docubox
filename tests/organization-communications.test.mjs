import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const key = '__organizationCommunicationsQA';
const stubs = {
  '@/lib/organization/server': `export class OrganizationApiError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}} export async function authorizeOrganizationRequest(){const h=globalThis.${key};if(h.denied)throw new OrganizationApiError(403,'permission_denied','Denegado');return {user:{id:'actor'},service:h.service}} export const organizationApiFailure=e=>Response.json({error:e.code||'internal_error'},{status:e.status||500});`,
  '@/lib/notifications/service': `export const emitDomainEvent=async input=>globalThis.${key}.events.push(input);`,
  'node:dns/promises': `export const resolveTxt=async()=>globalThis.${key}.dns;`,
  resend: `export class Resend{constructor(){const h=globalThis.${key};this.domains={list:async()=>({data:{data:[{id:'provider',name:'example.invalid'}]}}),get:async()=>({data:{status:h.providerStatus,records:[]}}),verify:async()=>({data:{}})}}}`,
};
const require = createRequire(import.meta.url);
async function bundle(entry, name) {
  await build({entryPoints:[entry],outfile:`.tmp/${name}.cjs`,bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'qa-boundaries',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(stubs,a.path)?{path:a.path,namespace:'qa'}:undefined);b.onLoad({filter:/.*/,namespace:'qa'},a=>({contents:stubs[a.path],loader:'js'}));}}]});
  return require(`../.tmp/${name}.cjs`);
}
const {renderOrganizationCommunication: render}=await bundle('src/lib/organization/communications.server.ts','organization-communications-qa');
const {POST}=await bundle('src/app/api/organizacion/sender-domains/route.ts','organization-domain-qa');
const {notifyOrganizationSecurityEvent: notify}=await bundle('src/lib/organization/security-alerts.server.ts','organization-alerts-qa');
const ws='11111111-1111-4111-8111-111111111111', domainId='22222222-2222-4222-8222-222222222222';
function setup(tables={}){
  const h={tables,mutations:[],queries:[],events:[],dns:[],providerStatus:'verified'};
  h.service={rpc:async(name,args)=>{h.mutations.push({name,args});return {data:{id:domainId},error:null}},from(table){const filters=[];h.queries.push({table,filters});const result=()=>({data:(h.tables[table]||[]).filter(row=>filters.every(([key,value])=>row[key]===value)),error:null});const q={select(){return q},eq(key,value){filters.push([key,value]);return q},order(){return q},limit(){return q},maybeSingle:async()=>({...result(),data:result().data[0]||null}),then(resolve,reject){return Promise.resolve(result()).then(resolve,reject)}};return q;}};
  globalThis[key]=h;return h;
}
const input={workspaceId:ws,templateKey:'organization.invitation',variables:{organization_name:'Organización',recipient_name:'<script>test</script>',action_url:'https://example.invalid/invitation'},fallbackSubject:'Invitación predeterminada',fallbackContentHtml:'<p>Contenido predeterminado</p>',context:'Organización'};
const originalKey=process.env.RESEND_API_KEY;
test.after(()=>{delete globalThis[key];if(originalKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=originalKey});
test('active invitation template escapes content, retains the action and uses verified sender and branding',async()=>{
  const h=setup({workspaces:[{id:ws,name:'Organización de ejemplo',branding_settings:{primary_color:'#123456'}}],organization_communication_templates:[{workspace_id:ws,template_key:'organization.invitation',status:'active',subject:'Hola {{recipient_name}}\r\nInjected',body_text:'Hola {{recipient_name}}',legal_version:3}],organization_sender_domains:[{workspace_id:ws,dns_status:'verified',sender_name:'Equipo',sender_email:'equipo@example.invalid',reply_to:'ayuda@example.invalid'}]});
  const result=await render(h.service,input);assert.match(result.html,/&lt;script&gt;/);assert.doesNotMatch(result.html,/<script>/);assert.match(result.html,/https:\/\/example.invalid\/invitation/);assert.match(result.html,/#123456/);assert.equal(result.from,'Equipo <equipo@example.invalid>');assert.doesNotMatch(result.subject,/[\r\n]/);assert.equal(result.templateVersion,3);
});
test('draft templates and pending sender domains do not override production messages',async()=>{
  const h=setup({organization_communication_templates:[{workspace_id:ws,template_key:'organization.invitation',status:'draft',subject:'No aplicar',body_text:'No aplicar'}],organization_sender_domains:[{workspace_id:ws,dns_status:'pending',sender_email:'no@example.invalid'}]});const result=await render(h.service,input);assert.equal(result.subject,input.fallbackSubject);assert.match(result.html,/Contenido predeterminado/);assert.equal(result.from,undefined);
});
const domainRequest=(action)=>new Request('http://localhost/api/organizacion/sender-domains',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspace_id:ws,domain_id:domainId,action})});
const domains=()=>[{id:domainId,workspace_id:ws,domain:'example.invalid',verification_reference:JSON.stringify({provider_id:'provider',challenge:'synthetic-ownership'})}];
test('provider verification alone cannot activate a domain belonging to another tenant',async()=>{
  process.env.RESEND_API_KEY='synthetic';const h=setup({organization_sender_domains:domains()});h.dns=[['docubox-verification=wrong']];const response=await POST(domainRequest('verify'));assert.equal(response.status,200);assert.equal((await response.json()).status,'pending');assert.equal(h.mutations[0].args.patch.dns_status,'pending');
});
test('domain activation requires both TXT ownership and provider verification',async()=>{
  process.env.RESEND_API_KEY='synthetic';const h=setup({organization_sender_domains:domains()});h.dns=[['docubox-verification=synthetic-ownership']];const response=await POST(domainRequest('verify'));assert.equal((await response.json()).status,'verified');assert.equal(h.mutations[0].args.patch.dns_status,'verified');
});
test('missing provider stays pending and foreign domains cannot be mutated',async()=>{
  delete process.env.RESEND_API_KEY;let h=setup({organization_sender_domains:domains()});let response=await POST(domainRequest('prepare'));let body=await response.json();assert.equal(body.provider_configured,false);assert.equal(body.status,'pending');assert.equal(body.records.length,1);h=setup();response=await POST(domainRequest('verify'));assert.equal(response.status,404);assert.equal(h.mutations.length,0);
});
test('enabled security rules route to current recipients with safe event details and stable deduplication',async()=>{
  const h=setup({organization_security_alert_rules:[{id:'rule',workspace_id:ws,event_key:'certificate.changed',enabled:true,display_name:'Cambio de certificado',severity:'high',channels:['in_app'],recipients:[]}],workspace_members:[{workspace_id:ws,user_id:'owner',role:'owner',status:'active'},{workspace_id:ws,user_id:'expired',role:'admin',status:'active',access_expires_at:'2020-01-01'},{workspace_id:ws,user_id:'removed',role:'admin',status:'suspended'}]});
  await notify(h.service,{workspaceId:ws,event:'certificate.changed',eventId:'event-1',actorUserId:'actor'});assert.equal(h.events.length,1);assert.equal(h.events[0].recipients[0].userId,'owner');assert.equal(h.events[0].severity,'warning');assert.equal(h.events[0].workspaceId,ws);assert.doesNotMatch(JSON.stringify(h.events[0].metadata),/@|token|ip_address/);const first=h.events[0].deduplicationKey;await notify(h.service,{workspaceId:ws,event:'certificate.changed',eventId:'event-1'});assert.equal(h.events[1].deduplicationKey,first);
});
test('disabled rules never enqueue notifications',async()=>{
  const h=setup({organization_security_alert_rules:[{workspace_id:ws,event_key:'auth.anomaly',enabled:false}]});await notify(h.service,{workspaceId:ws,event:'auth.anomaly',eventId:'event-2'});assert.equal(h.events.length,0);
});
