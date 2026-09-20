'use client';

import type { TemplateDocxImportResult } from './types';

const DATABASE_NAME = 'docubox-template-imports';
const STORE_NAME = 'imports';
const DATABASE_VERSION = 1;
const FALLBACK_PREFIX = 'docubox:template-import:';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'importId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('No se pudo abrir el almacenamiento temporal.'));
  });
}

async function runStoreOperation<T>(
  mode: 'readonly' | 'readwrite',
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Falló la sesión de importación.'));
    });
  } finally {
    database.close();
  }
}

export async function saveTemplateImportSession(result: TemplateDocxImportResult) {
  try {
    await runStoreOperation('readwrite', (store) => store.put(result));
    return;
  } catch {
    try {
      sessionStorage.setItem(`${FALLBACK_PREFIX}${result.importId}`, JSON.stringify(result));
    } catch {
      throw new Error(
        'El documento procesado es demasiado grande para prepararlo en este navegador.'
      );
    }
  }
}

export async function readTemplateImportSession(importId: string) {
  let result: TemplateDocxImportResult | null = null;
  try {
    const stored = await runStoreOperation<TemplateDocxImportResult | undefined>(
      'readonly',
      (store) => store.get(importId)
    );
    result = stored || null;
  } catch {
    const stored = sessionStorage.getItem(`${FALLBACK_PREFIX}${importId}`);
    result = stored ? (JSON.parse(stored) as TemplateDocxImportResult) : null;
  }
  if (result && new Date(result.expiresAt).getTime() <= Date.now()) {
    await removeTemplateImportSession(importId);
    return null;
  }
  return result;
}

export async function removeTemplateImportSession(importId: string) {
  try {
    await runStoreOperation('readwrite', (store) => store.delete(importId));
  } catch {
    // The sessionStorage fallback is cleaned below.
  }
  sessionStorage.removeItem(`${FALLBACK_PREFIX}${importId}`);
}
