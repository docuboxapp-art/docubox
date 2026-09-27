import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const viewer = await readFile(
  new URL('../src/app/visor-documento/[id]/page.tsx', import.meta.url),
  'utf8'
);

test('audit sections have the requested reading order and consistent headings', () => {
  assert.match(viewer, /className="flex flex-col gap-4 p-4"/);

  const auditStart = viewer.indexOf('/* ── Constancia de auditoría hasta el cierre ── */');
  const auditEnd = viewer.indexOf('/* ── Descargas del documento ── */', auditStart);
  assert.ok(auditStart > 0 && auditEnd > auditStart);
  const auditMarkup = viewer.slice(auditStart, auditEnd);
  const headings = [
    ...auditMarkup.matchAll(
      /<h3 className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wide text-foreground">\s*([^<]+)\s*<\/h3>/g
    ),
  ].map(([, heading]) => heading.trim());
  assert.deepEqual(headings, [
    'Constancia de Auditoría',
    'XML de Evidencia',
    'Evidencia Blockchain',
    'Integridad y Evidencia Digital',
    'Paquete de Evidencia',
  ]);
  assert.doesNotMatch(auditMarkup, /className="order-[1-5]/);

  assert.match(
    viewer,
    /<details className="group border-t border-border\/60 pt-3">[\s\S]*?Detalles técnicos del documento firmado/
  );
});
