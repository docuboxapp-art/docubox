'use client';

import React, { useEffect } from 'react';
import { Save, AlertCircle } from 'lucide-react';

export function ExitConfirmModal({
  onClose,
  onExitWithoutSave,
  onSaveDraft,
  saving,
  canSave = true,
}: {
  onClose: () => void;
  onExitWithoutSave: () => void;
  onSaveDraft: () => void;
  saving: boolean;
  canSave?: boolean;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-6">
          <div className="mb-4">
              <h2 className="text-lg font-bold text-gray-900">¿Deseas salir?</h2>
              <p className="text-sm text-gray-500">Tienes cambios sin guardar en este documento.</p>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Puedes guardar tu avance como borrador para continuar más tarde, o salir sin guardar y perder los cambios realizados.
          </p>
          {!canSave && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mb-4">
              <AlertCircle size={15} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-600">Para guardar el avance primero debes cargar el documento y asignarle un nombre.</p>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <button
              onClick={onSaveDraft}
              disabled={saving || !canSave}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Guardando...
                </>
              ) : (
                <><Save size={15} />Guardar avance y salir</>
              )}
            </button>
            <button
              onClick={onExitWithoutSave}
              className="h-9 w-full rounded-lg border border-red-200 px-4 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
            >
              Salir sin guardar
            </button>
            <button
              onClick={onClose}
              className="h-9 w-full rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
