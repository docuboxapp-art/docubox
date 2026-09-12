import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateXML } from 'xmllint-wasm';

const schemaPromises = new Map<string, Promise<string>>();

function loadSchema(version: '2.0' | '2.1') {
  const fileName = version === '2.1' ? 'docubox-evidence-v2.1.xsd' : 'docubox-evidence-v2.xsd';
  let promise = schemaPromises.get(fileName);
  if (!promise) {
    promise = readFile(
      path.join(process.cwd(), 'src', 'lib', 'evidence-v2', 'schema', fileName),
      'utf8'
    );
    schemaPromises.set(fileName, promise);
  }
  return promise;
}

export async function validateEvidenceV2XmlAgainstXsd(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    return { valid: false, errors: ['DTD and entity declarations are not permitted'] };
  }
  const version = /schemaVersion="2\.1"/.test(xml) ? '2.1' : '2.0';
  const schema = await loadSchema(version);
  const result = await validateXML({
    xml: [{ fileName: 'evidence.xml', contents: xml }],
    schema: [
      {
        fileName: version === '2.1' ? 'docubox-evidence-v2.1.xsd' : 'docubox-evidence-v2.xsd',
        contents: schema,
      },
    ],
  });
  return {
    valid: result.valid,
    errors: result.errors.map((error) => error.message || error.rawMessage),
  };
}
