'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, CalendarClock, CheckCircle2, CircleAlert, Loader2, ShieldCheck } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { useAuth } from '@/contexts/AuthContext';

type Preview = {
  organization?: { id?: string; name?: string; logo_url?: string | null };
  role?: string;
  email?: string;
  expires_at?: string;
};

export default function OrganizationInvitationPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { user, session, loading: authLoading } = useAuth();
  const token = useMemo(() => String(params?.token || ''), [params?.token]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);

  const returnTo = `/invitacion-organizacion/${encodeURIComponent(token)}`;

  const loadPreview = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/organizacion/invitations/accept?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'La invitacion no esta disponible.');
      setPreview(payload.data || null);
    } catch (cause: any) {
      setError(cause?.message || 'La invitacion no esta disponible.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  const accept = async () => {
    if (!session?.access_token) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/organizacion/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ token }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo aceptar la invitacion.');
      setAccepted(true);
      window.setTimeout(() => router.replace('/inicio'), 1800);
    } catch (cause: any) {
      setError(cause?.message || 'No se pudo aceptar la invitacion.');
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="min-h-screen bg-[#F6F8FB] dark:bg-[#101216] px-4 py-10 grid place-items-center">
    <section className="w-full max-w-xl rounded-lg border border-border bg-background shadow-sm overflow-hidden">
      <header className="h-20 px-6 border-b border-border flex items-center justify-between gap-4">
        <AppLogo className="h-8 w-auto" />
        <span className="text-xs font-medium text-muted-foreground">ACCESO SEGURO</span>
      </header>
      <div className="p-6 sm:p-8">
        {loading || authLoading ? <div className="min-h-64 grid place-items-center text-sm text-muted-foreground"><span className="inline-flex items-center gap-2"><Loader2 size={18} className="animate-spin" /> Validando invitacion...</span></div> : accepted ? <div className="min-h-64 grid place-items-center text-center"><div><div className="mx-auto h-14 w-14 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center"><CheckCircle2 size={28} /></div><h1 className="mt-5 text-2xl font-medium">Ya formas parte de la organizacion</h1><p className="mt-2 text-sm text-muted-foreground">Estamos preparando tu espacio de trabajo.</p></div></div> : preview ? <>
          <div className="h-12 w-12 rounded-md bg-primary/10 text-primary grid place-items-center"><Building2 size={23} /></div>
          <p className="mt-5 text-sm font-medium text-primary">INVITACION A ORGANIZACION</p>
          <h1 className="mt-2 text-2xl font-medium">Unete a {preview.organization?.name || 'la organizacion'}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Colabora con documentos, procesos y recursos administrados en Docubox.</p>
          <dl className="mt-6 rounded-lg border border-border divide-y divide-border text-sm">
            <div className="p-4 flex justify-between gap-4"><dt className="text-muted-foreground">Correo invitado</dt><dd className="font-medium text-right">{preview.email}</dd></div>
            <div className="p-4 flex justify-between gap-4"><dt className="text-muted-foreground">Rol inicial</dt><dd className="font-medium text-right">{preview.role}</dd></div>
            <div className="p-4 flex justify-between gap-4"><dt className="text-muted-foreground inline-flex items-center gap-2"><CalendarClock size={15} /> Vigencia</dt><dd className="font-medium text-right">{preview.expires_at ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(preview.expires_at)) : 'No disponible'}</dd></div>
          </dl>
          {error && <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><CircleAlert size={17} className="shrink-0 mt-0.5" />{error}</div>}
          {user ? <button onClick={accept} disabled={submitting} className="mt-6 h-11 w-full rounded-md bg-primary text-white text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50">{submitting ? <Loader2 size={17} className="animate-spin" /> : <ShieldCheck size={17} />} Aceptar y entrar</button> : <div className="mt-6 grid sm:grid-cols-2 gap-3"><Link href={`/login?returnTo=${encodeURIComponent(returnTo)}`} className="h-11 rounded-md bg-primary text-white text-sm font-medium grid place-items-center">Iniciar sesion</Link><Link href={`/registro?returnTo=${encodeURIComponent(returnTo)}`} className="h-11 rounded-md border border-border text-sm font-medium grid place-items-center">Crear cuenta</Link></div>}
          <p className="mt-4 text-xs leading-5 text-muted-foreground">Debes iniciar sesion con el mismo correo al que se envio esta invitacion.</p>
        </> : <div className="min-h-64 grid place-items-center text-center"><div><CircleAlert size={30} className="mx-auto text-red-500" /><h1 className="mt-4 text-xl font-medium">Invitacion no disponible</h1><p className="mt-2 text-sm text-muted-foreground max-w-sm">{error || 'El enlace puede haber vencido, sido cancelado o utilizado anteriormente.'}</p><Link href="/login" className="mt-5 inline-flex h-10 items-center px-4 rounded-md bg-primary text-white text-sm font-medium">Ir a inicio de sesion</Link></div></div>}
      </div>
    </section>
  </main>;
}

