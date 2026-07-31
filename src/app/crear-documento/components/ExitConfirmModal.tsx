'use client';

import React, { useEffect } from 'react';
import { AlertTriangle, Save, AlertCircle } from 'lucide-react';

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
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center shrink-0">
              <AlertTriangle size={20} className="text-amber-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">¿Deseas salir?</h2>
              <p className="text-sm text-gray-500">Tienes cambios sin guardar en este documento.</p>
            </div>
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
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
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
              className="w-full px-4 py-2.5 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
            >
              Salir sin guardar
            </button>
            <button
              onClick={onClose}
              className="w-full px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
