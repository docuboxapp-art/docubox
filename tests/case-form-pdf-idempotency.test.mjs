import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
let source=await readFile('supabase/functions/generate-form-pdf/index.ts','utf8');
source=source.replace("import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';",'export let handler; const serve = callback => { handler = callback; };');
source=source.replace("import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';",'let client; export const useClient = value => { client = value; }; const createClient = () => client;');
for(const [remote,local] of Object.entries({'https://esm.sh/pdf-lib@1.17.1':'pdf-lib','npm:@pdf-lib/fontkit@1.1.1':'@pdf-lib/fontkit','https://esm.sh/qrcode@1.5.4':'qrcode'}))source=source.replaceAll(remote,local);
await mkdir('.tmp',{recursive:true});
await build({stdin:{contents:source,loader:'ts',resolveDir:process.cwd()+'/supabase/functions/generate-form-pdf'},bundle:true,platform:'node',format:'cjs',packages:'external',outfile:'.tmp/case-form-pdf-unit.cjs'});
const {handler,useClient}=createRequire(import.meta.url)('../.tmp/case-form-pdf-unit.cjs');
const bytes=Buffer.from('%PDF-1.7\nsynthetic cached document'),hash=createHash('sha256').update(bytes).digest('hex');
const secret='unit-only-pdf-service-secret';
globalThis.Deno={env:{get:name=>name==='SUPABASE_SERVICE_ROLE_KEY'?secret:name==='SUPABASE_URL'?'https://project.example.invalid':''}};
const request=(authorization=secret)=>new Request('http://localhost/pdf',{method:'POST',headers:{Authorization:'Bearer '+authorization,'Content-Type':'application/json'},body:JSON.stringify({response_id:'synthetic-response'})});
function fixture({tamper=false,metadataHash=hash}={}){
  let queries=0,downloads=0;
  const row={id:'synthetic-response',workspace_id:'workspace',generated_pdf_id:'pdf',pdf_output_hash:hash,pdf_output_path:'immutable/receipt.pdf'};
  useClient({from:table=>{queries++;const q={select:()=>q,eq:()=>q,single:async()=>({error:null,data:table==='form_responses'?row:{id:'pdf',unsigned_sha256_hash:metadataHash,storage_path:row.pdf_output_path,qr_validation_url:'https://example.invalid/validate'}})};return q;},storage:{from:()=>({download:async()=>{downloads++;return {error:null,data:new Blob([tamper?'changed':bytes])};}})}});
  return {counts:()=>({queries,downloads})};
}
test('a PDF retry returns the same verified receipt without uploading or inserting another PDF',async()=>{
  const f=fixture();
  const a=await handler(request()),b=await handler(request());
  assert.equal(a.status,200);assert.equal(b.status,200);
  assert.deepEqual(await a.json(),await b.json());assert.equal(f.counts().downloads,2);
});
test('cached receipt rejects bytes that differ from the committed hash',async()=>{
  fixture({tamper:true});const r=await handler(request());assert.equal(r.status,500);assert.equal((await r.json()).error,'FORM_PDF_INTEGRITY_CONFLICT');
});
test('cached receipt rejects inconsistent PDF metadata before downloading',async()=>{
  const f=fixture({metadataHash:'0'.repeat(64)});const r=await handler(request());assert.equal(r.status,500);assert.equal((await r.json()).error,'FORM_PDF_RECEIPT_CONFLICT');assert.equal(f.counts().downloads,0);
});
test('generator keeps service authentication and does not consult data for an unauthorized caller',async()=>{
  const f=fixture();const r=await handler(request('wrong-secret'));assert.equal(r.status,401);assert.equal(f.counts().queries,0);
});
