import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { randomBytes } from 'node:crypto';

const require=createRequire(import.meta.url);
const key='__organizationWebhookQA';
const stubs={
 'server-only':'',
 '@/lib/supabase/server':'export const createServiceClient=()=>({});export const createAnonClient=()=>({});',
 'node:dns/promises':`export const lookup=async()=>[{address:'8.8.8.8',family:4}];`,
};
async function bundle(entry,name){await build({entryPoints:[entry],outfile:`.tmp/${name}.cjs`,bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'qa',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(stubs,a.path)?{path:a.path,namespace:'qa'}:undefined);b.onLoad({filter:/.*/,namespace:'qa'},a=>({contents:stubs[a.path],loader:'js'}));}}]});return require(`../.tmp/${name}.cjs`);}
const {encryptOrganizationSecret}=await bundle('src/lib/organization/server.ts','organization-webhook-encrypt-qa');
const {processOrganizationWebhookDeliveries,createWebhookSignature}=await bundle('src/lib/organization/webhook-dispatcher.ts','organization-webhook-deliver-qa');
const original={fetch:globalThis.fetch,master:process.env.ORGANIZATION_CREDENTIAL_ENCRYPTION_KEY};
test.after(()=>{globalThis.fetch=original.fetch;if(original.master===undefined)delete process.env.ORGANIZATION_CREDENTIAL_ENCRYPTION_KEY;else process.env.ORGANIZATION_CREDENTIAL_ENCRYPTION_KEY=original.master;delete globalThis[key]});
function setup(){
 process.env.ORGANIZATION_CREDENTIAL_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const secret='whsec_synthetic-only';const packet=encryptOrganizationSecret(secret);
 const endpoint={id:'endpoint',workspace_id:'organization',endpoint_url:'https://events.example.invalid/docubox',status:'active',secret_ciphertext:packet.ciphertext,secret_iv:packet.iv,secret_tag:packet.tag,secret_version:packet.version};
 const event={id:'event',workspace_id:'organization',document_id:'document',event_type:'document.completed',occurred_at:'2026-11-18T01:00:00Z',correlation_id:'correlation',payload:{status:'completed'}};
 const h={secret,endpoint,event,updates:[],calls:[],claim:true,status:200};
 const service={rpc:async()=>({data:h.claim?(h.claim=false,[{id:'delivery',endpoint_id:'endpoint',workspace_id:'organization',canonical_event_id:'event',attempt_number:1}]):[],error:null}),from(table){const filters=[];let values;const result=()=>{if(values){h.updates.push({table,values,filters});return {data:null,error:null}}let row=table==='organization_webhook_endpoints'?h.endpoint:h.event;return {data:row&&filters.every(([k,v])=>row[k]===v)?row:null,error:null}};const q={select(){return q},eq(k,v){filters.push([k,v]);return q},update(v){values=v;return q},maybeSingle:async()=>result(),then(resolve,reject){return Promise.resolve(result()).then(resolve,reject)}};return q}};
 globalThis.fetch=async(url,init)=>{h.calls.push({url:String(url),...init});return new Response('',{status:h.status})};return {h,service};
}
test('saved encrypted webhook secrets can be decrypted and sign the actual outbound delivery',async()=>{
 const {h,service}=setup();const now=new Date('2026-11-18T01:10:00Z');const result=await processOrganizationWebhookDeliveries(service,{now});assert.equal(result.delivered,1);assert.equal(h.calls.length,1);const call=h.calls[0];assert.equal(call.headers['x-docubox-signature'],createWebhookSignature({secret:h.secret,timestamp:String(Math.floor(now.getTime()/1000)),deliveryId:'delivery',body:call.body}));assert.doesNotMatch(call.body,/whsec_synthetic/);assert.ok(h.updates.some(row=>row.values.status==='delivered'));
});
test('a foreign endpoint cannot receive an organization delivery',async()=>{
 const {h,service}=setup();h.endpoint.workspace_id='foreign';const result=await processOrganizationWebhookDeliveries(service);assert.equal(result.discarded,1);assert.equal(h.calls.length,0);
});
test('tampered secret packets fail closed before any network request',async()=>{
 const {h,service}=setup();h.endpoint.secret_tag=Buffer.alloc(16).toString('base64');const result=await processOrganizationWebhookDeliveries(service);assert.equal(result.discarded,1);assert.equal(h.calls.length,0);
});
test('transient provider failures schedule a retry rather than reporting success',async()=>{
 const {h,service}=setup();h.status=503;const result=await processOrganizationWebhookDeliveries(service);assert.equal(result.delivered,0);assert.equal(result.retrying,1);assert.ok(h.updates.some(row=>row.values.next_retry_at));
});
