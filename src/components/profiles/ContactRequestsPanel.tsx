'use client';

import Link from 'next/link';
import { Inbox, Send, UserPlus, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { profilePrivacy } from '@/lib/profile-privacy/client';
import {
  CONTACT_REQUEST_APPROVAL_LABEL,
  formatPrivacyDate,
  REQUEST_STATUS_LABELS,
  SENT_REQUEST_STATUS_LABELS,
  type ContactRequestInbox,
} from '@/lib/profile-privacy/model';

const actionButton =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted focus-visible:outline-primary disabled:opacity-50';
const primaryButton =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-primary disabled:opacity-50';

function RequestCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border bg-muted/45 px-4 py-3 sm:px-5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function RequestState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center sm:py-10">
      <span className="mb-3 grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon size={18} aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export function ContactRequestsPanel({
  data,
  error,
  reload,
  onOpenContact,
}: {
  data: ContactRequestInbox | null;
  error: string;
  reload: () => void;
  onOpenContact?: (contactId: string) => void;
}) {
  const [busy, setBusy] = useState('');
  async function decide(id: string, decision: 'approve' | 'decline' | 'revoke') {
    setBusy(id);
    try {
      await profilePrivacy('decide', { requestId: id, decision });
      toast.success(
        decision === 'approve'
          ? 'Solicitud aprobada.'
          : decision === 'decline'
            ? 'Solicitud rechazada.'
            : 'Acceso revocado.'
      );
      reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'No fue posible resolver la solicitud.');
    } finally {
      setBusy('');
    }
  }
  if (error || !data)
    return (
      <RequestCard title="Solicitudes de contacto">
        {error ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {error}{' '}
            <button type="button" onClick={reload} className="ml-1 font-medium underline">
              Reintentar
            </button>
          </p>
        ) : (
          <p role="status" className="p-4 text-sm text-muted-foreground">
            Cargando solicitudes…
          </p>
        )}
      </RequestCard>
    );

  return (
    <div className="space-y-4">
      <RequestCard
        title="Solicitudes de contacto recibidas"
        description={
          data.allowContacts && data.received.length
            ? 'Puedes aprobar o rechazar las solicitudes de quienes quieren agregarte a su agenda.'
            : undefined
        }
      >
        {!data.allowContacts ? (
          <RequestState icon={UserPlus} title="Aprobación de contactos desactivada">
            Pueden agregarte directamente a su agenda. Si quieres revisar cada solicitud, activa «
            {CONTACT_REQUEST_APPROVAL_LABEL}» en Opciones de privacidad.
          </RequestState>
        ) : data.received.length === 0 ? (
          <RequestState icon={Inbox} title="Aún no has recibido solicitudes">
            Cuando alguien pida agregarte a su agenda, podrás aprobar o rechazar su solicitud aquí.
          </RequestState>
        ) : (
          <ul className="divide-y divide-border">
            {data.received.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 break-words">
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatPrivacyDate(item.created_at)} · {REQUEST_STATUS_LABELS[item.status]}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.status === 'pending' && (
                    <>
                      <button
                        type="button"
                        className={actionButton}
                        disabled={Boolean(busy)}
                        onClick={() => void decide(item.id, 'decline')}
                      >
                        Rechazar
                      </button>
                      <button
                        type="button"
                        className={primaryButton}
                        disabled={Boolean(busy)}
                        onClick={() => void decide(item.id, 'approve')}
                      >
                        Aprobar
                      </button>
                    </>
                  )}
                  {item.status === 'approved' && (
                    <button
                      type="button"
                      className={actionButton}
                      disabled={Boolean(busy)}
                      onClick={() => void decide(item.id, 'revoke')}
                    >
                      Revocar acceso
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </RequestCard>
      <RequestCard
        title="Solicitudes de contacto enviadas"
        description={
          data.sent.length
            ? 'Si la otra persona aprueba tu solicitud, aparecerá en tu agenda.'
            : undefined
        }
      >
        {data.sent.length === 0 ? (
          <RequestState icon={Send} title="Aún no has enviado solicitudes">
            Al usar «Agregar contacto», puedes enviar una solicitud si la otra persona necesita
            aprobar que la agregues.
          </RequestState>
        ) : (
          <ul className="divide-y divide-border">
            {data.sent.map(({ id, name, email, created_at, status, contactId }) => (
              <li key={id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 break-words">
                  <p className="text-sm font-medium">
                    {name || email || `Perfil privado · ${id.slice(0, 8).toUpperCase()}`}
                  </p>
                  {name && email && <p className="mt-0.5 text-xs text-muted-foreground">{email}</p>}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatPrivacyDate(created_at)} · {SENT_REQUEST_STATUS_LABELS[status]}
                  </p>
                </div>
                {contactId &&
                  status === 'approved' &&
                  (onOpenContact ? (
                    <button
                      type="button"
                      className={actionButton}
                      onClick={() => onOpenContact(contactId)}
                    >
                      Ver contacto
                    </button>
                  ) : (
                    <Link
                      className={actionButton}
                      href={`/contactos?contact=${encodeURIComponent(contactId)}`}
                    >
                      Ver contacto
                    </Link>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </RequestCard>
    </div>
  );
}
