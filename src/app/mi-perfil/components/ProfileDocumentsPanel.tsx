'use client';

import { BottomNotice } from '@/components/ui/BottomNotice';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Download, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { DEFAULT_TABLE_PAGE_SIZE, shouldShowTablePagination } from '@/lib/workspaces/table-pagination';
import { ContactEditorDialog, contactButton, contactCard, contactControl } from '@/app/contactos/contact-detail-ui';

const bucket = 'profile-support-documents';
const maxFileSize = 10 * 1024 * 1024;
const types = [
  { key: 'ine-frente', label: 'INE · Frente' },
  { key: 'ine-reverso', label: 'INE · Reverso' },
  { key: 'domicilio', label: 'Comprobante de domicilio' },
  { key: 'fiscal', label: 'Constancia de situación fiscal (SAT)' },
  { key: 'notarial', label: 'Poder notarial' },
  { key: 'ingresos', label: 'Comprobante de ingresos' },
  { key: 'otro', label: 'Otro' },
];
const mimeTypes: Record<string, string> = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };
const pageSize = DEFAULT_TABLE_PAGE_SIZE;

export function ProfileDocumentsPanel({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Array<{ id: string; name: string }>>([]);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [category, setCategory] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const { data, error } = await createClient().storage.from(bucket).list(userId, {
          limit: pageSize + 1,
          offset: page * pageSize,
          sortBy: { column: 'created_at', order: 'desc' },
        });
        if (error) throw error;
        if (!current) return;
        if (!data.length && page > 0) {
          setPage((value) => value - 1);
        } else {
          setRows(data.flatMap(({ id, name }) => id ? [{ id, name }] : []));
        }
      } catch {
        if (current) setError('No se pudo cargar tu expediente personal.');
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => { current = false; };
  }, [page, revision, userId]);

  function openUpload(key = 'otro') {
    setDialogError('');
    setCategory(key);
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const file = new FormData(event.currentTarget).get('document');
    if (!(file instanceof File) || !file.size || file.size > maxFileSize || !Object.hasOwn(mimeTypes, file.type)) {
      setDialogError('Selecciona un PDF, JPG o PNG de hasta 10 MB.');
      return;
    }
    if (!types.some(({ key }) => key === category)) return;
    setBusy(true);
    setDialogError('');
    try {
      const label = file.name.normalize('NFD').replace(/\p{M}/gu, '').replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9_. -]/g, '_').replace(/--+/g, '-').trim().slice(0, 100) || 'Documento';
      const path = `${userId}/${category}--${crypto.randomUUID()}--${label}${mimeTypes[file.type]}`;
      const { error } = await createClient().storage.from(bucket).upload(path, file, { contentType: file.type });
      if (error) throw error;
      setCategory('');
      setNotice('Documento guardado en tu expediente privado.');
      setPage(0);
      setRevision((value) => value + 1);
    } catch {
      setDialogError('No se pudo subir el documento. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  async function act(name: string, operation: 'download' | 'remove') {
    if (busy || (operation === 'remove' && !window.confirm('¿Eliminar este archivo del expediente personal?'))) return;
    setBusy(true);
    setError('');
    setNotice('');
    const path = `${userId}/${name}`;
    try {
      const storage = createClient().storage.from(bucket);
      if (operation === 'download') {
        const { data, error } = await storage.download(path);
        if (error || !data) throw error;
        const url = URL.createObjectURL(data);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name.split('--').slice(2).join('--') || 'Documento';
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const { data, error } = await storage.remove([path]);
        if (error || !data?.length) throw error ?? new Error('delete_not_confirmed');
        setNotice('Documento eliminado.');
        setRevision((value) => value + 1);
      }
    } catch {
      setError(operation === 'download' ? 'No se pudo descargar el documento.' : 'No se pudo eliminar el documento.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className={contactCard}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="text-sm font-semibold">Documentos de mi expediente</h2>
            <p className="mt-1 text-xs text-muted-foreground">Archivos privados de tu cuenta. PDF, JPG y PNG de hasta 10 MB.</p>
          </div>
          <button type="button" className={contactButton} disabled={busy} onClick={() => openUpload()}>
            <Upload size={15} /> Agregar documento
          </button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-border p-4">
          {types.map(({ key, label }) => (
            <button key={key} type="button" className={contactButton} disabled={busy} onClick={() => openUpload(key)}>
              {label}
            </button>
          ))}
        </div>
        {error && <p role="alert" className="px-4 pt-4 text-sm text-destructive">{error} <button type="button" className="underline" onClick={() => setRevision((value) => value + 1)}>Actualizar</button></p>}
        {notice && <BottomNotice message={notice} tone="success" onClose={() => setNotice('')} />}
        {loading && <p role="status" className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground"><Loader2 size={15} className="animate-spin" /> Cargando documentos…</p>}
        {!loading && !rows.length && !error && <p className="px-4 py-5 text-sm text-muted-foreground">Todavía no has subido documentos.</p>}
        <ul className="divide-y divide-border">
          {!loading && rows.slice(0, pageSize).map((row) => {
            const [kind, , filename] = row.name.split('--');
            return (
              <li key={row.id} className="flex items-center gap-3 p-4">
                <FileText size={17} className="shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium">{filename || 'Documento'}</p>
                  <p className="text-xs text-muted-foreground">{types.find(({ key }) => key === kind)?.label || 'Archivo'}</p>
                </div>
                <button type="button" className={contactButton} aria-label="Descargar archivo" title="Descargar" disabled={busy} onClick={() => void act(row.name, 'download')}><Download size={15} /></button>
                <button type="button" className={contactButton} aria-label="Eliminar archivo" title="Eliminar" disabled={busy} onClick={() => void act(row.name, 'remove')}><Trash2 size={15} /></button>
              </li>
            );
          })}
        </ul>
        {(page > 0 || shouldShowTablePagination(rows.length)) && (
          <div className="flex justify-end gap-2 border-t border-border p-4">
            <button type="button" className={contactButton} disabled={loading || page === 0} onClick={() => setPage((value) => value - 1)}>Anterior</button>
            <button type="button" className={contactButton} disabled={loading || rows.length <= pageSize} onClick={() => setPage((value) => value + 1)}>Siguiente</button>
          </div>
        )}
      </section>
      <section className={contactCard + ' space-y-2 p-4'}>
        <h2 className="text-sm font-semibold">Documentos solicitados</h2>
        <p className="text-sm text-muted-foreground">Abre el expediente de la solicitud para consultar sus requisitos y aportar los documentos que correspondan.</p>
        <Link className={contactButton} href="/mis-participaciones">Ver mis participaciones</Link>
      </section>
      {category && (
        <ContactEditorDialog
          title="Agregar documento"
          submitLabel="Subir archivo"
          busyLabel="Subiendo…"
          busy={busy}
          error={dialogError}
          onClose={() => setCategory('')}
          onSubmit={(event) => void upload(event)}
        >
          <label className="grid gap-1.5 text-sm">
            Tipo de documento
            <select className={contactControl} value={category} onChange={(event) => setCategory(event.target.value)}>
              {types.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            Archivo
            <input type="file" className={contactControl + ' w-full py-2'} name="document" accept=".pdf,.jpg,.jpeg,.png" required />
          </label>
        </ContactEditorDialog>
      )}
    </div>
  );
}
