'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, Check, Link2, Mail } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { HELP_ROOT } from '@/lib/help/model';
import styles from '../help.module.css';

const contextualKey = 'docubox.help.context';
const subscribe = () => () => {};
const readContext = () => {
  try {
    return sessionStorage.getItem(contextualKey) === 'flow';
  } catch {
    return false;
  }
};

const navItems = [
  { title: 'Guías', href: HELP_ROOT + '/guias' },
  { title: 'Tutoriales', href: HELP_ROOT + '/tutoriales' },
  { title: 'Legal y seguridad', href: HELP_ROOT + '/legal-y-seguridad' },
  { title: 'Soporte', href: HELP_ROOT + '#soporte' },
];

export function HelpNavigation() {
  const pathname = usePathname();
  return (
    <nav className={styles.nav} aria-label="Navegación del Centro de ayuda">
      {navItems.map(({ title, href }) => (
        <Link
          key={href}
          href={href}
          className={styles.navLink}
          prefetch={false}
          aria-current={pathname === href ? 'page' : undefined}
        >
          {title}
        </Link>
      ))}
    </nav>
  );
}

export function HelpReturn() {
  const contextual = useSearchParams().get('origen') === 'flujo';
  const remembered = useSyncExternalStore(subscribe, readContext, () => false);
  const [prompt, setPrompt] = useState(false);

  useEffect(() => {
    if (!contextual) return;
    try {
      sessionStorage.setItem(contextualKey, 'flow');
    } catch {
      // The current entry still has the context when storage is unavailable.
    }
  }, [contextual]);

  if (!contextual && !remembered) return <HelpAppReturnLink />;
  return (
    <div className={styles.headerAction}>
      <button
        className={styles.button}
        type="button"
        onClick={() => {
          setPrompt(true);
          window.close();
        }}
      >
        <ArrowLeft size={15} aria-hidden="true" /> Volver al flujo
      </button>
      {prompt && (
        <p role="status" className={styles.headerActionStatus}>
          Cierra esta pestaña para retomar la que dejaste abierta.
        </p>
      )}
    </div>
  );
}

export function HelpAppReturnLink() {
  return (
    <Link
      href="/inicio"
      prefetch={false}
      className={styles.button + ' ' + styles.headerAction}
      aria-label="Volver a Docubox"
    >
      <ArrowLeft size={15} aria-hidden="true" />{' '}
      <span>
        Volver <span className={styles.returnWide}>a Docubox</span>
      </span>
    </Link>
  );
}

const publicAppLinks = new Set([
  '/login',
  '/registro',
  '/olvide-contrasena',
  '/verificar-documento',
]);

export function HelpAppAction({ href, label }: { href: string; label: string }) {
  const { user } = useAuth();
  const destination =
    user || publicAppLinks.has(href) ? href : '/login?redirect=' + encodeURIComponent(href);
  return (
    <Link href={destination} prefetch={false} className={styles.button}>
      {label} <ArrowUpRight size={15} aria-hidden="true" />
    </Link>
  );
}

export function CopyHelpArticle({ path }: { path: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [copyUrl, setCopyUrl] = useState('');

  async function copy() {
    const url = new URL(path, window.location.origin).href;
    setCopyUrl(url);
    try {
      await navigator.clipboard.writeText(url);
      setStatus('copied');
    } catch {
      setStatus('manual');
    }
  }

  return (
    <div>
      <button type="button" onClick={() => void copy()} className={styles.button}>
        {status === 'copied' ? (
          <Check size={15} aria-hidden="true" />
        ) : (
          <Link2 size={15} aria-hidden="true" />
        )}
        {status === 'copied' ? 'Enlace copiado' : 'Copiar enlace'}
      </button>
      {status === 'copied' && (
        <span role="status" className="sr-only">
          Enlace copiado
        </span>
      )}
      {status === 'manual' && (
        <label className="mt-2 block text-sm">
          Selecciona y copia el enlace
          <input
            value={copyUrl}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
            className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1"
          />
        </label>
      )}
    </div>
  );
}

export function HelpSupportEmailLink({ email }: { email: string }) {
  function recordContact() {
    void fetch('/api/centro-ayuda/eventos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'support_email' }),
      keepalive: true,
    }).catch(() => undefined);
  }

  return (
    <a href={'mailto:' + email} className={styles.button} onClick={recordContact}>
      <Mail size={16} aria-hidden="true" /> Abrir correo para soporte
    </a>
  );
}
