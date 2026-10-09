export class FormDesignSaveError extends Error {
  readonly stage: 'form' | 'defaults';
  readonly cause: unknown;

  constructor(stage: 'form' | 'defaults', cause: unknown) {
    super('No se pudo completar el guardado del diseño.');
    this.stage = stage;
    this.cause = cause;
  }
}

export async function saveFormAndDesignDefaults<T>(
  saveForm: () => Promise<unknown>,
  saveDefaults: () => Promise<T>
): Promise<T> {
  try {
    await saveForm();
  } catch (cause) {
    throw new FormDesignSaveError('form', cause);
  }
  try {
    return await saveDefaults();
  } catch (cause) {
    throw new FormDesignSaveError('defaults', cause);
  }
}
