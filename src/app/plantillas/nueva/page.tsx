'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';

import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, Save, CheckCircle, AlertCircle, Info, ArrowLeft, ArrowRight, X, CheckCircle2, FileText, Settings, Send, Tag, Search, Bold, Italic, Underline as UnderlineIcon, AlignLeft, AlignCenter, AlignRight, AlignJustify, List, ListOrdered, Type, Strikethrough, Link, Indent, Outdent, Highlighter, Minus, Star, Layers, Image as ImageIcon, Table as TableIcon, Hash, Columns, Layout } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

import { FieldsSidebar } from '../components/FieldsSidebar';
import { FieldPropertiesSidebar, InsertedField } from '../components/FieldPropertiesSidebar';
import { MultiPageEditor, MultiPageEditorHandle, PaperSize, PageOrientation, PageMargins } from '../components/DocumentPaginator';
import AppLogo from '@/components/ui/AppLogo';

// ─── Step definitions ─────────────────────────────────────────────────────────

const WIZARD_STEPS = [
  { id: 1, label: 'Información general', icon: FileText },
  { id: 2, label: 'Editor de plantilla', icon: Settings },
  { id: 3, label: 'Publicación', icon: Send },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface GrupoTipoDocumento {
  id: string;
  nombre: string;
}

interface TipoDocumento {
  id: string;
  nombre: string;
  grupo_id: string;
}

interface Etiqueta {
  id: string;
  nombre: string;
  color?: string;
}

interface InfoGeneralData {
  nombre: string;
  descripcion: string;
  numeroOficio: string;
  areaResponsable: string;
  tipoPlantilla: string;
  etiquetasIds: string[];
  grupotipoId: string;
  tipoDocumentoId: string;
  hojaTamano: string;
  hojaOrientacion: 'vertical' | 'horizontal';
}

interface PublicacionData {
  publicacionOpcion: 'borrador' | 'publicar' | 'aprobacion' | 'version';
  comentarioPublicacion: string;
  estadoPlantilla: string;
  versionPublicada: string;
}

const AREAS = ['Comercial', 'Legal', 'Recursos Humanos', 'Finanzas', 'Operaciones', 'Dirección General'];
const TIPOS_PLANTILLA = ['Externa (para firmar por clientes)', 'Interna (uso interno)', 'Mixta'];
const ESTADOS_PLANTILLA = ['Borrador', 'En revisión', 'Publicada', 'Archivada'];
const TAMANOS_HOJA = ['Carta (Letter)', 'Oficio (Legal)', 'A4', 'A3', 'A5', 'Tabloide'];

const DOCUBOX_TEMPLATE_BRAND = `
  <div data-docubox-template-brand="2026" contenteditable="false" style="display:flex;align-items:center;justify-content:space-between;gap:24px;border-bottom:2px solid #1E6BFF;padding:0 0 14px;margin:0 0 24px;font-family:'Google Sans','Google Sans Text',Arial,sans-serif;">
    <img data-in-figure="true" src="/assets/images/docubox-logo-2026.png" alt="Docubox" width="126" style="display:block;width:126px;height:auto;max-width:42%;margin:0;" />
    <div style="text-align:right;line-height:1.35;">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:#1E6BFF;text-transform:uppercase;">Documento Docubox</div>
      <div style="margin-top:3px;font-size:9px;color:#64748B;">Plantilla documental</div>
    </div>
  </div>
`;

function ensureDocuboxTemplateBrand(html?: string | null) {
  const content = html?.trim() || '<p><br></p>';
  return content.includes('data-docubox-template-brand=')
    ? content
    : `${DOCUBOX_TEMPLATE_BRAND}${content}`;
}

const PUBLICACION_OPTIONS = [
  { id: 'borrador', title: 'Guardar como borrador', desc: 'Guarda sin publicar' },
  { id: 'publicar', title: 'Publicar plantilla', desc: 'Publica y hace disponible la plantilla' },
  { id: 'aprobacion', title: 'Enviar a aprobación', desc: 'Envía para revisión y aprobación' },
  { id: 'version', title: 'Duplicar como nueva versión', desc: 'Crea una nueva versión basada en esta plantilla' },
] as const;

// ─── Simple formatting toolbar ────────────────────────────────────────────────

const EDITOR_FONT_FAMILIES = [
  'Arial', 'Arial Black', 'Times New Roman', 'Georgia', 'Garamond', 'Courier New', 'Verdana',
  'Tahoma', 'Trebuchet MS', 'Impact', 'Helvetica', 'Palatino',
  'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Raleway', 'Nunito', 'Poppins',
  'Source Sans 3', 'Merriweather', 'Playfair Display', 'Oswald', 'PT Sans', 'PT Serif',
  'Ubuntu', 'Noto Sans', 'Libre Baskerville', 'Crimson Text', 'EB Garamond',
  'Josefin Sans', 'Quicksand', 'Mulish', 'Barlow', 'Inter', 'DM Sans', 'Fira Sans',
  'Cabin', 'Exo 2', 'Titillium Web', 'Zilla Slab', 'Spectral', 'Cormorant Garamond',
  'Alegreya', 'Lora', 'Arvo', 'Bitter', 'Karla', 'Rubik', 'Work Sans', 'Manrope',
  'Space Grotesk', 'Plus Jakarta Sans', 'Sora', 'Outfit', 'Figtree', 'Lexend', 'Jost',
  'Urbanist', 'Archivo', 'Asap', 'Heebo', 'Hind', 'Varela Round', 'Comfortaa',
  'Pacifico', 'Dancing Script', 'Caveat', 'Sacramento', 'Great Vibes', 'Satisfy',
  'Kaushan Script', 'Lobster', 'Righteous', 'Fredoka One', 'Boogaloo', 'Indie Flower',
  'Patrick Hand', 'Shadows Into Light', 'Amatic SC', 'Permanent Marker', 'Rock Salt',
  'Special Elite', 'Courier Prime', 'Source Code Pro', 'Fira Code', 'Space Mono',
  'Inconsolata', 'Anonymous Pro', 'Share Tech Mono',
];

const EDITOR_FONT_SIZES = ['8pt', '9pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '24pt', '28pt', '32pt', '36pt', '48pt', '60pt', '72pt'];

// ─── Contact Picker Modal ─────────────────────────────────────────────────────
interface Contact {
  id: string;
  nombre: string;
  email: string;
}

function ContactPickerModal({
  onSelect,
  onClose,
}: {
  onSelect: (contact: Contact) => void;
  onClose: () => void;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('contacts')
          .select('id, nombre:full_name, email')
          .order('full_name');
        if (data) setContacts(data as Contact[]);
      } catch { /* silent */ } finally { setLoading(false); }
    };
    load();
  }, []);

  const filtered = contacts.filter(
    (c) =>
      c.nombre?.toLowerCase().includes(search.toLowerCase()) ||
      c.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden flex flex-col" style={{ maxHeight: '80vh' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Seleccionar contacto para aprobación</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded"><X size={18} /></button>
        </div>
        <div className="px-5 pt-4 pb-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar contacto..."
              autoFocus
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-gray-50"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto border-t border-gray-100">
          {loading ? (
            <div className="px-5 py-10 text-center text-sm text-gray-400">Cargando contactos...</div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-400">No se encontraron contactos</div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c)}
                className="w-full text-left px-5 py-3.5 hover:bg-gray-50 transition-colors flex items-center gap-3 border-b border-gray-50 last:border-0"
              >
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-sm shrink-0">
                  {(c.nombre || c.email || '?')[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{c.nombre || '—'}</p>
                  <p className="text-xs text-gray-500 truncate">{c.email}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Image Size Modal ─────────────────────────────────────────────────────────
function ImageSizeModal({
  originalWidth,
  originalHeight,
  currentWidth,
  onApply,
  onClose,
}: {
  originalWidth: number;
  originalHeight: number;
  currentWidth: number;
  onApply: (width: number, height: number) => void;
  onClose: () => void;
}) {
  const aspectRatio = originalHeight > 0 && originalWidth > 0 ? originalHeight / originalWidth : 1;
  const [width, setWidth] = useState(currentWidth || originalWidth || 300);
  const [height, setHeight] = useState(Math.round((currentWidth || originalWidth || 300) * aspectRatio));
  const [lockAspect, setLockAspect] = useState(true);

  const handleWidthChange = (v: number) => {
    setWidth(v);
    if (lockAspect) setHeight(Math.round(v * aspectRatio));
  };
  const handleHeightChange = (v: number) => {
    setHeight(v);
    if (lockAspect) setWidth(Math.round(v / aspectRatio));
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="px-6 py-5">
          <h3 className="text-base font-semibold text-gray-900 mb-1">Tamaño de imagen</h3>
          <p className="text-xs text-gray-500 mb-4">Tamaño original: {originalWidth} × {originalHeight} px</p>
          <div className="space-y-3 mb-4">
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-gray-700 w-16">Ancho (px)</label>
              <input
                type="number"
                min={10}
                max={2000}
                value={width}
                onChange={(e) => handleWidthChange(Number(e.target.value))}
                className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-gray-700 w-16">Alto (px)</label>
              <input
                type="number"
                min={10}
                max={2000}
                value={height}
                onChange={(e) => handleHeightChange(Number(e.target.value))}
                className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={lockAspect} onChange={(e) => setLockAspect(e.target.checked)} className="rounded text-blue-600" />
              <span className="text-xs text-gray-700">Mantener proporción</span>
            </label>
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-full transition-colors">Cancelar</button>
            <button type="button" onClick={() => onApply(width, height)} className="px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors">Aplicar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolbarDivider() {
  return <div className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0" />;
}

function TBtn({
  onMouseDown, title, children, active, disabled,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  title: string;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={onMouseDown}
      title={title}
      disabled={disabled}
      className={`p-1.5 rounded transition-colors ${active ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 text-gray-700'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  );
}

// ─── Page Numbers Modal (Simple Editor) ──────────────────────────────────────
function SimplePageNumbersModal({
  onApply,
  onClose,
}: {
  onApply: (opts: { position: 'header' | 'footer'; showOnFirst: boolean; startFrom: number }) => void;
  onClose: () => void;
}) {
  const [position, setPosition] = useState<'header' | 'footer'>('header');
  const [showOnFirst, setShowOnFirst] = useState(true);
  const [startFrom, setStartFrom] = useState(1);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="px-6 py-5">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Números de página</h3>
          <div className="mb-4">
            <p className="text-xs font-medium text-gray-700 mb-2">Posición</p>
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input type="radio" name="sp-position" checked={position === 'header'} onChange={() => setPosition('header')} className="text-blue-600" />
              <span className="text-sm text-gray-700">Encabezado</span>
            </label>
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input type="radio" name="sp-position" checked={position === 'footer'} onChange={() => setPosition('footer')} className="text-blue-600" />
              <span className="text-sm text-gray-700">Pie de página</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={showOnFirst} onChange={(e) => setShowOnFirst(e.target.checked)} className="rounded text-blue-600" />
              <span className="text-sm text-gray-700">Mostrar en la primera página</span>
            </label>
          </div>
          <div className="mb-5">
            <p className="text-xs font-medium text-gray-700 mb-2">Numeración</p>
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input type="radio" name="sp-numbering" defaultChecked className="text-blue-600" />
              <span className="text-sm text-gray-700">Empezar en</span>
              <input type="number" min={1} value={startFrom} onChange={(e) => setStartFrom(Number(e.target.value))} className="w-16 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 text-center" />
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="sp-numbering" className="text-blue-600" />
              <span className="text-sm text-gray-700">Continuar desde la sección anterior</span>
            </label>
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-full transition-colors">Cancelar</button>
            <button type="button" onClick={() => onApply({ position, showOnFirst, startFrom })} className="px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors">Aplicar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Numero de Página Dropdown Content ───────────────────────────────────────
function NumeroPaginaDropdownContent({
  onApply,
  onClose,
}: {
  onApply: (opts: { position: 'header' | 'footer'; showOnFirst: boolean; startFrom: number }) => void;
  onClose: () => void;
}) {
  const [position, setPosition] = useState<'header' | 'footer'>('header');
  const [showOnFirst, setShowOnFirst] = useState(true);
  const [startFrom, setStartFrom] = useState(1);

  return (
    <div>
      <div className="mb-3">
        <p className="text-xs font-medium text-gray-700 mb-2">Posición</p>
        <label className="flex items-center gap-2 mb-2 cursor-pointer">
          <input type="radio" name="np-position" checked={position === 'header'} onChange={() => setPosition('header')} className="text-blue-600" />
          <span className="text-xs text-gray-700">Encabezado</span>
        </label>
        <label className="flex items-center gap-2 mb-2 cursor-pointer">
          <input type="radio" name="np-position" checked={position === 'footer'} onChange={() => setPosition('footer')} className="text-blue-600" />
          <span className="text-xs text-gray-700">Pie de página</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={showOnFirst} onChange={(e) => setShowOnFirst(e.target.checked)} className="rounded text-blue-600" />
          <span className="text-xs text-gray-700">Mostrar en la primera página</span>
        </label>
      </div>
      <div className="mb-4">
        <p className="text-xs font-medium text-gray-700 mb-2">Numeración</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-700">Empezar en</span>
          <input
            type="number"
            min={1}
            value={startFrom}
            onChange={(e) => setStartFrom(Number(e.target.value))}
            className="w-14 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 text-center"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => onApply({ position, showOnFirst, startFrom })} className="flex-1 text-xs bg-blue-600 text-white rounded-md py-1.5 hover:bg-blue-700 font-medium">Aplicar</button>
        <button type="button" onClick={onClose} className="flex-1 text-xs bg-gray-100 text-gray-700 rounded-md py-1.5 hover:bg-gray-200">Cancelar</button>
      </div>
    </div>
  );
}

// ─── Table Grid Selector (Simple Editor) ─────────────────────────────────────
function SimpleTableGrid({ onSelect }: { onSelect: (rows: number, cols: number) => void }) {
  const [hovered, setHovered] = useState({ rows: 0, cols: 0 });
  const MAX = 10;
  return (
    <div className="p-3">
      <p className="text-xs font-semibold text-gray-700 mb-2">Elementos de creación</p>
      <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${MAX}, 18px)` }} onMouseLeave={() => setHovered({ rows: 0, cols: 0 })}>
        {Array.from({ length: MAX }).map((_, r) =>
          Array.from({ length: MAX }).map((_, c) => (
            <div
              key={`${r}-${c}`}
              onMouseEnter={() => setHovered({ rows: r + 1, cols: c + 1 })}
              onClick={() => onSelect(r + 1, c + 1)}
              className={`w-4 h-4 border cursor-pointer rounded-sm transition-colors ${r < hovered.rows && c < hovered.cols ? 'bg-blue-200 border-blue-400' : 'bg-gray-50 border-gray-300 hover:bg-blue-100'}`}
            />
          ))
        )}
      </div>
      <p className="text-xs text-center text-gray-500 mt-2">{hovered.rows > 0 && hovered.cols > 0 ? `${hovered.rows} × ${hovered.cols}` : '1 × 1'}</p>
    </div>
  );
}

function SimpleEditorToolbar({
  selectedChipId,
  infoData,
  onInfoChange,
  showRulers,
  onToggleRulers,
  showHeader,
  showFooter,
  onShowHeaderChange,
  onShowFooterChange,
  firstPageDifferent,
  onFirstPageDifferentChange,
  margenes,
  onMargenesChange,
  onShowNumerosModal,
  onApplyPageNumbers,
  showFindReplace,
  onToggleFindReplace,
  wordCount,
  showWordCount,
  onToggleWordCount,
  openDropdown,
  onSetOpenDropdown,
}: {
  selectedChipId?: string | null;
  infoData?: { hojaTamano: string; hojaOrientacion: 'vertical' | 'horizontal' };
  onInfoChange?: (updates: { hojaTamano?: string; hojaOrientacion?: 'vertical' | 'horizontal'; columnas?: number; margenes?: { top: number; bottom: number; left: number; right: number } }) => void;
  showRulers?: boolean;
  onToggleRulers?: () => void;
  showHeader?: boolean;
  showFooter?: boolean;
  onShowHeaderChange?: (v: boolean) => void;
  onShowFooterChange?: (v: boolean) => void;
  firstPageDifferent?: boolean;
  onFirstPageDifferentChange?: (v: boolean) => void;
  margenes?: { top: number; bottom: number; left: number; right: number };
  onMargenesChange?: (m: { top: number; bottom: number; left: number; right: number }) => void;
  onShowNumerosModal?: () => void;
  onApplyPageNumbers?: (opts: { position: 'header' | 'footer'; showOnFirst: boolean; startFrom: number }) => void;
  showFindReplace?: boolean;
  onToggleFindReplace?: () => void;
  wordCount?: number;
  showWordCount?: boolean;
  onToggleWordCount?: () => void;
  openDropdown?: string | null;
  onSetOpenDropdown?: (v: string | null) => void;
}) {
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [currentFont, setCurrentFont] = useState('Arial');
  const [currentSize, setCurrentSize] = useState('11pt');
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrike, setIsStrike] = useState(false);
  const [currentParaStyle, setCurrentParaStyle] = useState('p');

  // Google Docs-inspired additions
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');

  // Page layout dropdowns
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  // Modals
  const [showNumerosModal, setShowNumerosModal] = useState(false);
  const [showImageSizeModal, setShowImageSizeModal] = useState(false);
  const [imageSizeModalData, setImageSizeModalData] = useState<{ originalWidth: number; originalHeight: number; currentWidth: number; figure: HTMLElement | null }>({ originalWidth: 300, originalHeight: 200, currentWidth: 300, figure: null });

  // Local margins state (cm) — synced from prop
  const [localMargenes, setLocalMargenes] = useState(margenes || { top: 2.54, bottom: 2.54, left: 3.17, right: 3.17 });
  // Columns state
  const [numColumnas, setNumColumnas] = useState(1);
  // Header/footer local state (for the dropdown UI only)
  const localShowHeader = showHeader ?? false;
  const localShowFooter = showFooter ?? false;
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Saved selection for paragraph style (select steals focus)
  const savedRangeRef = useRef<Range | null>(null);

  // Word count updater
  const updateWordCount = useCallback(() => {
    const pages = document.querySelectorAll('[data-page-content]');
    let text = '';
    pages.forEach((p) => { text += (p as HTMLElement).innerText + ' '; });
    const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
    // no-op: word count is managed by parent
  }, []);

  useEffect(() => {
    const interval = setInterval(updateWordCount, 2000);
    return () => clearInterval(interval);
  }, [updateWordCount]);

  const getSelectedChip = (): HTMLElement | null => {
    if (!selectedChipId) return null;
    return document.querySelector(`[data-field-id="${selectedChipId}"]`) as HTMLElement | null;
  };

  useEffect(() => {
    if (selectedChipId) {
      const chip = document.querySelector(`[data-field-id="${selectedChipId}"]`) as HTMLElement | null;
      if (chip) {
        const cs = window.getComputedStyle(chip);
        const ff = chip.style.fontFamily || cs.fontFamily;
        if (ff) setCurrentFont(ff.replace(/['"]/g, '').split(',')[0].trim());
        const fs = chip.style.fontSize || cs.fontSize;
        if (fs) {
          if (fs.endsWith('px')) {
            const pt = Math.round(parseFloat(fs) * 0.75);
            setCurrentSize(`${pt}pt`);
          } else if (fs.endsWith('pt')) {
            setCurrentSize(fs);
          }
        }
        setIsBold(chip.style.fontWeight === 'bold' || parseInt(chip.style.fontWeight) >= 700 || cs.fontWeight === 'bold' || parseInt(cs.fontWeight) >= 700);
        setIsItalic(chip.style.fontStyle === 'italic' || cs.fontStyle === 'italic');
        setIsUnderline((chip.style.textDecoration || cs.textDecoration).includes('underline'));
        setIsStrike((chip.style.textDecoration || cs.textDecoration).includes('line-through'));
      }
    }
  }, [selectedChipId]);

  useEffect(() => {
    const updateState = () => {
      if (selectedChipId) return;
      setIsBold(document.queryCommandState('bold'));
      setIsItalic(document.queryCommandState('italic'));
      setIsUnderline(document.queryCommandState('underline'));
      setIsStrike(document.queryCommandState('strikeThrough'));
      const font = document.queryCommandValue('fontName');
      if (font) setCurrentFont(font.replace(/['"]/g, ''));
      // Detect current block format
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
        while (node && node !== document.body) {
          const tag = (node as HTMLElement).tagName?.toLowerCase();
          if (tag === 'h1') { setCurrentParaStyle('h1'); return; }
          if (tag === 'h2') { setCurrentParaStyle('h2'); return; }
          if (tag === 'h3') { setCurrentParaStyle('h3'); return; }
          if (tag === 'h4') { setCurrentParaStyle('h4'); return; }
          if (tag === 'h5') { setCurrentParaStyle('h5'); return; }
          if (tag === 'p' || tag === 'div') { setCurrentParaStyle('p'); return; }
          node = node.parentNode;
        }
        setCurrentParaStyle('p');
      }
    };
    document.addEventListener('selectionchange', updateState);
    return () => document.removeEventListener('selectionchange', updateState);
  }, [selectedChipId]);

  const execCmd = (cmd: string, value?: string) => {
    const chip = getSelectedChip();
    if (chip) {
      switch (cmd) {
        case 'bold':
          chip.style.fontWeight = chip.style.fontWeight === 'bold' ? 'normal' : 'bold';
          setIsBold(chip.style.fontWeight === 'bold');
          break;
        case 'italic':
          chip.style.fontStyle = chip.style.fontStyle === 'italic' ? 'normal' : 'italic';
          setIsItalic(chip.style.fontStyle === 'italic');
          break;
        case 'underline': {
          const hasUnderline = chip.style.textDecoration.includes('underline');
          const hasStrike = chip.style.textDecoration.includes('line-through');
          chip.style.textDecoration = hasUnderline ? (hasStrike ? 'line-through' : 'none') : (hasStrike ? 'underline line-through' : 'underline');
          setIsUnderline(!hasUnderline);
          break;
        }
        case 'strikeThrough': {
          const hasStrike2 = chip.style.textDecoration.includes('line-through');
          const hasUnderline2 = chip.style.textDecoration.includes('underline');
          chip.style.textDecoration = hasStrike2 ? (hasUnderline2 ? 'underline' : 'none') : (hasUnderline2 ? 'underline line-through' : 'line-through');
          setIsStrike(!hasStrike2);
          break;
        }
        case 'fontName':
          if (value) { chip.style.fontFamily = value; setCurrentFont(value); }
          break;
        case 'foreColor':
          if (value) chip.style.color = value;
          break;
        case 'hiliteColor':
          if (value) chip.style.backgroundColor = value;
          break;
        default:
          document.execCommand(cmd, false, value);
      }
      return;
    }
    document.execCommand(cmd, false, value);
  };

  const applyFontSize = (sizeWithPt: string) => {
    const chip = getSelectedChip();
    if (chip) {
      chip.style.fontSize = sizeWithPt;
      setCurrentSize(sizeWithPt);
      return;
    }
    // Restore saved selection before applying
    const sel = window.getSelection();
    if (savedRangeRef.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
    document.execCommand('fontSize', false, '7');
    const spans = document.querySelectorAll('font[size="7"]');
    spans.forEach((span) => {
      let el = span as HTMLElement;
      el.removeAttribute('size');
      el.style.fontSize = sizeWithPt;
    });
    setCurrentSize(sizeWithPt);
    savedRangeRef.current = null;
  };

  const decreaseSize = (e: React.MouseEvent) => {
    e.preventDefault();
    const idx = EDITOR_FONT_SIZES.indexOf(currentSize);
    if (idx > 0) applyFontSize(EDITOR_FONT_SIZES[idx - 1]);
  };

  const increaseSize = (e: React.MouseEvent) => {
    e.preventDefault();
    const idx = EDITOR_FONT_SIZES.indexOf(currentSize);
    if (idx < EDITOR_FONT_SIZES.length - 1) applyFontSize(EDITOR_FONT_SIZES[idx + 1]);
  };

  const insertLink = () => {
    let text = linkText.trim();
    const url = linkUrl.trim();
    if (!url) {
      if (onSetOpenDropdown) onSetOpenDropdown(null);
      setLinkUrl('');
      setLinkText('');
      return;
    }
    const sel = window.getSelection();
    if (savedRangeRef.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
    if (text) {
      // Insert anchor with custom text
      const html = `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      document.execCommand('insertHTML', false, html);
    } else {
      execCmd('createLink', url);
    }
    if (onSetOpenDropdown) onSetOpenDropdown(null);
    setLinkUrl('');
    setLinkText('');
  };

  const applyMargenes = () => {
    if (onMargenesChange) onMargenesChange(localMargenes);
    if (onInfoChange) onInfoChange({ margenes: localMargenes });
    if (onSetOpenDropdown) onSetOpenDropdown(null);
  };

  const applyColumnas = () => {
    const pages = document.querySelectorAll('[data-page-content]');
    pages.forEach((page) => {
      let el = page as HTMLElement;
      el.style.columnCount = numColumnas > 1 ? String(numColumnas) : '';
      el.style.columnGap = numColumnas > 1 ? '1.5em' : '';
    });
    if (onSetOpenDropdown) onSetOpenDropdown(null);
  };

  const insertTable = (rows: number, cols: number) => {
    // Ensure focus is in the editor before inserting
    const pages = document.querySelectorAll('[data-page-content]');
    if (pages.length > 0) {
      const targetPage = pages[0] as HTMLElement;
      // Try to find the focused page first
      let focused: HTMLElement | null = null;
      pages.forEach((p) => {
        if ((p as HTMLElement).contains(document.activeElement)) focused = p as HTMLElement;
      });
      const editorEl = focused || targetPage;
      // If no selection inside editor, place cursor at end
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !editorEl.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        editorEl.focus();
        const range = document.createRange();
        range.selectNodeContents(editorEl);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    const html = `<table style="border-collapse:collapse;width:100%;margin:8px 0"><tbody>${Array.from({ length: rows }).map(() => `<tr>${Array.from({ length: cols }).map(() => '<td style="border:1px solid #ccc;padding:6px 8px;min-width:40px">&nbsp;</td>').join('')}</tr>`).join('')}</tbody></table><p><br></p>`;
    document.execCommand('insertHTML', false, html);
    if (onSetOpenDropdown) onSetOpenDropdown(null);
  };

  const applyEncabezadoPie = () => {
    if (onShowHeaderChange) onShowHeaderChange(localShowHeader);
    if (onShowFooterChange) onShowFooterChange(localShowFooter);
    if (onSetOpenDropdown) onSetOpenDropdown(null);
  };

  const applyPageNumbers = (opts: { position: 'header' | 'footer'; showOnFirst: boolean; startFrom: number }) => {
    if (onApplyPageNumbers) {
      onApplyPageNumbers(opts);
    }
    setShowNumerosModal(false);
    if (onSetOpenDropdown) onSetOpenDropdown(null);
  };

  const openMenu = (name: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    if (onSetOpenDropdown) {
      onSetOpenDropdown((openDropdown ?? null) === name ? null : name);
    }
  };

  const applyLineSpacing = (value: string) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    let node: Node | null = range.commonAncestorContainer;
    while (node && node.nodeName !== 'P' && node.nodeName !== 'DIV' && node !== document.body) {
      node = node.parentNode;
    }
    if (node && node !== document.body) {
      (node as HTMLElement).style.lineHeight = value;
    }
    if (onSetOpenDropdown) onSetOpenDropdown(null);
  };

  const applyIndent = (direction: 'increase' | 'decrease') => {
    if (selectedChipId) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    let node: Node | null = range.commonAncestorContainer;
    while (node && node.nodeName !== 'P' && node.nodeName !== 'LI' && node.nodeName !== 'DIV' && node !== document.body) {
      node = node.parentNode;
    }
    if (node && node !== document.body) {
      let el = node as HTMLElement;
      const current = parseFloat(el.style.paddingLeft || '0') || 0;
      const step = 40;
      const next = direction === 'increase' ? current + step : Math.max(0, current - step);
      el.style.paddingLeft = next > 0 ? `${next}px` : '';
    }
  };

  // Google Docs-inspired: Clear formatting
  const clearFormatting = (e: React.MouseEvent) => {
    e.preventDefault();
    document.execCommand('removeFormat');
    document.execCommand('unlink');
  };

  // Google Docs-inspired: Find & Replace
  const handleFind = () => {
    if (!findText) return;
    const pages = document.querySelectorAll('[data-page-content]');
    pages.forEach((page) => {
      let el = page as HTMLElement;
      // Simple highlight: wrap found text in mark
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let n: Node | null;
      while ((n = walker.nextNode())) nodes.push(n as Text);
      nodes.forEach((textNode) => {
        const idx = textNode.textContent?.toLowerCase().indexOf(findText.toLowerCase()) ?? -1;
        if (idx >= 0) {
          const range = document.createRange();
          range.setStart(textNode, idx);
          range.setEnd(textNode, idx + findText.length);
          const sel = window.getSelection();
          if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        }
      });
    });
  };

  const handleReplace = () => {
    if (!findText) return;
    const pages = document.querySelectorAll('[data-page-content]');
    pages.forEach((page) => {
      let el = page as HTMLElement;
      el.innerHTML = el.innerHTML.replace(
        new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        replaceText
      );
    });
  };

  const handleReplaceAll = () => {
    handleReplace();
    if (onToggleFindReplace && showFindReplace) onToggleFindReplace();
  };

  const handlePrint = () => {
    window.print();
  };

  // Controls that only apply to block/document content — disabled when a chip is selected
  const chipSelected = !!selectedChipId;

  // When opening link dropdown, capture selected text
  const openLinkDropdown = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (chipSelected) return;
    const sel = window.getSelection();
    let selectedText = '';
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
      selectedText = sel.toString().trim();
    }
    setLinkText(selectedText);
    setLinkUrl('');
    openMenu('vinculo', e);
  };

  return (
    <>
      <div className="bg-white border-b border-gray-200 relative z-10">
        <div className="flex items-center gap-0.5 px-2 py-1.5 flex-wrap">
          {/* Regla toggle */}
          <button
            type="button"
            onClick={onToggleRulers}
            className={`p-1.5 rounded transition-colors flex-shrink-0 ${showRulers ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 text-gray-700'}`}
            title={showRulers ? 'Ocultar regla' : 'Mostrar regla'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="10" rx="1"/>
              <line x1="6" y1="7" x2="6" y2="12"/><line x1="10" y1="7" x2="10" y2="10"/>
              <line x1="14" y1="7" x2="14" y2="12"/><line x1="18" y1="7" x2="18" y2="10"/>
            </svg>
          </button>

          <div className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0" />

          {/* Márgenes */}
          <button
            type="button"
            onClick={(e) => openMenu('margenes', e)}
            className="p-1.5 rounded transition-colors hover:bg-gray-100 text-gray-700 flex-shrink-0"
            title="Márgenes"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="1"/>
              <line x1="7" y1="3" x2="7" y2="21"/><line x1="17" y1="3" x2="17" y2="21"/>
              <line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="17" x2="21" y2="17"/>
            </svg>
          </button>

          <div className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0" />

          {/* Orientación */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              if (infoData && onInfoChange) {
                const next = infoData.hojaOrientacion === 'vertical' ? 'horizontal' : 'vertical';
                onInfoChange({ hojaOrientacion: next });
              }
            }}
            className="p-1.5 rounded transition-colors hover:bg-gray-100 text-gray-700 flex-shrink-0"
            title={`Orientación: ${infoData?.hojaOrientacion === 'horizontal' ? 'Horizontal' : 'Vertical'} — clic para cambiar`}
          >
            {infoData?.hojaOrientacion === 'horizontal' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="1"/><path d="M16 10l4 2-4 2" strokeWidth="1.5"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="1"/><path d="M10 16l2 4 2-4" strokeWidth="1.5"/></svg>
            )}
          </button>

          <div className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0" />

          {/* Tamaño */}
          <button
            type="button"
            onClick={(e) => openMenu('tamano', e)}
            className="p-1.5 rounded transition-colors hover:bg-gray-100 text-gray-700 flex-shrink-0"
            title="Tamaño de página"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="1"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="13" y2="14"/></svg>
          </button>

          <div className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0" />

          {/* Columnas */}
          <button
            type="button"
            onClick={(e) => openMenu('columnas', e)}
            className="p-1.5 rounded transition-colors hover:bg-gray-100 text-gray-700 flex-shrink-0"
            title="Columnas"
          >
            <Columns size={16} />
          </button>

          <div className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0" />

          {/* Tabla con grid */}
          <button
            type="button"
            onClick={(e) => { if (!chipSelected) openMenu('tabla', e); }}
            disabled={chipSelected}
            className={`p-1.5 rounded transition-colors flex-shrink-0 ${chipSelected ? 'opacity-40 cursor-not-allowed text-gray-400' : 'hover:bg-gray-100 text-gray-700'}`}
            title="Insertar tabla"
          >
            <TableIcon size={16} />
          </button>

          <div className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0" />

          {/* Imagen */}
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); if (!chipSelected) imageInputRef.current?.click(); }}
            disabled={chipSelected}
            className={`p-1.5 rounded transition-colors flex-shrink-0 ${chipSelected ? 'opacity-40 cursor-not-allowed text-gray-400' : 'hover:bg-gray-100 text-gray-700'}`}
            title="Insertar imagen"
          >
            <ImageIcon size={16} />
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (ev) => {
                const src = ev.target?.result as string;
                if (src) {
                  const html = `<figure data-docubox-image="true" data-selected="false" data-alignment="center" data-width="300" contenteditable="false" style="display:block;position:relative;margin:8px auto;line-height:0;max-width:100%;cursor:default;"><img src="${src}" style="width:300px;height:auto;max-width:100%;display:block;user-select:none;" alt="imagen" data-in-figure="true" /><span class="docubox-resize-handle" data-handle-pos="nw" style="display:none;position:absolute;top:-5px;left:-5px;width:10px;height:10px;background:#1E6BFF;border:2px solid white;border-radius:50%;z-index:20;cursor:nwse-resize;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></span><span class="docubox-resize-handle" data-handle-pos="ne" style="display:none;position:absolute;top:-5px;right:-5px;width:10px;height:10px;background:#1E6BFF;border:2px solid white;border-radius:50%;z-index:20;cursor:nesw-resize;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></span><span class="docubox-resize-handle" data-handle-pos="sw" style="display:none;position:absolute;bottom:-5px;left:-5px;width:10px;height:10px;background:#1E6BFF;border:2px solid white;border-radius:50%;z-index:20;cursor:nesw-resize;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></span><span class="docubox-resize-handle" data-handle-pos="se" style="display:none;position:absolute;bottom:-5px;right:-5px;width:10px;height:10px;background:#1E6BFF;border:2px solid white;border-radius:50%;z-index:20;cursor:nwse-resize;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></span></figure><p><br></p>`;
                  document.execCommand('insertHTML', false, html);
                }
              };
              reader.readAsDataURL(file);
              e.target.value = '';
            }}
          />

          <div className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0" />

          {/* Vínculo */}
          <button
            type="button"
            onClick={openLinkDropdown}
            disabled={chipSelected}
            className={`p-1.5 rounded transition-colors flex-shrink-0 ${chipSelected ? 'opacity-40 cursor-not-allowed text-gray-400' : openDropdown === 'vinculo' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 text-gray-700'}`}
            title="Insertar vínculo"
          >
            <Link size={16} />
          </button>

          <div className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0" />

          {/* Encabezado y pie de página */}
          <button
            type="button"
            onClick={(e) => { if (!chipSelected) openMenu('encabezado', e); }}
            disabled={chipSelected}
            className={`p-1.5 rounded transition-colors flex-shrink-0 ${chipSelected ? 'opacity-40 cursor-not-allowed text-gray-400' : 'hover:bg-gray-100 text-gray-700'}`}
            title="Encabezado y pie de página"
          >
            <Layout size={16} />
          </button>

          <div className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0" />

          {/* Números de página */}
          <button
            type="button"
            onClick={(e) => { if (!chipSelected) openMenu('numeroPagina', e); }}
            disabled={chipSelected}
            className={`p-1.5 rounded transition-colors flex-shrink-0 ${chipSelected ? 'opacity-40 cursor-not-allowed text-gray-400' : openDropdown === 'numeroPagina' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 text-gray-700'}`}
            title="Números de página"
          >
            <Hash size={16} />
          </button>

          <div className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0" />

          {selectedChipId && (
            <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700 font-medium mr-1 flex-shrink-0">
              <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
              Etiqueta seleccionada
            </div>
          )}

          {/* Paragraph style — Google Docs style */}
          <select
            onMouseDown={(e) => {
              e.stopPropagation();
              // Save current selection before the select steals focus
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) {
                savedRangeRef.current = sel.getRangeAt(0).cloneRange();
              }
            }}
            value={currentParaStyle}
            onChange={(e) => {
              const val = e.target.value;
              if (!selectedChipId && val !== 'opciones') {
                // Restore the saved selection so formatBlock targets the right element
                const sel = window.getSelection();
                if (savedRangeRef.current && sel) {
                  sel.removeAllRanges();
                  sel.addRange(savedRangeRef.current);
                }
                if (val === 'p') {
                  document.execCommand('formatBlock', false, 'p');
                } else {
                  document.execCommand('formatBlock', false, val);
                }
                setCurrentParaStyle(val);
                savedRangeRef.current = null;
              }
              if (val === 'opciones') e.target.value = currentParaStyle;
            }}
            disabled={chipSelected}
            className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-40 flex-shrink-0"
            style={{ minWidth: '120px' }}
          >
            <option value="p">Texto normal</option>
            <option value="h1" style={{ fontWeight: 'bold', fontSize: '1.2em' }}>Título</option>
            <option value="h2" style={{ color: '#6b7280' }}>Subtítulo</option>
            <option value="h3" style={{ fontWeight: 'bold' }}>Encabezado 1</option>
            <option value="h4">Encabezado 2</option>
            <option value="h5">Encabezado 3</option>
            <option value="opciones" disabled style={{ color: '#9ca3af', borderTop: '1px solid #e5e7eb' }}>Opciones ▶</option>
          </select>

          <ToolbarDivider />

          {/* Font family */}
          <select
            onMouseDown={(e) => {
              e.stopPropagation();
              // Save selection before focus is stolen
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) {
                savedRangeRef.current = sel.getRangeAt(0).cloneRange();
              }
            }}
            value={currentFont}
            onChange={(e) => {
              const font = e.target.value;
              const chip = getSelectedChip();
              if (chip) {
                chip.style.fontFamily = font;
                setCurrentFont(font);
                return;
              }
              // Restore selection before applying command
              const sel = window.getSelection();
              if (savedRangeRef.current && sel) {
                sel.removeAllRanges();
                sel.addRange(savedRangeRef.current);
              }
              document.execCommand('fontName', false, font);
              setCurrentFont(font);
              savedRangeRef.current = null;
            }}
            className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 flex-shrink-0"
            style={{ minWidth: '120px', maxWidth: '150px', fontFamily: currentFont }}
            title="Fuente"
          >
            {EDITOR_FONT_FAMILIES.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
            ))}
          </select>

          <ToolbarDivider />

          {/* Font size */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button type="button" onMouseDown={decreaseSize} className="w-5 h-6 flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded text-sm font-medium" title="Reducir tamaño">−</button>
            <select
              onMouseDown={(e) => {
                e.stopPropagation();
                // Save selection before focus is stolen
                const sel = window.getSelection();
                if (sel && sel.rangeCount > 0) {
                  savedRangeRef.current = sel.getRangeAt(0).cloneRange();
                }
              }}
              value={currentSize}
              onChange={(e) => applyFontSize(e.target.value)}
              className="text-xs border border-gray-200 rounded px-1 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-14 text-center"
              title="Tamaño de fuente"
            >
              {EDITOR_FONT_SIZES.map((s) => (
                <option key={s} value={s}>{s.replace('pt', '')}</option>
              ))}
            </select>
            <button type="button" onMouseDown={increaseSize} className="w-5 h-6 flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded text-sm font-medium" title="Aumentar tamaño">+</button>
          </div>

          <ToolbarDivider />

          {/* Bold, Italic, Underline, Strike */}
          <TBtn onMouseDown={(e) => { e.preventDefault(); execCmd('bold'); }} title="Negrita (Ctrl+B)" active={isBold}><Bold size={14} /></TBtn>
          <TBtn onMouseDown={(e) => { e.preventDefault(); execCmd('italic'); }} title="Cursiva (Ctrl+I)" active={isItalic}><Italic size={14} /></TBtn>
          <TBtn onMouseDown={(e) => { e.preventDefault(); execCmd('underline'); }} title="Subrayado (Ctrl+U)" active={isUnderline}><UnderlineIcon size={14} /></TBtn>
          <TBtn onMouseDown={(e) => { e.preventDefault(); execCmd('strikeThrough'); }} title="Tachado" active={isStrike}><Strikethrough size={14} /></TBtn>

          <ToolbarDivider />

          {/* Text color */}
          <label className="flex flex-col items-center cursor-pointer p-1 rounded hover:bg-gray-100 relative flex-shrink-0" title="Color de texto">
            <Type size={13} className="text-gray-700" />
            <input type="color" className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" onChange={(e) => execCmd('foreColor', e.target.value)} title="Color de texto" />
          </label>

          {/* Highlight */}
          <label className="flex flex-col items-center cursor-pointer p-1 rounded hover:bg-gray-100 relative flex-shrink-0" title="Resaltado">
            <Highlighter size={13} className="text-gray-700" />
            <input type="color" defaultValue="#ffff00" className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" onChange={(e) => execCmd('hiliteColor', e.target.value)} title="Color de resaltado" />
          </label>

          <ToolbarDivider />

          {/* Alignment */}
          <TBtn onMouseDown={(e) => { e.preventDefault(); if (!selectedChipId) document.execCommand('justifyLeft'); }} title="Alinear izquierda" disabled={chipSelected}><AlignLeft size={14} /></TBtn>
          <TBtn onMouseDown={(e) => { e.preventDefault(); if (!selectedChipId) document.execCommand('justifyCenter'); }} title="Centrar" disabled={chipSelected}><AlignCenter size={14} /></TBtn>
          <TBtn onMouseDown={(e) => { e.preventDefault(); if (!selectedChipId) document.execCommand('justifyRight'); }} title="Alinear derecha" disabled={chipSelected}><AlignRight size={14} /></TBtn>
          <TBtn onMouseDown={(e) => { e.preventDefault(); if (!selectedChipId) document.execCommand('justifyFull'); }} title="Justificar" disabled={chipSelected}><AlignJustify size={14} /></TBtn>

          <ToolbarDivider />

          {/* Line spacing dropdown */}
          <button
            type="button"
            onClick={(e) => { if (!chipSelected) openMenu('lineSpacing', e); }}
            disabled={chipSelected}
            className={`p-1.5 rounded transition-colors flex-shrink-0 flex items-center gap-0.5 ${chipSelected ? 'opacity-40 cursor-not-allowed text-gray-400' : 'hover:bg-gray-100 text-gray-700'}`}
            title="Interlineado"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/><path d="M8 3l-4 3 4 3"/><path d="M8 15l-4 3 4 3"/></svg>
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>

          <ToolbarDivider />

          {/* Lists */}
          <TBtn onMouseDown={(e) => {
            e.preventDefault();
            if (!selectedChipId) {
              // Save selection before button steals focus, then restore and execute
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) {
                savedRangeRef.current = sel.getRangeAt(0).cloneRange();
              }
              requestAnimationFrame(() => {
                if (savedRangeRef.current) {
                  const s = window.getSelection();
                  if (s) { s.removeAllRanges(); s.addRange(savedRangeRef.current); }
                }
                document.execCommand('insertUnorderedList');
                savedRangeRef.current = null;
              });
            }
          }} title="Lista con viñetas" disabled={chipSelected}><List size={14} /></TBtn>
          {/* Bullet style picker */}
          <button
            type="button"
            onClick={(e) => { if (!chipSelected) openMenu('bulletStyle', e); }}
            disabled={chipSelected}
            className={`p-1 rounded transition-colors flex-shrink-0 flex items-center ${chipSelected ? 'opacity-40 cursor-not-allowed text-gray-400' : 'hover:bg-gray-100 text-gray-700'}`}
            title="Estilo de viñeta"
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <TBtn onMouseDown={(e) => {
            e.preventDefault();
            if (!selectedChipId) {
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) {
                savedRangeRef.current = sel.getRangeAt(0).cloneRange();
              }
              requestAnimationFrame(() => {
                if (savedRangeRef.current) {
                  const s = window.getSelection();
                  if (s) { s.removeAllRanges(); s.addRange(savedRangeRef.current); }
                }
                document.execCommand('insertOrderedList');
                savedRangeRef.current = null;
              });
            }
          }} title="Lista numerada" disabled={chipSelected}><ListOrdered size={14} /></TBtn>
          {/* Ordered list style picker */}
          <button
            type="button"
            onClick={(e) => {
              if (chipSelected) return;
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) {
                savedRangeRef.current = sel.getRangeAt(0).cloneRange();
              }
              openMenu('orderedStyle', e);
            }}
            disabled={chipSelected}
            className={`p-1 rounded transition-colors flex-shrink-0 flex items-center ${chipSelected ? 'opacity-40 cursor-not-allowed text-gray-400' : 'hover:bg-gray-100 text-gray-700'}`}
            title="Estilo de lista numerada"
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>

          <ToolbarDivider />

          {/* Indent */}
          <TBtn onMouseDown={(e) => { e.preventDefault(); if (!chipSelected) applyIndent('increase'); }} title="Aumentar sangría" disabled={chipSelected}><Indent size={14} /></TBtn>
          <TBtn onMouseDown={(e) => { e.preventDefault(); if (!chipSelected) applyIndent('decrease'); }} title="Reducir sangría" disabled={chipSelected}><Outdent size={14} /></TBtn>

          <ToolbarDivider />

          {/* HR */}
          <TBtn onMouseDown={(e) => { e.preventDefault(); if (!selectedChipId) document.execCommand('insertHTML', false, '<hr style="border:none;border-top:1px solid #ccc;margin:8px 0;" />'); }} title="Separador horizontal" disabled={chipSelected}>
            <Minus size={14} />
          </TBtn>
        </div>
      </div>

      {/* ─── Find & Replace Bar ─────────────────────────────────────────────── */}
      {showFindReplace && (
        <div className="bg-gray-50 border-b border-gray-200 px-3 py-2 flex items-center gap-2 flex-wrap z-10">
          <span className="text-xs font-medium text-gray-600 shrink-0">Buscar:</span>
          <input
            type="text"
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleFind(); }}
            placeholder="Texto a buscar..."
            className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 w-40"
            autoFocus
          />
          <span className="text-xs font-medium text-gray-600 shrink-0">Reemplazar:</span>
          <input
            type="text"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder="Reemplazar con..."
            className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 w-40"
          />
          <button type="button" onClick={handleFind} className="text-xs px-2 py-1 bg-white border border-gray-200 rounded hover:bg-gray-100 text-gray-700 font-medium">Buscar</button>
          <button type="button" onClick={handleReplace} className="text-xs px-2 py-1 bg-white border border-gray-200 rounded hover:bg-gray-100 text-gray-700 font-medium">Reemplazar</button>
          <button type="button" onClick={handleReplaceAll} className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium">Reemplazar todo</button>
          <button type="button" onClick={() => { if (onToggleFindReplace) onToggleFindReplace(); }} className="ml-auto text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ─── Floating Dropdowns ─────────────────────────────────────────────── */}

      {/* Márgenes */}
      {openDropdown === 'margenes' && (
        <div className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] p-4 w-64" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
          <p className="text-xs font-semibold text-gray-800 mb-3">Márgenes de página (cm)</p>
          {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
            <div key={side} className="flex items-center gap-2 mb-2">
              <label className="text-xs text-gray-600 w-20">{side === 'top' ? 'Superior' : side === 'bottom' ? 'Inferior' : side === 'left' ? 'Izquierdo' : 'Derecho'}:</label>
              <input type="number" min={0} max={10} step={0.1} value={localMargenes[side]} onChange={(e) => setLocalMargenes((m) => ({ ...m, [side]: parseFloat(e.target.value) || 0 }))} className="w-20 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <span className="text-xs text-gray-400">cm</span>
            </div>
          ))}
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={applyMargenes} className="flex-1 text-xs bg-blue-600 text-white rounded-md py-1.5 hover:bg-blue-700 font-medium">Aplicar</button>
            <button type="button" onClick={() => { if (onSetOpenDropdown) onSetOpenDropdown(null); }} className="flex-1 text-xs bg-gray-100 text-gray-700 rounded-md py-1.5 hover:bg-gray-200">Cancelar</button>
          </div>
        </div>
      )}

      {/* Tamaño */}
      {openDropdown === 'tamano' && (
        <div className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] p-3 w-52" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
          <p className="text-xs font-semibold text-gray-800 mb-2">Tamaño de página</p>
          {['Carta (Letter)', 'Oficio (Legal)', 'A4', 'A3', 'A5', 'Tabloide'].map((size) => (
            <button key={size} type="button" onClick={() => { if (onInfoChange) onInfoChange({ hojaTamano: size }); if (onSetOpenDropdown) onSetOpenDropdown(null); }} className={`w-full text-left text-xs px-3 py-2 rounded-md mb-0.5 transition-colors ${infoData?.hojaTamano === size ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}>{size}</button>
          ))}
        </div>
      )}

      {/* Columnas */}
      {openDropdown === 'columnas' && (
        <div className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] p-3 w-44" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
          <p className="text-xs font-semibold text-gray-800 mb-2">Número de columnas</p>
          {[1, 2, 3].map((n) => (
            <button key={n} type="button" onClick={() => setNumColumnas(n)} className={`w-full text-left text-xs px-3 py-2 rounded-md mb-0.5 transition-colors flex items-center gap-2 ${numColumnas === n ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}>
              <span className="flex gap-0.5">{Array.from({ length: n }).map((_, i) => <span key={i} className="w-3 h-5 bg-current rounded-sm opacity-60" />)}</span>
              {n === 1 ? 'Una columna' : n === 2 ? 'Dos columnas' : 'Tres columnas'}
            </button>
          ))}
          <div className="flex gap-2 mt-2">
            <button type="button" onClick={applyColumnas} className="flex-1 text-xs bg-blue-600 text-white rounded-md py-1.5 hover:bg-blue-700 font-medium">Aplicar</button>
            <button type="button" onClick={() => { if (onSetOpenDropdown) onSetOpenDropdown(null); }} className="flex-1 text-xs bg-gray-100 text-gray-700 rounded-md py-1.5 hover:bg-gray-200">Cancelar</button>
          </div>
        </div>
      )}

      {/* Tabla con grid visual */}
      {openDropdown === 'tabla' && (
        <div className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999]" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
          <SimpleTableGrid onSelect={insertTable} />
        </div>
      )}

      {/* Interlineado */}
      {openDropdown === 'lineSpacing' && (
        <div className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] py-1 min-w-[160px]" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
          {[{ label: 'Sencillo', value: '1' }, { label: '1,15', value: '1.15' }, { label: '1,5', value: '1.5' }, { label: 'Doble', value: '2' }].map((s) => (
            <button key={s.value} type="button" onClick={() => applyLineSpacing(s.value)} className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2">
              <span className="w-4 text-blue-600">{s.value === '1.15' ? '✓' : ''}</span>{s.label}
            </button>
          ))}
        </div>
      )}

      {/* Estilo de lista numerada */}
      {openDropdown === 'orderedStyle' && (
        <div className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] p-3" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
          <p className="text-xs font-semibold text-gray-700 mb-2">Estilo de lista numerada</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: '1.\n2.\n3.', title: '1. 2. 3.', listType: 'decimal', css: 'decimal' },
              { label: '1)\n2)\n3)', title: '1) 2) 3)', listType: 'decimal', css: 'decimal', suffix: ')' },
              { label: 'a.\nb.\nc.', title: 'a. b. c.', listType: 'lower-alpha', css: 'lower-alpha' },
              { label: 'a)\nb)\nc)', title: 'a) b) c)', listType: 'lower-alpha', css: 'lower-alpha', suffix: ')' },
              { label: 'i.\nii.\niii.', title: 'i. ii. iii.', listType: 'lower-roman', css: 'lower-roman' },
              { label: 'I.\nII.\nIII.', title: 'I. II. III.', listType: 'upper-roman', css: 'upper-roman' },
            ].map((opt) => (
              <button
                key={opt.title}
                type="button"
                title={opt.title}
                onClick={() => {
                  if (savedRangeRef.current) {
                    const s = window.getSelection();
                    if (s) { s.removeAllRanges(); s.addRange(savedRangeRef.current); }
                  }
                  document.execCommand('insertOrderedList');
                  requestAnimationFrame(() => {
                    const sel = window.getSelection();
                    if (sel && sel.rangeCount > 0) {
                      let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
                      while (node && node.nodeName !== 'OL' && node !== document.body) node = node.parentNode;
                      if (node && node.nodeName === 'OL') {
                        const ol = node as HTMLElement;
                        ol.style.listStyleType = opt.css;
                        if (opt.suffix === ')') {
                          // Use CSS counter for ) suffix
                          ol.setAttribute('data-list-suffix', ')');
                          const styleId = `ol-style-paren`;
                          if (!document.getElementById(styleId)) {
                            const style = document.createElement('style');
                            style.id = styleId;
                            style.textContent = `ol[data-list-suffix=")"] { list-style: none; counter-reset: item; } ol[data-list-suffix=")"] li { counter-increment: item; } ol[data-list-suffix=")"] li::before { content: counter(item, ${opt.css}) ")"; margin-right: 0.5em; }`;
                            document.head.appendChild(style);
                          }
                        }
                      }
                    }
                  });
                  if (onSetOpenDropdown) onSetOpenDropdown(null);
                }}
                className="flex flex-col items-center justify-center p-2 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors cursor-pointer min-w-[60px]"
              >
                <span className="text-[10px] text-gray-700 font-mono whitespace-pre leading-tight text-left">{opt.label}</span>
                <span className="text-[9px] text-gray-400 mt-1">{opt.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Estilo de viñeta */}
      {openDropdown === 'bulletStyle' && (        <div className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] p-3" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
          <p className="text-xs font-semibold text-gray-700 mb-2">Estilo de viñeta</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: '●', title: 'Disco', style: 'disc' },
              { label: '○', title: 'Círculo', style: 'circle' },
              { label: '■', title: 'Cuadrado', style: 'square' },
              { label: '→', title: 'Flecha', style: 'none', char: '→' },
              { label: '★', title: 'Estrella', style: 'none', char: '★' },
              { label: '✓', title: 'Check', style: 'none', char: '✓' },
            ].map((opt) => (
              <button
                key={opt.title}
                type="button"
                title={opt.title}
                onClick={() => {
                  if (savedRangeRef.current) {
                    const s = window.getSelection();
                    if (s) { s.removeAllRanges(); s.addRange(savedRangeRef.current); }
                  }
                  if (opt.style !== 'none') {
                    document.execCommand('insertUnorderedList');
                    // Apply list-style-type to the UL
                    requestAnimationFrame(() => {
                      const sel = window.getSelection();
                      if (sel && sel.rangeCount > 0) {
                        let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
                        while (node && node.nodeName !== 'UL' && node !== document.body) node = node.parentNode;
                        if (node && node.nodeName === 'UL') (node as HTMLElement).style.listStyleType = opt.style;
                      }
                    });
                  } else if (opt.char) {
                    // Custom character list using CSS
                    document.execCommand('insertUnorderedList');
                    requestAnimationFrame(() => {
                      const sel = window.getSelection();
                      if (sel && sel.rangeCount > 0) {
                        let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
                        while (node && node.nodeName !== 'UL' && node !== document.body) node = node.parentNode;
                        if (node && node.nodeName === 'UL') {
                          const ul = node as HTMLElement;
                          ul.style.listStyleType = 'none';
                          ul.style.paddingLeft = '1.5em';
                          Array.from(ul.querySelectorAll('li')).forEach((li) => {
                            (li as HTMLElement).style.position = 'relative';
                            (li as HTMLElement).setAttribute('data-bullet', opt.char!);
                          });
                          // Inject style for this list
                          const styleId = `bullet-style-${opt.char}`;
                          if (!document.getElementById(styleId)) {
                            const style = document.createElement('style');
                            style.id = styleId;
                            style.textContent = `li[data-bullet="${opt.char}"]::before { content: "${opt.char}"; position: absolute; left: -1.2em; }`;
                            document.head.appendChild(style);
                          }
                        }
                      }
                    });
                  }
                  if (onSetOpenDropdown) onSetOpenDropdown(null);
                }}
                className="flex flex-col items-center justify-center p-2 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors cursor-pointer"
              >
                <span className="text-lg leading-none mb-1">{opt.label}</span>
                <span className="text-[10px] text-gray-500">{opt.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Encabezado y pie de página */}
      {openDropdown === 'encabezado' && (
        <div className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] w-72 p-4" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
          <p className="text-xs font-semibold text-gray-800 mb-3">Encabezado y pie de página</p>
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1.5">
              <input type="checkbox" id="s-header" checked={localShowHeader} onChange={(e) => { if (onShowHeaderChange) onShowHeaderChange(e.target.checked); }} className="rounded" />
              <label htmlFor="s-header" className="text-xs font-medium text-gray-700">Mostrar encabezado</label>
            </div>
          </div>
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1.5">
              <input type="checkbox" id="s-footer" checked={localShowFooter} onChange={(e) => { if (onShowFooterChange) onShowFooterChange(e.target.checked); }} className="rounded" />
              <label htmlFor="s-footer" className="text-xs font-medium text-gray-700">Mostrar pie de página</label>
            </div>
          </div>
          <div className="border-t border-gray-100 pt-2 mb-3">
            <p className="text-xs font-medium text-gray-500 mb-1">Opciones</p>
            <button type="button" onClick={() => { if (onSetOpenDropdown) onSetOpenDropdown(null); if (onShowNumerosModal) onShowNumerosModal(); else setShowNumerosModal(true); }} className="w-full text-left text-xs px-2 py-1.5 text-gray-700 hover:bg-gray-50 rounded">Números de página</button>
            <button type="button" onClick={() => { if (onShowHeaderChange) onShowHeaderChange(false); if (onShowFooterChange) onShowFooterChange(false); if (onSetOpenDropdown) onSetOpenDropdown(null); }} className="w-full text-left text-xs px-2 py-1.5 text-red-600 hover:bg-red-50 rounded">Quitar encabezado y pie</button>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={applyEncabezadoPie} className="flex-1 text-xs bg-blue-600 text-white rounded-md py-1.5 hover:bg-blue-700 font-medium">Aplicar</button>
            <button type="button" onClick={() => { if (onSetOpenDropdown) onSetOpenDropdown(null); }} className="flex-1 text-xs bg-gray-100 text-gray-700 rounded-md py-1.5 hover:bg-gray-200">Cancelar</button>
          </div>
        </div>
      )}

      {/* Vínculo inline dropdown */}
      {openDropdown === 'vinculo' && (
        <div className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] p-3 w-80" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
          <p className="text-xs font-semibold text-gray-700 mb-2">Insertar vínculo</p>
          <div className="mb-2">
            <label className="block text-xs text-gray-600 mb-1">Texto del vínculo</label>
            <input
              type="text"
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              placeholder="Texto a mostrar"
              className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 mb-1"
            />
          </div>
          <div className="mb-2">
            <label className="block text-xs text-gray-600 mb-1">URL del vínculo</label>
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://ejemplo.com"
              className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
              onKeyDown={(e) => { if (e.key === 'Enter') insertLink(); if (e.key === 'Escape') { if (onSetOpenDropdown) onSetOpenDropdown(null); } }}
              autoFocus={!linkText}
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={insertLink} className="flex-1 text-xs bg-blue-600 text-white rounded-md py-1.5 hover:bg-blue-700 font-medium">Insertar</button>
            <button type="button" onClick={() => { if (onSetOpenDropdown) onSetOpenDropdown(null); setLinkUrl(''); setLinkText(''); }} className="flex-1 text-xs bg-gray-100 text-gray-700 rounded-md py-1.5 hover:bg-gray-200">Cancelar</button>
          </div>
        </div>
      )}

      {/* Números de página inline dropdown */}
      {openDropdown === 'numeroPagina' && (
        <div className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] p-4 w-72" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
          <p className="text-xs font-semibold text-gray-800 mb-3">Números de página</p>
          <NumeroPaginaDropdownContent
            onApply={(opts) => {
              applyPageNumbers(opts);
              if (onSetOpenDropdown) onSetOpenDropdown(null);
            }}
            onClose={() => { if (onSetOpenDropdown) onSetOpenDropdown(null); }}
          />
        </div>
      )}

      {/* Números de página modal — fallback when triggered from header/footer options */}
      {showNumerosModal && (
        <SimplePageNumbersModal
          onApply={applyPageNumbers}
          onClose={() => setShowNumerosModal(false)}
        />
      )}

      {showImageSizeModal && imageSizeModalData.figure && (
        <ImageSizeModal
          originalWidth={imageSizeModalData.originalWidth}
          originalHeight={imageSizeModalData.originalHeight}
          currentWidth={imageSizeModalData.currentWidth}
          onApply={(w, h) => {
            const fig = imageSizeModalData.figure;
            if (fig) {
              const img = fig.querySelector('img') as HTMLImageElement | null;
              if (img) {
                img.style.width = `${w}px`;
                img.style.height = `${h}px`;
                img.setAttribute('width', String(w));
                fig.setAttribute('data-width', String(w));
              }
            }
            setShowImageSizeModal(false);
          }}
          onClose={() => setShowImageSizeModal(false)}
        />
      )}
    </>
  );
}

// ─── ¿Deseas salir? Modal ─────────────────────────────────────────────────────

function ExitConfirmModal({
  onSaveAndExit,
  onExitWithoutSave,
  onCancel,
  isSaving,
}: {
  onSaveAndExit: () => void;
  onExitWithoutSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">¿Deseas salir?</h3>
              <p className="text-sm text-gray-500 mt-0.5">Tienes cambios sin guardar en este documento.</p>
            </div>
          </div>
          <p className="text-sm text-gray-600 mb-6">
            Puedes guardar tu avance como borrador para continuar más tarde, o salir sin guardar y perder los cambios realizados.
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onSaveAndExit}
              disabled={isSaving}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-60"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              {isSaving ? 'Guardando...' : 'Guardar avance y salir'}
            </button>
            <button
              type="button"
              onClick={onExitWithoutSave}
              className="w-full px-4 py-3 text-sm font-semibold text-red-600 border border-gray-200 rounded-xl hover:bg-red-50 transition-colors"
            >
              Salir sin guardar
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="w-full px-4 py-3 text-sm font-medium text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tipo de documento Modal (tabbed) ─────────────────────────────────────────

function TipoDocumentoModal({
  tiposDocumento,
  grupos,
  selectedId,
  onSelect,
  onClose,
}: {
  tiposDocumento: TipoDocumento[];
  grupos: GrupoTipoDocumento[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'tipo' | 'favoritos' | 'grupo'>('tipo');
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('tipo_doc_favorites');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  // For "Por grupo" tab: null = show group list, string = show types of that group
  const [drillGroupId, setDrillGroupId] = useState<string | null>(null);

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem('tipo_doc_favorites', JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const favCount = tiposDocumento.filter((t) => favorites.has(t.id)).length;

  // Reset drill when switching tabs or searching
  const handleTabChange = (newTab: 'tipo' | 'favoritos' | 'grupo') => {
    setTab(newTab);
    setDrillGroupId(null);
  };

  // Filtered list for "Por tipo" and "Favoritos" tabs
  const filteredTipos = tiposDocumento.filter((t) => {
    const matchSearch = t.nombre.toLowerCase().includes(search.toLowerCase()) ||
      (grupos.find(g => g.id === t.grupo_id)?.nombre.toLowerCase().includes(search.toLowerCase()) ?? false);
    if (tab === 'tipo') return matchSearch;
    if (tab === 'favoritos') return favorites.has(t.id) && matchSearch;
    return false;
  });

  // For "Por grupo" tab — groups filtered by search
  const filteredGrupos = grupos.filter((g) => {
    if (!search) return true;
    const matchGroupName = g.nombre.toLowerCase().includes(search.toLowerCase());
    const hasMatchingTipo = tiposDocumento.some(
      (t) => t.grupo_id === g.id && t.nombre.toLowerCase().includes(search.toLowerCase())
    );
    return matchGroupName || hasMatchingTipo;
  });

  // Types inside a drilled group, filtered by search
  const drillTipos = drillGroupId
    ? tiposDocumento.filter(
        (t) =>
          t.grupo_id === drillGroupId &&
          (search === '' || t.nombre.toLowerCase().includes(search.toLowerCase()))
      )
    : [];

  const drillGroup = grupos.find((g) => g.id === drillGroupId);

  // Count of types per group
  const countByGroup = (gid: string) => tiposDocumento.filter((t) => t.grupo_id === gid).length;

  // Render a tipo row (shared between tabs)
  const renderTipoRow = (t: TipoDocumento) => {
    const grupo = grupos.find((g) => g.id === t.grupo_id);
    const isFav = favorites.has(t.id);
    return (
      <div
        key={t.id}
        className={`flex w-full items-center border-b border-gray-100 transition-colors last:border-0 hover:bg-gray-50 ${selectedId === t.id ? 'bg-blue-50' : ''}`}
      >
        <button
          type="button"
          onClick={() => onSelect(t.id)}
          className="min-w-0 flex-1 px-5 py-3.5 text-left"
        >
          <span className={`block text-sm font-semibold leading-snug ${selectedId === t.id ? 'text-blue-700' : 'text-gray-900'}`}>{t.nombre}</span>
          {grupo && <span className="mt-0.5 block text-xs text-gray-500">{grupo.nombre}</span>}
        </button>
        <button
          type="button"
          onClick={(e) => toggleFavorite(t.id, e)}
          className="mr-4 shrink-0 rounded-md p-2 transition-colors hover:bg-amber-50"
          title={isFav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
          aria-label={isFav ? `Quitar ${t.nombre} de favoritos` : `Agregar ${t.nombre} a favoritos`}
        >
          <Star
            size={16}
            className={isFav ? 'text-amber-400 fill-amber-400' : 'text-gray-300 hover:text-amber-300'}
          />
        </button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden flex flex-col" style={{ maxHeight: '85vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-blue-600" />
            <h3 className="text-base font-semibold text-gray-900">Tipo de documento</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-md transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-4 pb-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setDrillGroupId(null); }}
              placeholder="Buscar tipo o documento..."
              autoFocus
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-gray-50"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="px-5 pb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleTabChange('tipo')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${tab === 'tipo' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            Por tipo
            <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${tab === 'tipo' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`}>
              {tiposDocumento.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('favoritos')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${tab === 'favoritos' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            <Star size={11} className={tab === 'favoritos' ? 'fill-white' : ''} />
            Favoritos
            <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${tab === 'favoritos' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`}>
              {favCount}
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('grupo')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${tab === 'grupo' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            Por grupo
          </button>
        </div>

        {/* List area */}
        <div className="flex-1 overflow-y-auto border-t border-gray-100">

          {/* ── Por tipo tab ── */}
          {tab === 'tipo' && (
            filteredTipos.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-gray-400">No se encontraron tipos</div>
            ) : (
              filteredTipos.map((t) => renderTipoRow(t))
            )
          )}

          {/* ── Favoritos tab ── */}
          {tab === 'favoritos' && (
            filteredTipos.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <Star size={32} className="mx-auto mb-3 text-gray-200" />
                <p className="text-sm text-gray-400 font-medium">No tienes favoritos aún</p>
                <p className="text-xs text-gray-300 mt-1">Marca documentos con ★ para verlos aquí</p>
              </div>
            ) : (
              filteredTipos.map((t) => renderTipoRow(t))
            )
          )}

          {/* ── Por grupo tab ── */}
          {tab === 'grupo' && (
            drillGroupId === null ? (
              /* Group list view */
              filteredGrupos.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-gray-400">No se encontraron grupos</div>
              ) : (
                filteredGrupos.map((g) => {
                  const count = countByGroup(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setDrillGroupId(g.id)}
                      className="w-full text-left px-5 py-4 hover:bg-gray-50 transition-colors flex items-center justify-between border border-gray-100 rounded-xl mx-3 mb-2 mt-2"
                      style={{ width: 'calc(100% - 24px)' }}
                    >
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{g.nombre}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{count} documento{count !== 1 ? 's' : ''}</p>
                      </div>
                      <ArrowRight size={16} className="text-gray-400 shrink-0" />
                    </button>
                  );
                })
              )
            ) : (
              /* Drilled into a group — show its types */
              <div className="flex flex-col h-full">
                {/* Back header */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <button
                    type="button"
                    onClick={() => setDrillGroupId(null)}
                    className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    <ArrowRight size={13} className="rotate-180" />
                    Grupos
                  </button>
                  <span className="text-gray-300 text-xs">/</span>
                  <span className="text-xs text-gray-700 font-semibold truncate">{drillGroup?.nombre}</span>
                </div>
                {drillTipos.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-gray-400">No se encontraron tipos en este grupo</div>
                ) : (
                  drillTipos.map((t) => renderTipoRow(t))
                )}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Etiquetas Modal (tabbed) ─────────────────────────────────────────────────

function EtiquetasModal({
  etiquetas,
  selectedIds,
  onConfirm,
  onClose,
}: {
  etiquetas: Etiqueta[];
  selectedIds: string[];
  onConfirm: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'todos' | 'favoritos'>('todos');
  const [search, setSearch] = useState('');
  const [localSelected, setLocalSelected] = useState<string[]>(selectedIds);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('etiqueta_favorites');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem('etiqueta_favorites', JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setLocalSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const filtered = etiquetas.filter((e) => {
    const matchSearch = e.nombre.toLowerCase().includes(search.toLowerCase());
    if (tab === 'favoritos') return favorites.has(e.id) && matchSearch;
    return matchSearch;
  });

  const favCount = etiquetas.filter((e) => favorites.has(e.id)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden flex flex-col" style={{ maxHeight: '85vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Etiquetas</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-md transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-4 pb-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar etiqueta..."
              autoFocus
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-gray-50"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="px-5 pb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('todos')}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${tab === 'todos' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            Todos
          </button>
          <button
            type="button"
            onClick={() => setTab('favoritos')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-colors ${tab === 'favoritos' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            <Star size={13} />
            Favoritos ({favCount})
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto border-t border-gray-100">
          {filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-400">
              {tab === 'favoritos' ? 'No tienes favoritos aún' : 'No se encontraron etiquetas'}
            </div>
          ) : (
            filtered.map((e) => {
              const isSelected = localSelected.includes(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => toggleSelect(e.id)}
                  className={`w-full text-left px-5 py-3 hover:bg-gray-50 transition-colors flex items-center justify-between group border-b border-gray-50 last:border-0 ${isSelected ? 'bg-blue-50/50' : ''}`}
                >
                  <span className={`text-sm ${isSelected ? 'text-blue-700 font-medium' : 'text-gray-700'}`}>{e.nombre}</span>
                  <button
                    type="button"
                    onClick={(ev) => toggleFavorite(e.id, ev)}
                    className="ml-3 shrink-0"
                    title={favorites.has(e.id) ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                  >
                    <Star
                      size={15}
                      className={favorites.has(e.id) ? 'text-amber-400 fill-amber-400' : 'text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity'}
                    />
                  </button>
                </button>
              );
            })
          )}
        </div>

        {/* Footer: Confirmar */}
        <div className="px-5 py-4 border-t border-gray-100">
          <button
            type="button"
            onClick={() => onConfirm(localSelected)}
            className="w-full py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
          >
            Confirmar ({localSelected.length} seleccionada{localSelected.length !== 1 ? 's' : ''})
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: Información General ─────────────────────────────────────────────

function StepInfoGeneral({
  data,
  onChange,
  showValidationErrors,
}: {
  data: InfoGeneralData;
  onChange: (updates: Partial<InfoGeneralData>) => void;
  showValidationErrors?: boolean;
}) {
  const [grupos, setGrupos] = useState<GrupoTipoDocumento[]>([]);
  const [tiposDocumento, setTiposDocumento] = useState<TipoDocumento[]>([]);
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const [showTipoModal, setShowTipoModal] = useState(false);
  const [showEtiquetasModal, setShowEtiquetasModal] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient();
        const [gruposRes, tiposRes, etiquetasRes] = await Promise.all([
          supabase.from('grupo_tipo_documento').select('id, nombre').order('nombre'),
          supabase.from('tipo_documento').select('id, nombre, grupo_id').order('nombre'),
          supabase.from('etiquetas').select('id, nombre, color').order('nombre'),
        ]);
        if (gruposRes.data) setGrupos(gruposRes.data);
        if (tiposRes.data) setTiposDocumento(tiposRes.data);
        if (etiquetasRes.data) setEtiquetas(etiquetasRes.data);
      } catch {
        // silently fail
      } finally {
        setLoadingData(false);
      }
    };
    load();
  }, []);

  const handleTipoSelect = (tipoId: string) => {
    const tipo = tiposDocumento.find((t) => t.id === tipoId);
    onChange({
      tipoDocumentoId: tipoId,
      grupotipoId: tipo ? tipo.grupo_id : '',
    });
    setShowTipoModal(false);
  };

  const selectedTipo = tiposDocumento.find((t) => t.id === data.tipoDocumentoId);
  const selectedGrupo = grupos.find((g) => g.id === data.grupotipoId);
  const selectedEtiquetas = etiquetas.filter((e) => data.etiquetasIds.includes(e.id));

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 px-6 py-6">
      <div className="mx-auto w-full max-w-6xl">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-50 text-primary">
              <FileText size={17} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Datos de la plantilla</h2>
              <p className="mt-0.5 text-xs text-slate-500">Información básica, clasificación y formato del documento.</p>
            </div>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
              {/* Nombre */}
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
                  Nombre de la plantilla <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={data.nombre}
                  onChange={(e) => onChange({ nombre: e.target.value })}
                  placeholder="Nombre de la plantilla"
                  className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 ${showValidationErrors && !data.nombre.trim() ? 'border-red-300 bg-red-50/30' : 'border-gray-200'}`}
                />
                {showValidationErrors && !data.nombre.trim() && (
                  <p className="text-xs text-red-500 mt-1">Este campo es obligatorio</p>
                )}
              </div>

              {/* Descripción */}
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">Descripción</label>
                <textarea
                  value={data.descripcion}
                  onChange={(e) => onChange({ descripcion: e.target.value })}
                  placeholder="Descripción de la plantilla"
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none"
                />
              </div>

              {/* Número de oficio / identificador */}
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">Número de oficio / documento</label>
                <input
                  type="text"
                  value={data.numeroOficio}
                  onChange={(e) => onChange({ numeroOficio: e.target.value })}
                  placeholder="Ej. OF-2026-001"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                />
              </div>

              {/* Grupo de documento — read-only, auto-filled */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Grupo de documento</label>
                <div className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed min-h-[38px] flex items-center">
                  {loadingData
                    ? 'Cargando...'
                    : selectedGrupo
                    ? selectedGrupo.nombre
                    : <span className="text-gray-400">Se asigna automáticamente</span>
                  }
                </div>
              </div>

              {/* Tipo de documento — input + Buscar button */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
                  Tipo de documento <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => !loadingData && setShowTipoModal(true)}
                    className={`flex-1 px-3 py-2 text-sm border rounded-lg min-h-[38px] flex items-center text-left transition-colors ${loadingData ? 'bg-gray-50 border-gray-200 cursor-not-allowed' : 'bg-white border-gray-200 hover:border-blue-400 hover:bg-blue-50/30 cursor-pointer'} ${showValidationErrors && !data.tipoDocumentoId ? 'border-red-300 bg-red-50/30' : ''}`}
                  >
                    {loadingData
                      ? <span className="text-gray-400">Cargando...</span>
                      : selectedTipo
                      ? <span className="text-gray-900">{selectedTipo.nombre}</span>
                      : <span className="text-gray-400">Seleccionar tipo de documento...</span>
                    }
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTipoModal(true)}
                    disabled={loadingData}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    <Search size={14} />
                    Buscar
                  </button>
                </div>
                {showValidationErrors && !data.tipoDocumentoId && (
                  <p className="text-xs text-red-500 mt-1">Este campo es obligatorio</p>
                )}
              </div>

              {/* Etiquetas — input + Buscar button */}
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-1.5">
                  <Tag size={12} className="text-gray-400" />
                  Etiquetas
                </label>
                <div className="flex gap-2">
                  <div className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white min-h-[38px] flex flex-wrap items-center gap-1.5">
                    {selectedEtiquetas.length === 0
                      ? <span className="text-gray-400">Seleccionar etiquetas...</span>
                      : selectedEtiquetas.map((tag) => (
                          <span
                            key={tag.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                            style={{ backgroundColor: tag.color || '#6B7280' }}
                          >
                            {tag.nombre}
                            <button
                              type="button"
                              onClick={() => onChange({ etiquetasIds: data.etiquetasIds.filter((x) => x !== tag.id) })}
                              className="hover:opacity-70 transition-opacity ml-0.5"
                            >
                              <X size={10} />
                            </button>
                          </span>
                        ))
                    }
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowEtiquetasModal(true)}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors whitespace-nowrap"
                  >
                    <Search size={14} />
                    Buscar
                  </button>
                </div>
              </div>

              {/* Configuración de hoja */}
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
                  Configuración de hoja <span className="text-red-500">*</span>
                  <span className="text-xs font-normal text-gray-400">(Tamaño obligatorio)</span>
                </label>
                <div className={`flex gap-2 items-stretch ${showValidationErrors && !data.hojaTamano ? 'ring-1 ring-red-300 rounded-lg' : ''}`}>
                  <div className="flex-1">
                    <select
                      value={data.hojaTamano}
                      onChange={(e) => onChange({ hojaTamano: e.target.value })}
                      className={`w-full px-3 py-2 text-sm border rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 min-h-[38px] ${showValidationErrors && !data.hojaTamano ? 'border-red-300' : 'border-gray-200'}`}
                    >
                      <option value="">Seleccionar tamaño...</option>
                      {TAMANOS_HOJA.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    {showValidationErrors && !data.hojaTamano && (
                      <p className="text-xs text-red-500 mt-1">Selecciona un tamaño de hoja</p>
                    )}
                  </div>
                  <div className="flex gap-2 items-center">
                    <button
                      type="button"
                      onClick={() => onChange({ hojaOrientacion: 'vertical' })}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium border rounded-lg min-h-[38px] transition-colors ${
                        data.hojaOrientacion === 'vertical' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                      }`}
                    >
                      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><rect x="0" y="0" width="10" height="14" rx="1" /></svg>
                      Vertical
                    </button>
                    <button
                      type="button"
                      onClick={() => onChange({ hojaOrientacion: 'horizontal' })}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium border rounded-lg min-h-[38px] transition-colors ${
                        data.hojaOrientacion === 'horizontal' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                      }`}
                    >
                      <svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor"><rect x="0" y="0" width="14" height="10" rx="1" /></svg>
                      Horizontal
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tipo de documento modal */}
      {showTipoModal && (
        <TipoDocumentoModal
          tiposDocumento={tiposDocumento}
          grupos={grupos}
          selectedId={data.tipoDocumentoId}
          onSelect={handleTipoSelect}
          onClose={() => setShowTipoModal(false)}
        />
      )}

      {/* Etiquetas modal */}
      {showEtiquetasModal && (
        <EtiquetasModal
          etiquetas={etiquetas}
          selectedIds={data.etiquetasIds}
          onConfirm={(ids) => { onChange({ etiquetasIds: ids }); setShowEtiquetasModal(false); }}
          onClose={() => setShowEtiquetasModal(false)}
        />
      )}
    </div>
  );
}

// ─── Step 3: Publicación ──────────────────────────────────────────────────────

function StepPublicacion({
  data,
  onChange,
  infoData,
  onInfoChange,
}: {
  data: PublicacionData;
  onChange: (updates: Partial<PublicacionData>) => void;
  infoData: InfoGeneralData;
  onInfoChange: (updates: Partial<InfoGeneralData>) => void;
}) {
  const [showContactModal, setShowContactModal] = useState(false);
  const [selectedContact, setSelectedContact] = useState<{ id: string; nombre: string; email: string } | null>(null);

  // Auto-set estadoPlantilla based on option
  const estadoMap: Record<string, string> = {
    borrador: 'Borrador',
    publicar: 'Publicada',
    aprobacion: 'En revisión',
    version: 'Publicada',
  };

  const handleOptionChange = (opt: PublicacionData['publicacionOpcion']) => {
    const nuevoEstado = estadoMap[opt] || 'Borrador';
    onChange({ publicacionOpcion: opt, estadoPlantilla: nuevoEstado });
    if (opt === 'aprobacion') {
      setShowContactModal(true);
    }
  };

  const publishButtonLabel: Record<string, string> = {
    borrador: 'Guardar como borrador',
    publicar: 'Publicar plantilla',
    aprobacion: 'Enviar a aprobación',
    version: 'Duplicar como nueva versión',
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 px-6 py-6">
      <div className="mx-auto w-full max-w-6xl space-y-5">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-50 text-primary">
              <Layers size={17} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Clasificación</h2>
              <p className="mt-0.5 text-xs text-slate-500">Define el uso y el área responsable de la plantilla.</p>
            </div>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Área responsable</label>
                <select
                  value={infoData.areaResponsable}
                  onChange={(e) => onInfoChange({ areaResponsable: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
                >
                  <option value="">Seleccionar...</option>
                  {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Tipo de plantilla</label>
                <select
                  value={infoData.tipoPlantilla}
                  onChange={(e) => onInfoChange({ tipoPlantilla: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
                >
                  <option value="">Seleccionar...</option>
                  {TIPOS_PLANTILLA.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-50 text-primary">
              <Send size={17} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Publicación</h2>
              <p className="mt-0.5 text-xs text-slate-500">Selecciona el destino y registra los últimos detalles.</p>
            </div>
          </div>
          <div className="p-6">

            <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {PUBLICACION_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleOptionChange(opt.id)}
                  className={`min-h-[92px] rounded-md border p-4 text-left transition-all ${
                    data.publicacionOpcion === opt.id ? 'border-primary bg-blue-50 ring-1 ring-primary/10' : 'border-slate-200 bg-white hover:border-primary/30 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      data.publicacionOpcion === opt.id ? 'border-blue-500' : 'border-gray-300'
                    }`}>
                      {data.publicacionOpcion === opt.id && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                    </div>
                    <span className={`text-xs font-semibold ${data.publicacionOpcion === opt.id ? 'text-blue-700' : 'text-gray-700'}`}>
                      {opt.title}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 ml-5">{opt.desc}</p>
                </button>
              ))}
            </div>

            {/* Contact selected for aprobacion */}
            {data.publicacionOpcion === 'aprobacion' && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-blue-800">Contacto para aprobación</p>
                  {selectedContact ? (
                    <p className="text-sm text-blue-700 font-semibold">{selectedContact.nombre} — {selectedContact.email}</p>
                  ) : (
                    <p className="text-xs text-blue-600 italic">No seleccionado</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowContactModal(true)}
                  className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  {selectedContact ? 'Cambiar' : 'Seleccionar'}
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">Comentario de publicación</label>
                <textarea
                  value={data.comentarioPublicacion}
                  onChange={(e) => onChange({ comentarioPublicacion: e.target.value })}
                  placeholder="Agregar comentario (opcional)..."
                  rows={3}
                  maxLength={500}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                />
                <p className="text-xs text-gray-400 text-right mt-0.5">{data.comentarioPublicacion.length} / 500</p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Estado de la plantilla <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={data.estadoPlantilla}
                    readOnly
                    disabled
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-600 cursor-not-allowed"
                    placeholder="Se asigna automáticamente"
                  />
                  {!data.estadoPlantilla && (
                    <p className="text-xs text-red-500 mt-1">Selecciona una opción de publicación</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Versión publicada</label>
                  <input
                    type="text"
                    value={data.versionPublicada}
                    onChange={(e) => onChange({ versionPublicada: e.target.value })}
                    disabled={data.publicacionOpcion !== 'version'}
                    className={`w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${data.publicacionOpcion !== 'version' ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`}
                    placeholder="Ej. 1.0"
                  />
                  {data.publicacionOpcion !== 'version' && (
                    <p className="text-xs text-gray-400 mt-0.5">Solo editable al duplicar como nueva versión</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showContactModal && (
        <ContactPickerModal
          onSelect={(c) => {
            setSelectedContact(c);
            onChange({ estadoPlantilla: 'En revisión' });
            setShowContactModal(false);
          }}
          onClose={() => setShowContactModal(false)}
        />
      )}
    </div>
  );
}

// ─── Wizard Shell ─────────────────────────────────────────────────────────────

function NuevaPlantillaPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams?.get('id') || null;

  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [currentHtml, setCurrentHtml] = useState(() => ensureDocuboxTemplateBrand());
  const [showPreview, setShowPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; type: 'success' | 'error' | 'info'; message: string }[]>([]);
  const [pageCount, setPageCount] = useState(1);
  const [activePage, setActivePage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const savedTemplateIdRef = useRef<string | null>(templateId);

  // Editor state
  const [showRulers, setShowRulers] = useState(false);
  const [showHeader, setShowHeader] = useState(false);
  const [showFooter, setShowFooter] = useState(false);
  const [firstPageDifferent, setFirstPageDifferent] = useState(false);
  const [showNumerosModal, setShowNumerosModal] = useState(false);
  const [imageSizeData, setImageSizeData] = useState<{ figure: HTMLElement; originalWidth: number; originalHeight: number; currentWidth: number } | null>(null);
  const [margenes, setMargenes] = useState<PageMargins>({ top: 2.54, bottom: 2.54, left: 3.17, right: 3.17 });

  // Toolbar shared state (lifted to avoid undefined refs in bottom bar)
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [showWordCount, setShowWordCount] = useState(false);

  const updateWordCount = useCallback(() => {
    const pages = document.querySelectorAll('[data-page-content]');
    let text = '';
    pages.forEach((p) => { text += (p as HTMLElement).innerText + ' '; });
    const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
    setWordCount(words.length);
  }, []);

  const [insertedFields, setInsertedFields] = useState<InsertedField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);

  const multiPageEditorRef = useRef<MultiPageEditorHandle>(null);
  const [pendingPageNumbers, setPendingPageNumbers] = useState<{
    position: 'header' | 'footer';
    showOnFirst: boolean;
    startFrom: number;
  } | null>(null);
  const savedSelectionRef = useRef<{ node: Node; offset: number; pageEl: HTMLElement; pageIndex: number } | null>(null);

  const [infoData, setInfoData] = useState<InfoGeneralData>({
    nombre: '',
    descripcion: '',
    numeroOficio: '',
    areaResponsable: '',
    tipoPlantilla: '',
    etiquetasIds: [],
    grupotipoId: '',
    tipoDocumentoId: '',
    hojaTamano: '',
    hojaOrientacion: 'vertical',
  });

  const [pubData, setPubData] = useState<PublicacionData>({
    publicacionOpcion: 'borrador',
    comentarioPublicacion: '',
    estadoPlantilla: 'Borrador',
    versionPublicada: '1.0',
  });

  const applyPageNumberConfig = useCallback(
    (opts: { position: 'header' | 'footer'; showOnFirst: boolean; startFrom: number }) => {
      if (opts.position === 'header') {
        setShowHeader(true);
      } else {
        setShowFooter(true);
      }
      setPendingPageNumbers(opts);
    },
    []
  );

  useEffect(() => {
    if (!pendingPageNumbers) return;
    const zoneIsVisible = pendingPageNumbers.position === 'header' ? showHeader : showFooter;
    if (!zoneIsVisible) return;

    const frame = requestAnimationFrame(() => {
      const editor = multiPageEditorRef.current;
      if (editor?.insertPageNumber(pendingPageNumbers)) {
        setCurrentHtml(editor.getHTML());
        setPendingPageNumbers(null);
        setHasUnsavedChanges(true);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [pendingPageNumbers, showHeader, showFooter]);

  // Load existing template if editing
  useEffect(() => {
    if (!templateId) return;
    const loadTemplate = async () => {
      setIsLoadingTemplate(true);
      try {
        let res = await fetch(`/api/plantillas/${templateId}`);
        if (!res.ok) return;
        const json = await res.json();
        const t = json.data;
        if (!t) return;

        setInfoData({
          nombre: t.nombre || t.name || '',
          descripcion: t.descripcion || t.description || '',
          numeroOficio: t.numero_oficio || '',
          areaResponsable: t.area_responsable || '',
          tipoPlantilla: t.tipo_plantilla || '',
          etiquetasIds: Array.isArray(t.etiquetas_ids) ? t.etiquetas_ids : [],
          grupotipoId: t.grupo_tipo_id || t.grupo_tipo?.id || '',
          tipoDocumentoId: t.tipo_documento_id || t.tipo_documento?.id || '',
          hojaTamano: t.hoja_tamano || 'Carta (Letter)',
          hojaOrientacion: (t.hoja_orientacion as 'vertical' | 'horizontal') || 'vertical',
        });

        setPubData({
          publicacionOpcion: (t.publicacion_opcion as PublicacionData['publicacionOpcion']) || 'borrador',
          comentarioPublicacion: t.comentario_publicacion || '',
          estadoPlantilla: t.estado_plantilla || 'Borrador',
          versionPublicada: t.version_publicada || '1.0',
        });

        setCurrentHtml(ensureDocuboxTemplateBrand(t.contenido_html));

        // Restore editor layout state
        if (t.margenes) setMargenes(t.margenes);
        if (typeof t.show_header === 'boolean') setShowHeader(t.show_header);
        if (typeof t.show_footer === 'boolean') setShowFooter(t.show_footer);

        if (Array.isArray(t.campos_insertados) && t.campos_insertados.length > 0) {
          setInsertedFields(t.campos_insertados as InsertedField[]);
        }

        savedTemplateIdRef.current = t.id;
      } catch {
        // silently fail
      } finally {
        setIsLoadingTemplate(false);
      }
    };
    loadTemplate();
  }, [templateId]);

  // Track unsaved changes
  const handleInfoChange = useCallback((updates: Partial<InfoGeneralData>) => {
    setInfoData((prev) => ({ ...prev, ...updates }));
    setHasUnsavedChanges(true);
  }, []);

  const addToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    const id = `toast-${Date.now()}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const getPageIndexForNode = useCallback((node: Node): number => {
    let el: Node | null = node;
    while (el) {
      if (el instanceof HTMLElement) {
        const pageAttr = el.closest('[data-page-id]');
        if (pageAttr) {
          const allPages = document.querySelectorAll('[data-page-id]');
          const idx = Array.from(allPages).indexOf(pageAttr as Element);
          return idx >= 0 ? idx : 0;
        }
      }
      el = el.parentNode;
    }
    return 0;
  }, []);

  const handleEditorInteraction = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      let node: Node | null = range.startContainer;
      let pageEl: HTMLElement | null = null;
      while (node) {
        if (node instanceof HTMLElement && node.contentEditable === 'true') {
          pageEl = node;
          break;
        }
        node = node.parentNode;
      }
      if (pageEl) {
        let pageIndex = getPageIndexForNode(range.startContainer);
        savedSelectionRef.current = {
          node: range.startContainer,
          offset: range.startOffset,
          pageEl,
          pageIndex,
        };
      }
    }
    setHasUnsavedChanges(true);
  }, [getPageIndexForNode]);

  const handleDocumentAreaClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const chip = target.closest('[data-field-id]') as HTMLElement | null;
    if (chip) {
      const fieldId = chip.getAttribute('data-field-id');
      if (fieldId) {
        setSelectedFieldId(fieldId);
        document.querySelectorAll('[data-field-id]').forEach((el) => {
          (el as HTMLElement).style.outline = '';
        });
        chip.style.outline = '2px solid #3B82F6';
        return;
      }
    }
    setSelectedFieldId(null);
    document.querySelectorAll('[data-field-id]').forEach((el) => {
      (el as HTMLElement).style.outline = '';
    });
  }, []);

  const handleUpdateField = useCallback((id: string, updates: Partial<InsertedField>) => {
    setInsertedFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
    );
    if (updates.customName !== undefined) {
      const chip = document.querySelector(`[data-field-id="${id}"]`) as HTMLElement | null;
      if (chip) {
        chip.textContent = `{{${updates.customName}}}`;
        chip.setAttribute('data-field-label', updates.customName);
      }
    }
  }, []);

  const insertGeneralField = useCallback(
    (_editor: unknown, fieldType: string, label: string) => {
      const fieldId = `field-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const chip = `<span contenteditable="false" data-field-id="${fieldId}" data-field-label="${label}" data-field-type="${fieldType}" style="display:inline;background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;border-radius:4px;padding:1px 7px;font-size:inherit;font-family:inherit;line-height:inherit;user-select:none;cursor:pointer;white-space:nowrap;" title="Clic para editar propiedades">{{${label}}}</span>`;

      const sel = window.getSelection();
      let pageIndex = 0;

      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        let node: Node | null = range.commonAncestorContainer;
        let pageEl: HTMLElement | null = null;
        while (node) {
          if (node instanceof HTMLElement && node.contentEditable === 'true') {
            pageEl = node;
            break;
          }
          node = node.parentNode;
        }
        if (pageEl) {
          pageIndex = getPageIndexForNode(range.startContainer);
          range.deleteContents();
          const fragment = range.createContextualFragment(chip);
          const lastNode = fragment.lastChild;
          range.insertNode(fragment);
          if (lastNode) {
            const newRange = document.createRange();
            newRange.setStartAfter(lastNode);
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
            savedSelectionRef.current = {
              node: newRange.startContainer,
              offset: newRange.startOffset,
              pageEl,
              pageIndex,
            };
          }
          const newField: InsertedField = { id: fieldId, label, fieldType, customName: label, showLabelInDocument: false, options: [], pageIndex };
          setInsertedFields((prev) => [...prev, newField]);
          setHasUnsavedChanges(true);
          return;
        }
      }

      const saved = savedSelectionRef.current;
      if (saved) {
        try {
          saved.pageEl.focus();
          const restoreSel = window.getSelection();
          if (restoreSel) {
            restoreSel.removeAllRanges();
            const range = document.createRange();
            range.setStart(saved.node, saved.offset);
            range.collapse(true);
            restoreSel.addRange(range);
            document.execCommand('insertHTML', false, chip);
            const newField: InsertedField = { id: fieldId, label, fieldType, customName: label, showLabelInDocument: false, options: [], pageIndex: saved.pageIndex };
            setInsertedFields((prev) => [...prev, newField]);
            setHasUnsavedChanges(true);
            return;
          }
        } catch {
          // fall through
        }
      }

      const firstPage = document.querySelector('[contenteditable="true"]') as HTMLElement | null;
      if (firstPage) {
        firstPage.focus();
        const fallbackSel = window.getSelection();
        if (fallbackSel) {
          fallbackSel.removeAllRanges();
          const range = document.createRange();
          range.selectNodeContents(firstPage);
          range.collapse(false);
          fallbackSel.addRange(range);
          document.execCommand('insertHTML', false, chip);
          const newField: InsertedField = { id: fieldId, label, fieldType, customName: label, showLabelInDocument: false, options: [], pageIndex: 0 };
          setInsertedFields((prev) => [...prev, newField]);
          setHasUnsavedChanges(true);
        }
      }
    },
    [getPageIndexForNode]
  );

  const buildPayload = useCallback((estado: string, estadoPlantilla: string) => {
    const html = ensureDocuboxTemplateBrand(multiPageEditorRef.current?.getHTML() ?? currentHtml);
    return {
      nombre: infoData.nombre || 'Nueva Plantilla',
      descripcion: infoData.descripcion,
      numeroOficio: infoData.numeroOficio,
      areaResponsable: infoData.areaResponsable,
      tipoPlantilla: infoData.tipoPlantilla,
      etiquetasIds: infoData.etiquetasIds,
      tipoDocumentoId: infoData.tipoDocumentoId || null,
      grupotipoId: infoData.grupotipoId || null,
      hojaTamano: infoData.hojaTamano,
      hojaOrientacion: infoData.hojaOrientacion,
      contenidoHtml: html,
      camposInsertados: insertedFields,
      publicacionOpcion: pubData.publicacionOpcion,
      comentarioPublicacion: pubData.comentarioPublicacion,
      estadoPlantilla: estadoPlantilla,
      versionPublicada: pubData.versionPublicada,
      estado: estado,
      fields: insertedFields,
      margenes: margenes,
      showHeader: showHeader,
      showFooter: showFooter,
    };
  }, [currentHtml, infoData, insertedFields, pubData, margenes, showHeader, showFooter]);

  const handleSaveDraft = useCallback(async () => {
    setIsSaving(true);
    try {
      const payload = buildPayload('draft', 'Borrador');

      let res: Response;
      if (savedTemplateIdRef.current) {
        res = await fetch(`/api/plantillas/${savedTemplateIdRef.current}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/plantillas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al guardar');

      if (json.data?.id && !savedTemplateIdRef.current) {
        savedTemplateIdRef.current = json.data.id;
        // Update URL without navigation
        const url = new URL(window.location.href);
        url.searchParams.set('id', json.data.id);
        window.history.replaceState({}, '', url.toString());
      }

      setHasUnsavedChanges(false);
      addToast('success', 'Borrador guardado correctamente');
    } catch (err: any) {
      addToast('error', err.message || 'Error al guardar el borrador');
    } finally {
      setIsSaving(false);
    }
  }, [buildPayload, addToast]);

  const handleExitClick = () => {
    if (hasUnsavedChanges) {
      setShowExitModal(true);
    } else {
      router.push('/plantillas');
    }
  };

  const handlePublish = useCallback(async () => {
    // Validate estado is set
    if (!pubData.estadoPlantilla) {
      addToast('error', 'Selecciona una opción de publicación para continuar.');
      return;
    }
    setIsSaving(true);
    try {
      const statusMap: Record<string, string> = {
        borrador: 'draft',
        publicar: 'published',
        aprobacion: 'draft',
        version: 'published',
      };
      const estadoMap: Record<string, string> = {
        borrador: 'Borrador',
        publicar: 'Publicada',
        aprobacion: 'En revisión',
        version: 'Publicada',
      };
      const estado = statusMap[pubData.publicacionOpcion] || 'draft';
      const estadoPlantilla = estadoMap[pubData.publicacionOpcion] || pubData.estadoPlantilla;
      const payload = buildPayload(estado, estadoPlantilla);

      let res: Response;
      if (savedTemplateIdRef.current) {
        res = await fetch(`/api/plantillas/${savedTemplateIdRef.current}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/plantillas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al publicar');

      if (json.data?.id && !savedTemplateIdRef.current) {
        savedTemplateIdRef.current = json.data.id;
      }

      setHasUnsavedChanges(false);
      const publishLabels: Record<string, string> = {
        borrador: 'Borrador guardado correctamente',
        publicar: '¡Plantilla publicada exitosamente!',
        aprobacion: 'Plantilla enviada a aprobación',
        version: 'Nueva versión creada correctamente',
      };
      addToast('success', publishLabels[pubData.publicacionOpcion] || 'Plantilla guardada correctamente');
      setTimeout(() => router.push('/plantillas'), 1500);
    } catch (err: any) {
      addToast('error', err.message || 'Error al publicar la plantilla');
    } finally {
      setIsSaving(false);
    }
  }, [buildPayload, pubData, addToast, router]);

  const handleSaveAndExit = async () => {
    await handleSaveDraft();
    router.push('/plantillas');
  };

  const handleNext = () => {
    if (wizardStep === 1) {
      if (!infoData.nombre.trim()) {
        setShowValidationErrors(true);
        addToast('error', 'El campo "Nombre de la plantilla" es obligatorio.');
        return;
      }
      if (!infoData.hojaTamano) {
        setShowValidationErrors(true);
        addToast('error', 'El campo "Tamaño de hoja" es obligatorio.');
        return;
      }
      setShowValidationErrors(false);
      setWizardStep(2);
    } else if (wizardStep === 2) setWizardStep(3);
  };

  const handleBack = () => {
    if (wizardStep === 3) setWizardStep(2);
    else if (wizardStep === 2) setWizardStep(1);
    else router.push('/plantillas');
  };

  const selectedField = insertedFields.find((f) => f.id === selectedFieldId) ?? null;
  const activeWizardStep = WIZARD_STEPS.find((step) => step.id === wizardStep) ?? WIZARD_STEPS[0];
  const ActiveWizardIcon = activeWizardStep.icon;
  const stepDescriptions: Record<number, string> = {
    1: 'Define la identidad, clasificación y formato base de la plantilla.',
    2: 'Diseña el contenido e incorpora los campos que se completarán después.',
    3: 'Revisa la clasificación y elige cómo guardar o publicar la plantilla.',
  };
  const wizardProgress = ((wizardStep - 1) / (WIZARD_STEPS.length - 1)) * 100;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-950">

      {/* Loading overlay when fetching existing template */}
      {isLoadingTemplate && (
        <div className="absolute inset-0 z-[300] flex items-center justify-center bg-white/85 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm font-medium text-slate-500">Cargando plantilla...</p>
          </div>
        </div>
      )}

      {/* ── Top header ── */}
      <header className="z-20 flex h-16 shrink-0 items-center border-b border-slate-200 bg-white px-4 lg:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="shrink-0">
            <AppLogo size={34} />
          </div>
          <div className="hidden h-8 w-px bg-slate-200 xl:block" />
          <div className="hidden min-w-0 xl:block">
            <p className="truncate text-sm font-700 text-slate-950">Nueva plantilla</p>
            <p className="truncate text-xs text-slate-500">Espacio Personal</p>
          </div>
        </div>

        <nav className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-1">
          {WIZARD_STEPS.map((step, idx) => {
            const StepIcon = step.icon;
            const isActive = step.id === wizardStep;
            const isCompleted = step.id < wizardStep;
            return (
              <React.Fragment key={step.id}>
                <button
                  onClick={() => (isCompleted || isActive) && setWizardStep(step.id as 1 | 2 | 3)}
                  aria-label={step.label}
                  title={step.label}
                  className={`flex h-8 items-center gap-2 rounded-md px-2 text-xs font-600 transition-colors sm:px-3 ${
                    isActive
                      ? 'bg-white text-primary shadow-[0_1px_3px_rgba(15,23,42,0.12)]'
                      : isCompleted
                      ? 'cursor-pointer text-slate-700 hover:bg-white hover:text-primary' : 'cursor-default text-slate-400'
                  }`}
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                    isActive ? 'bg-primary text-white' : isCompleted ? 'bg-primary/10 text-primary' : 'bg-slate-200/70 text-slate-400'
                  }`}>
                    {isCompleted ? <CheckCircle2 size={13} /> : <StepIcon size={13} />}
                  </span>
                  <span className="hidden lg:inline">{step.label}</span>
                </button>
                {idx < WIZARD_STEPS.length - 1 && (
                  <div className={`hidden h-px w-3 sm:block ${step.id < wizardStep ? 'bg-primary/50' : 'bg-slate-200'}`} />
                )}
              </React.Fragment>
            );
          })}
        </nav>

        <div className="flex flex-1 items-center justify-end gap-1.5">
          {wizardStep === 2 && (
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:bg-slate-50"
            >
              <Eye size={15} />
              <span className="hidden sm:inline">Vista previa</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleExitClick}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            <X size={16} />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 flex-col overflow-hidden bg-slate-50">
        <section className="shrink-0 border-b border-slate-200 bg-slate-50 px-7 py-5">
          <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between gap-8">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-primary">
                <ActiveWizardIcon size={22} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold text-slate-950">{activeWizardStep.label}</h1>
                  <span className="rounded-md bg-slate-200/80 px-2 py-1 text-xs font-medium text-slate-600">
                    Paso {wizardStep} de {WIZARD_STEPS.length}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-slate-500">{stepDescriptions[wizardStep]}</p>
              </div>
            </div>
            <div className="hidden w-64 shrink-0 lg:block">
              <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500">
                <span>Progreso</span>
                <span>{Math.round(wizardProgress)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${wizardProgress}%` }}
                />
              </div>
            </div>
          </div>
        </section>

        <div className="flex flex-1 overflow-hidden">
        {wizardStep === 1 && (
          <StepInfoGeneral
            data={infoData}
            onChange={handleInfoChange}
            showValidationErrors={showValidationErrors}
          />
        )}

        {wizardStep === 2 && (
          <div className="flex flex-1 overflow-hidden">
            {/* Left fields sidebar */}
            <div className="hidden shrink-0 md:flex">
              <FieldsSidebar
                editor={null}
                fields={insertedFields}
                selectedFieldId={selectedFieldId}
                onInsertField={insertGeneralField}
                onSelectField={(id) => {
                  setSelectedFieldId(id);
                  document.querySelectorAll('[data-field-id]').forEach((el) => {
                    (el as HTMLElement).style.outline = '';
                  });
                  if (id) {
                    const chip = document.querySelector(`[data-field-id="${id}"]`) as HTMLElement | null;
                    if (chip) chip.style.outline = '2px solid #3B82F6';
                  }
                }}
                onUpdateField={() => {}}
              />
            </div>

            {/* Center: toolbar + multi-page editor (no MenuBar) */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <SimpleEditorToolbar
                selectedChipId={selectedFieldId}
                infoData={infoData}
                onInfoChange={handleInfoChange}
                showRulers={showRulers}
                onToggleRulers={() => setShowRulers((v) => !v)}
                showHeader={showHeader}
                showFooter={showFooter}
                onShowHeaderChange={setShowHeader}
                onShowFooterChange={setShowFooter}
                firstPageDifferent={firstPageDifferent}
                onFirstPageDifferentChange={setFirstPageDifferent}
                margenes={margenes}
                onMargenesChange={setMargenes}
                onShowNumerosModal={() => setShowNumerosModal(true)}
                onApplyPageNumbers={(opts) => {
                  applyPageNumberConfig(opts);
                }}
                showFindReplace={showFindReplace}
                onToggleFindReplace={() => setShowFindReplace((v) => !v)}
                wordCount={wordCount}
                showWordCount={showWordCount}
                onToggleWordCount={() => { updateWordCount(); setShowWordCount((v) => !v); }}
                openDropdown={openDropdown}
                onSetOpenDropdown={setOpenDropdown}
              />
              <div
                className="flex-1 overflow-y-auto"
                style={{ backgroundColor: '#F4F5F7' }}
                onMouseUp={handleEditorInteraction}
                onKeyUp={handleEditorInteraction}
                onClick={handleDocumentAreaClick}
              >
                <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center', transition: 'transform 0.15s ease' }}>
                  <MultiPageEditor
                    ref={multiPageEditorRef}
                    paperSize={infoData.hojaTamano as PaperSize}
                    orientation={infoData.hojaOrientacion as PageOrientation}
                    initialHtml={currentHtml}
                    margins={margenes}
                    showRulers={showRulers}
                    showHeader={showHeader}
                    showFooter={showFooter}
                    firstPageDifferent={firstPageDifferent}
                    onFirstPageDifferentChange={setFirstPageDifferent}
                    onRemoveHeader={() => setShowHeader(false)}
                    onRemoveFooter={() => setShowFooter(false)}
                    onPageNumbers={() => setShowNumerosModal(true)}
                    onImageSelected={(data) => setImageSizeData(data)}
                    onChange={(html) => {
                      setCurrentHtml(html);
                      setHasUnsavedChanges(true);
                      updateWordCount();
                      // Sync insertedFields: remove any field whose chip is no longer in the HTML
                      const parser = new DOMParser();
                      const doc = parser.parseFromString(html, 'text/html');
                      const presentIds = new Set(
                        Array.from(doc.querySelectorAll('[data-field-id]')).map(
                          (el) => el.getAttribute('data-field-id') as string
                        )
                      );
                      setInsertedFields((prev) => {
                        const next = prev.filter((f) => presentIds.has(f.id));
                        return next.length !== prev.length ? next : prev;
                      });
                    }}
                    onPageCountChange={(count) => {
                      setPageCount(count);
                      setActivePage((current) => Math.min(current, count));
                    }}
                    onActivePageChange={setActivePage}
                  />
                </div>
              </div>
              {/* Bottom status bar */}
              <div className="flex items-center justify-between px-4 py-1.5 bg-white border-t border-gray-200 text-xs text-gray-500 shrink-0 select-none">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Página {Math.min(activePage, pageCount)} de {pageCount}</span>
                  <div className="w-px h-4 bg-gray-200" />
                  {/* Undo / Redo */}
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); document.execCommand('undo'); }}
                    title="Deshacer (Ctrl+Z)"
                    className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M3 13C5.333 7.667 9.6 5 16 5c3.5 0 6 1.5 7 4"/></svg>
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); document.execCommand('redo'); }}
                    title="Rehacer (Ctrl+Y)"
                    className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6"/><path d="M21 13C18.667 7.667 14.4 5 8 5c-3.5 0-6 1.5-7 4"/></svg>
                  </button>
                  <div className="w-px h-4 bg-gray-200" />
                  {/* Find & Replace */}
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); setShowFindReplace((v) => !v); setOpenDropdown(null); }}
                    title="Buscar y reemplazar (Ctrl+H)"
                    className={`p-1 rounded hover:bg-gray-100 transition-colors ${showFindReplace ? 'text-blue-600 bg-blue-50' : 'text-gray-500'}`}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  </button>
                  <div className="w-px h-4 bg-gray-200" />
                  {/* Word count */}
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); updateWordCount(); setShowWordCount((v) => !v); }}
                    title="Recuento de palabras"
                    className="px-1.5 py-0.5 rounded hover:bg-gray-100 transition-colors text-gray-500 font-medium"
                  >
                    {wordCount} palabras
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setZoom((z) => Math.max(25, z - 10))} className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600 font-bold text-sm leading-none" title="Reducir zoom">−</button>
                  <input type="range" min={25} max={200} step={5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-24 h-1 accent-blue-500 cursor-pointer" title="Zoom" />
                  <button type="button" onClick={() => setZoom((z) => Math.min(200, z + 10))} className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600 font-bold text-sm leading-none" title="Aumentar zoom">+</button>
                  <span className="w-10 text-center font-medium text-gray-600">{zoom}%</span>
                  <button type="button" onClick={() => setZoom(100)} className="px-1.5 py-0.5 rounded hover:bg-gray-100 text-gray-500 text-xs" title="Restablecer zoom">Ajustar</button>
                </div>
              </div>
            </div>

            {/* Right: Field Properties Sidebar */}
            <div className="hidden shrink-0 xl:flex">
              <FieldPropertiesSidebar
                field={selectedField}
                onClose={() => setSelectedFieldId(null)}
                onUpdate={handleUpdateField}
                allFields={insertedFields}
                onSelectField={(id) => {
                  setSelectedFieldId(id);
                  document.querySelectorAll('[data-field-id]').forEach((el) => {
                    (el as HTMLElement).style.outline = '';
                  });
                  const chip = document.querySelector(`[data-field-id="${id}"]`) as HTMLElement | null;
                  if (chip) {
                    chip.style.outline = '2px solid #3B82F6';
                    chip.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                  }
                }}
              />
            </div>
          </div>
        )}

        {wizardStep === 3 && (
          <StepPublicacion
            data={pubData}
            onChange={(updates) => setPubData((prev) => ({ ...prev, ...updates }))}
            infoData={infoData}
            onInfoChange={handleInfoChange}
          />
        )}
        </div>
      </div>

      {/* ── Footer bar ── */}
      <footer className="z-20 flex h-16 shrink-0 items-center justify-between border-t border-slate-200 bg-white px-6">
        <button
          onClick={handleBack}
          className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
        >
          <ArrowLeft size={16} />
          Atrás
        </button>
        <div className="flex items-center gap-3">
          {wizardStep === 2 && (
            <button
              onClick={() => setShowExitModal(true)}
              disabled={isSaving}
              className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              <Save size={15} />
              {isSaving ? 'Guardando...' : 'Guardar borrador'}
            </button>
          )}
          {wizardStep < 3 ? (
            <button
              onClick={handleNext}
              className="flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90"
            >
              Siguiente <ArrowRight size={16} />
            </button>
          ) : (
            <button
              onClick={handlePublish}
              disabled={isSaving || !pubData.estadoPlantilla}
              className="flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {isSaving ? 'Guardando...' : (
                {
                  borrador: 'Guardar como borrador',
                  publicar: 'Publicar plantilla',
                  aprobacion: 'Enviar a aprobación',
                  version: 'Duplicar como nueva versión',
                }[pubData.publicacionOpcion] || 'Publicar plantilla'
              )}
            </button>
          )}
        </div>
      </footer>

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/60 backdrop-blur-sm">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <Eye size={16} className="text-blue-600" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Vista Previa</h2>
                <p className="text-xs text-gray-400">{infoData.nombre || 'Nueva plantilla'} · {infoData.hojaTamano || 'Carta (Letter)'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const paperSize = infoData.hojaTamano || 'Carta (Letter)';
                  const orientation = infoData.hojaOrientacion || 'vertical';
                  const PAGE_SIZES: Record<string, { width: number; height: number }> = {
                    'Carta (Letter)': { width: 816, height: 1056 },
                    'Oficio (Legal)': { width: 816, height: 1344 },
                    'A4': { width: 794, height: 1123 },
                    'A3': { width: 1123, height: 1587 },
                    'A5': { width: 559, height: 794 },
                    'Tabloide': { width: 1056, height: 1632 },
                  };
                  const dims = PAGE_SIZES[paperSize] ?? PAGE_SIZES['Carta (Letter)'];
                  const w = orientation === 'horizontal' ? dims.height : dims.width;
                  const h = orientation === 'horizontal' ? dims.width : dims.height;
                  const printWindow = window.open('', '_blank', `width=${w + 100},height=${h + 100}`);
                  if (!printWindow) return;
                  printWindow.document.write(`<!DOCTYPE html><html><head><title>${infoData.nombre || 'Plantilla'}</title><style>*{box-sizing:border-box;margin:0;padding:0;}body{background:white;font-family:Arial,sans-serif;font-size:12px;color:#111;}@page{size:${w}px ${h}px;margin:0;}.page{width:${w}px;min-height:${h}px;padding:40px 60px;margin:0 auto;page-break-after:always;}table{border-collapse:collapse;width:100%;}td,th{border:1px solid #d1d5db;padding:6px 10px;}hr{border:none;border-top:2px solid #e5e7eb;margin:16px 0;}ul{list-style-type:disc;padding-left:1.5em;}ol{list-style-type:decimal;padding-left:1.5em;}h1{font-size:28px;font-weight:700;margin:16px 0 8px;}h2{font-size:22px;font-weight:600;margin:14px 0 8px;}h3{font-size:18px;font-weight:600;margin:12px 0 6px;}p{margin:0 0 8px;line-height:1.5;}img{max-width:100%;height:auto;}@media print{body{margin:0;}.page{page-break-after:always;}}</style></head><body><div class="page">${currentHtml || '<p><em>Sin contenido</em></p>'}</div></body></html>`);
                  printWindow.document.close();
                  printWindow.focus();
                  setTimeout(() => { printWindow.print(); printWindow.close(); }, 300);
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                Imprimir
              </button>
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                <X size={15} />
                Cerrar
              </button>
            </div>
          </div>
          {/* Document area */}
          <div className="flex-1 overflow-y-auto bg-gray-300 py-10 px-6">
            {(() => {
              const paperSize = infoData.hojaTamano || 'Carta (Letter)';
              const orientation = infoData.hojaOrientacion || 'vertical';
              const PAGE_SIZES: Record<string, { width: number; height: number }> = {
                'Carta (Letter)': { width: 816, height: 1056 },
                'Oficio (Legal)': { width: 816, height: 1344 },
                'A4': { width: 794, height: 1123 },
                'A3': { width: 1123, height: 1587 },
                'A5': { width: 559, height: 794 },
                'Tabloide': { width: 1056, height: 1632 },
              };
              const dims = PAGE_SIZES[paperSize] ?? PAGE_SIZES['Carta (Letter)'];
              const w = orientation === 'horizontal' ? dims.height : dims.width;
              const h = orientation === 'horizontal' ? dims.width : dims.height;
              return (
                <div
                  style={{
                    width: `${w}px`,
                    minHeight: `${h}px`,
                    background: 'white',
                    padding: '40px 60px',
                    margin: '0 auto',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
                    borderRadius: '2px',
                    fontFamily: 'Arial, sans-serif',
                    fontSize: '12px',
                    color: '#111',
                    lineHeight: '1.5',
                  }}
                  dangerouslySetInnerHTML={{ __html: currentHtml || '<p><em>Sin contenido</em></p>' }}
                />
              );
            })()}
          </div>
          {/* Footer */}
          <div className="shrink-0 flex items-center justify-between px-6 py-2 border-t border-gray-200 bg-white">
            <span className="text-xs text-gray-400">
              Tamaño: {infoData.hojaTamano || 'Carta (Letter)'} · Orientación: {infoData.hojaOrientacion === 'horizontal' ? 'Horizontal' : 'Vertical'}
            </span>
          </div>
        </div>
      )}

      {/* ¿Deseas salir? Modal */}
      {showExitModal && (
        <ExitConfirmModal
          onSaveAndExit={handleSaveAndExit}
          onExitWithoutSave={() => router.push('/plantillas')}
          onCancel={() => setShowExitModal(false)}
          isSaving={isSaving}
        />
      )}

      {/* Números de página modal */}
      {showNumerosModal && (
        <SimplePageNumbersModal
          onApply={(opts) => {
            applyPageNumberConfig(opts);
            setShowNumerosModal(false);
          }}
          onClose={() => setShowNumerosModal(false)}
        />
      )}

      {/* Image Size Modal */}
      {imageSizeData && (
        <ImageSizeModal
          originalWidth={imageSizeData.originalWidth}
          originalHeight={imageSizeData.originalHeight}
          currentWidth={imageSizeData.currentWidth}
          onApply={(w, h) => {
            const fig = imageSizeData.figure;
            if (fig) {
              const img = fig.querySelector('img') as HTMLImageElement | null;
              if (img) {
                img.style.width = `${w}px`;
                img.style.height = `${h}px`;
                img.setAttribute('width', String(w));
                fig.setAttribute('data-width', String(w));
              }
            }
            setImageSizeData(null);
          }}
          onClose={() => setImageSizeData(null)}
        />
      )}

      {/* Toast notifications */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium pointer-events-auto"
            style={{
              backgroundColor: toast.type === 'success' ? '#ECFDF5' : toast.type === 'error' ? '#FEF2F2' : '#EFF6FF',
              color: toast.type === 'success' ? '#065F46' : toast.type === 'error' ? '#991B1B' : '#1E40AF',
              border: `1px solid ${toast.type === 'success' ? '#A7F3D0' : toast.type === 'error' ? '#FECACA' : '#BFDBFE'}`,
            }}
          >
            {toast.type === 'success' && <CheckCircle size={16} />}
            {toast.type === 'error' && <AlertCircle size={16} />}
            {toast.type === 'info' && <Info size={16} />}
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function NuevaPlantillaPageWrapper() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <NuevaPlantillaPage />
    </Suspense>
  );
}
