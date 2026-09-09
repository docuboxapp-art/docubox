import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateXML } from 'xmllint-wasm';

const schemaPath = path.join(
  process.cwd(),
  'src',
  'lib',
  'evidence-v2',
  'schema',
  'docubox-evidence-v2.xsd'
);

let schemaPromise: Promise<string> | null = null;

function loadSchema() {
  schemaPromise ||= readFile(schemaPath, 'utf8');
  return schemaPromise;
}

export async function validateEvidenceV2XmlAgainstXsd(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    return { valid: false, errors: ['DTD and entity declarations are not permitted'] };
  }
  const schema = await loadSchema();
  const result = await validateXML({
    xml: [{ fileName: 'evidence.xml', contents: xml }],
    schema: [{ fileName: 'docubox-evidence-v2.xsd', contents: schema }],
  });
  return {
    valid: result.valid,
    errors: result.errors.map((error) => error.message || error.rawMessage),
  };
}
