import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const scanRoots = ['src/app', 'src/components'];

async function collectTsxFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectTsxFiles(target);
      return entry.isFile() && entry.name.endsWith('.tsx') ? [target] : [];
    })
  );
  return files.flat();
}

const files = (
  await Promise.all(scanRoots.map((directory) => collectTsxFiles(path.join(root, directory))))
)
  .flat()
  .filter((file) => !file.includes(`${path.sep}src${path.sep}app${path.sep}api${path.sep}`));

const sources = new Map(
  await Promise.all(
    files.map(async (file) => [path.relative(root, file).replaceAll('\\', '/'), await readFile(file, 'utf8')])
  )
);

const authoredContentExceptions = new Set([
  'src/app/crear-documento/components/StepAjustes.tsx',
  'src/app/firmar-documento/[id]/page.tsx',
  'src/app/mi-perfil/components/AutografaStampSelector.tsx',
  'src/app/mi-perfil/components/ClickSignStampSelector.tsx',
  'src/app/mi-perfil/components/EfirmaStampSelector.tsx',
  'src/app/plantillas/components/EditorToolbar.tsx',
  'src/app/plantillas/nueva/page.tsx',
]);

const metricWeightExceptions = new Set([
  'src/app/documents-dashboard/components/EstadoDocumentosWidget.tsx',
  'src/app/documents-dashboard/components/EstadoParticipacionesWidget.tsx',
  'src/app/documents-dashboard/page.tsx',
  'src/app/facturacion/page.tsx',
  'src/app/mis-documentos/page.tsx',
]);

test('application interface does not reintroduce the legacy 700 utility', () => {
  const offenders = [...sources].filter(([, source]) => source.includes('font-700'));
  assert.deepEqual(offenders.map(([file]) => file), []);
});

test('bold utility is limited to authored documents, stamps and formatting controls', () => {
  const offenders = [...sources]
    .filter(([file, source]) => source.includes('font-bold') && !authoredContentExceptions.has(file))
    .map(([file]) => file);
  assert.deepEqual(offenders, []);
});

test('extra-heavy utility is reserved for numeric metrics and pricing', () => {
  const offenders = [...sources]
    .filter(([file, source]) => source.includes('font-800') && !metricWeightExceptions.has(file))
    .map(([file]) => file);
  assert.deepEqual(offenders, []);
});

test('legacy inline interface weights are removed from mobile identity flows', () => {
  for (const route of [
    'src/app/captura-id-movil/[token]/page.tsx',
    'src/app/enrolamiento/[token]/page.tsx',
  ]) {
    assert.doesNotMatch(sources.get(route) || '', /fontWeight:\s*(?:700|800|900)/);
  }
});
