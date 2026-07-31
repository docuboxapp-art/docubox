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
export default function PublicTokenLayout({ children, token, luciaScope }: PublicTokenLayoutProps) {
  const [luciaOpen, setLuciaOpen] = useState(false);

  return (
    <div className="min-h-screen w-full bg-background dark:bg-background">
      {children}

      {/* LucIA floating button for public token routes */}
      {!luciaOpen && (
        <button
          onClick={() => setLuciaOpen(true)}
          className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-105"
          aria-label="Abrir asistente LucIA"
          title="¿Necesitas ayuda? Pregúntale a LucIA"
        >
          <Sparkles className="w-6 h-6 text-white" />
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
