'use client';

import { useEffect, useRef, useState } from 'react';
import { Globe2, Loader2, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useOrganizationAccess } from './OrganizationAccessContext';

type Verification = {
  message: string;
  status: string;
  records: Array<{ type: string; name: string; value: string; priority?: number }>;
};
export default function OrganizationDomainVerification({
  id,
  onSaved,
}: {
  id: string;
  onSaved: () => void | Promise<void>;
}) {
  const { session } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const { canAccess } = useOrganizationAccess();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Verification | null>(null);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  if (!canAccess('branding.manage')) return null;
  const check = async (action: 'prepare' | 'verify') => {
    setOpen(true);
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/organizacion/sender-domains', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({ workspace_id: activeWorkspace!.id, domain_id: id, action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo verificar el dominio.');
      setData(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo verificar el dominio.');
    } finally {
      setLoading(false);
    }
  };
  const close = () => {
    setOpen(false);
    void onSaved();
  };
  return (
    <>
      <button
        type="button"
        className="organization-record-action"
        onClick={() => check('prepare')}
        title="Verificar dominio"
        aria-label="Verificar dominio"
      >
        <Globe2 size={15} />
      </button>
      <dialog
        ref={dialog}
        className="organization-record-dialog"
        onCancel={(event) => {
          event.preventDefault();
          if (!loading) close();
        }}
      >
        <div className="organization-record-dialog-header">
          <div>
            <h3>Verificación del dominio</h3>
            <p>Configura los registros DNS para usar este remitente.</p>
          </div>
          <button type="button" disabled={loading} onClick={close} aria-label="Cerrar verificación">
            <X size={18} />
          </button>
        </div>
        <div className="organization-record-dialog-body">
          {error && (
            <p role="alert" className="mb-4 text-sm text-red-600">
              {error}
            </p>
          )}
          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              Consultando verificación...
            </p>
          )}
          {data && (
            <>
              <p className="mb-4 text-sm">{data.message}</p>
              <div className="space-y-3">
                {data.records.map((record, index) => (
                  <div
                    key={`${record.type}-${index}`}
                    className="rounded-md border border-border p-3 text-sm"
                  >
                    <p className="font-medium">
                      {record.type}
                      {record.priority === undefined ? '' : ` · Prioridad ${record.priority}`}
                    </p>
                    <p className="mt-2 break-all text-muted-foreground">{record.name}</p>
                    <p className="mt-1 break-all font-mono text-xs">{record.value}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="organization-record-dialog-footer">
          <button
            type="button"
            onClick={close}
            disabled={loading}
            className="organization-secondary-button"
          >
            Cerrar
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => check('verify')}
            className="organization-primary-button"
          >
            Comprobar DNS
          </button>
        </div>
      </dialog>
    </>
  );
}
