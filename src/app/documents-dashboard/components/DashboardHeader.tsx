'use client';

import React from 'react';
import Link from 'next/link';
import { Plus, Download, RefreshCw } from 'lucide-react';

export default function DashboardHeader() {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-2xl font-700 text-foreground tracking-tight">Dashboard de Documentos</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Actualizado el 21 de marzo de 2026 · 18:27 CST
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-500 text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-150 active:scale-95">
          <RefreshCw size={14} />
          Actualizar
        </button>
        <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-500 text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-150 active:scale-95">
          <Download size={14} />
          Exportar
        </button>
        <Link
          href="/documents-dashboard"
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-600 hover:bg-primary-700 transition-all duration-150 active:scale-95 shadow-sm"
        >
          <Plus size={15} />
          Nuevo Documento
        </Link>
      </div>
    </div>
  );
}