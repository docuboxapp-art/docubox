import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const script = await build({
  stdin: {
    resolveDir: root,
    contents: [
      "export * from './src/lib/help/catalog.server'",
      "export * from './src/lib/help/search'",
      "export * from './src/lib/help/query'",
      "export * from './src/lib/help/model'",
      "export * from './src/lib/help/request.server'",
      "export * from './src/lib/help/support.server'",
    ].join('\n'),
  },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  plugins: [
    {
      name: 'server-only-test',
      setup(builder) {
        builder.onResolve({ filter: /^server-only$/ }, () => ({
          path: 'server-only',
          namespace: 'test',
        }));
        builder.onLoad({ filter: /./, namespace: 'test' }, () => ({ contents: '' }));
      },
    },
  ],
});
const compiled = { exports: {} };
new Function('module', 'exports', script.outputFiles[0].text)(compiled, compiled.exports);
const help = compiled.exports;

test('publication validates article structure, references, review dates and legal sources', () => {
  const articles = help.publicHelpArticles;
  assert.equal(new Set(articles.map(({ slug }) => slug)).size, articles.length);
  assert.equal(new Set(articles.map(({ id }) => id)).size, articles.length);
  for (const article of articles) {
    assert.equal(help.getPublicHelpArticle(article.slug), article);
    assert.match(article.slug, /^[a-z0-9][a-z0-9-]{0,89}$/);
    assert.ok(help.HELP_CATEGORIES[article.category]);
    assert.ok(
      article.tags.length > 1 && article.searchTerms.length > 1 && article.audiences.length
    );
    assert.ok(
      article.related.every((slug) => slug !== article.slug && help.getPublicHelpArticle(slug))
    );
    assert.ok(article.sections.length > 0);
    assert.equal(new Set(article.sections.map(({ id }) => id)).size, article.sections.length);
    assert.ok(
      article.sections.every(
        (section) =>
          (section.steps?.length || section.items?.length || section.paragraphs?.length) > 0
      )
    );
    assert.match(article.updatedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(article.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isFinite(Date.parse(article.reviewedAt)));
    if (article.kind === 'legal') {
      assert.ok(article.scope && article.sources.length);
      assert.ok(
        article.sources.every(
          ({ href, scope }) => new URL(href).protocol === 'https:' && scope.length > 15
        )
      );
    }
    if (article.kind === 'tutorial') {
      assert.ok(article.requirements?.length);
      assert.ok(article.sections.some(({ steps }) => steps?.length > 1));
    }
  }
});

test('everyday queries, spelling variants and typos reach the intended articles', () => {
  const queries = new Map([
    ['No me llega el código', 'no-recibo-el-codigo'],
    ['NO ME LLEGA EL CODIGGO', 'no-recibo-el-codigo'],
    ['Ya firmé, qué sigue', 'que-sigue-despues-de-firmar'],
    ['No puedo descargar', 'no-puedo-descargar'],
    ['Mi e.firma no funciona', 'mi-efirma-no-funciona'],
    ['mi efirma no funciona', 'mi-efirma-no-funciona'],
    ['mi e firma no funciona', 'mi-efirma-no-funciona'],
    ['Quiero rechazar un documento', 'aprobar-rechazar-o-solicitar-cambios'],
    ['Tiene validez legal', 'validez-de-la-firma-electronica'],
  ]);
  for (const [query, slug] of queries) assert.equal(help.searchHelp(query)[0]?.slug, slug, query);
  assert.deepEqual(help.searchHelp('zzzzxxqqz'), []);
  assert.equal(
    help.searchHelp('firma', { categoria: 'legal-y-seguridad', tipo: 'legal' }, 2).length,
    2
  );
  assert.ok(
    help
      .searchHelp('roles', { audiencia: 'organizacion' })
      .every(({ slug }) => help.getPublicHelpArticle(slug).audiences.includes('organizacion'))
  );
});

test('search rebuilds with editorial updates and excludes unpublished or internal entries', () => {
  const current = help.getPublicHelpArticle('enviar-mi-primer-documento');
  const unique = 'arbolillo metalúrgico';
  const changed = {
    ...current,
    sections: [
      {
        id: 'nuevo',
        title: 'Una edición de prueba',
        paragraphs: ['El ' + unique + ' es una frase de prueba del índice.'],
      },
    ],
  };
  const entries = [
    { ...changed, status: 'draft', slug: 'draft' },
    { ...changed, status: 'archived', slug: 'archive' },
    { ...changed, visibility: 'internal', slug: 'staff' },
  ];
  assert.deepEqual(help.buildHelpIndex([current, ...entries])(unique), []);
  const result = help.buildHelpIndex([changed, ...entries])(unique);
  assert.equal(result.length, 1);
  assert.equal(result[0].slug, current.slug);
  assert.match(result[0].excerpt, /arbolillo metalúrgico/);
  assert.equal(help.getPublicHelpArticle('staff'), undefined);
});

test('public paths and shareable URLs avoid flow tokens and credentials', () => {
  const url = new URL(help.contextualHelpHref('firmar-con-efirma'), 'https://docubox.test');
  assert.equal(url.pathname, '/centro-ayuda/articulos/firmar-con-efirma');
  assert.deepEqual(
    [...url.searchParams.entries()],
    [
      ['audiencia', 'participar'],
      ['origen', 'flujo'],
    ]
  );
  assert.equal(help.isHelpPage('/centro-ayuda-falso'), false);
  assert.equal(help.isHelpApi('/api/centro-ayuda/privado'), false);
  const query =
    'código 555222 111 222 persona@ejemplo.test https://docubox.test/portal-participante/demo contraseña=secreto';
  assert.equal(help.cleanHelpQuery(query), 'código contraseña');
  assert.equal(
    help.helpSearchHref(query, { tipo: 'solucion' }),
    '/centro-ayuda/buscar?q=c%C3%B3digo+contrase%C3%B1a&tipo=solucion'
  );
});

test('public help APIs accept bounded same-origin JSON and reject alternate body formats', async () => {
  const request = (body, origin = 'https://docubox.test', contentType = 'application/json') =>
    new Request('https://docubox.test/api/centro-ayuda/buscar', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': contentType },
      body,
    });
  assert.deepEqual(await help.readHelpRequest(request('{"q":"código"}')), { q: 'código' });
  await assert.rejects(help.readHelpRequest(request('{}', 'https://otro.test')), { status: 403 });
  await assert.rejects(help.readHelpRequest(request('{}', 'https://docubox.test', 'text/plain')), {
    status: 415,
  });
  await assert.rejects(help.readHelpRequest(request('[')), { status: 400 });
  await assert.rejects(help.readHelpRequest(request('x'.repeat(2049))), { status: 413 });
});

test('the support fallback accepts a disabled mailbox and only displays approved HTTPS policy links', () => {
  assert.equal(help.getHelpSupportEmail({ DOCUBOX_HELP_SUPPORT_EMAIL: '' }), null);
  assert.equal(
    help.getHelpSupportEmail({ RESEND_REPLY_TO_EMAIL: 'soporte@ejemplo.test' }),
    'soporte@ejemplo.test'
  );
  assert.deepEqual(
    help.getHelpInstitutionalLinks({
      DOCUBOX_HELP_TERMS_URL: 'javascript:alert(1)',
      DOCUBOX_HELP_PRIVACY_URL: 'https://ejemplo.test/aviso',
    }),
    [{ title: 'Aviso de privacidad', href: 'https://ejemplo.test/aviso' }]
  );
});

const runtime = '../.tmp/colabora-db-qa/node_modules/@electric-sql/pglite';
let embeddedPostgres = true;
try {
  require.resolve(runtime);
} catch {
  embeddedPostgres = false;
}

test(
  'the feedback migration supports atomic retries and denies direct access to visitors and tenants',
  {
    skip: embeddedPostgres ? false : 'PGlite de pruebas no disponible',
  },
  async () => {
    const { PGlite } = require(runtime);
    const db = new PGlite();
    try {
      await db.exec(
        'create role anon; create role authenticated; create role service_role bypassrls;'
      );
      await db.exec(
        await readFile(
          resolve(root, 'supabase/migrations/20261124150150_help_article_feedback.sql'),
          'utf8'
        )
      );
      await db.exec('set role service_role');
      const slug = 'firmar-un-documento';
      const anonymousId = 'a'.repeat(64);
      const sql =
        'insert into public.help_article_feedback (article_slug,voter_hash,helpful,reason) values ($1,$2,$3,$4) on conflict (article_slug,voter_hash) do update set helpful=excluded.helpful,reason=excluded.reason';
      await db.query(sql, [slug, anonymousId, true, null]);
      await db.query(sql, [slug, anonymousId, false, 'steps_changed']);
      const stored = await db.query(
        'select article_slug,helpful,reason from public.help_article_feedback'
      );
      assert.deepEqual(stored.rows, [
        { article_slug: slug, helpful: false, reason: 'steps_changed' },
      ]);
      await assert.rejects(
        db.query(sql, [slug, anonymousId, true, 'steps_changed']),
        /check constraint/i
      );
      for (const role of ['anon', 'authenticated']) {
        await db.exec('reset role; set role ' + role);
        await assert.rejects(
          db.query('select * from public.help_article_feedback'),
          /permission denied/i
        );
        await assert.rejects(db.query(sql, [slug, anonymousId, true, null]), /permission denied/i);
      }
    } finally {
      await db.close();
    }
  }
);
