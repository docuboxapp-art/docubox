/** Shared, non-secret portal contracts and upload constraints. */
export type PortalItem = {
  id: string;
  title: string;
  description?: string;
  required: boolean;
  status: string;
  canSubmit: boolean;
  canResume?: boolean;
  formats?: string[];
  maxBytes?: number;
  askIssueDate?: boolean;
};
export type CasePortal = {
  title: string;
  folio: string;
  status: string;
  progress: number;
  sender: string;
  participantName: string;
  role: string;
  expiresAt: string;
  requirements: PortalItem[];
  forms: PortalItem[];
};
export const portalMime = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
} as const;
export function portalFileRules(settings: Record<string, unknown>) {
  const configured = Array.isArray(settings.allowedFormats)
    ? settings.allowedFormats.map(String)
    : [];
  const formats = (configured.length ? configured : ['pdf', 'jpg', 'png']).map((f) =>
    f.toLowerCase()
  );
  const mimes: string[] = [
    ...new Set(
      formats
        .map(
          (f) =>
            portalMime[f as keyof typeof portalMime] ||
            (Object.values(portalMime).includes(f as never) ? f : '')
        )
        .filter(Boolean)
    ),
  ];
  const maxBytes = Math.min(100, Math.max(1, Number(settings.maxSizeMb) || 15)) * 1024 * 1024;
  return {
    formats,
    mimes,
    maxBytes,
    askIssueDate: settings.askIssueDate === true || !!settings.validityDays,
  };
}
export const portalStatus = (value: string) =>
  ({
    pending: 'Pendiente',
    not_started: 'Pendiente',
    uploaded: 'Recibido',
    submitted: 'Recibido',
    in_review: 'En revisión',
    approved: 'Aprobado',
    observed: 'Con observaciones',
    expired: 'Vencido',
    completed: 'Completado',
    signed: 'Firmado',
    locked: 'Completado',
  })[value] || 'En seguimiento';
