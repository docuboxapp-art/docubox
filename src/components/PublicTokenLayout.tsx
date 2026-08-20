'use client';

import React, { useState } from 'react';
import LucIAChat from './LucIAChat';
import { Sparkles } from 'lucide-react';

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
 * Mounts LucIAChat in mode="public-token" so it only consults
 * the resource associated with the token, never the full workspace.
 */
export default function PublicTokenLayout({
  children,
  token,
  luciaScope,
  compactAssistant = false,
}: PublicTokenLayoutProps) {
  const [luciaOpen, setLuciaOpen] = useState(false);

  return (
    <div className="min-h-screen w-full bg-background dark:bg-background">
      {children}

      {/* LucIA floating button for public token routes */}
      {!luciaOpen && (
        <button
          onClick={() => setLuciaOpen(true)}
          className={`fixed z-40 flex items-center justify-center bg-primary text-white shadow-lg transition-colors hover:bg-primary/90 ${
            compactAssistant
              ? 'bottom-5 right-5 h-11 w-11 rounded-lg border border-white/70'
              : 'bottom-6 right-6 h-14 w-14 rounded-full hover:scale-105'
          }`}
          aria-label="Abrir asistente LucIA"
          title="¿Necesitas ayuda? Pregúntale a LucIA"
        >
          <Sparkles className={compactAssistant ? 'h-5 w-5' : 'h-6 w-6'} />
        </button>
      )}

      {/* LucIA in public-token mode — only accesses token-scoped resource */}
      <LucIAChat
        isOpen={luciaOpen}
        onClose={() => setLuciaOpen(false)}
        mode="public-token"
        publicToken={token}
      />
    </div>
  );
}
