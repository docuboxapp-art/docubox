import assert from 'node:assert/strict';
import test from 'node:test';
import { FormDesignSaveError, saveFormAndDesignDefaults } from '../src/lib/forms/design-save.ts';

test('Guardar cambios persiste primero el formulario y luego el diseño predeterminado', async () => {
  const calls = [];
  const saved = await saveFormAndDesignDefaults(
    async () => { calls.push('formulario'); },
    async () => { calls.push('predeterminado'); return { headerText: 'Nuevo diseño' }; }
  );
  assert.deepEqual(calls, ['formulario', 'predeterminado']);
  assert.equal(saved.headerText, 'Nuevo diseño');
});

test('un fallo del formulario impide cambiar los predeterminados', async () => {
  let defaultsCalled = false;
  await assert.rejects(
    saveFormAndDesignDefaults(
      async () => { throw new Error('falló el borrador'); },
      async () => { defaultsCalled = true; }
    ),
    (error) => error instanceof FormDesignSaveError && error.stage === 'form'
  );
  assert.equal(defaultsCalled, false);
});

test('un fallo posterior identifica que el borrador sí se guardó', async () => {
  await assert.rejects(
    saveFormAndDesignDefaults(
      async () => 'draft-id',
      async () => { throw new Error('falló el predeterminado'); }
    ),
    (error) => error instanceof FormDesignSaveError && error.stage === 'defaults'
  );
});
