'use client';
import { BottomNotice } from '@/components/ui/BottomNotice';
import { useState } from 'react';
import { Copy, Loader2, Send } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCollaboration } from '@/contexts/CollaborationContext';
import { useCollaborationApi } from '@/lib/collaboration/client';

export default function RequestInvitationActions({
  requestId,
  status,
  invitationStatus,
}: {
  requestId: string;
  status: string;
  invitationStatus?: string;
}) {
  const { activeWorkspace } = useWorkspace();
  const { can } = useCollaboration();
  const api = useCollaborationApi();
  const [deliveryStatus, setDeliveryStatus] = useState(invitationStatus || 'not_requested');
  const [sending, setSending] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [link, setLink] = useState('');
  if (!can('requests.create', true) || ['cancelled', 'expired', 'completed'].includes(status))
    return null;
  const send = async () => {
    if (!activeWorkspace?.id) return;
    setSending(true);
    setError('');
    setMessage('');
    try {
      const result = await api<{ path: string; message: string; status: string }>(
        '/api/colabora/invitations',
        {
          method: 'POST',
          body: JSON.stringify({ workspace_id: activeWorkspace.id, request_id: requestId }),
        }
      );
      setLink(new URL(result.path, window.location.origin).href);
      setMessage(result.message);
      setDeliveryStatus(result.status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar la invitación.');
    } finally {
      setSending(false);
    }
  };
  return (
    <section className="rounded-lg border border-border bg-background p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Invitación del destinatario</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {deliveryStatus === 'sent'
              ? 'Correo enviado'
              : deliveryStatus === 'failed'
                ? 'El último correo no pudo enviarse'
                : 'Comparte la solicitud con el destinatario'}
            . Renovar la invitación invalida el enlace anterior.
          </p>
        </div>
        <button
          type="button"
          onClick={send}
          disabled={sending}
          className="colabora-secondary-button"
        >
          {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}{' '}
          {deliveryStatus === 'sent' ? 'Reenviar invitación' : 'Enviar invitación'}
        </button>
      </div>
      {message && <BottomNotice message={message} onClose={() => setMessage('')} />}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
      {link && (
        <div className="mt-3 flex gap-2">
          <input
            readOnly
            aria-label="Enlace renovado de la solicitud"
            value={link}
            className="colabora-input"
          />
          <button
            type="button"
            aria-label="Copiar enlace renovado"
            className="colabora-icon-button"
            onClick={() =>
              void navigator.clipboard
                .writeText(link)
                .then(() => setMessage('Enlace copiado.'))
                .catch(() => setError('Selecciona el enlace y cópialo manualmente.'))
            }
          >
            <Copy size={16} />
          </button>
        </div>
      )}
    </section>
  );
}
