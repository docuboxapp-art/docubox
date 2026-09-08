import React from 'react';

interface PublicTokenLayoutProps {
  children: React.ReactNode;
  /** The public token from the URL — passed to LucIA for token-scoped context */
  token?: string;
  /** Optional: override the scope for LucIA (e.g. 'external_participant', 'public_form') */
  luciaScope?: string;
  /** Keeps the assistant trigger aligned with compact operational screens. */
  compactAssistant?: boolean;
}

/**
 * PublicTokenLayout
 *
 * Layout for public token-based routes:
 * - /portal-participante/[token]
 * - /registro-participante/[token]
 * - /form/[token]
 * - /enrolamiento/[token]
 * - /captura-id-movil/[token]
 * - /subir-movil/[token]
 *
 * LucIA is mounted once by LuciaAssistantProvider, which resolves the
 * current public capability without duplicating assistants in this shell.
 */
export default function PublicTokenLayout({
  children,
  token,
  luciaScope,
  compactAssistant = false,
}: PublicTokenLayoutProps) {
  void token;
  void luciaScope;
  void compactAssistant;

  return <div className="min-h-screen w-full bg-background dark:bg-background">{children}</div>;
}
