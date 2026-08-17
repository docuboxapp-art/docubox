import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMetaDefenderResult, scanWithMetaDefender } from './metadefender.ts';

test('interpreta un resultado limpio de MetaDefender', () => {
  assert.deepEqual(
    parseMetaDefenderResult({
      process_info: { progress_percentage: 100 },
      scan_results: {
        scan_all_result_i: 0,
        scan_details: { EngineA: { scan_result_i: 0, threat_found: '' } },
      },
    }),
    { clean: true, engine: 'MetaDefender Cloud' }
  );
});

test('falla cerrado ante una amenaza', () => {
  assert.equal(
    parseMetaDefenderResult({
      process_info: { progress_percentage: 100 },
      scan_results: {
        scan_all_result_i: 1,
        scan_details: { EngineA: { scan_result_i: 1, threat_found: 'EICAR-Test' } },
      },
    })?.clean,
    false
  );
});

test('reutiliza el resultado conocido por hash sin subir el archivo', async () => {
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    requests.push(String(input));
    return Response.json({
      process_info: { progress_percentage: 100 },
      scan_results: { scan_all_result_i: 0, scan_details: { EngineA: { scan_result_i: 0 } } },
    });
  };

  const result = await scanWithMetaDefender({
    bytes: Buffer.from('archivo-limpio'),
    filename: 'documento.pdf',
    apiKey: 'test-key',
    fetchImpl,
    pollIntervalMs: 0,
  });

  assert.equal(result.clean, true);
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/hash\/[a-f0-9]{64}$/);
});
