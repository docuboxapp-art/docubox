'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';

import { useRouter, useSearchParams } from 'next/navigation';
import {
  Eye,
  Save,
  CheckCircle,
  AlertCircle,
  Info,
  ArrowLeft,
  ArrowRight,
  X,
  CheckCircle2,
  FileText,
  Settings,
  Send,
  Tag,
  Search,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Type,
  Strikethrough,
  Link,
  Indent,
  Outdent,
  Highlighter,
  Minus,
  Plus,
  Star,
  Layers,
  Image as ImageIcon,
  Table as TableIcon,
  Hash,
  Columns,
  Layout,
  Maximize2,
  FileUp,
  FilePlus2,
  Upload,
  Loader2,
  Pencil,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';

import { FieldsSidebar } from '../components/FieldsSidebar';
import { FieldPropertiesSidebar, InsertedField } from '../components/FieldPropertiesSidebar';
import {
  MultiPageEditor,
  MultiPageEditorHandle,
  PaperSize,
  PageOrientation,
  PageMargins,
  cmToPx,
  getPageDimensions,
} from '../components/DocumentPaginator';
import AppLogo from '@/components/ui/AppLogo';
import { TemplateDocumentSettingsPanel } from '@/components/templates/TemplateDocumentSettingsPanel';
import {
  DEFAULT_TEMPLATE_DOCUMENT_SETTINGS,
  readTemplateDocumentSettings,
  type TemplateDocumentSettings,
  type TemplatePaperSize,
} from '@/lib/templates/document-settings';
import { templateApiFetch } from '@/lib/templates/client';
import {
  readTemplateImportSession,
  removeTemplateImportSession,
} from '@/lib/template-import/client-session';
import type { TemplateDocxImportResult } from '@/lib/template-import/types';

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
  publicacionOpcion: 'borrador' | 'publicar' | 'aprobacion' | 'actualizar' | 'version';
  comentarioPublicacion: string;
  estadoPlantilla: string;
  versionPublicada: string;
}

type TemplateOrigin = 'word' | 'scratch';
type TemplateImportStage = 'uploading' | 'processing' | 'preparing' | null;

interface TemplatePublicationContext {
  workspaceType: 'personal' | 'business';
  workspaceName: string;
  role: string;
  policy: 'DIRECT_PUBLISH' | 'APPROVAL_REQUIRED';
  approvalWorkflow: { id: string; name: string; version: number } | null;
  permissions: {
    canSaveDraft: boolean;
    canPublish: boolean;
    canSubmitApproval: boolean;
    canCreateVersion: boolean;
  };
  template: {
    id: string;
    status: string | null;
    displayStatus: string | null;
    currentVersion: string;
    nextVersion: string;
  } | null;
  areas: Array<{ id: string; name: string }>;
  templateTypes: Array<{ id: string; nombre: string }>;
}

function normalizeTemplateHtml(html?: string | null) {
  const content = html?.trim() || '<p><br></p>';
  const withoutLegacyBrand = content.replace(
    /<div data-docubox-template-brand="2026"[\s\S]*?<\/div>\s*<\/div>\s*/i,
    ''
  );

  return withoutLegacyBrand.trim() || '<p><br></p>';
}

interface TemplatePreviewSnapshot {
  pages: string[];
  headerHtml: string;
  footerHtml: string;
}

const TEMPLATE_PREVIEW_CONTENT_CSS = `
  .template-preview-content { font-family:'Google Sans','Google Sans Text','Segoe UI',Arial,sans-serif; font-size:11pt; line-height:1.6; overflow-wrap:break-word; word-break:break-word; color:#111827; }
  .template-preview-content h1 { font-size:28px; font-weight:700; line-height:1.25; margin:16px 0 8px; }
  .template-preview-content h2 { font-size:22px; font-weight:600; line-height:1.3; margin:14px 0 8px; }
  .template-preview-content h3 { font-size:18px; font-weight:600; line-height:1.35; margin:12px 0 6px; }
  .template-preview-content h4 { font-size:16px; font-weight:600; line-height:1.4; margin:10px 0 6px; }
  .template-preview-content h5 { font-size:14px; font-weight:600; line-height:1.4; margin:8px 0 4px; }
  .template-preview-content p { font-size:12px; line-height:1.5; margin:0 0 8px; }
  .template-preview-content ul { list-style-type:disc; padding-left:2em; margin:8px 0; }
  .template-preview-content ol { list-style-type:decimal; padding-left:2em; margin:8px 0; }
  .template-preview-content li { display:list-item; margin:2px 0; }
  .template-preview-content table { border-collapse:collapse; width:100%; margin:8px 0; }
  .template-preview-content td, .template-preview-content th { border:1px solid #d1d5db; padding:6px 8px; min-width:40px; vertical-align:top; }
  .template-preview-content img { max-width:100%; height:auto; }
  .template-preview-content [data-docubox-page-break] { display:none; }
  .template-preview-zone { font-family:'Google Sans','Google Sans Text','Segoe UI',Arial,sans-serif; font-size:10pt; color:#374151; overflow:hidden; }
  .template-preview-zone p { margin:0; }
`;

function cleanPreviewContent(element: Element): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll('[data-signature-resize-handle], .docubox-resize-handle')
    .forEach((control) => control.remove());
  clone.querySelectorAll('[data-selected="true"]').forEach((selected) => {
    selected.removeAttribute('data-selected');
    (selected as HTMLElement).style.removeProperty('outline');
  });
  return clone.innerHTML;
}

function splitSerializedTemplateHtml(html: string): TemplatePreviewSnapshot {
  const parser = new DOMParser();
  const documentModel = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const root = documentModel.body.firstElementChild as HTMLElement | null;
  if (!root) return { pages: ['<p><br></p>'], headerHtml: '', footerHtml: '' };

  const header = root.querySelector('[data-header-zone="true"]');
  const footer = root.querySelector('[data-footer-zone="true"]');
  const headerHtml = header?.innerHTML || '';
  const footerHtml = footer?.innerHTML || '';
  header?.remove();
  footer?.remove();

  const pages: string[] = [];
  let currentPage: Node[] = [];
  Array.from(root.childNodes).forEach((node) => {
    const isPageBreak = node instanceof HTMLElement && node.hasAttribute('data-docubox-page-break');
    if (isPageBreak) {
      const page = documentModel.createElement('div');
      currentPage.forEach((item) => page.appendChild(item.cloneNode(true)));
      pages.push(page.innerHTML || '<p><br></p>');
      currentPage = [];
      return;
    }
    currentPage.push(node);
  });
  const lastPage = documentModel.createElement('div');
  currentPage.forEach((item) => lastPage.appendChild(item.cloneNode(true)));
  if (lastPage.innerHTML || pages.length === 0) pages.push(lastPage.innerHTML || '<p><br></p>');

  return { pages, headerHtml, footerHtml };
}

function resolvePreviewZoneHtml(html: string, pageIndex: number): string {
  if (!html) return '';
  const parser = new DOMParser();
  const parsed = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const root = parsed.body.firstElementChild as HTMLElement | null;
  if (!root) return html;

  root.querySelectorAll('[data-page-number="true"]').forEach((element) => {
    const pageNumber = element as HTMLElement;
    const startFrom = Number(pageNumber.getAttribute('data-page-number-start') || 1);
    pageNumber.textContent = `— ${startFrom + pageIndex} —`;
    pageNumber.style.removeProperty('display');
  });
  root.querySelectorAll('[data-hide-first-page="true"]').forEach((element) => {
    (element as HTMLElement).style.display = pageIndex === 0 ? 'none' : '';
  });
  return root.innerHTML;
}

function escapePrintTitle(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

// ─── Simple formatting toolbar ────────────────────────────────────────────────

const EDITOR_FONT_FAMILIES = [
  'Arial',
  'Arial Black',
  'Times New Roman',
  'Georgia',
  'Garamond',
  'Courier New',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Impact',
  'Helvetica',
  'Palatino',
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Raleway',
  'Nunito',
  'Poppins',
  'Source Sans 3',
  'Merriweather',
  'Playfair Display',
  'Oswald',
  'PT Sans',
  'PT Serif',
  'Ubuntu',
  'Noto Sans',
  'Libre Baskerville',
  'Crimson Text',
  'EB Garamond',
  'Josefin Sans',
  'Quicksand',
  'Mulish',
  'Barlow',
  'Inter',
  'DM Sans',
  'Fira Sans',
  'Cabin',
  'Exo 2',
  'Titillium Web',
  'Zilla Slab',
  'Spectral',
  'Cormorant Garamond',
  'Alegreya',
  'Lora',
  'Arvo',
  'Bitter',
  'Karla',
  'Rubik',
  'Work Sans',
  'Manrope',
  'Space Grotesk',
  'Plus Jakarta Sans',
  'Sora',
  'Outfit',
  'Figtree',
  'Lexend',
  'Jost',
  'Urbanist',
  'Archivo',
  'Asap',
  'Heebo',
  'Hind',
  'Varela Round',
  'Comfortaa',
  'Pacifico',
  'Dancing Script',
  'Caveat',
  'Sacramento',
  'Great Vibes',
  'Satisfy',
  'Kaushan Script',
  'Lobster',
  'Righteous',
  'Fredoka One',
  'Boogaloo',
  'Indie Flower',
  'Patrick Hand',
  'Shadows Into Light',
  'Amatic SC',
  'Permanent Marker',
  'Rock Salt',
  'Special Elite',
  'Courier Prime',
  'Source Code Pro',
  'Fira Code',
  'Space Mono',
  'Inconsolata',
  'Anonymous Pro',
  'Share Tech Mono',
];

const EDITOR_FONT_SIZES = [
  '8pt',
  '9pt',
  '10pt',
  '11pt',
  '12pt',
  '14pt',
  '16pt',
  '18pt',
  '20pt',
  '24pt',
  '28pt',
  '32pt',
  '36pt',
  '48pt',
  '60pt',
  '72pt',
];

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
  const [height, setHeight] = useState(
    Math.round((currentWidth || originalWidth || 300) * aspectRatio)
  );
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
          <p className="text-xs text-gray-500 mb-4">
            Tamaño original: {originalWidth} × {originalHeight} px
          </p>
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
              <input
                type="checkbox"
                checked={lockAspect}
                onChange={(e) => setLockAspect(e.target.checked)}
                className="rounded text-blue-600"
              />
              <span className="text-xs text-gray-700">Mantener proporción</span>
            </label>
          </div>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onApply(width, height)}
              className="px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors"
            >
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolbarDivider({ fieldVisible = false }: { fieldVisible?: boolean }) {
  return (
    <div
      className={`w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0 ${fieldVisible ? 'field-divider-visible' : ''}`}
    />
  );
}

function TBtn({
  onMouseDown,
  title,
  children,
  active,
  disabled,
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
  onApply: (opts: {
    position: 'header' | 'footer';
    showOnFirst: boolean;
    startFrom: number;
  }) => void;
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
              <input
                type="radio"
                name="sp-position"
                checked={position === 'header'}
                onChange={() => setPosition('header')}
                className="text-blue-600"
              />
              <span className="text-sm text-gray-700">Encabezado</span>
            </label>
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input
                type="radio"
                name="sp-position"
                checked={position === 'footer'}
                onChange={() => setPosition('footer')}
                className="text-blue-600"
              />
              <span className="text-sm text-gray-700">Pie de página</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnFirst}
                onChange={(e) => setShowOnFirst(e.target.checked)}
                className="rounded text-blue-600"
              />
              <span className="text-sm text-gray-700">Mostrar en la primera página</span>
            </label>
          </div>
          <div className="mb-5">
            <p className="text-xs font-medium text-gray-700 mb-2">Numeración</p>
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input type="radio" name="sp-numbering" defaultChecked className="text-blue-600" />
              <span className="text-sm text-gray-700">Empezar en</span>
              <input
                type="number"
                min={1}
                value={startFrom}
                onChange={(e) => setStartFrom(Number(e.target.value))}
                className="w-16 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 text-center"
              />
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="sp-numbering" className="text-blue-600" />
              <span className="text-sm text-gray-700">Continuar desde la sección anterior</span>
            </label>
          </div>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onApply({ position, showOnFirst, startFrom })}
              className="px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors"
            >
              Aplicar
            </button>
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
  onApply: (opts: {
    position: 'header' | 'footer';
    showOnFirst: boolean;
    startFrom: number;
  }) => void;
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
          <input
            type="radio"
            name="np-position"
            checked={position === 'header'}
            onChange={() => setPosition('header')}
            className="text-blue-600"
          />
          <span className="text-xs text-gray-700">Encabezado</span>
        </label>
        <label className="flex items-center gap-2 mb-2 cursor-pointer">
          <input
            type="radio"
            name="np-position"
            checked={position === 'footer'}
            onChange={() => setPosition('footer')}
            className="text-blue-600"
          />
          <span className="text-xs text-gray-700">Pie de página</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showOnFirst}
            onChange={(e) => setShowOnFirst(e.target.checked)}
            className="rounded text-blue-600"
          />
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
        <button
          type="button"
          onClick={() => onApply({ position, showOnFirst, startFrom })}
          className="flex-1 text-xs bg-blue-600 text-white rounded-md py-1.5 hover:bg-blue-700 font-medium"
        >
          Aplicar
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 text-xs bg-gray-100 text-gray-700 rounded-md py-1.5 hover:bg-gray-200"
        >
          Cancelar
        </button>
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
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${MAX}, 18px)` }}
        onMouseLeave={() => setHovered({ rows: 0, cols: 0 })}
      >
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
      <p className="text-xs text-center text-gray-500 mt-2">
        {hovered.rows > 0 && hovered.cols > 0 ? `${hovered.rows} × ${hovered.cols}` : '1 × 1'}
      </p>
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
  onInfoChange?: (updates: {
    hojaTamano?: string;
    hojaOrientacion?: 'vertical' | 'horizontal';
    columnas?: number;
    margenes?: { top: number; bottom: number; left: number; right: number };
  }) => void;
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
  onApplyPageNumbers?: (opts: {
    position: 'header' | 'footer';
    showOnFirst: boolean;
    startFrom: number;
  }) => void;
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
  const [imageSizeModalData, setImageSizeModalData] = useState<{
    originalWidth: number;
    originalHeight: number;
    currentWidth: number;
    figure: HTMLElement | null;
  }>({ originalWidth: 300, originalHeight: 200, currentWidth: 300, figure: null });

  // Local margins state (cm) — synced from prop
  const [localMargenes, setLocalMargenes] = useState(
    margenes || { top: 2.54, bottom: 2.54, left: 3.17, right: 3.17 }
  );
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
    pages.forEach((p) => {
      text += (p as HTMLElement).innerText + ' ';
    });
    const words = text
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
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
      const chip = document.querySelector(
        `[data-field-id="${selectedChipId}"]`
      ) as HTMLElement | null;
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
        setIsBold(
          chip.style.fontWeight === 'bold' ||
            parseInt(chip.style.fontWeight) >= 700 ||
            cs.fontWeight === 'bold' ||
            parseInt(cs.fontWeight) >= 700
        );
        setIsItalic(chip.style.fontStyle === 'italic' || cs.fontStyle === 'italic');
        setIsUnderline((chip.style.textDecoration || cs.textDecoration).includes('underline'));
        setIsStrike((chip.style.textDecoration || cs.textDecoration).includes('line-through'));
      }
    }
  }, [selectedChipId]);

  useEffect(() => {
    if (!selectedChipId) return;

    onSetOpenDropdown?.(null);
  }, [selectedChipId, onSetOpenDropdown]);

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
          if (tag === 'h1') {
            setCurrentParaStyle('h1');
            return;
          }
          if (tag === 'h2') {
            setCurrentParaStyle('h2');
            return;
          }
          if (tag === 'h3') {
            setCurrentParaStyle('h3');
            return;
          }
          if (tag === 'h4') {
            setCurrentParaStyle('h4');
            return;
          }
          if (tag === 'h5') {
            setCurrentParaStyle('h5');
            return;
          }
          if (tag === 'p' || tag === 'div') {
            setCurrentParaStyle('p');
            return;
          }
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
          chip.style.textDecoration = hasUnderline
            ? hasStrike
              ? 'line-through'
              : 'none'
            : hasStrike
              ? 'underline line-through'
              : 'underline';
          setIsUnderline(!hasUnderline);
          break;
        }
        case 'strikeThrough': {
          const hasStrike2 = chip.style.textDecoration.includes('line-through');
          const hasUnderline2 = chip.style.textDecoration.includes('underline');
          chip.style.textDecoration = hasStrike2
            ? hasUnderline2
              ? 'underline'
              : 'none'
            : hasUnderline2
              ? 'underline line-through'
              : 'line-through';
          setIsStrike(!hasStrike2);
          break;
        }
        case 'fontName':
          if (value) {
            chip.style.fontFamily = value;
            setCurrentFont(value);
          }
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
      if (
        !sel ||
        sel.rangeCount === 0 ||
        !editorEl.contains(sel.getRangeAt(0).commonAncestorContainer)
      ) {
        editorEl.focus();
        const range = document.createRange();
        range.selectNodeContents(editorEl);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    const html = `<table style="border-collapse:collapse;width:100%;margin:8px 0"><tbody>${Array.from(
      { length: rows }
    )
      .map(
        () =>
          `<tr>${Array.from({ length: cols })
            .map(
              () => '<td style="border:1px solid #ccc;padding:6px 8px;min-width:40px">&nbsp;</td>'
            )
            .join('')}</tr>`
      )
      .join('')}</tbody></table><p><br></p>`;
    document.execCommand('insertHTML', false, html);
    if (onSetOpenDropdown) onSetOpenDropdown(null);
  };

  const applyEncabezadoPie = () => {
    if (onShowHeaderChange) onShowHeaderChange(localShowHeader);
    if (onShowFooterChange) onShowFooterChange(localShowFooter);
    if (onSetOpenDropdown) onSetOpenDropdown(null);
  };

  const applyPageNumbers = (opts: {
    position: 'header' | 'footer';
    showOnFirst: boolean;
    startFrom: number;
  }) => {
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
    while (
      node &&
      node.nodeName !== 'P' &&
      node.nodeName !== 'LI' &&
      node.nodeName !== 'DIV' &&
      node !== document.body
    ) {
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
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
          }
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
        <div
          className={`flex items-center gap-0.5 px-2 py-1.5 flex-wrap ${chipSelected ? 'field-formatting-mode' : ''}`}
          aria-label={chipSelected ? 'Formato del campo seleccionado' : 'Formato del documento'}
        >
          {/* Regla toggle */}
          <button
            type="button"
            onClick={onToggleRulers}
            disabled={chipSelected}
            className={`p-1.5 rounded transition-colors flex-shrink-0 ${showRulers ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 text-gray-700'}`}
            title={showRulers ? 'Ocultar regla' : 'Mostrar regla'}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="7" width="20" height="10" rx="1" />
              <line x1="6" y1="7" x2="6" y2="12" />
              <line x1="10" y1="7" x2="10" y2="10" />
              <line x1="14" y1="7" x2="14" y2="12" />
              <line x1="18" y1="7" x2="18" y2="10" />
            </svg>
          </button>

          <div className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0" />

          {/* Márgenes */}
          <button
            type="button"
            onClick={(e) => openMenu('margenes', e)}
            disabled={chipSelected}
            className="p-1.5 rounded transition-colors hover:bg-gray-100 text-gray-700 flex-shrink-0"
            title="Márgenes"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="1" />
              <line x1="7" y1="3" x2="7" y2="21" />
              <line x1="17" y1="3" x2="17" y2="21" />
              <line x1="3" y1="7" x2="21" y2="7" />
              <line x1="3" y1="17" x2="21" y2="17" />
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
            disabled={chipSelected}
            className="p-1.5 rounded transition-colors hover:bg-gray-100 text-gray-700 flex-shrink-0"
            title={`Orientación: ${infoData?.hojaOrientacion === 'horizontal' ? 'Horizontal' : 'Vertical'} — clic para cambiar`}
          >
            {infoData?.hojaOrientacion === 'horizontal' ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="6" width="20" height="12" rx="1" />
                <path d="M16 10l4 2-4 2" strokeWidth="1.5" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="6" y="2" width="12" height="20" rx="1" />
                <path d="M10 16l2 4 2-4" strokeWidth="1.5" />
              </svg>
            )}
          </button>

          <div className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0" />

          {/* Tamaño */}
          <button
            type="button"
            onClick={(e) => openMenu('tamano', e)}
            disabled={chipSelected}
            className="p-1.5 rounded transition-colors hover:bg-gray-100 text-gray-700 flex-shrink-0"
            title="Tamaño de página"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="4" y="2" width="16" height="20" rx="1" />
              <line x1="8" y1="6" x2="16" y2="6" />
              <line x1="8" y1="10" x2="16" y2="10" />
              <line x1="8" y1="14" x2="13" y2="14" />
            </svg>
          </button>

          <div className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0" />

          {/* Columnas */}
          <button
            type="button"
            onClick={(e) => openMenu('columnas', e)}
            disabled={chipSelected}
            className="p-1.5 rounded transition-colors hover:bg-gray-100 text-gray-700 flex-shrink-0"
            title="Columnas"
          >
            <Columns size={16} />
          </button>

          <div className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0" />

          {/* Tabla con grid */}
          <button
            type="button"
            onClick={(e) => {
              if (!chipSelected) openMenu('tabla', e);
            }}
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
            onMouseDown={(e) => {
              e.preventDefault();
              if (!chipSelected) imageInputRef.current?.click();
            }}
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
            onClick={(e) => {
              if (!chipSelected) openMenu('encabezado', e);
            }}
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
            onClick={(e) => {
              if (!chipSelected) openMenu('numeroPagina', e);
            }}
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
            <option value="h1" style={{ fontWeight: 'bold', fontSize: '1.2em' }}>
              Título
            </option>
            <option value="h2" style={{ color: '#6b7280' }}>
              Subtítulo
            </option>
            <option value="h3" style={{ fontWeight: 'bold' }}>
              Encabezado 1
            </option>
            <option value="h4">Encabezado 2</option>
            <option value="h5">Encabezado 3</option>
            <option
              value="opciones"
              disabled
              style={{ color: '#9ca3af', borderTop: '1px solid #e5e7eb' }}
            >
              Opciones ▶
            </option>
          </select>

          <ToolbarDivider fieldVisible />

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
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}
              </option>
            ))}
          </select>

          <ToolbarDivider fieldVisible />

          {/* Font size */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              type="button"
              onMouseDown={decreaseSize}
              className="w-5 h-6 flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded text-sm font-medium"
              title="Reducir tamaño"
            >
              −
            </button>
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
                <option key={s} value={s}>
                  {s.replace('pt', '')}
                </option>
              ))}
            </select>
            <button
              type="button"
              onMouseDown={increaseSize}
              className="w-5 h-6 flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded text-sm font-medium"
              title="Aumentar tamaño"
            >
              +
            </button>
          </div>

          <ToolbarDivider fieldVisible />

          {/* Bold, Italic, Underline, Strike */}
          <TBtn
            onMouseDown={(e) => {
              e.preventDefault();
              execCmd('bold');
            }}
            title="Negrita (Ctrl+B)"
            active={isBold}
          >
            <Bold size={14} />
          </TBtn>
          <TBtn
            onMouseDown={(e) => {
              e.preventDefault();
              execCmd('italic');
            }}
            title="Cursiva (Ctrl+I)"
            active={isItalic}
          >
            <Italic size={14} />
          </TBtn>
          <TBtn
            onMouseDown={(e) => {
              e.preventDefault();
              execCmd('underline');
            }}
            title="Subrayado (Ctrl+U)"
            active={isUnderline}
          >
            <UnderlineIcon size={14} />
          </TBtn>
          <TBtn
            onMouseDown={(e) => {
              e.preventDefault();
              execCmd('strikeThrough');
            }}
            title="Tachado"
            active={isStrike}
          >
            <Strikethrough size={14} />
          </TBtn>

          <ToolbarDivider fieldVisible />

          {/* Text color */}
          <label
            className="flex flex-col items-center cursor-pointer p-1 rounded hover:bg-gray-100 relative flex-shrink-0"
            title="Color de texto"
          >
            <Type size={13} className="text-gray-700" />
            <input
              type="color"
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              onChange={(e) => execCmd('foreColor', e.target.value)}
              title="Color de texto"
            />
          </label>

          {/* Highlight */}
          <label
            className="flex flex-col items-center cursor-pointer p-1 rounded hover:bg-gray-100 relative flex-shrink-0"
            title="Resaltado"
          >
            <Highlighter size={13} className="text-gray-700" />
            <input
              type="color"
              defaultValue="#ffff00"
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              onChange={(e) => execCmd('hiliteColor', e.target.value)}
              title="Color de resaltado"
            />
          </label>

          <ToolbarDivider />

          {/* Alignment */}
          <TBtn
            onMouseDown={(e) => {
              e.preventDefault();
              if (!selectedChipId) document.execCommand('justifyLeft');
            }}
            title="Alinear izquierda"
            disabled={chipSelected}
          >
            <AlignLeft size={14} />
          </TBtn>
          <TBtn
            onMouseDown={(e) => {
              e.preventDefault();
              if (!selectedChipId) document.execCommand('justifyCenter');
            }}
            title="Centrar"
            disabled={chipSelected}
          >
            <AlignCenter size={14} />
          </TBtn>
          <TBtn
            onMouseDown={(e) => {
              e.preventDefault();
              if (!selectedChipId) document.execCommand('justifyRight');
            }}
            title="Alinear derecha"
            disabled={chipSelected}
          >
            <AlignRight size={14} />
          </TBtn>
          <TBtn
            onMouseDown={(e) => {
              e.preventDefault();
              if (!selectedChipId) document.execCommand('justifyFull');
            }}
            title="Justificar"
            disabled={chipSelected}
          >
            <AlignJustify size={14} />
          </TBtn>

          <ToolbarDivider />

          {/* Line spacing dropdown */}
          <button
            type="button"
            onClick={(e) => {
              if (!chipSelected) openMenu('lineSpacing', e);
            }}
            disabled={chipSelected}
            className={`p-1.5 rounded transition-colors flex-shrink-0 flex items-center gap-0.5 ${chipSelected ? 'opacity-40 cursor-not-allowed text-gray-400' : 'hover:bg-gray-100 text-gray-700'}`}
            title="Interlineado"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
              <path d="M8 3l-4 3 4 3" />
              <path d="M8 15l-4 3 4 3" />
            </svg>
            <svg
              width="8"
              height="8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          <ToolbarDivider />

          {/* Lists */}
          <TBtn
            onMouseDown={(e) => {
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
                    if (s) {
                      s.removeAllRanges();
                      s.addRange(savedRangeRef.current);
                    }
                  }
                  document.execCommand('insertUnorderedList');
                  savedRangeRef.current = null;
                });
              }
            }}
            title="Lista con viñetas"
            disabled={chipSelected}
          >
            <List size={14} />
          </TBtn>
          {/* Bullet style picker */}
          <button
            type="button"
            onClick={(e) => {
              if (!chipSelected) openMenu('bulletStyle', e);
            }}
            disabled={chipSelected}
            className={`p-1 rounded transition-colors flex-shrink-0 flex items-center ${chipSelected ? 'opacity-40 cursor-not-allowed text-gray-400' : 'hover:bg-gray-100 text-gray-700'}`}
            title="Estilo de viñeta"
          >
            <svg
              width="8"
              height="8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <TBtn
            onMouseDown={(e) => {
              e.preventDefault();
              if (!selectedChipId) {
                const sel = window.getSelection();
                if (sel && sel.rangeCount > 0) {
                  savedRangeRef.current = sel.getRangeAt(0).cloneRange();
                }
                requestAnimationFrame(() => {
                  if (savedRangeRef.current) {
                    const s = window.getSelection();
                    if (s) {
                      s.removeAllRanges();
                      s.addRange(savedRangeRef.current);
                    }
                  }
                  document.execCommand('insertOrderedList');
                  savedRangeRef.current = null;
                });
              }
            }}
            title="Lista numerada"
            disabled={chipSelected}
          >
            <ListOrdered size={14} />
          </TBtn>
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
            <svg
              width="8"
              height="8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          <ToolbarDivider />

          {/* Indent */}
          <TBtn
            onMouseDown={(e) => {
              e.preventDefault();
              if (!chipSelected) applyIndent('increase');
            }}
            title="Aumentar sangría"
            disabled={chipSelected}
          >
            <Indent size={14} />
          </TBtn>
          <TBtn
            onMouseDown={(e) => {
              e.preventDefault();
              if (!chipSelected) applyIndent('decrease');
            }}
            title="Reducir sangría"
            disabled={chipSelected}
          >
            <Outdent size={14} />
          </TBtn>

          <ToolbarDivider />

          {/* HR */}
          <TBtn
            onMouseDown={(e) => {
              e.preventDefault();
              if (!selectedChipId)
                document.execCommand(
                  'insertHTML',
                  false,
                  '<hr style="border:none;border-top:1px solid #ccc;margin:8px 0;" />'
                );
            }}
            title="Separador horizontal"
            disabled={chipSelected}
          >
            <Minus size={14} />
          </TBtn>
        </div>
        <style jsx>{`
          .field-formatting-mode > :global(button:disabled),
          .field-formatting-mode > :global(select:disabled),
          .field-formatting-mode > :global(.w-px) {
            display: none;
          }

          .field-formatting-mode > :global(.field-divider-visible) {
            display: block;
          }
        `}</style>
      </div>

      {/* ─── Find & Replace Bar ─────────────────────────────────────────────── */}
      {showFindReplace && !chipSelected && (
        <div className="bg-gray-50 border-b border-gray-200 px-3 py-2 flex items-center gap-2 flex-wrap z-10">
          <span className="text-xs font-medium text-gray-600 shrink-0">Buscar:</span>
          <input
            type="text"
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleFind();
            }}
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
          <button
            type="button"
            onClick={handleFind}
            className="text-xs px-2 py-1 bg-white border border-gray-200 rounded hover:bg-gray-100 text-gray-700 font-medium"
          >
            Buscar
          </button>
          <button
            type="button"
            onClick={handleReplace}
            className="text-xs px-2 py-1 bg-white border border-gray-200 rounded hover:bg-gray-100 text-gray-700 font-medium"
          >
            Reemplazar
          </button>
          <button
            type="button"
            onClick={handleReplaceAll}
            className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
          >
            Reemplazar todo
          </button>
          <button
            type="button"
            onClick={() => {
              if (onToggleFindReplace) onToggleFindReplace();
            }}
            className="ml-auto text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ─── Floating Dropdowns ─────────────────────────────────────────────── */}

      {/* Márgenes */}
      {openDropdown === 'margenes' && (
        <div
          className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] p-4 w-64"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <p className="text-xs font-semibold text-gray-800 mb-3">Márgenes de página (cm)</p>
          {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
            <div key={side} className="flex items-center gap-2 mb-2">
              <label className="text-xs text-gray-600 w-20">
                {side === 'top'
                  ? 'Superior'
                  : side === 'bottom'
                    ? 'Inferior'
                    : side === 'left'
                      ? 'Izquierdo'
                      : 'Derecho'}
                :
              </label>
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={localMargenes[side]}
                onChange={(e) =>
                  setLocalMargenes((m) => ({ ...m, [side]: parseFloat(e.target.value) || 0 }))
                }
                className="w-20 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span className="text-xs text-gray-400">cm</span>
            </div>
          ))}
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={applyMargenes}
              className="flex-1 text-xs bg-blue-600 text-white rounded-md py-1.5 hover:bg-blue-700 font-medium"
            >
              Aplicar
            </button>
            <button
              type="button"
              onClick={() => {
                if (onSetOpenDropdown) onSetOpenDropdown(null);
              }}
              className="flex-1 text-xs bg-gray-100 text-gray-700 rounded-md py-1.5 hover:bg-gray-200"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Tamaño */}
      {openDropdown === 'tamano' && (
        <div
          className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] p-3 w-52"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <p className="text-xs font-semibold text-gray-800 mb-2">Tamaño de página</p>
          {['Carta (Letter)', 'Oficio (Legal)', 'A4', 'A3', 'A5', 'Tabloide'].map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => {
                if (onInfoChange) onInfoChange({ hojaTamano: size });
                if (onSetOpenDropdown) onSetOpenDropdown(null);
              }}
              className={`w-full text-left text-xs px-3 py-2 rounded-md mb-0.5 transition-colors ${infoData?.hojaTamano === size ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              {size}
            </button>
          ))}
        </div>
      )}

      {/* Columnas */}
      {openDropdown === 'columnas' && (
        <div
          className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] p-3 w-44"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <p className="text-xs font-semibold text-gray-800 mb-2">Número de columnas</p>
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNumColumnas(n)}
              className={`w-full text-left text-xs px-3 py-2 rounded-md mb-0.5 transition-colors flex items-center gap-2 ${numColumnas === n ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              <span className="flex gap-0.5">
                {Array.from({ length: n }).map((_, i) => (
                  <span key={i} className="w-3 h-5 bg-current rounded-sm opacity-60" />
                ))}
              </span>
              {n === 1 ? 'Una columna' : n === 2 ? 'Dos columnas' : 'Tres columnas'}
            </button>
          ))}
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={applyColumnas}
              className="flex-1 text-xs bg-blue-600 text-white rounded-md py-1.5 hover:bg-blue-700 font-medium"
            >
              Aplicar
            </button>
            <button
              type="button"
              onClick={() => {
                if (onSetOpenDropdown) onSetOpenDropdown(null);
              }}
              className="flex-1 text-xs bg-gray-100 text-gray-700 rounded-md py-1.5 hover:bg-gray-200"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Tabla con grid visual */}
      {openDropdown === 'tabla' && (
        <div
          className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999]"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <SimpleTableGrid onSelect={insertTable} />
        </div>
      )}

      {/* Interlineado */}
      {openDropdown === 'lineSpacing' && (
        <div
          className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] py-1 min-w-[160px]"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          {[
            { label: 'Sencillo', value: '1' },
            { label: '1,15', value: '1.15' },
            { label: '1,5', value: '1.5' },
            { label: 'Doble', value: '2' },
          ].map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => applyLineSpacing(s.value)}
              className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              <span className="w-4 text-blue-600">{s.value === '1.15' ? '✓' : ''}</span>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Estilo de lista numerada */}
      {openDropdown === 'orderedStyle' && (
        <div
          className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] p-3"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <p className="text-xs font-semibold text-gray-700 mb-2">Estilo de lista numerada</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: '1.\n2.\n3.', title: '1. 2. 3.', listType: 'decimal', css: 'decimal' },
              {
                label: '1)\n2)\n3)',
                title: '1) 2) 3)',
                listType: 'decimal',
                css: 'decimal',
                suffix: ')',
              },
              {
                label: 'a.\nb.\nc.',
                title: 'a. b. c.',
                listType: 'lower-alpha',
                css: 'lower-alpha',
              },
              {
                label: 'a)\nb)\nc)',
                title: 'a) b) c)',
                listType: 'lower-alpha',
                css: 'lower-alpha',
                suffix: ')',
              },
              {
                label: 'i.\nii.\niii.',
                title: 'i. ii. iii.',
                listType: 'lower-roman',
                css: 'lower-roman',
              },
              {
                label: 'I.\nII.\nIII.',
                title: 'I. II. III.',
                listType: 'upper-roman',
                css: 'upper-roman',
              },
            ].map((opt) => (
              <button
                key={opt.title}
                type="button"
                title={opt.title}
                onClick={() => {
                  if (savedRangeRef.current) {
                    const s = window.getSelection();
                    if (s) {
                      s.removeAllRanges();
                      s.addRange(savedRangeRef.current);
                    }
                  }
                  document.execCommand('insertOrderedList');
                  requestAnimationFrame(() => {
                    const sel = window.getSelection();
                    if (sel && sel.rangeCount > 0) {
                      let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
                      while (node && node.nodeName !== 'OL' && node !== document.body)
                        node = node.parentNode;
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
                <span className="text-[10px] text-gray-700 font-mono whitespace-pre leading-tight text-left">
                  {opt.label}
                </span>
                <span className="text-[9px] text-gray-400 mt-1">{opt.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Estilo de viñeta */}
      {openDropdown === 'bulletStyle' && (
        <div
          className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] p-3"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
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
                    if (s) {
                      s.removeAllRanges();
                      s.addRange(savedRangeRef.current);
                    }
                  }
                  if (opt.style !== 'none') {
                    document.execCommand('insertUnorderedList');
                    // Apply list-style-type to the UL
                    requestAnimationFrame(() => {
                      const sel = window.getSelection();
                      if (sel && sel.rangeCount > 0) {
                        let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
                        while (node && node.nodeName !== 'UL' && node !== document.body)
                          node = node.parentNode;
                        if (node && node.nodeName === 'UL')
                          (node as HTMLElement).style.listStyleType = opt.style;
                      }
                    });
                  } else if (opt.char) {
                    // Custom character list using CSS
                    document.execCommand('insertUnorderedList');
                    requestAnimationFrame(() => {
                      const sel = window.getSelection();
                      if (sel && sel.rangeCount > 0) {
                        let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
                        while (node && node.nodeName !== 'UL' && node !== document.body)
                          node = node.parentNode;
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
        <div
          className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] w-72 p-4"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <p className="text-xs font-semibold text-gray-800 mb-3">Encabezado y pie de página</p>
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1.5">
              <input
                type="checkbox"
                id="s-header"
                checked={localShowHeader}
                onChange={(e) => {
                  if (onShowHeaderChange) onShowHeaderChange(e.target.checked);
                }}
                className="rounded"
              />
              <label htmlFor="s-header" className="text-xs font-medium text-gray-700">
                Mostrar encabezado
              </label>
            </div>
          </div>
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1.5">
              <input
                type="checkbox"
                id="s-footer"
                checked={localShowFooter}
                onChange={(e) => {
                  if (onShowFooterChange) onShowFooterChange(e.target.checked);
                }}
                className="rounded"
              />
              <label htmlFor="s-footer" className="text-xs font-medium text-gray-700">
                Mostrar pie de página
              </label>
            </div>
          </div>
          <div className="border-t border-gray-100 pt-2 mb-3">
            <p className="text-xs font-medium text-gray-500 mb-1">Opciones</p>
            <button
              type="button"
              onClick={() => {
                if (onSetOpenDropdown) onSetOpenDropdown(null);
                if (onShowNumerosModal) onShowNumerosModal();
                else setShowNumerosModal(true);
              }}
              className="w-full text-left text-xs px-2 py-1.5 text-gray-700 hover:bg-gray-50 rounded"
            >
              Números de página
            </button>
            <button
              type="button"
              onClick={() => {
                if (onShowHeaderChange) onShowHeaderChange(false);
                if (onShowFooterChange) onShowFooterChange(false);
                if (onSetOpenDropdown) onSetOpenDropdown(null);
              }}
              className="w-full text-left text-xs px-2 py-1.5 text-red-600 hover:bg-red-50 rounded"
            >
              Quitar encabezado y pie
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={applyEncabezadoPie}
              className="flex-1 text-xs bg-blue-600 text-white rounded-md py-1.5 hover:bg-blue-700 font-medium"
            >
              Aplicar
            </button>
            <button
              type="button"
              onClick={() => {
                if (onSetOpenDropdown) onSetOpenDropdown(null);
              }}
              className="flex-1 text-xs bg-gray-100 text-gray-700 rounded-md py-1.5 hover:bg-gray-200"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Vínculo inline dropdown */}
      {openDropdown === 'vinculo' && (
        <div
          className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] p-3 w-80"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') insertLink();
                if (e.key === 'Escape') {
                  if (onSetOpenDropdown) onSetOpenDropdown(null);
                }
              }}
              autoFocus={!linkText}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={insertLink}
              className="flex-1 text-xs bg-blue-600 text-white rounded-md py-1.5 hover:bg-blue-700 font-medium"
            >
              Insertar
            </button>
            <button
              type="button"
              onClick={() => {
                if (onSetOpenDropdown) onSetOpenDropdown(null);
                setLinkUrl('');
                setLinkText('');
              }}
              className="flex-1 text-xs bg-gray-100 text-gray-700 rounded-md py-1.5 hover:bg-gray-200"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Números de página inline dropdown */}
      {openDropdown === 'numeroPagina' && (
        <div
          className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] p-4 w-72"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <p className="text-xs font-semibold text-gray-800 mb-3">Números de página</p>
          <NumeroPaginaDropdownContent
            onApply={(opts) => {
              applyPageNumbers(opts);
              if (onSetOpenDropdown) onSetOpenDropdown(null);
            }}
            onClose={() => {
              if (onSetOpenDropdown) onSetOpenDropdown(null);
            }}
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
  createsNewVersion,
}: {
  onSaveAndExit: () => void;
  onExitWithoutSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  createsNewVersion: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#D97706"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">¿Deseas salir?</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                Tienes cambios sin guardar en esta plantilla.
              </p>
            </div>
          </div>
          <p className="text-sm text-gray-600 mb-6">
            {createsNewVersion
              ? 'La plantilla publicada se conservará intacta. Puedes crear una nueva versión como borrador o salir sin guardar los cambios.'
              : 'Puedes guardar tu avance como borrador para continuar más tarde, o salir sin guardar y perder los cambios realizados.'}
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onSaveAndExit}
              disabled={isSaving}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-60"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              {isSaving
                ? 'Guardando...'
                : createsNewVersion
                  ? 'Crear nueva versión y salir'
                  : 'Guardar avance y salir'}
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
    } catch {
      return new Set();
    }
  });
  // For "Por grupo" tab: null = show group list, string = show types of that group
  const [drillGroupId, setDrillGroupId] = useState<string | null>(null);

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem('tipo_doc_favorites', JSON.stringify([...next]));
      } catch {}
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
    const matchSearch =
      t.nombre.toLowerCase().includes(search.toLowerCase()) ||
      (grupos
        .find((g) => g.id === t.grupo_id)
        ?.nombre.toLowerCase()
        .includes(search.toLowerCase()) ??
        false);
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
          <span
            className={`block text-sm font-semibold leading-snug ${selectedId === t.id ? 'text-blue-700' : 'text-gray-900'}`}
          >
            {t.nombre}
          </span>
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
            className={
              isFav ? 'text-amber-400 fill-amber-400' : 'text-gray-300 hover:text-amber-300'
            }
          />
        </button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden flex flex-col"
        style={{ maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-blue-600" />
            <h3 className="text-base font-semibold text-gray-900">Tipo de documento</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-md transition-colors"
          >
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
              onChange={(e) => {
                setSearch(e.target.value);
                setDrillGroupId(null);
              }}
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
            <span
            className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${tab === 'tipo' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`}
            >
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
            <span
            className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${tab === 'favoritos' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`}
            >
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
          {tab === 'tipo' &&
            (filteredTipos.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-gray-400">
                No se encontraron tipos
              </div>
            ) : (
              filteredTipos.map((t) => renderTipoRow(t))
            ))}

          {/* ── Favoritos tab ── */}
          {tab === 'favoritos' &&
            (filteredTipos.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <Star size={32} className="mx-auto mb-3 text-gray-200" />
                <p className="text-sm text-gray-400 font-medium">No tienes favoritos aún</p>
                <p className="text-xs text-gray-300 mt-1">
                  Marca documentos con ★ para verlos aquí
                </p>
              </div>
            ) : (
              filteredTipos.map((t) => renderTipoRow(t))
            ))}

          {/* ── Por grupo tab ── */}
          {tab === 'grupo' &&
            (drillGroupId === null ? (
              /* Group list view */
              filteredGrupos.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-gray-400">
                  No se encontraron grupos
                </div>
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
                        <p className="text-xs text-gray-500 mt-0.5">
                          {count} documento{count !== 1 ? 's' : ''}
                        </p>
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
                  <span className="text-xs text-gray-700 font-semibold truncate">
                    {drillGroup?.nombre}
                  </span>
                </div>
                {drillTipos.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-gray-400">
                    No se encontraron tipos en este grupo
                  </div>
                ) : (
                  drillTipos.map((t) => renderTipoRow(t))
                )}
              </div>
            ))}
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
    } catch {
      return new Set();
    }
  });

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem('etiqueta_favorites', JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setLocalSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const filtered = etiquetas.filter((e) => {
    const matchSearch = e.nombre.toLowerCase().includes(search.toLowerCase());
    if (tab === 'favoritos') return favorites.has(e.id) && matchSearch;
    return matchSearch;
  });

  const favCount = etiquetas.filter((e) => favorites.has(e.id)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden flex flex-col"
        style={{ maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Etiquetas</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-md transition-colors"
          >
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
                  <span
                    className={`text-sm ${isSelected ? 'text-blue-700 font-medium' : 'text-gray-700'}`}
                  >
                    {e.nombre}
                  </span>
                  <button
                    type="button"
                    onClick={(ev) => toggleFavorite(e.id, ev)}
                    className="ml-3 shrink-0"
                    title={favorites.has(e.id) ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                  >
                    <Star
                      size={15}
                      className={
                        favorites.has(e.id)
                          ? 'text-amber-400 fill-amber-400'
                          : 'text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity'
                      }
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
  margenes,
  showRulers,
  onDocumentSettingsChange,
  showValidationErrors,
  showOriginChoice,
  templateOrigin,
  onTemplateOriginChange,
  onDocxImport,
  importStage,
  importError,
  importedDocxName,
}: {
  data: InfoGeneralData;
  onChange: (updates: Partial<InfoGeneralData>) => void;
  margenes: PageMargins;
  showRulers: boolean;
  onDocumentSettingsChange: (settings: TemplateDocumentSettings) => void;
  showValidationErrors?: boolean;
  showOriginChoice: boolean;
  templateOrigin: TemplateOrigin | null;
  onTemplateOriginChange: (origin: TemplateOrigin | null) => void;
  onDocxImport: (file: File) => void;
  importStage: TemplateImportStage;
  importError: string | null;
  importedDocxName: string | null;
}) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingDocx, setIsDraggingDocx] = useState(false);
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
  const selectedEtiquetas = etiquetas.filter((e) => data.etiquetasIds.includes(e.id));
  const documentSettings: TemplateDocumentSettings = {
    paperSize:
      (data.hojaTamano as TemplatePaperSize) || DEFAULT_TEMPLATE_DOCUMENT_SETTINGS.paperSize,
    orientation: data.hojaOrientacion,
    margins: margenes,
    showRulers,
  };
  const isImporting = importStage !== null;
  const importStageLabel = {
    uploading: 'Subiendo documento Word...',
    processing: 'Procesando contenido...',
    preparing: 'Preparando la plantilla...',
  }[importStage || 'uploading'];
  const showTemplateConfiguration =
    !showOriginChoice || templateOrigin === 'scratch' || Boolean(importedDocxName);

  const handleDocxDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingDocx(false);
    if (isImporting) return;
    const file = event.dataTransfer.files?.[0];
    if (file) onDocxImport(file);
  };

  const openDocxPicker = () => {
    if (!isImporting) importInputRef.current?.click();
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 px-4 py-5 lg:px-6">
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        {showOriginChoice && !templateOrigin && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] xl:col-span-2">
            <div>
              <h2 className="text-base font-600 leading-5 text-slate-950">
                ¿Cómo quieres comenzar?
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Elige el origen del contenido de tu nueva plantilla.
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={isImporting}
                onClick={() => onTemplateOriginChange('word')}
                className="flex min-h-[150px] flex-col items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white p-6 text-center transition-colors hover:border-primary/40 hover:bg-primary/[0.02] disabled:cursor-wait disabled:opacity-70"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <FileUp size={22} />
                </span>
                <span className="min-w-0 text-center">
                  <span className="block text-sm font-600 text-slate-900">Importar Word</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">
                    Usa un documento .docx existente como contenido inicial.
                  </span>
                </span>
              </button>

              <button
                type="button"
                disabled={isImporting}
                onClick={() => onTemplateOriginChange('scratch')}
                className="flex min-h-[150px] flex-col items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white p-6 text-center transition-colors hover:border-primary/40 hover:bg-primary/[0.02] disabled:cursor-wait disabled:opacity-70"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <FilePlus2 size={22} />
                </span>
                <span className="min-w-0 text-center">
                  <span className="block text-sm font-600 text-slate-900">Crear desde cero</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">
                    Comienza con una hoja en blanco y construye el contenido en el editor.
                  </span>
                </span>
              </button>
            </div>
          </section>
        )}

        {showOriginChoice && templateOrigin && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] xl:col-span-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {templateOrigin === 'word' ? <FileUp size={19} /> : <FilePlus2 size={19} />}
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-slate-400">Origen seleccionado</p>
                  <p className="text-sm font-600 text-slate-900">
                    {templateOrigin === 'word' ? 'Importar Word' : 'Crear desde cero'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onTemplateOriginChange(null)}
                disabled={isImporting}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:border-primary/30 hover:bg-primary/[0.03] hover:text-primary disabled:cursor-wait disabled:opacity-60"
              >
                <Pencil size={14} />
                Cambiar origen
              </button>
            </div>

            {templateOrigin === 'word' && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <input
                  ref={importInputRef}
                  type="file"
                  accept="application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
                  aria-label="Seleccionar documento Word .docx"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) onDocxImport(file);
                  }}
                />

                {importedDocxName ? (
                  <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 sm:flex-row sm:items-center">
                    <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-600 text-emerald-800">Documento Word importado</p>
                      <p className="mt-0.5 truncate text-xs text-emerald-700">{importedDocxName}</p>
                    </div>
                    <button
                      type="button"
                      onClick={openDocxPicker}
                      disabled={isImporting}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-white px-3 text-sm font-600 text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60"
                    >
                      <FileUp size={15} />
                      Cambiar archivo
                    </button>
                  </div>
                ) : (
                  <>
                    <div
                      role="button"
                      tabIndex={isImporting ? -1 : 0}
                      onClick={openDocxPicker}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openDocxPicker();
                        }
                      }}
                      onDrop={handleDocxDrop}
                      onDragOver={(event) => {
                        event.preventDefault();
                        if (!isImporting) setIsDraggingDocx(true);
                      }}
                      onDragLeave={() => setIsDraggingDocx(false)}
                      className={`flex min-h-[150px] flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center transition-colors ${
                        isImporting
                          ? 'cursor-wait border-slate-200 bg-slate-50/70'
                          : isDraggingDocx
                            ? 'cursor-pointer border-primary bg-primary/5'
                            : 'cursor-pointer border-slate-300 bg-slate-50/40 hover:border-primary/60 hover:bg-primary/[0.02]'
                      }`}
                    >
                      {isImporting ? (
                        <Loader2 size={28} className="mb-3 animate-spin text-primary" />
                      ) : (
                        <Upload size={30} className="mb-3 text-slate-400" />
                      )}
                      <p className="text-sm font-600 text-primary">
                        {isImporting ? importStageLabel : 'Arrastra tu documento Word aquí'}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">Archivo .docx de hasta 15 MB.</p>
                    </div>
                    <button
                      type="button"
                      onClick={openDocxPicker}
                      disabled={isImporting}
                      className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-600 text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                    >
                      <Upload size={15} />
                      Elegir archivo .docx
                    </button>
                  </>
                )}

                {importError && (
                  <p role="alert" className="mt-3 text-sm text-red-600">
                    {importError}
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {showTemplateConfiguration && (
          <>
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="mb-5">
                <h2 className="text-base font-600 leading-5 text-slate-950">
                  Propiedades de la plantilla
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Define la información y clasificación de la plantilla.
                </p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Nombre de la plantilla <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={data.nombre}
                    onChange={(e) => onChange({ nombre: e.target.value })}
                    placeholder="Nombre de la plantilla"
                    className={`h-10 w-full rounded-lg border px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${showValidationErrors && !data.nombre.trim() ? 'border-red-300 bg-red-50/30' : 'border-slate-200'}`}
                  />
                  {showValidationErrors && !data.nombre.trim() && (
                    <p className="mt-1 text-xs text-red-500">Este campo es obligatorio</p>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Descripción
                  </label>
                  <textarea
                    value={data.descripcion}
                    onChange={(e) => onChange({ descripcion: e.target.value })}
                    placeholder="Añade un resumen o notas sobre el contenido de la plantilla."
                    rows={3}
                    className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Número de oficio / documento
                  </label>
                  <input
                    type="text"
                    value={data.numeroOficio}
                    onChange={(e) => onChange({ numeroOficio: e.target.value })}
                    placeholder="Ej. OF-2026-001"
                    className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                    <Layers size={14} className="text-slate-400" />
                    Tipo de documento <span className="font-normal text-slate-400">(Opcional)</span>
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        readOnly
                        value={selectedTipo?.nombre || ''}
                        placeholder={
                          loadingData ? 'Cargando...' : 'Seleccionar tipo de documento...'
                        }
                        disabled={loadingData}
                        className="h-10 w-full cursor-default rounded-lg border border-slate-200 bg-white px-3 pr-8 text-sm outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-400"
                      />
                      {data.tipoDocumentoId && (
                        <button
                          type="button"
                          onClick={() => onChange({ tipoDocumentoId: '', grupotipoId: '' })}
                          aria-label="Quitar tipo de documento"
                          title="Quitar tipo de documento"
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowTipoModal(true)}
                      disabled={loadingData}
                      className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-600 text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Search size={14} />
                      Buscar
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                    <Tag size={14} className="text-slate-400" />
                    Etiquetas
                  </label>
                  <div className="flex gap-2">
                    <div className="flex min-h-10 flex-1 flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                      {selectedEtiquetas.length === 0 ? (
                        <span className="text-slate-400">Seleccionar etiquetas...</span>
                      ) : (
                        selectedEtiquetas.map((tag) => (
                          <span
                            key={tag.id}
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white"
                            style={{ backgroundColor: tag.color || '#6B7280' }}
                          >
                            {tag.nombre}
                            <button
                              type="button"
                              onClick={() =>
                                onChange({
                                  etiquetasIds: data.etiquetasIds.filter((id) => id !== tag.id),
                                })
                              }
                              aria-label={`Quitar etiqueta ${tag.nombre}`}
                              className="ml-0.5 transition-opacity hover:opacity-70"
                            >
                              <X size={10} />
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowEtiquetasModal(true)}
                      className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-600 text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <Search size={14} />
                      Buscar
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <div className="h-fit xl:sticky xl:top-5">
              <TemplateDocumentSettingsPanel
                key={JSON.stringify(documentSettings)}
                initialSettings={documentSettings}
                onSave={(settings) => {
                  onChange({
                    hojaTamano: settings.paperSize,
                    hojaOrientacion: settings.orientation,
                  });
                  onDocumentSettingsChange(settings);
                }}
              />
            </div>
          </>
        )}
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
          onConfirm={(ids) => {
            onChange({ etiquetasIds: ids });
            setShowEtiquetasModal(false);
          }}
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
  context,
  loadingContext,
  contextError,
}: {
  data: PublicacionData;
  onChange: (updates: Partial<PublicacionData>) => void;
  context: TemplatePublicationContext | null;
  loadingContext: boolean;
  contextError: string | null;
}) {
  const versionTargetAction: Exclude<
    PublicacionData['publicacionOpcion'],
    'actualizar' | 'version'
  > = context?.permissions.canPublish
    ? 'publicar'
    : context?.permissions.canSubmitApproval
      ? 'aprobacion'
      : 'borrador';
  const versionTargetStatus = {
    borrador: 'Borrador',
    publicar: 'Publicada',
    aprobacion: 'En revisión',
  }[versionTargetAction];
  const estadoMap: Record<PublicacionData['publicacionOpcion'], string> = {
    borrador: 'Borrador',
    publicar: 'Publicada',
    aprobacion: 'En revisión',
    actualizar: versionTargetStatus,
    version: versionTargetStatus,
  };

  const handleOptionChange = (opt: PublicacionData['publicacionOpcion']) => {
    const nuevoEstado = estadoMap[opt] || 'Borrador';
    onChange({ publicacionOpcion: opt, estadoPlantilla: nuevoEstado });
  };

  const isPersonal = context?.workspaceType === 'personal';
  const isPublishedTemplate =
    context?.template?.status === 'published' || context?.template?.displayStatus === 'Publicada';
  const publicationOptions: Array<{
    id: PublicacionData['publicacionOpcion'];
    title: string;
    desc: string;
  }> = [];
  if (isPublishedTemplate) {
    if (context?.permissions.canCreateVersion) {
      publicationOptions.push({
        id: 'actualizar',
        title: 'Actualizar la versión actual',
        desc: `Conserva la versión ${context.template?.currentVersion || data.versionPublicada} y publica esta revisión como la vigente.`,
      });
      publicationOptions.push({
        id: 'version',
        title: 'Crear una nueva versión',
        desc: `Avanza a la versión ${context.template?.nextVersion || 'siguiente'} y conserva la actual en el historial.`,
      });
    }
  } else {
    if (context?.permissions.canSaveDraft) {
      publicationOptions.push({
        id: 'borrador',
        title: 'Guardar como borrador',
        desc: 'Guarda la plantilla sin publicarla.',
      });
    }
    if (context?.permissions.canPublish) {
      publicationOptions.push({
        id: 'publicar',
        title: 'Publicar plantilla',
        desc: 'Hace disponible la plantilla para utilizarla.',
      });
    }
    if (context?.permissions.canSubmitApproval) {
      publicationOptions.push({
        id: 'aprobacion',
        title: 'Enviar a aprobación',
        desc: 'Envía la plantilla al flujo de revisión configurado.',
      });
    }
  }

  const versionValue =
    data.publicacionOpcion === 'version'
      ? context?.template?.nextVersion || data.versionPublicada
      : context?.template?.currentVersion || data.versionPublicada;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 px-6 py-6">
      <div className="mx-auto w-full max-w-6xl space-y-5">
        {loadingContext && (
          <div className="rounded-md border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500">
            Cargando opciones de publicación...
          </div>
        )}
        {contextError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            {contextError}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-sm font-medium text-slate-800">Publicación</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Revisa los últimos detalles y decide cómo guardar la plantilla.
            </p>
          </div>
          <div className="p-6">
            {context?.approvalWorkflow && (
              <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3">
                <p className="text-xs font-medium text-blue-800">Aprobación requerida</p>
                <p className="mt-0.5 text-xs text-blue-700">
                  Se utilizará {context.approvalWorkflow.name}, versión{' '}
                  {context.approvalWorkflow.version}.
                </p>
              </div>
            )}

            <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {publicationOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleOptionChange(opt.id)}
                  className={`min-h-[92px] rounded-md border p-4 text-left transition-all ${
                    data.publicacionOpcion === opt.id
                      ? 'border-primary bg-blue-50 ring-1 ring-primary/10'
                      : 'border-slate-200 bg-white hover:border-primary/30 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        data.publicacionOpcion === opt.id ? 'border-blue-500' : 'border-gray-300'
                      }`}
                    >
                      {data.publicacionOpcion === opt.id && (
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                      )}
                    </div>
                    <span
                      className={`!text-xs !font-medium ${data.publicacionOpcion === opt.id ? 'text-blue-700' : 'text-gray-700'}`}
                    >
                      {opt.title}
                    </span>
                  </div>
                  <p className="ml-5 !text-xs !font-normal text-gray-500">{opt.desc}</p>
                </button>
              ))}
            </div>

            {!loadingContext && context && publicationOptions.length === 0 && (
              <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                No tienes una acción de publicación disponible para el estado y los permisos
                actuales.
              </div>
            )}

            <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  {isPersonal ? 'Comentario (opcional)' : 'Comentario de publicación (opcional)'}
                </label>
                <textarea
                  value={data.comentarioPublicacion}
                  onChange={(e) => onChange({ comentarioPublicacion: e.target.value })}
                  placeholder="Agregar comentario (opcional)..."
                  rows={3}
                  maxLength={500}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                />
                <p className="text-xs text-gray-400 text-right mt-0.5">
                  {data.comentarioPublicacion.length} / 500
                </p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">
                    Estado de la plantilla
                  </label>
                  <input
                    type="text"
                    value={data.estadoPlantilla}
                    readOnly
                    disabled
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-600 cursor-not-allowed"
                    placeholder="Se asigna automáticamente"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Versión publicada
                  </label>
                  <input
                    type="text"
                    value={versionValue}
                    readOnly
                    disabled
                    className="w-full cursor-not-allowed rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
                  />
                  <p className="mt-0.5 text-xs text-gray-400">
                    La versión se asigna automáticamente.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Wizard Shell ─────────────────────────────────────────────────────────────

function NuevaPlantillaPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeWorkspace } = useWorkspace();
  const activeWorkspaceId = activeWorkspace?.id || null;
  const containerRef = useRef<HTMLDivElement>(null);
  const previewScrollAreaRef = useRef<HTMLDivElement>(null);
  const previewWheelLockUntilRef = useRef(0);
  const previewScrollTargetRef = useRef<'start' | 'end'>('start');
  const templateId = searchParams?.get('id') || null;
  const importSessionId = searchParams?.get('import') || null;
  const previewRequested = searchParams?.get('preview') === '1';
  const previewOpenedFromGallery = searchParams?.get('preview_origin') === 'gallery';

  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(previewRequested ? 2 : 1);
  const [currentHtml, setCurrentHtml] = useState(() => normalizeTemplateHtml());
  const [showPreview, setShowPreview] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState<TemplatePreviewSnapshot>({
    pages: ['<p><br></p>'],
    headerHtml: '',
    footerHtml: '',
  });
  const [previewPage, setPreviewPage] = useState(1);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [publicationContext, setPublicationContext] = useState<TemplatePublicationContext | null>(
    null
  );
  const [isLoadingPublicationContext, setIsLoadingPublicationContext] = useState(false);
  const [publicationContextError, setPublicationContextError] = useState<string | null>(null);
  const [editorDocumentVersion, setEditorDocumentVersion] = useState(0);
  const [toasts, setToasts] = useState<
    { id: string; type: 'success' | 'error' | 'info'; message: string }[]
  >([]);
  const [pageCount, setPageCount] = useState(1);
  const [activePage, setActivePage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [templateOrigin, setTemplateOrigin] = useState<TemplateOrigin | null>(
    importSessionId ? 'word' : templateId ? 'scratch' : null
  );
  const [templateImportStage, setTemplateImportStage] = useState<TemplateImportStage>(null);
  const [templateImportError, setTemplateImportError] = useState<string | null>(null);
  const [importedDocx, setImportedDocx] = useState<{
    filename: string;
    suggestedName: string;
  } | null>(null);
  const savedTemplateIdRef = useRef<string | null>(templateId);
  const loadedTemplateIdRef = useRef<string | null>(null);
  const openedPreviewTemplateRef = useRef<string | null>(null);
  const appliedImportSessionRef = useRef<string | null>(null);

  // Editor state
  const [showRulers, setShowRulers] = useState(DEFAULT_TEMPLATE_DOCUMENT_SETTINGS.showRulers);
  const [showHeader, setShowHeader] = useState(false);
  const [showFooter, setShowFooter] = useState(false);
  const [firstPageDifferent, setFirstPageDifferent] = useState(false);
  const [showNumerosModal, setShowNumerosModal] = useState(false);
  const [imageSizeData, setImageSizeData] = useState<{
    figure: HTMLElement;
    originalWidth: number;
    originalHeight: number;
    currentWidth: number;
  } | null>(null);
  const [margenes, setMargenes] = useState<PageMargins>(DEFAULT_TEMPLATE_DOCUMENT_SETTINGS.margins);

  // Toolbar shared state (lifted to avoid undefined refs in bottom bar)
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [showWordCount, setShowWordCount] = useState(false);

  const updateWordCount = useCallback(() => {
    const pages = document.querySelectorAll('[data-page-content]');
    let text = '';
    pages.forEach((p) => {
      text += (p as HTMLElement).innerText + ' ';
    });
    const words = text
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
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
  const savedSelectionRef = useRef<{
    node: Node;
    offset: number;
    pageEl: HTMLElement;
    pageIndex: number;
  } | null>(null);

  const [infoData, setInfoData] = useState<InfoGeneralData>({
    nombre: '',
    descripcion: '',
    numeroOficio: '',
    areaResponsable: '',
    tipoPlantilla: '',
    etiquetasIds: [],
    grupotipoId: '',
    tipoDocumentoId: '',
    hojaTamano: DEFAULT_TEMPLATE_DOCUMENT_SETTINGS.paperSize,
    hojaOrientacion: DEFAULT_TEMPLATE_DOCUMENT_SETTINGS.orientation,
  });

  const [pubData, setPubData] = useState<PublicacionData>({
    publicacionOpcion: 'borrador',
    comentarioPublicacion: '',
    estadoPlantilla: 'Borrador',
    versionPublicada: '1.0',
  });
  const isExistingPublishedTemplate = Boolean(
    templateId &&
    (publicationContext?.template?.status === 'published' ||
      publicationContext?.template?.displayStatus === 'Publicada')
  );

  useEffect(() => {
    if (templateId) return;

    const settings = readTemplateDocumentSettings(activeWorkspace?.id);
    const animationFrame = window.requestAnimationFrame(() => {
      setInfoData((current) => ({
        ...current,
        hojaTamano: settings.paperSize,
        hojaOrientacion: settings.orientation,
      }));
      setMargenes(settings.margins);
      setShowRulers(settings.showRulers);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeWorkspace?.id, templateId]);

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
    if (!templateId || !activeWorkspace?.id) return;
    const controller = new AbortController();
    const loadTemplate = async () => {
      loadedTemplateIdRef.current = null;
      setIsLoadingTemplate(true);
      try {
        const res = await templateApiFetch(
          `/api/plantillas/${templateId}?workspace_id=${encodeURIComponent(activeWorkspace.id)}`,
          { signal: controller.signal }
        );
        if (!res.ok) {
          const failure = await res.json().catch(() => null);
          throw new Error(failure?.error || 'No se pudo cargar la plantilla.');
        }
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
          publicacionOpcion:
            (t.publicacion_opcion as PublicacionData['publicacionOpcion']) || 'borrador',
          comentarioPublicacion: t.comentario_publicacion || '',
          estadoPlantilla: t.estado_plantilla || 'Borrador',
          versionPublicada: t.version_publicada || '1.0',
        });

        setCurrentHtml(normalizeTemplateHtml(t.contenido_html));
        setEditorDocumentVersion((current) => current + 1);

        // Restore editor layout state
        if (t.margenes) setMargenes(t.margenes);
        if (typeof t.show_header === 'boolean') setShowHeader(t.show_header);
        if (typeof t.show_footer === 'boolean') setShowFooter(t.show_footer);

        if (Array.isArray(t.campos_insertados) && t.campos_insertados.length > 0) {
          setInsertedFields(
            (t.campos_insertados as InsertedField[]).map((field) => ({
              ...field,
              valueKey:
                field.valueKey ||
                `legacy:${field.scope || 'participant'}:${field.fieldType}:${(field.customName || field.label).trim().toLocaleLowerCase('es-MX')}`,
            }))
          );
        }

        savedTemplateIdRef.current = t.id;
        loadedTemplateIdRef.current = t.id;
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          setPublicationContextError((error as Error).message);
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingTemplate(false);
      }
    };
    void loadTemplate();
    return () => controller.abort();
  }, [activeWorkspace?.id, templateId]);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    const controller = new AbortController();
    const loadPublicationContext = async () => {
      setIsLoadingPublicationContext(true);
      setPublicationContextError(null);
      try {
        const params = new URLSearchParams({ workspace_id: activeWorkspace.id });
        if (templateId) params.set('template_id', templateId);
        const response = await templateApiFetch(`/api/plantillas/publication-context?${params}`, {
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || 'No se pudo obtener la política de publicación.');
        const nextContext = result as TemplatePublicationContext;
        setPublicationContext(nextContext);

        if (nextContext.workspaceType === 'personal') {
          setInfoData((current) => ({ ...current, areaResponsable: '' }));
        }

        setPubData((current) => {
          const publishedTemplate =
            nextContext.template?.status === 'published' ||
            nextContext.template?.displayStatus === 'Publicada';
          const allowed: PublicacionData['publicacionOpcion'][] = publishedTemplate
            ? nextContext.permissions.canCreateVersion
              ? ['actualizar', 'version']
              : []
            : [
                ...(nextContext.permissions.canSaveDraft ? (['borrador'] as const) : []),
                ...(nextContext.permissions.canPublish ? (['publicar'] as const) : []),
                ...(nextContext.permissions.canSubmitApproval ? (['aprobacion'] as const) : []),
              ];
          const publicacionOpcion = allowed.includes(current.publicacionOpcion)
            ? current.publicacionOpcion
            : allowed[0] || 'borrador';
          const estadoPlantilla = {
            borrador: 'Borrador',
            publicar: 'Publicada',
            aprobacion: 'En revisión',
            actualizar: nextContext.permissions.canPublish
              ? 'Publicada'
              : nextContext.permissions.canSubmitApproval
                ? 'En revisión'
                : 'Borrador',
            version: nextContext.permissions.canPublish
              ? 'Publicada'
              : nextContext.permissions.canSubmitApproval
                ? 'En revisión'
                : 'Borrador',
          }[publicacionOpcion];
          return {
            ...current,
            publicacionOpcion,
            estadoPlantilla,
            versionPublicada:
              publicacionOpcion === 'version'
                ? nextContext.template?.nextVersion || current.versionPublicada
                : nextContext.template?.currentVersion || current.versionPublicada || '1.0',
          };
        });
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          setPublicationContext(null);
          setPublicationContextError((error as Error).message);
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingPublicationContext(false);
      }
    };
    void loadPublicationContext();
    return () => controller.abort();
  }, [activeWorkspace?.id, templateId]);

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

  const applyImportedTemplate = useCallback(
    (imported: TemplateDocxImportResult, advanceToEditor: boolean) => {
      setTemplateOrigin('word');
      setImportedDocx({
        filename: imported.originalFilename,
        suggestedName: imported.suggestedName,
      });
      setInfoData((current) => ({
        ...current,
        nombre: current.nombre || imported.suggestedName,
      }));
      setCurrentHtml(normalizeTemplateHtml(imported.contentHtml));
      setInsertedFields(imported.fields as InsertedField[]);
      setEditorDocumentVersion((current) => current + 1);
      setPageCount(1);
      setActivePage(1);
      if (advanceToEditor) setWizardStep(2);
      setHasUnsavedChanges(true);
    },
    []
  );

  const handleDocxImport = useCallback(
    async (file: File) => {
      if (!activeWorkspaceId || templateImportStage) return;

      setTemplateOrigin('word');
      setTemplateImportError(null);
      if (!file.name.toLowerCase().endsWith('.docx')) {
        setTemplateImportError('Selecciona un archivo Microsoft Word con extensión .docx.');
        return;
      }
      if (file.size <= 0 || file.size > 15 * 1024 * 1024) {
        setTemplateImportError('El archivo debe contener información y no superar 15 MB.');
        return;
      }

      setTemplateImportStage('uploading');
      const processingTimer = window.setTimeout(() => setTemplateImportStage('processing'), 250);
      try {
        const formData = new FormData();
        formData.set('file', file);
        const response = await templateApiFetch(
          `/api/plantillas/import-docx?workspace_id=${encodeURIComponent(activeWorkspaceId)}`,
          { method: 'POST', body: formData }
        );
        const result = (await response.json()) as TemplateDocxImportResult & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(result.error || 'No fue posible importar el documento Word.');
        }

        window.clearTimeout(processingTimer);
        setTemplateImportStage('preparing');
        applyImportedTemplate(result, false);
        addToast(
          result.warnings.length > 0 ? 'info' : 'success',
          result.warnings.length > 0
            ? `Documento importado con ${result.warnings.length} aviso${result.warnings.length === 1 ? '' : 's'} de compatibilidad.`
            : 'Documento Word importado. El contenido está listo en el editor.'
        );
      } catch (error) {
        setTemplateImportError(
          (error as Error).message || 'No fue posible importar el documento Word.'
        );
      } finally {
        window.clearTimeout(processingTimer);
        setTemplateImportStage(null);
      }
    },
    [activeWorkspaceId, addToast, applyImportedTemplate, templateImportStage]
  );

  const handleTemplateOriginChange = useCallback(
    (origin: TemplateOrigin | null) => {
      if (templateImportStage) return;
      setTemplateOrigin(origin);
      setTemplateImportError(null);

      if (origin === 'scratch' && importedDocx) {
        setInfoData((current) => ({
          ...current,
          nombre: current.nombre === importedDocx.suggestedName ? '' : current.nombre,
        }));
        setImportedDocx(null);
        setCurrentHtml(normalizeTemplateHtml());
        setInsertedFields([]);
        setSelectedFieldId(null);
        setEditorDocumentVersion((current) => current + 1);
        setPageCount(1);
        setActivePage(1);
        setHasUnsavedChanges(true);
      }
    },
    [importedDocx, templateImportStage]
  );

  useEffect(() => {
    if (
      !importSessionId ||
      templateId ||
      !activeWorkspace?.id ||
      appliedImportSessionRef.current === importSessionId
    ) {
      return;
    }

    let cancelled = false;
    const applyImportedDocument = async () => {
      try {
        const imported = await readTemplateImportSession(importSessionId);
        if (cancelled) return;
        if (!imported) {
          addToast(
            'error',
            'La importación venció o ya no está disponible. Vuelve a importar el archivo.'
          );
          return;
        }
        if (imported.workspaceId !== activeWorkspace.id) {
          await removeTemplateImportSession(importSessionId);
          addToast('error', 'La importación pertenece a otro espacio de trabajo.');
          return;
        }

        appliedImportSessionRef.current = importSessionId;
        applyImportedTemplate(imported, true);
        await removeTemplateImportSession(importSessionId);
        addToast(
          imported.warnings.length > 0 ? 'info' : 'success',
          imported.warnings.length > 0
            ? `Plantilla preparada con ${imported.warnings.length} aviso${imported.warnings.length === 1 ? '' : 's'} de compatibilidad.`
            : 'Plantilla preparada. El contenido de Word ya puede editarse.'
        );
      } catch (error) {
        if (!cancelled) {
          addToast('error', (error as Error).message || 'No fue posible preparar la plantilla.');
        }
      }
    };

    void applyImportedDocument();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.id, addToast, applyImportedTemplate, importSessionId, templateId]);

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

  const findInsertedFieldElement = useCallback((fieldId: string): HTMLElement | null => {
    return (
      Array.from(document.querySelectorAll<HTMLElement>('[data-field-id]')).find(
        (element) => element.getAttribute('data-field-id') === fieldId
      ) ?? null
    );
  }, []);

  const clearInsertedFieldHighlights = useCallback(() => {
    document.querySelectorAll<HTMLElement>('[data-field-id]').forEach((element) => {
      element.removeAttribute('data-field-selected');
      element.style.outline = '';
      element.style.outlineOffset = '';
      element.style.boxShadow = '';
      element.style.borderColor =
        element.getAttribute('data-field-type') === 'signature' ? '#60A5FA' : '#BFDBFE';
      element.style.marginInline = '2px';
    });
  }, []);

  const selectInsertedField = useCallback(
    (fieldId: string, scrollIntoView = true) => {
      const fieldElement = findInsertedFieldElement(fieldId);
      if (!fieldElement) {
        setInsertedFields((current) => current.filter((field) => field.id !== fieldId));
        setSelectedFieldId(null);
        addToast('error', 'El campo ya no existe en el documento y se retiró de la lista.');
        return false;
      }

      clearInsertedFieldHighlights();
      fieldElement.setAttribute('data-field-selected', 'true');
      fieldElement.style.outline = '';
      fieldElement.style.outlineOffset = '';
      fieldElement.style.borderColor = '#2563EB';
      fieldElement.style.boxShadow = '0 0 0 1px rgba(37, 99, 235, 0.12)';
      setSelectedFieldId(fieldId);
      if (scrollIntoView) {
        fieldElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }
      return true;
    },
    [addToast, clearInsertedFieldHighlights, findInsertedFieldElement]
  );

  const notifyEditorMutation = useCallback((element: HTMLElement) => {
    const pageElement = element.closest('[data-page-content]') as HTMLElement | null;
    pageElement?.dispatchEvent(new Event('input', { bubbles: true }));
  }, []);

  const handleEditorInteraction = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      let node: Node | null = range.startContainer;
      let pageEl: HTMLElement | null = null;
      while (node) {
        if (
          node instanceof HTMLElement &&
          node.matches('[data-page-content][contenteditable="true"]')
        ) {
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

  const handleDocumentAreaClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const chip = target.closest('[data-field-id]') as HTMLElement | null;
      const fieldId = chip?.getAttribute('data-field-id');
      if (fieldId) {
        selectInsertedField(fieldId, false);
        return;
      }
      setSelectedFieldId(null);
      clearInsertedFieldHighlights();
    },
    [clearInsertedFieldHighlights, selectInsertedField]
  );

  const handleUpdateField = useCallback(
    (id: string, updates: Partial<InsertedField>) => {
      setInsertedFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
      if (updates.customName !== undefined) {
        const chip = document.querySelector(`[data-field-id="${id}"]`) as HTMLElement | null;
        if (chip) {
          const labelElement = chip.querySelector('[data-field-label-text]');
          if (labelElement) {
            labelElement.textContent = `{{${updates.customName}}}`;
          } else {
            chip.textContent = `{{${updates.customName}}}`;
          }
          chip.setAttribute('data-field-label', updates.customName);
          notifyEditorMutation(chip);
        }
      }
    },
    [notifyEditorMutation]
  );

  const handleDeleteField = useCallback(
    (fieldId: string) => {
      const fieldElement = findInsertedFieldElement(fieldId);
      if (fieldElement) {
        const pageElement = fieldElement.closest('[data-page-content]') as HTMLElement | null;
        fieldElement.remove();
        pageElement?.dispatchEvent(new Event('input', { bubbles: true }));
      }
      setInsertedFields((current) => current.filter((field) => field.id !== fieldId));
      setSelectedFieldId((current) => (current === fieldId ? null : current));
      clearInsertedFieldHighlights();
      setHasUnsavedChanges(true);
    },
    [clearInsertedFieldHighlights, findInsertedFieldElement]
  );

  const getInsertionFontSize = useCallback((node: Node, pageElement: HTMLElement): string => {
    const element = node instanceof HTMLElement ? node : node.parentElement;
    const formattedElement =
      element && pageElement.contains(element) && !element.closest('[data-field-id]')
        ? element
        : pageElement;
    return window.getComputedStyle(formattedElement).fontSize;
  }, []);

  const handleDuplicateField = useCallback(
    (fieldId: string) => {
      const fieldElement = findInsertedFieldElement(fieldId);
      const pageElement = fieldElement?.closest('[data-page-content]') as HTMLElement | null;
      if (!fieldElement || !pageElement) {
        addToast('error', 'No fue posible localizar el campo para duplicarlo.');
        return;
      }

      const duplicateId = `field-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const sourceField = insertedFields.find((field) => field.id === fieldId);
      const sharedValueKey = sourceField?.valueKey || fieldElement.dataset.fieldValueKey || fieldId;
      const duplicateElement = fieldElement.cloneNode(true) as HTMLElement;
      duplicateElement.setAttribute('data-field-id', duplicateId);
      duplicateElement.setAttribute('data-field-value-key', sharedValueKey);
      fieldElement.setAttribute('data-field-value-key', sharedValueKey);
      duplicateElement.removeAttribute('data-field-selected');
      duplicateElement.style.outline = '';
      duplicateElement.style.outlineOffset = '';
      duplicateElement.style.boxShadow = '';
      duplicateElement.style.marginInline = '2px';
      if (!fieldElement.style.marginInline) fieldElement.style.marginInline = '2px';

      const findEditablePage = (node: Node): HTMLElement | null => {
        const element = node instanceof HTMLElement ? node : node.parentElement;
        if (element?.closest('[data-field-id]')) return null;
        return element?.closest('[data-page-content][contenteditable="true"]') ?? null;
      };

      let targetPage: HTMLElement | null = null;
      let insertionRange: Range | null = null;
      let targetFontSize = '';
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const currentRange = selection.getRangeAt(0);
        targetPage = findEditablePage(currentRange.commonAncestorContainer);
        if (targetPage) {
          insertionRange = currentRange.cloneRange();
          targetFontSize = getInsertionFontSize(currentRange.startContainer, targetPage);
        }
      }

      if (!insertionRange) {
        const saved = savedSelectionRef.current;
        if (saved?.pageEl.isConnected && saved.node.isConnected) {
          try {
            targetPage = findEditablePage(saved.node);
            if (targetPage) {
              insertionRange = document.createRange();
              insertionRange.setStart(saved.node, saved.offset);
              insertionRange.collapse(true);
              targetFontSize = getInsertionFontSize(saved.node, targetPage);
            }
          } catch {
            insertionRange = null;
            targetPage = null;
          }
        }
      }

      const insertedAtCursor = Boolean(insertionRange && targetPage);
      if (insertionRange && targetPage) {
        insertionRange.collapse(false);
        insertionRange.insertNode(duplicateElement);
      } else {
        fieldElement.insertAdjacentElement('afterend', duplicateElement);
        targetPage = pageElement;
        targetFontSize = window.getComputedStyle(fieldElement).fontSize;
      }
      duplicateElement.style.fontSize = targetFontSize;

      const pageIndex = getPageIndexForNode(duplicateElement);
      setInsertedFields((current) => {
        const sourceIndex = current.findIndex((field) => field.id === fieldId);
        if (sourceIndex < 0) return current;

        const source = current[sourceIndex];
        const duplicate: InsertedField = {
          ...source,
          id: duplicateId,
          valueKey: source.valueKey || source.id,
          pageIndex,
          options: [...source.options],
        };
        const linkedSource = { ...source, valueKey: source.valueKey || source.id };
        return [
          ...current.slice(0, sourceIndex),
          linkedSource,
          duplicate,
          ...current.slice(sourceIndex + 1),
        ];
      });

      if (selection) {
        const range = document.createRange();
        range.setStartAfter(duplicateElement);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        savedSelectionRef.current = {
          node: range.startContainer,
          offset: range.startOffset,
          pageEl: targetPage,
          pageIndex,
        };
      }

      selectInsertedField(duplicateId, false);
      notifyEditorMutation(duplicateElement);
      setHasUnsavedChanges(true);
      addToast(
        'success',
        insertedAtCursor
          ? 'Campo duplicado en la posición del cursor.'
          : 'Campo duplicado junto al original.'
      );
    },
    [
      addToast,
      findInsertedFieldElement,
      getPageIndexForNode,
      getInsertionFontSize,
      insertedFields,
      notifyEditorMutation,
      selectInsertedField,
    ]
  );

  const insertGeneralField = useCallback(
    (
      _editor: unknown,
      fieldType: string,
      label: string,
      options?: { participantField?: boolean; required?: boolean }
    ) => {
      const fieldId = `field-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const participantAttributes = options?.participantField
        ? ' data-field-scope="participant" data-participant-assignment="unassigned"'
        : ' data-field-scope="general"';
      const isSignatureField = fieldType === 'signature';
      const isRequired = !isSignatureField && options?.required === true;
      const requiredAttribute = isRequired ? ' data-field-required="true"' : '';
      const fieldStyle = isSignatureField
        ? 'display:inline-flex;align-items:center;justify-content:center;width:180px;height:72px;min-width:48px;min-height:24px;max-width:100%;resize:both;overflow:hidden;vertical-align:middle;box-sizing:border-box;background:#EFF6FF;color:#1D4ED8;border:1px dashed #60A5FA;border-radius:4px;margin:0 2px;padding:8px;font-size:12px;font-family:inherit;line-height:1.25;user-select:none;cursor:pointer;white-space:nowrap;'
        : 'display:inline;background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;border-radius:4px;margin:0 2px;padding:1px 7px;font-size:inherit;font-family:inherit;line-height:inherit;user-select:none;cursor:pointer;white-space:nowrap;';
      const fieldTitle = isSignatureField
        ? 'Clic para editar. Tamaños sugeridos: corta 180 × 72 px, mediana 260 × 96 px y larga 340 × 120 px. Puedes ajustarlo libremente.'
        : 'Clic para editar propiedades';
      const fieldContent = isSignatureField
        ? `<span data-field-label-text="true">{{${label}}}</span><span data-signature-resize-handle="true" aria-hidden="true"></span>`
        : `{{${label}}}`;
      const chip = `<span contenteditable="false" data-field-id="${fieldId}" data-field-value-key="${fieldId}" data-field-label="${label}" data-field-type="${fieldType}"${participantAttributes}${requiredAttribute} style="${fieldStyle}" title="${fieldTitle}">${fieldContent}</span>`;
      const insertedField = (pageIndex: number): InsertedField => ({
        id: fieldId,
        valueKey: fieldId,
        label,
        fieldType,
        customName: label,
        showLabelInDocument: false,
        options: [],
        pageIndex,
        scope: options?.participantField ? 'participant' : 'general',
        required: isRequired,
        assignedParticipantId: null,
      });

      const sel = window.getSelection();
      let pageIndex = 0;

      const commitInsertion = (
        targetPage: HTMLElement,
        targetPageIndex: number,
        insertionFontSize: string
      ) => {
        const fieldElement = findInsertedFieldElement(fieldId);
        if (!fieldElement) {
          addToast('error', 'No fue posible colocar el campo en el documento.');
          return false;
        }
        fieldElement.style.fontSize = insertionFontSize;
        setInsertedFields((current) =>
          current.some((field) => field.id === fieldId)
            ? current
            : [...current, insertedField(targetPageIndex)]
        );
        selectInsertedField(fieldId);
        notifyEditorMutation(targetPage);
        setHasUnsavedChanges(true);
        return true;
      };

      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        let node: Node | null = range.commonAncestorContainer;
        let pageEl: HTMLElement | null = null;
        while (node) {
          if (
            node instanceof HTMLElement &&
            node.matches('[data-page-content][contenteditable="true"]')
          ) {
            pageEl = node;
            break;
          }
          node = node.parentNode;
        }
        if (pageEl) {
          pageIndex = getPageIndexForNode(range.startContainer);
          const insertionFontSize = getInsertionFontSize(range.startContainer, pageEl);
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
          if (commitInsertion(pageEl, pageIndex, insertionFontSize)) return;
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
            const insertionFontSize = getInsertionFontSize(saved.node, saved.pageEl);
            restoreSel.addRange(range);
            const fragment = range.createContextualFragment(chip);
            const lastNode = fragment.lastChild;
            range.insertNode(fragment);
            if (lastNode) {
              range.setStartAfter(lastNode);
              range.collapse(true);
              restoreSel.removeAllRanges();
              restoreSel.addRange(range);
            }
            if (commitInsertion(saved.pageEl, saved.pageIndex, insertionFontSize)) return;
          }
        } catch {
          // fall through
        }
      }

      const firstPage = document.querySelector(
        '[data-page-content][contenteditable="true"]'
      ) as HTMLElement | null;
      if (firstPage) {
        firstPage.focus();
        const fallbackSel = window.getSelection();
        if (fallbackSel) {
          fallbackSel.removeAllRanges();
          const range = document.createRange();
          range.selectNodeContents(firstPage);
          range.collapse(false);
          const insertionFontSize = getInsertionFontSize(firstPage, firstPage);
          fallbackSel.addRange(range);
          const fragment = range.createContextualFragment(chip);
          const lastNode = fragment.lastChild;
          range.insertNode(fragment);
          if (lastNode) {
            range.setStartAfter(lastNode);
            range.collapse(true);
            fallbackSel.removeAllRanges();
            fallbackSel.addRange(range);
          }
          commitInsertion(firstPage, 0, insertionFontSize);
        }
      } else {
        addToast('error', 'No hay una página disponible para colocar el campo.');
      }
    },
    [
      addToast,
      findInsertedFieldElement,
      getPageIndexForNode,
      getInsertionFontSize,
      notifyEditorMutation,
      selectInsertedField,
    ]
  );

  const buildPayload = useCallback(
    (
      estado: string,
      estadoPlantilla: string,
      publicacionOpcion: PublicacionData['publicacionOpcion'] = pubData.publicacionOpcion
    ) => {
      const html = normalizeTemplateHtml(multiPageEditorRef.current?.getHTML() ?? currentHtml);
      return {
        workspaceId: activeWorkspace?.id || '',
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
        publicacionOpcion,
        comentarioPublicacion: pubData.comentarioPublicacion,
        estadoPlantilla: estadoPlantilla,
        versionPublicada:
          publicacionOpcion === 'version'
            ? publicationContext?.template?.nextVersion || pubData.versionPublicada
            : publicationContext?.template?.currentVersion || pubData.versionPublicada,
        versionTargetAction:
          publicacionOpcion === 'actualizar' || publicacionOpcion === 'version'
            ? estado === 'published'
              ? 'publicar'
              : estadoPlantilla === 'En revisión'
                ? 'aprobacion'
                : 'borrador'
            : undefined,
        estado: estado,
        fields: insertedFields,
        margenes: margenes,
        showHeader: showHeader,
        showFooter: showFooter,
      };
    },
    [
      activeWorkspace?.id,
      currentHtml,
      infoData,
      insertedFields,
      pubData,
      margenes,
      publicationContext,
      showHeader,
      showFooter,
    ]
  );

  const handleSaveDraft = useCallback(async () => {
    if (!activeWorkspace?.id) {
      addToast('error', 'Selecciona un espacio de trabajo para guardar la plantilla.');
      return false;
    }
    setIsSaving(true);
    try {
      const saveAction: PublicacionData['publicacionOpcion'] = isExistingPublishedTemplate
        ? pubData.publicacionOpcion === 'version'
          ? 'version'
          : 'actualizar'
        : 'borrador';
      const payload = buildPayload('draft', 'Borrador', saveAction);

      let res: Response;
      if (savedTemplateIdRef.current) {
        res = await templateApiFetch(`/api/plantillas/${savedTemplateIdRef.current}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        res = await templateApiFetch('/api/plantillas', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al guardar');

      if (json.data?.id && (!savedTemplateIdRef.current || json.createdVersion)) {
        savedTemplateIdRef.current = json.data.id;
        // Update URL without navigation
        const url = new URL(window.location.href);
        url.searchParams.set('id', json.data.id);
        window.history.replaceState({}, '', url.toString());
      }

      setHasUnsavedChanges(false);
      addToast(
        'success',
        isExistingPublishedTemplate
          ? saveAction === 'actualizar'
            ? 'Revisión de la versión actual guardada como borrador'
            : 'Nueva versión creada como borrador'
          : 'Borrador guardado correctamente'
      );
      return true;
    } catch (err: any) {
      addToast(
        'error',
        err.message ||
          (isExistingPublishedTemplate
            ? 'Error al crear la nueva versión'
            : 'Error al guardar el borrador')
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [activeWorkspace?.id, buildPayload, addToast, isExistingPublishedTemplate]);

  const handleExitClick = () => {
    if (hasUnsavedChanges) {
      setShowExitModal(true);
    } else {
      router.push('/plantillas');
    }
  };

  const handleToggleFullscreen = () => {
    if (!isFullscreen) {
      containerRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
    setIsFullscreen((value) => !value);
  };

  const capturePreviewSnapshot = useCallback((): TemplatePreviewSnapshot => {
    const serializedHtml = multiPageEditorRef.current?.getHTML() ?? currentHtml;
    const serialized = splitSerializedTemplateHtml(serializedHtml);
    const editorRoot = containerRef.current;
    const livePages = editorRoot
      ? Array.from(editorRoot.querySelectorAll('[data-page-content="true"]')).map(
          cleanPreviewContent
        )
      : [];
    const liveHeader = editorRoot?.querySelector('[data-header-editable="true"]');
    const liveFooter = editorRoot?.querySelector('[data-footer-editable="true"]');

    const pages =
      livePages.length >= serialized.pages.length && livePages.length > 0
        ? livePages
        : serialized.pages;

    return {
      pages,
      headerHtml: showHeader
        ? liveHeader
          ? cleanPreviewContent(liveHeader)
          : serialized.headerHtml
        : '',
      footerHtml: showFooter
        ? liveFooter
          ? cleanPreviewContent(liveFooter)
          : serialized.footerHtml
        : '',
    };
  }, [currentHtml, showFooter, showHeader]);

  const handleOpenPreview = useCallback(() => {
    setPreviewSnapshot(capturePreviewSnapshot());
    previewScrollTargetRef.current = 'start';
    previewWheelLockUntilRef.current = 0;
    setPreviewPage(1);
    setShowPreview(true);
  }, [capturePreviewSnapshot]);

  const handleClosePreview = useCallback(() => {
    if (previewRequested && previewOpenedFromGallery) {
      router.back();
      return;
    }

    setShowPreview(false);
  }, [previewOpenedFromGallery, previewRequested, router]);

  useEffect(() => {
    if (!previewRequested || !templateId || isLoadingTemplate) return;
    if (
      loadedTemplateIdRef.current !== templateId ||
      openedPreviewTemplateRef.current === templateId
    ) {
      return;
    }

    let previewFrame = 0;
    const paginationFrame = requestAnimationFrame(() => {
      previewFrame = requestAnimationFrame(() => {
        handleOpenPreview();
        openedPreviewTemplateRef.current = templateId;
      });
    });

    return () => {
      cancelAnimationFrame(paginationFrame);
      if (previewFrame) cancelAnimationFrame(previewFrame);
    };
  }, [handleOpenPreview, isLoadingTemplate, previewRequested, templateId]);

  const goToPreviewPage = useCallback(
    (page: number, scrollTarget: 'start' | 'end' = 'start') => {
      previewScrollTargetRef.current = scrollTarget;
      setPreviewPage(Math.min(Math.max(page, 1), previewSnapshot.pages.length));
    },
    [previewSnapshot.pages.length]
  );

  const handlePreviewWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || Math.abs(event.deltaY) < 4) return;

      const scrollArea = event.currentTarget;
      const movingForward = event.deltaY > 0;
      const atStart = scrollArea.scrollTop <= 1;
      const atEnd = scrollArea.scrollTop + scrollArea.clientHeight >= scrollArea.scrollHeight - 1;
      const reachedBoundary = movingForward ? atEnd : atStart;
      const canChangePage = movingForward
        ? previewPage < previewSnapshot.pages.length
        : previewPage > 1;

      if (!reachedBoundary || !canChangePage) return;

      const now = Date.now();
      if (now < previewWheelLockUntilRef.current) return;

      previewWheelLockUntilRef.current = now + 350;
      goToPreviewPage(previewPage + (movingForward ? 1 : -1), movingForward ? 'start' : 'end');
    },
    [goToPreviewPage, previewPage, previewSnapshot.pages.length]
  );

  useEffect(() => {
    if (!showPreview) return;

    const frame = window.requestAnimationFrame(() => {
      const scrollArea = previewScrollAreaRef.current;
      if (!scrollArea) return;

      scrollArea.scrollTop =
        previewScrollTargetRef.current === 'end'
          ? Math.max(0, scrollArea.scrollHeight - scrollArea.clientHeight)
          : 0;
      previewScrollTargetRef.current = 'start';
    });

    return () => window.cancelAnimationFrame(frame);
  }, [previewPage, showPreview]);

  const handlePrintPreview = useCallback(() => {
    const paperSize = (infoData.hojaTamano || 'Carta (Letter)') as PaperSize;
    const orientation = infoData.hojaOrientacion || 'vertical';
    const dims = getPageDimensions(paperSize, orientation);
    const widthInches = dims.width / 96;
    const heightInches = dims.height / 96;
    const printWindow = window.open(
      '',
      '_blank',
      `width=${Math.round(dims.width + 100)},height=${Math.round(dims.height + 100)}`
    );
    if (!printWindow) return;

    const pagesMarkup = previewSnapshot.pages
      .map((pageHtml, pageIndex) => {
        const headerHtml = showHeader
          ? resolvePreviewZoneHtml(previewSnapshot.headerHtml, pageIndex)
          : '';
        const footerHtml = showFooter
          ? resolvePreviewZoneHtml(previewSnapshot.footerHtml, pageIndex)
          : '';
        return `<section class="template-print-page"><div class="template-preview-zone template-print-header">${headerHtml}</div><div class="template-preview-content template-print-content">${pageHtml}</div><div class="template-preview-zone template-print-footer">${footerHtml}</div></section>`;
      })
      .join('');

    printWindow.document.write(
      `<!DOCTYPE html><html><head><title>${escapePrintTitle(
        infoData.nombre || 'Plantilla'
      )}</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Google+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap"><style>*{box-sizing:border-box;}html,body{margin:0;padding:0;background:white;}@page{size:${widthInches}in ${heightInches}in;margin:0;}.template-print-page{width:${widthInches}in;height:${heightInches}in;display:flex;flex-direction:column;overflow:hidden;break-after:page;page-break-after:always;background:white;}.template-print-page:last-child{break-after:auto;page-break-after:auto;}.template-print-header{height:${margenes.top}cm;min-height:${margenes.top}cm;padding:4px ${margenes.right}cm 4px ${margenes.left}cm;display:flex;align-items:flex-end;flex-shrink:0;}.template-print-content{min-height:0;flex:1;overflow:hidden;padding:0 ${margenes.right}cm 0 ${margenes.left}cm;}.template-print-footer{height:${margenes.bottom}cm;min-height:${margenes.bottom}cm;padding:4px ${margenes.right}cm 4px ${margenes.left}cm;display:flex;align-items:flex-start;flex-shrink:0;}${TEMPLATE_PREVIEW_CONTENT_CSS}</style></head><body>${pagesMarkup}</body></html>`
    );
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 300);
  }, [infoData, margenes, previewSnapshot, showFooter, showHeader]);

  const handlePublish = useCallback(async () => {
    if (!activeWorkspace?.id || !publicationContext) {
      addToast(
        'error',
        publicationContextError || 'No se pudo validar la política de publicación.'
      );
      return;
    }
    setIsSaving(true);
    try {
      const publicationAction: PublicacionData['publicacionOpcion'] = isExistingPublishedTemplate
        ? pubData.publicacionOpcion === 'version'
          ? 'version'
          : 'actualizar'
        : pubData.publicacionOpcion;
      const versionTargetAction = publicationContext.permissions.canPublish
        ? 'publicar'
        : publicationContext.permissions.canSubmitApproval
          ? 'aprobacion'
          : 'borrador';
      const statusMap: Record<string, string> = {
        borrador: 'draft',
        publicar: 'published',
        aprobacion: 'draft',
        actualizar:
          versionTargetAction === 'publicar'
            ? 'published'
            : versionTargetAction === 'aprobacion'
              ? 'draft'
              : 'draft',
        version:
          versionTargetAction === 'publicar'
            ? 'published'
            : versionTargetAction === 'aprobacion'
              ? 'draft'
              : 'draft',
      };
      const estadoMap: Record<string, string> = {
        borrador: 'Borrador',
        publicar: 'Publicada',
        aprobacion: 'En revisión',
        actualizar:
          versionTargetAction === 'publicar'
            ? 'Publicada'
            : versionTargetAction === 'aprobacion'
              ? 'En revisión'
              : 'Borrador',
        version:
          versionTargetAction === 'publicar'
            ? 'Publicada'
            : versionTargetAction === 'aprobacion'
              ? 'En revisión'
              : 'Borrador',
      };
      const estado = statusMap[publicationAction] || 'draft';
      const estadoPlantilla = estadoMap[publicationAction] || pubData.estadoPlantilla;
      const payload = buildPayload(estado, estadoPlantilla, publicationAction);

      let res: Response;
      if (savedTemplateIdRef.current) {
        res = await templateApiFetch(`/api/plantillas/${savedTemplateIdRef.current}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        res = await templateApiFetch('/api/plantillas', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al publicar');

      if (json.data?.id && (!savedTemplateIdRef.current || json.createdVersion)) {
        savedTemplateIdRef.current = json.data.id;
      }

      setHasUnsavedChanges(false);
      const publishLabels: Record<string, string> = {
        borrador: 'Borrador guardado correctamente',
        publicar: '¡Plantilla publicada exitosamente!',
        aprobacion: 'Plantilla enviada a aprobación',
        actualizar:
          versionTargetAction === 'publicar'
            ? 'Versión actualizada correctamente'
            : versionTargetAction === 'aprobacion'
              ? 'Actualización enviada a aprobación'
              : 'Actualización guardada como borrador',
        version:
          versionTargetAction === 'publicar'
            ? 'Nueva versión publicada correctamente'
            : versionTargetAction === 'aprobacion'
              ? 'Nueva versión enviada a aprobación'
              : 'Nueva versión creada como borrador',
      };
      addToast('success', publishLabels[publicationAction] || 'Plantilla guardada correctamente');
      setTimeout(() => router.push('/plantillas'), 1500);
    } catch (err: any) {
      addToast('error', err.message || 'Error al publicar la plantilla');
    } finally {
      setIsSaving(false);
    }
  }, [
    activeWorkspace?.id,
    buildPayload,
    pubData,
    addToast,
    publicationContext,
    publicationContextError,
    router,
    isExistingPublishedTemplate,
  ]);

  const handleSaveAndExit = async () => {
    const saved = await handleSaveDraft();
    if (saved) router.push('/plantillas');
  };

  const handleNext = () => {
    if (wizardStep === 1) {
      if (!templateId && !templateOrigin) {
        addToast('error', 'Selecciona cómo quieres comenzar la plantilla.');
        return;
      }
      if (!templateId && templateOrigin === 'word' && !importedDocx) {
        addToast('error', 'Importa un documento Word antes de continuar.');
        return;
      }
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
    3: 'Elige cómo guardar o publicar la plantilla.',
  };
  const wizardProgress = ((wizardStep - 1) / (WIZARD_STEPS.length - 1)) * 100;

  return (
    <div
      ref={containerRef}
      className="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-950"
    >
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
      <header className="flex h-16 shrink-0 items-center border-b border-slate-200 bg-white px-4 lg:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <AppLogo size={34} />
          <div className="hidden h-8 w-px bg-slate-200 lg:block" />
          <div className="hidden min-w-0 lg:block">
            <p className="truncate text-sm font-600 text-slate-950">Nueva plantilla</p>
            <p className="truncate text-xs text-slate-500">
              {activeWorkspace?.name || 'Espacio personal'}
            </p>
          </div>
        </div>

        <nav className="hidden items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 xl:flex">
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
                  className={`flex h-8 items-center gap-2 rounded-md px-3 text-xs font-600 transition-colors ${
                    isActive
                      ? 'bg-white text-primary shadow-[0_1px_3px_rgba(15,23,42,0.12)]'
                      : isCompleted
                        ? 'cursor-pointer text-slate-700 hover:bg-white hover:text-primary'
                        : 'cursor-default text-slate-400'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                      isActive
                        ? 'bg-primary text-white'
                        : isCompleted
                          ? 'bg-primary/10 text-primary'
                          : 'bg-slate-200/70 text-slate-400'
                    }`}
                  >
                    {isCompleted ? <CheckCircle2 size={13} /> : <StepIcon size={13} />}
                  </span>
                  <span>{step.label}</span>
                </button>
                {idx < WIZARD_STEPS.length - 1 && (
                  <div
                    className={`h-px w-3 ${step.id < wizardStep ? 'bg-primary/50' : 'bg-slate-200'}`}
                  />
                )}
              </React.Fragment>
            );
          })}
        </nav>

        <div className="flex flex-1 items-center justify-end gap-1.5">
          {wizardStep === 2 && (
            <button
              type="button"
              onClick={handleOpenPreview}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:bg-slate-50"
            >
              <Eye size={15} />
              <span className="hidden sm:inline">Vista previa</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleToggleFullscreen}
            title={isFullscreen ? 'Restaurar pantalla' : 'Maximizar pantalla'}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-slate-500 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-950"
          >
            <Maximize2 size={17} />
          </button>
          <button
            type="button"
            onClick={handleExitClick}
            title="Salir"
            className="ml-0.5 flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            <X size={16} />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </header>

      <div className="shrink-0 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2 xl:hidden">
        <nav className="mx-auto flex min-w-max items-center gap-1">
          {WIZARD_STEPS.map((step) => {
            const StepIcon = step.icon;
            const isActive = step.id === wizardStep;
            const isCompleted = step.id < wizardStep;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => (isCompleted || isActive) && setWizardStep(step.id as 1 | 2 | 3)}
                className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-600 transition-colors ${isActive ? 'bg-primary/10 text-primary' : isCompleted ? 'text-slate-700' : 'text-slate-400'}`}
              >
                {isCompleted ? <CheckCircle2 size={14} /> : <StepIcon size={14} />}
                {step.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 flex-col overflow-hidden bg-slate-50">
        <section className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-4 lg:px-6">
          <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ActiveWizardIcon size={19} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-600 text-slate-950">{activeWizardStep.label}</h1>
                  <span className="rounded-md bg-slate-200/70 px-2 py-0.5 text-xs font-600 text-slate-600">
                    Paso {wizardStep} de {WIZARD_STEPS.length}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">{stepDescriptions[wizardStep]}</p>
              </div>
            </div>
            <div className="w-full sm:w-60">
              <div className="flex items-center justify-between text-xs font-600 text-slate-500">
                <span>Progreso</span>
                <span>{Math.round(wizardProgress)}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
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
              margenes={margenes}
              showRulers={showRulers}
              onDocumentSettingsChange={(settings) => {
                setMargenes(settings.margins);
                setShowRulers(settings.showRulers);
                setHasUnsavedChanges(true);
              }}
              showValidationErrors={showValidationErrors}
              showOriginChoice={!templateId}
              templateOrigin={templateOrigin}
              onTemplateOriginChange={handleTemplateOriginChange}
              onDocxImport={(file) => void handleDocxImport(file)}
              importStage={templateImportStage}
              importError={templateImportError}
              importedDocxName={importedDocx?.filename || null}
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
                    if (id) selectInsertedField(id);
                    else {
                      setSelectedFieldId(null);
                      clearInsertedFieldHighlights();
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
                  onToggleWordCount={() => {
                    updateWordCount();
                    setShowWordCount((v) => !v);
                  }}
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
                  <div
                    style={{
                      transform: `scale(${zoom / 100})`,
                      transformOrigin: 'top center',
                      transition: 'transform 0.15s ease',
                    }}
                  >
                    <MultiPageEditor
                      key={`template-editor-${templateId ?? 'new'}-${editorDocumentVersion}`}
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
                        // Keep the sidebar aligned with fields that truly exist in the document.
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(html, 'text/html');
                        const presentIds = new Set(
                          Array.from(doc.querySelectorAll('[data-field-id]')).map(
                            (el) => el.getAttribute('data-field-id') as string
                          )
                        );
                        setInsertedFields((current) => {
                          let changed = false;
                          const next = current
                            .filter((field) => {
                              const present = presentIds.has(field.id);
                              if (!present) changed = true;
                              return present;
                            })
                            .map((field) => {
                              const fieldElement = findInsertedFieldElement(field.id);
                              if (!fieldElement) return field;
                              const nextPageIndex = getPageIndexForNode(fieldElement);
                              if (nextPageIndex === field.pageIndex) return field;
                              changed = true;
                              return { ...field, pageIndex: nextPageIndex };
                            });
                          return changed ? next : current;
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
                    {pageCount > 5 ? (
                      <label className="flex items-center gap-1 font-medium text-slate-600">
                        <span>Página</span>
                        <select
                          aria-label="Seleccionar página"
                          value={Math.min(activePage, pageCount)}
                          onChange={(event) => {
                            const pageNumber = Number(event.target.value);
                            if (multiPageEditorRef.current?.goToPage(pageNumber)) {
                              setActivePage(pageNumber);
                            }
                          }}
                          className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                        >
                          {Array.from({ length: pageCount }, (_, index) => index + 1).map(
                            (pageNumber) => (
                              <option key={pageNumber} value={pageNumber}>
                                {pageNumber}
                              </option>
                            )
                          )}
                        </select>
                        <span>de {pageCount}</span>
                      </label>
                    ) : (
                      <span className="font-medium">
                        Página {Math.min(activePage, pageCount)} de {pageCount}
                      </span>
                    )}
                    <div className="w-px h-4 bg-gray-200" />
                    {/* Undo / Redo */}
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        document.execCommand('undo');
                      }}
                      title="Deshacer (Ctrl+Z)"
                      className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 7v6h6" />
                        <path d="M3 13C5.333 7.667 9.6 5 16 5c3.5 0 6 1.5 7 4" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        document.execCommand('redo');
                      }}
                      title="Rehacer (Ctrl+Y)"
                      className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 7v6h-6" />
                        <path d="M21 13C18.667 7.667 14.4 5 8 5c-3.5 0-6 1.5-7 4" />
                      </svg>
                    </button>
                    <div className="w-px h-4 bg-gray-200" />
                    {/* Find & Replace */}
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setShowFindReplace((v) => !v);
                        setOpenDropdown(null);
                      }}
                      title="Buscar y reemplazar (Ctrl+H)"
                      className={`p-1 rounded hover:bg-gray-100 transition-colors ${showFindReplace ? 'text-blue-600 bg-blue-50' : 'text-gray-500'}`}
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                    </button>
                    <div className="w-px h-4 bg-gray-200" />
                    {/* Word count */}
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        updateWordCount();
                        setShowWordCount((v) => !v);
                      }}
                      title="Recuento de palabras"
                      className="px-1.5 py-0.5 rounded hover:bg-gray-100 transition-colors text-gray-500 font-medium"
                    >
                      {wordCount} palabras
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(25, z - 10))}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600 font-bold text-sm leading-none"
                      title="Reducir zoom"
                    >
                      −
                    </button>
                    <input
                      type="range"
                      min={25}
                      max={200}
                      step={5}
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                      className="w-24 h-1 accent-blue-500 cursor-pointer"
                      title="Zoom"
                    />
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(200, z + 10))}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600 font-bold text-sm leading-none"
                      title="Aumentar zoom"
                    >
                      +
                    </button>
                    <span className="w-10 text-center font-medium text-gray-600">{zoom}%</span>
                    <button
                      type="button"
                      onClick={() => setZoom(100)}
                      className="px-1.5 py-0.5 rounded hover:bg-gray-100 text-gray-500 text-xs"
                      title="Restablecer zoom"
                    >
                      Ajustar
                    </button>
                  </div>
                </div>
              </div>

              {/* Right: Field Properties Sidebar */}
              <div className="hidden shrink-0 xl:flex">
                <FieldPropertiesSidebar
                  field={selectedField}
                  onClose={() => {
                    setSelectedFieldId(null);
                    clearInsertedFieldHighlights();
                  }}
                  onUpdate={handleUpdateField}
                  onDuplicateField={handleDuplicateField}
                  onDeleteField={handleDeleteField}
                  allFields={insertedFields}
                  onSelectField={(id) => selectInsertedField(id)}
                />
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <StepPublicacion
              data={pubData}
              onChange={(updates) => setPubData((prev) => ({ ...prev, ...updates }))}
              context={publicationContext}
              loadingContext={isLoadingPublicationContext}
              contextError={publicationContextError}
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
              disabled={
                isSaving ||
                isLoadingPublicationContext ||
                (isExistingPublishedTemplate &&
                  publicationContext?.permissions.canCreateVersion !== true)
              }
              className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              <Save size={15} />
              {isSaving
                ? 'Guardando...'
                : isExistingPublishedTemplate
                  ? pubData.publicacionOpcion === 'version'
                    ? 'Guardar nueva versión como borrador'
                    : 'Guardar actualización como borrador'
                  : 'Guardar borrador'}
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
              disabled={
                isSaving ||
                isLoadingPublicationContext ||
                !publicationContext ||
                !pubData.estadoPlantilla ||
                (isExistingPublishedTemplate &&
                  publicationContext.permissions.canCreateVersion !== true)
              }
              className="flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {isSaving
                ? 'Guardando...'
                : isExistingPublishedTemplate
                  ? pubData.publicacionOpcion === 'version'
                    ? publicationContext?.permissions.canSubmitApproval
                      ? 'Enviar nueva versión a aprobación'
                      : 'Publicar nueva versión'
                    : publicationContext?.permissions.canSubmitApproval
                      ? 'Enviar actualización a aprobación'
                      : 'Actualizar versión actual'
                  : {
                      borrador: 'Guardar como borrador',
                      publicar: 'Publicar plantilla',
                      aprobacion: 'Enviar a aprobación',
                      actualizar: 'Actualizar versión actual',
                      version: 'Crear nueva versión',
                    }[pubData.publicacionOpcion] || 'Publicar plantilla'}
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
                <p className="text-xs text-gray-400">
                  {infoData.nombre || 'Nueva plantilla'} · {infoData.hojaTamano || 'Carta (Letter)'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrintPreview}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
                Imprimir
              </button>
              <button
                type="button"
                onClick={handleClosePreview}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                <X size={15} />
                Cerrar
              </button>
            </div>
          </div>
          {/* Document area */}
          <div
            ref={previewScrollAreaRef}
            onWheel={handlePreviewWheel}
            aria-label="Vista previa paginada"
            className="flex-1 overflow-auto overscroll-contain bg-gray-300 py-10 px-6"
          >
            {(() => {
              const paperSize = (infoData.hojaTamano || 'Carta (Letter)') as PaperSize;
              const orientation = infoData.hojaOrientacion || 'vertical';
              const dims = getPageDimensions(paperSize, orientation);
              const marginTop = cmToPx(margenes.top);
              const marginBottom = cmToPx(margenes.bottom);
              const marginLeft = cmToPx(margenes.left);
              const marginRight = cmToPx(margenes.right);
              const pageIndex = Math.min(previewPage, previewSnapshot.pages.length) - 1;
              const pageHtml = previewSnapshot.pages[pageIndex] || '<p><br></p>';
              const previewScale = previewZoom / 100;
              return (
                <>
                  <style>{TEMPLATE_PREVIEW_CONTENT_CSS}</style>
                  <div className="flex min-h-full min-w-max items-start justify-center">
                    <div
                      style={{
                        width: `${dims.width * previewScale}px`,
                        height: `${dims.height * previewScale}px`,
                        flexShrink: 0,
                        margin: '0 auto',
                        position: 'relative',
                      }}
                    >
                      <div
                        data-preview-page={pageIndex + 1}
                        style={{
                          width: `${dims.width}px`,
                          height: `${dims.height}px`,
                          display: 'flex',
                          flexDirection: 'column',
                          overflow: 'hidden',
                          flexShrink: 0,
                          background: 'white',
                          border: '1px solid #d1d5db',
                          boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
                          borderRadius: '2px',
                          boxSizing: 'border-box',
                          transform: `scale(${previewScale})`,
                          transformOrigin: 'top left',
                        }}
                      >
                        <div
                          className="template-preview-zone"
                          style={{
                            height: `${marginTop}px`,
                            minHeight: `${marginTop}px`,
                            padding: `4px ${marginRight}px 4px ${marginLeft}px`,
                            display: 'flex',
                            alignItems: 'flex-end',
                            flexShrink: 0,
                            boxSizing: 'border-box',
                          }}
                          dangerouslySetInnerHTML={{
                            __html: showHeader
                              ? resolvePreviewZoneHtml(previewSnapshot.headerHtml, pageIndex)
                              : '',
                          }}
                        />
                        <div
                          className="template-preview-content"
                          style={{
                            minHeight: 0,
                            flex: 1,
                            overflow: 'hidden',
                            paddingLeft: `${marginLeft}px`,
                            paddingRight: `${marginRight}px`,
                            boxSizing: 'border-box',
                          }}
                          dangerouslySetInnerHTML={{ __html: pageHtml }}
                        />
                        <div
                          className="template-preview-zone"
                          style={{
                            height: `${marginBottom}px`,
                            minHeight: `${marginBottom}px`,
                            padding: `4px ${marginRight}px 4px ${marginLeft}px`,
                            display: 'flex',
                            alignItems: 'flex-start',
                            flexShrink: 0,
                            boxSizing: 'border-box',
                          }}
                          dangerouslySetInnerHTML={{
                            __html: showFooter
                              ? resolvePreviewZoneHtml(previewSnapshot.footerHtml, pageIndex)
                              : '',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
          {/* Footer */}
          <div className="shrink-0 flex min-h-12 items-center justify-between gap-4 border-t border-gray-200 bg-white px-6 py-2">
            <span className="text-xs text-gray-400">
              Tamaño: {infoData.hojaTamano || 'Carta (Letter)'} · Orientación:{' '}
              {infoData.hojaOrientacion === 'horizontal' ? 'Horizontal' : 'Vertical'}
            </span>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <button
                type="button"
                onClick={() => setPreviewZoom((value) => Math.max(25, value - 10))}
                disabled={previewZoom <= 25}
                title="Reducir zoom"
                aria-label="Reducir zoom de vista previa"
                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Minus size={14} />
              </button>
              <input
                type="range"
                min={25}
                max={200}
                step={5}
                value={previewZoom}
                onChange={(event) => setPreviewZoom(Number(event.target.value))}
                aria-label="Zoom de vista previa"
                className="h-1 w-24 cursor-pointer accent-blue-600"
              />
              <button
                type="button"
                onClick={() => setPreviewZoom((value) => Math.min(200, value + 10))}
                disabled={previewZoom >= 200}
                title="Aumentar zoom"
                aria-label="Aumentar zoom de vista previa"
                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={14} />
              </button>
              <span className="w-10 text-center font-medium text-slate-600">{previewZoom}%</span>
              <button
                type="button"
                onClick={() => setPreviewZoom(100)}
                className="rounded-md px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                Restablecer
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <button
                type="button"
                onClick={() => goToPreviewPage(previewPage - 1)}
                disabled={previewPage <= 1}
                title="Página anterior"
                aria-label="Página anterior"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft size={14} />
              </button>
              <label className="flex items-center gap-1.5 font-medium text-slate-600">
                <span>Página</span>
                <select
                  aria-label="Seleccionar página de vista previa"
                  value={Math.min(previewPage, previewSnapshot.pages.length)}
                  onChange={(event) => goToPreviewPage(Number(event.target.value))}
                  className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                >
                  {previewSnapshot.pages.map((_, index) => (
                    <option key={index + 1} value={index + 1}>
                      {index + 1}
                    </option>
                  ))}
                </select>
                <span>de {previewSnapshot.pages.length}</span>
              </label>
              <button
                type="button"
                onClick={() => goToPreviewPage(previewPage + 1)}
                disabled={previewPage >= previewSnapshot.pages.length}
                title="Página siguiente"
                aria-label="Página siguiente"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight size={14} />
              </button>
            </div>
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
          createsNewVersion={isExistingPublishedTemplate}
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
              backgroundColor:
                toast.type === 'success'
                  ? '#ECFDF5'
                  : toast.type === 'error'
                    ? '#FEF2F2'
                    : '#EFF6FF',
              color:
                toast.type === 'success'
                  ? '#065F46'
                  : toast.type === 'error'
                    ? '#991B1B'
                    : '#1E40AF',
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
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-white">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <NuevaPlantillaPage />
    </Suspense>
  );
}
