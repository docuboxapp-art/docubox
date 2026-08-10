'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Eye, FileText, Loader2, Pencil } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { normalizeFormTemplate, type FormTemplate } from '@/lib/forms/schema';
import FormPreview from '../components/FormPreview';

function PreviewContent() {
  const router = useRouter();
  const formId = useSearchParams().get('id');
  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [mode, setMode] = useState<'web' | 'pdf'>('web');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!formId) { setLoading(false); return; }
    const load = async () => {
      const { data } = await createClient().from('form_templates').select('*').eq('id', formId).single();
      if (data) setTemplate(normalizeFormTemplate({
        id: data.id, name: data.name, description: data.description, status: data.status,
        schema: data.form_schema?.fields || data.schema,
        sections: data.form_schema?.sections || data.settings?.sections,
        settings: { ...data.settings, pdfSchema: data.pdf_schema && Object.keys(data.pdf_schema).length ? data.pdf_schema : data.settings?.pdfSchema },
      }));
      setLoading(false);
    };
    load();
  }, [formId]);

  return (
    <AppLayout noPadding>
      <div className="mx-auto max-w-[1450px]">
        <header className="flex flex-col gap-4 border-b border-[#EBEBF0] pb-4 md:flex-row md:items-center md:justify-between dark:border-border">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => router.push('/formularios')} className="flex h-9 w-9 items-center justify-center rounded-md border border-[#EBEBF0] text-[#52525B] hover:bg-[#F4F4F5] dark:border-border"><ArrowLeft size={15} /></button>
            <div><h1 className="text-xl font-semibold text-[#18181B] dark:text-foreground">Vista previa</h1><p className="mt-1 text-xs text-[#71717A]">{template?.name || 'Formulario firmable'}</p></div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-[#EBEBF0] bg-white p-1 dark:border-border dark:bg-card">
              <Tab active={mode === 'web'} icon={Eye} label="Formulario web" onClick={() => setMode('web')} />
              <Tab active={mode === 'pdf'} icon={FileText} label="PDF espejo" onClick={() => setMode('pdf')} />
            </div>
            {formId && <button type="button" onClick={() => router.push(`/formularios/builder?id=${formId}`)} className="flex h-10 items-center gap-2 rounded-md bg-[#4F46E5] px-4 text-xs font-semibold text-white"><Pencil size={14} /> Editar</button>}
          </div>
        </header>

        <div className="min-h-[700px] bg-[#F1F1F5] px-4 py-8 dark:bg-background md:px-8">
          {loading ? <div className="flex min-h-[500px] items-center justify-center"><Loader2 size={24} className="animate-spin text-[#4F46E5]" /></div> : template ? <FormPreview template={template} mode={mode} /> : <div className="flex min-h-[500px] items-center justify-center text-sm text-[#71717A]">No se encontró el formulario.</div>}
        </div>
      </div>
    </AppLayout>
  );
}

function Tab({ active, icon: Icon, label, onClick }: { active: boolean; icon: React.ElementType; label: string; onClick: () => void }) { return <button type="button" onClick={onClick} className={`flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium ${active ? 'bg-[#EEF2FF] text-[#4F46E5]' : 'text-[#71717A] hover:bg-[#F4F4F5]'}`}><Icon size={13} />{label}</button>; }

export default function FormPreviewPage() { return <Suspense fallback={null}><PreviewContent /></Suspense>; }
