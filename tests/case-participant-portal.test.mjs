import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const bundled=await build({stdin:{contents:"export * from './src/lib/case-files/portal'; export * from './src/lib/document-package/file-validation';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {portalFileRules,validatePackageFile}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
test('requirements retain their actual type and size constraints',()=>{
  const rules=portalFileRules({allowedFormats:['PDF','jpeg'],maxSizeMb:100,validityDays:30});
  assert.deepEqual(rules.mimes,['application/pdf','image/jpeg']);
  assert.equal(rules.maxBytes,104857600);assert.equal(rules.askIssueDate,true);
  assert.deepEqual(portalFileRules({allowedFormats:['exe']}).mimes,[]);
});
test('a renamed executable cannot be delivered as a PDF',async()=>{
  await assert.rejects(validatePackageFile(new File(['MZ executable payload'],'document.pdf',{type:'application/pdf'}),['application/pdf'],1024),e=>e.code==='PACKAGE_FILE_TYPE_INVALID');
});
test('actual file bytes must agree with the declared type and configured formats',async()=>{
  const png=Buffer.from('89504e470d0a1a0a000000000000','hex');
  await assert.rejects(validatePackageFile(new File([png],'image.pdf',{type:'application/pdf'}),['image/png'],1024),e=>e.code==='PACKAGE_FILE_MIME_MISMATCH');
  await assert.rejects(validatePackageFile(new File([png],'image.png',{type:'image/png'}),['application/pdf'],1024),e=>e.code==='PACKAGE_FILE_TYPE_INVALID');
});
test('empty and oversized files are rejected before storage',async()=>{
  await assert.rejects(validatePackageFile(new File([],'empty.pdf'),['application/pdf'],100),e=>e.status===413);
  await assert.rejects(validatePackageFile(new File(['%PDF-'+'.'.repeat(200)],'large.pdf'),['application/pdf'],100),e=>e.status===413);
});
test('validated content receives a stable hash and a safe filename',async()=>{
  const f=new File(['%PDF-1.7\nsynthetic fixture'],'../../documento.pdf',{type:'application/pdf'});
  const a=await validatePackageFile(f,['application/pdf'],1024),b=await validatePackageFile(f,['application/pdf'],1024);
  assert.equal(a.sha256,b.sha256);assert.match(a.sha256,/^[a-f0-9]{64}$/);assert.ok(!a.safeName.includes('/'));a.bytes.fill(0);b.bytes.fill(0);
});
