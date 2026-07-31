'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Editor } from '@tiptap/core';
import { Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight, AlignJustify, List, ListOrdered, Minus, Image, Table, Undo, Redo, Link, Indent, Outdent, Highlighter, ChevronDown, Hash, Layout,  } from 'lucide-react';
import { VariableField } from '../hooks/useTemplateBuilder';

const FONTS = [
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

const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48', '60', '72'];

const PARAGRAPH_STYLES = [
  { label: 'Texto normal', value: 'paragraph' },
  { label: 'Título 1', value: 'heading1' },
  { label: 'Título 2', value: 'heading2' },
  { label: 'Título 3', value: 'heading3' },
  { label: 'Título 4', value: 'heading4' },
];

interface EditorToolbarProps {
  editor: Editor | null;
  onInsertField: (editor: Editor, type: VariableField['fieldType'], label: string) => void;
}

function ToolbarButton({
  onClick, active, title, children, disabled,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded transition-colors text-sm flex-shrink-0 ${
        active
          ? 'bg-blue-100 text-blue-700' :'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0" />;
}

// ─── Floating Dropdown wrapper ─────────────────────────────────────────────────
function FloatingDropdown({
  open,
  onClose,
  children,
  align = 'left',
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className={`fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] min-w-[200px]`}
      style={{ top: 'var(--dropdown-top)', left: align === 'left' ? 'var(--dropdown-left)' : undefined, right: align === 'right' ? 'var(--dropdown-right)' : undefined }}
    >
      {children}
    </div>
  );
}

// ─── Dropdown trigger button ───────────────────────────────────────────────────
function DropdownTrigger({
  label,
  icon,
  onClick,
  active,
  title,
}: {
  label?: string;
  icon?: React.ReactNode;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex items-center gap-0.5 px-1.5 py-1 rounded transition-colors text-xs flex-shrink-0 ${
        active ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      {icon}
      {label && <span className="hidden sm:inline">{label}</span>}
      <ChevronDown size={10} className="opacity-60" />
    </button>
  );
}

// ─── Table Grid Selector ───────────────────────────────────────────────────────
function TableGridSelector({ onSelect }: { onSelect: (rows: number, cols: number) => void }) {
  const [hovered, setHovered] = useState({ rows: 0, cols: 0 });
  const MAX_ROWS = 10;
  const MAX_COLS = 10;

  return (
    <div className="p-3">
      <p className="text-xs font-semibold text-gray-700 mb-2">Elementos de creación</p>
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 18px)` }}
        onMouseLeave={() => setHovered({ rows: 0, cols: 0 })}
      >
        {Array.from({ length: MAX_ROWS }).map((_, r) =>
          Array.from({ length: MAX_COLS }).map((_, c) => (
            <div
              key={`${r}-${c}`}
              onMouseEnter={() => setHovered({ rows: r + 1, cols: c + 1 })}
              onClick={() => onSelect(r + 1, c + 1)}
              className={`w-4 h-4 border cursor-pointer rounded-sm transition-colors ${
                r < hovered.rows && c < hovered.cols
                  ? 'bg-blue-200 border-blue-400' :'bg-gray-50 border-gray-300 hover:bg-blue-100'
              }`}
            />
          ))
        )}
      </div>
      <p className="text-xs text-center text-gray-500 mt-2">
        {hovered.rows > 0 && hovered.cols > 0
          ? `${hovered.rows} × ${hovered.cols}`
          : '1 × 1'}
      </p>
    </div>
  );
}

// ─── Line Spacing Menu ─────────────────────────────────────────────────────────
function LineSpacingMenu({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const spacings = [
    { label: 'Sencillo', value: '1' },
    { label: '1,15', value: '1.15' },
    { label: '1,5', value: '1.5' },
    { label: 'Doble', value: '2' },
  ];

  const applyLineHeight = (value: string) => {
    // Apply line height via CSS style on the paragraph
    editor.chain().focus().updateAttributes('paragraph', { style: `line-height: ${value}` }).run();
    onClose();
  };

  const applySpacingBefore = () => {
    editor.chain().focus().updateAttributes('paragraph', { style: 'margin-top: 12pt' }).run();
    onClose();
  };

  const applySpacingAfter = () => {
    editor.chain().focus().updateAttributes('paragraph', { style: 'margin-bottom: 12pt' }).run();
    onClose();
  };

  const applyPageBreakBefore = () => {
    editor.chain().focus().insertContent('<p style="page-break-before: always;"></p>').run();
    onClose();
  };

  return (
    <div className="py-1 min-w-[160px]">
      {spacings.map((s) => (
        <button
          key={s.value}
          type="button"
          onClick={() => applyLineHeight(s.value)}
          className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
        >
          <span className="w-4 text-blue-600">{s.value === '1.15' ? '✓' : ''}</span>
          {s.label}
        </button>
      ))}
    </div>
  );
}

// ─── Header/Footer Section ─────────────────────────────────────────────────────
interface HeaderFooterState {
  headerEnabled: boolean;
  footerEnabled: boolean;
  firstPageDifferent: boolean;
  headerText: string;
  footerText: string;
}

// ─── Page Numbers Modal ────────────────────────────────────────────────────────
function PageNumbersModal({
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
              <input
                type="radio"
                name="position"
                checked={position === 'header'}
                onChange={() => setPosition('header')}
                className="text-blue-600"
              />
              <span className="text-sm text-gray-700">Encabezado</span>
            </label>
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input
                type="radio"
                name="position"
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
              <input type="radio" name="numbering" defaultChecked className="text-blue-600" />
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
              <input type="radio" name="numbering" className="text-blue-600" />
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

// ─── Resizable Image Component ─────────────────────────────────────────────────
// This is injected into the editor via NodeView or HTML — handled via CSS + JS on img elements

export function EditorToolbar({ editor, onInsertField }: EditorToolbarProps) {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [showPageNumbers, setShowPageNumbers] = useState(false);
  const [tableHovered, setTableHovered] = useState({ rows: 0, cols: 0 });
  const [headerFooter, setHeaderFooter] = useState<HeaderFooterState>({
    headerEnabled: false,
    footerEnabled: false,
    firstPageDifferent: false,
    headerText: '',
    footerText: '',
  });
  const [showHeaderOptions, setShowHeaderOptions] = useState(false);
  const [headerOptionsPos, setHeaderOptionsPos] = useState({ top: 0, left: 0 });
  const imageInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Load Google Fonts
  useEffect(() => {
    const linkId = 'google-fonts-editor-toolbar';
    if (document.getElementById(linkId)) return;
    const link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Roboto&family=Open+Sans&family=Lato&family=Montserrat&family=Raleway&family=Nunito&family=Poppins&family=Source+Sans+3&family=Merriweather&family=Playfair+Display&family=Oswald&family=PT+Sans&family=PT+Serif&family=Ubuntu&family=Noto+Sans&family=Libre+Baskerville&family=Crimson+Text&family=EB+Garamond&family=Josefin+Sans&family=Quicksand&family=Mulish&family=Barlow&family=Inter&family=DM+Sans&family=Fira+Sans&family=Cabin&family=Exo+2&family=Titillium+Web&family=Zilla+Slab&family=Spectral&family=Cormorant+Garamond&family=Alegreya&family=Lora&family=Arvo&family=Bitter&family=Karla&family=Rubik&family=Work+Sans&family=Manrope&family=Space+Grotesk&family=Plus+Jakarta+Sans&family=Sora&family=Outfit&family=Figtree&family=Lexend&family=Jost&family=Urbanist&family=Archivo&family=Asap&family=Heebo&family=Hind&family=Varela+Round&family=Comfortaa&family=Pacifico&family=Dancing+Script&family=Caveat&family=Sacramento&family=Great+Vibes&family=Satisfy&family=Kaushan+Script&family=Lobster&family=Righteous&family=Fredoka+One&family=Boogaloo&family=Indie+Flower&family=Patrick+Hand&family=Shadows+Into+Light&family=Amatic+SC&family=Permanent+Marker&family=Rock+Salt&family=Special+Elite&family=Courier+Prime&family=Source+Code+Pro&family=Fira+Code&family=Space+Mono&family=Inconsolata&family=Anonymous+Pro&family=Share+Tech+Mono&display=swap';
    document.head.appendChild(link);
  }, []);

  // Make images in editor resizable
  useEffect(() => {
    if (!editor) return;
    const makeImagesResizable = () => {
      const editorEl = editor.view.dom as HTMLElement;
      const imgs = editorEl.querySelectorAll('img:not([data-resizable])');
      imgs.forEach((img) => {
        const imgEl = img as HTMLImageElement;
        imgEl.setAttribute('data-resizable', 'true');
        imgEl.style.cursor = 'pointer';
        imgEl.style.maxWidth = '100%';
        imgEl.style.display = 'inline-block';
        imgEl.style.position = 'relative';

        // Add resize handles via wrapper
        const wrapper = document.createElement('span');
        wrapper.style.display = 'inline-block';
        wrapper.style.position = 'relative';
        wrapper.style.lineHeight = '0';
        wrapper.style.userSelect = 'none';
        imgEl.parentNode?.insertBefore(wrapper, imgEl);
        wrapper.appendChild(imgEl);

        // Create 4 corner resize handles
        const corners = [
          { pos: 'nw', style: 'top:-4px;left:-4px;cursor:nw-resize;' },
          { pos: 'ne', style: 'top:-4px;right:-4px;cursor:ne-resize;' },
          { pos: 'sw', style: 'bottom:-4px;left:-4px;cursor:sw-resize;' },
          { pos: 'se', style: 'bottom:-4px;right:-4px;cursor:se-resize;' },
        ];

        corners.forEach(({ pos, style }) => {
          const handle = document.createElement('span');
          handle.style.cssText = `
            position: absolute; ${style}
            width: 10px; height: 10px;
            background: #3B82F6; border: 1px solid white; border-radius: 2px;
            z-index: 10;
            opacity: 0; transition: opacity 0.15s;
          `;
          wrapper.appendChild(handle);

          wrapper.addEventListener('mouseenter', () => {
            wrapper.querySelectorAll('span').forEach((h) => { h.style.opacity = '1'; });
            imgEl.style.outline = '2px solid #3B82F6';
          });
          wrapper.addEventListener('mouseleave', () => {
            wrapper.querySelectorAll('span').forEach((h) => { h.style.opacity = '0'; });
            imgEl.style.outline = '';
          });

          let startX = 0, startY = 0, startW = 0, startH = 0;

          handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            startX = e.clientX;
            startY = e.clientY;
            startW = imgEl.offsetWidth || imgEl.naturalWidth || 200;
            startH = imgEl.offsetHeight || imgEl.naturalHeight || 150;
            const ratio = startH > 0 && startW > 0 ? startH / startW : 1;

            const onMove = (me: MouseEvent) => {
              me.preventDefault();
              let dw = me.clientX - startX;
              if (pos === 'nw' || pos === 'sw') dw = -dw;
              const newW = Math.max(30, startW + dw);
              imgEl.style.width = `${newW}px`;
              imgEl.style.height = `${Math.round(newW * ratio)}px`;
            };

            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          });
        });
      });
    };

    editor.on('update', makeImagesResizable);
    return () => { editor.off('update', makeImagesResizable); };
  }, [editor]);

  const openMenu = useCallback((name: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    setOpenDropdown((prev) => (prev === name ? null : name));
  }, []);

  const closeMenu = useCallback(() => setOpenDropdown(null), []);

  if (!editor) return null;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      if (src) {
        editor.chain().focus().setImage({ src }).run();
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleInsertTable = (rows: number, cols: number) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    closeMenu();
  };

  const handleInsertLink = () => {
    if (linkUrl) {
      editor.chain().focus().setLink({ href: linkUrl }).run();
    }
    setShowLinkModal(false);
    setLinkUrl('');
  };

  const handleApplyPageNumbers = (opts: { position: 'header' | 'footer'; showOnFirst: boolean; startFrom: number }) => {
    // Store page number config in editor storage or as a data attribute
    const editorEl = editor.view.dom as HTMLElement;
    const container = editorEl.closest('[data-page-content]') || editorEl.parentElement;
    if (container) {
      container.setAttribute('data-page-numbers', JSON.stringify(opts));
    }
    // Insert page number placeholder at cursor
    const posStyle = opts.position === 'header' ? 'margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px;' : 'margin-top: 8px; border-top: 1px solid #e5e7eb; padding-top: 4px;';
    editor.chain().focus().insertContent(
      `<p style="text-align:center; color:#6b7280; font-size:11px; ${posStyle}" data-page-number="true">— 1 —</p>`
    ).run();
    setShowPageNumbers(false);
  };

  const applyHeaderFooter = () => {
    const editorEl = editor.view.dom as HTMLElement;
    // Remove existing header/footer
    editorEl.querySelectorAll('[data-header-zone]').forEach((el) => el.remove());
    editorEl.querySelectorAll('[data-footer-zone]').forEach((el) => el.remove());

    if (headerFooter.headerEnabled) {
      const headerDiv = document.createElement('div');
      headerDiv.setAttribute('data-header-zone', 'true');
      headerDiv.contentEditable = 'true';
      headerDiv.style.cssText = 'border-bottom: 1px solid #e5e7eb; padding: 6px 0 8px; margin-bottom: 12px; font-size: 11px; color: #374151; min-height: 28px; outline: none;';
      headerDiv.innerHTML = headerFooter.headerText || '<span style="color:#9ca3af">Encabezado</span>';
      editorEl.insertBefore(headerDiv, editorEl.firstChild);
    }

    if (headerFooter.footerEnabled) {
      const footerDiv = document.createElement('div');
      footerDiv.setAttribute('data-footer-zone', 'true');
      footerDiv.contentEditable = 'true';
      footerDiv.style.cssText = 'border-top: 1px solid #e5e7eb; padding: 8px 0 6px; margin-top: 12px; font-size: 11px; color: #374151; min-height: 28px; outline: none;';
      footerDiv.innerHTML = headerFooter.footerText || '<span style="color:#9ca3af">Pie de página</span>';
      editorEl.appendChild(footerDiv);
    }
    closeMenu();
  };

  const currentFontFamily = editor.getAttributes('textStyle').fontFamily || 'Arial';
  const currentFontSize = (editor.getAttributes('textStyle').fontSize as string | undefined)?.replace('pt', '') || '12';

  const getCurrentParagraphStyle = () => {
    if (editor.isActive('heading', { level: 1 })) return 'heading1';
    if (editor.isActive('heading', { level: 2 })) return 'heading2';
    if (editor.isActive('heading', { level: 3 })) return 'heading3';
    if (editor.isActive('heading', { level: 4 })) return 'heading4';
    return 'paragraph';
  };

  const applyParagraphStyle = (value: string) => {
    if (value === 'paragraph') {
      editor.chain().focus().setParagraph().run();
    } else {
      const level = parseInt(value.replace('heading', ''), 10) as 1 | 2 | 3 | 4;
      editor.chain().focus().toggleHeading({ level }).run();
    }
  };

  // CSS vars for dropdown positioning
  const dropdownStyle = {
    '--dropdown-top': `${dropdownPos.top}px`,
    '--dropdown-left': `${dropdownPos.left}px`,
  } as React.CSSProperties;

  return (
    <>
      <div ref={toolbarRef} className="bg-white border-b border-gray-200 px-2 py-1.5 flex items-center flex-wrap gap-0.5 relative z-10">

        {/* Group 1: Undo/Redo */}
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} title="Deshacer (Ctrl+Z)" disabled={!editor.can().undo()}>
          <Undo size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} title="Rehacer (Ctrl+Y)" disabled={!editor.can().redo()}>
          <Redo size={15} />
        </ToolbarButton>

        <Divider />

        {/* Group 2: Paragraph style */}
        <select
          value={getCurrentParagraphStyle()}
          onChange={(e) => applyParagraphStyle(e.target.value)}
          className="text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white flex-shrink-0"
          style={{ minWidth: '110px', maxWidth: '130px' }}
          title="Estilo de párrafo"
        >
          {PARAGRAPH_STYLES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <Divider />

        {/* Group 3: Font family */}
        <select
          value={currentFontFamily}
          onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
          className="text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white flex-shrink-0"
          style={{ minWidth: '120px', maxWidth: '150px', fontFamily: currentFontFamily }}
          title="Familia tipográfica"
        >
          {FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
          ))}
        </select>

        <Divider />

        {/* Group 4: Font size */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            type="button"
            title="Reducir tamaño"
            onClick={() => {
              const cur = parseInt(currentFontSize, 10) || 12;
              const idx = FONT_SIZES.indexOf(String(cur));
              const prev = idx > 0 ? FONT_SIZES[idx - 1] : FONT_SIZES[0];
              editor.chain().focus().setMark('textStyle', { fontSize: `${prev}pt` }).run();
            }}
            className="w-5 h-6 flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded text-sm font-medium"
          >
            −
          </button>
          <select
            value={currentFontSize}
            onChange={(e) => {
              editor.chain().focus().setMark('textStyle', { fontSize: `${e.target.value}pt` }).run();
            }}
            className="text-xs border border-gray-200 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white w-12 text-center"
            title="Tamaño de fuente"
          >
            {FONT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            type="button"
            title="Aumentar tamaño"
            onClick={() => {
              const cur = parseInt(currentFontSize, 10) || 12;
              const idx = FONT_SIZES.indexOf(String(cur));
              const next = idx < FONT_SIZES.length - 1 ? FONT_SIZES[idx + 1] : FONT_SIZES[FONT_SIZES.length - 1];
              editor.chain().focus().setMark('textStyle', { fontSize: `${next}pt` }).run();
            }}
            className="w-5 h-6 flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded text-sm font-medium"
          >
            +
          </button>
        </div>

        <Divider />

        {/* Group 5: Bold, Italic, Underline, Strike */}
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Negrita (Ctrl+B)">
          <Bold size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Cursiva (Ctrl+I)">
          <Italic size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Subrayado (Ctrl+U)">
          <Underline size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Tachado">
          <Strikethrough size={15} />
        </ToolbarButton>

        <Divider />

        {/* Group 6: Text color & highlight */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <label className="flex flex-col items-center cursor-pointer p-1 rounded hover:bg-gray-100 relative" title="Color de texto">
            <span className="text-xs font-bold text-gray-700 leading-none">A</span>
            <div
              className="w-4 h-1 rounded-sm mt-0.5"
              style={{ backgroundColor: editor.getAttributes('textStyle').color || '#000000' }}
            />
            <input
              type="color"
              defaultValue="#000000"
              onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              title="Color de texto"
            />
          </label>
          <label className="flex flex-col items-center cursor-pointer p-1 rounded hover:bg-gray-100 relative" title="Resaltado">
            <Highlighter size={13} className="text-gray-600" />
            <input
              type="color"
              defaultValue="#ffff00"
              onChange={(e) => editor.chain().focus().setHighlight({ color: e.target.value }).run()}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              title="Color de resaltado"
            />
          </label>
        </div>

        <Divider />

        {/* Group 7: Link */}
        <ToolbarButton
          onClick={() => {
            if (editor.isActive('link')) {
              editor.chain().focus().unsetLink().run();
            } else {
              setLinkUrl(editor.getAttributes('link').href || '');
              setShowLinkModal(true);
            }
          }}
          active={editor.isActive('link')}
          title="Insertar enlace"
        >
          <Link size={15} />
        </ToolbarButton>

        {/* Image */}
        <ToolbarButton onClick={() => imageInputRef.current?.click()} title="Insertar imagen">
          <Image size={15} />
        </ToolbarButton>
        <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

        <Divider />

        {/* Group 8: Alignment */}
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Alinear izquierda">
          <AlignLeft size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Centrar">
          <AlignCenter size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Alinear derecha">
          <AlignRight size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justificar">
          <AlignJustify size={15} />
        </ToolbarButton>

        <Divider />

        {/* Group 9: Line spacing dropdown */}
        <DropdownTrigger
          icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/><path d="M8 3l-4 3 4 3"/><path d="M8 15l-4 3 4 3"/></svg>}
          onClick={(e) => openMenu('lineSpacing', e)}
          active={openDropdown === 'lineSpacing'}
          title="Interlineado"
        />

        <Divider />

        {/* Group 10: Lists */}
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Lista con viñetas">
          <List size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Lista numerada">
          <ListOrdered size={15} />
        </ToolbarButton>

        <Divider />

        {/* Group 11: Indent */}
        <ToolbarButton
          onClick={() => {
            if (editor.isActive('listItem')) {
              editor.chain().focus().sinkListItem('listItem').run();
            } else {
              editor.chain().focus().updateAttributes('paragraph', { style: 'padding-left: 2em' }).run();
            }
          }}
          title="Aumentar sangría"
        >
          <Indent size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => {
            if (editor.isActive('listItem')) {
              editor.chain().focus().liftListItem('listItem').run();
            } else {
              editor.chain().focus().updateAttributes('paragraph', { style: '' }).run();
            }
          }}
          title="Reducir sangría"
        >
          <Outdent size={15} />
        </ToolbarButton>

        <Divider />

        {/* Group 12: Table with grid selector */}
        <DropdownTrigger
          icon={<Table size={15} />}
          onClick={(e) => openMenu('table', e)}
          active={openDropdown === 'table'}
          title="Insertar tabla"
        />

        <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Separador horizontal">
          <Minus size={15} />
        </ToolbarButton>

        <Divider />

        {/* Group 13: Header/Footer */}
        <DropdownTrigger
          icon={<Layout size={15} />}
          onClick={(e) => openMenu('headerFooter', e)}
          active={openDropdown === 'headerFooter'}
          title="Encabezado y pie de página"
        />

        {/* Group 14: Page Numbers */}
        <ToolbarButton onClick={() => setShowPageNumbers(true)} title="Números de página">
          <Hash size={15} />
        </ToolbarButton>
      </div>

      {/* ─── Floating Dropdowns ─────────────────────────────────────────────── */}

      {/* Line Spacing Dropdown */}
      {openDropdown === 'lineSpacing' && (
        <div
          className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999]"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <LineSpacingMenu editor={editor} onClose={closeMenu} />
        </div>
      )}

      {/* Table Grid Dropdown */}
      {openDropdown === 'table' && (
        <div
          className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999]"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <TableGridSelector onSelect={handleInsertTable} />
        </div>
      )}

      {/* Header/Footer Dropdown */}
      {openDropdown === 'headerFooter' && (
        <div
          className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] w-72"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <div className="p-4">
            <p className="text-xs font-semibold text-gray-800 mb-3">Encabezado y pie de página</p>

            {/* Header */}
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1.5">
                <input
                  type="checkbox"
                  id="hf-header"
                  checked={headerFooter.headerEnabled}
                  onChange={(e) => setHeaderFooter((s) => ({ ...s, headerEnabled: e.target.checked }))}
                  className="rounded"
                />
                <label htmlFor="hf-header" className="text-xs font-medium text-gray-700">Mostrar encabezado</label>
              </div>
              {headerFooter.headerEnabled && (
                <input
                  type="text"
                  value={headerFooter.headerText}
                  onChange={(e) => setHeaderFooter((s) => ({ ...s, headerText: e.target.value }))}
                  placeholder="Texto del encabezado..."
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              )}
            </div>

            {/* Footer */}
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1.5">
                <input
                  type="checkbox"
                  id="hf-footer"
                  checked={headerFooter.footerEnabled}
                  onChange={(e) => setHeaderFooter((s) => ({ ...s, footerEnabled: e.target.checked }))}
                  className="rounded"
                />
                <label htmlFor="hf-footer" className="text-xs font-medium text-gray-700">Mostrar pie de página</label>
              </div>
              {headerFooter.footerEnabled && (
                <input
                  type="text"
                  value={headerFooter.footerText}
                  onChange={(e) => setHeaderFooter((s) => ({ ...s, footerText: e.target.value }))}
                  placeholder="Texto del pie de página..."
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              )}
            </div>

            {/* First page different */}
            <div className="flex items-center gap-2 mb-3">
              <input
                type="checkbox"
                id="hf-first"
                checked={headerFooter.firstPageDifferent}
                onChange={(e) => setHeaderFooter((s) => ({ ...s, firstPageDifferent: e.target.checked }))}
                className="rounded"
              />
              <label htmlFor="hf-first" className="text-xs text-gray-600">Primera página diferente</label>
            </div>

            {/* Options submenu */}
            <div className="border-t border-gray-100 pt-2 mb-3">
              <p className="text-xs font-medium text-gray-500 mb-1">Opciones</p>
              <button
                type="button"
                onClick={() => { closeMenu(); }}
                className="w-full text-left text-xs px-2 py-1.5 text-gray-700 hover:bg-gray-50 rounded"
              >
                Formato de encabezado
              </button>
              <button
                type="button"
                onClick={() => { closeMenu(); setShowPageNumbers(true); }}
                className="w-full text-left text-xs px-2 py-1.5 text-gray-700 hover:bg-gray-50 rounded"
              >
                Números de página
              </button>
              <button
                type="button"
                onClick={() => {
                  setHeaderFooter((s) => ({ ...s, headerEnabled: false, footerEnabled: false }));
                  const editorEl = editor.view.dom as HTMLElement;
                  editorEl.querySelectorAll('[data-header-zone]').forEach((el) => el.remove());
                  editorEl.querySelectorAll('[data-footer-zone]').forEach((el) => el.remove());
                  closeMenu();
                }}
                className="w-full text-left text-xs px-2 py-1.5 text-red-600 hover:bg-red-50 rounded"
              >
                Quitar encabezado
              </button>
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={applyHeaderFooter} className="flex-1 text-xs bg-blue-600 text-white rounded-md py-1.5 hover:bg-blue-700 font-medium">Aplicar</button>
              <button type="button" onClick={closeMenu} className="flex-1 text-xs bg-gray-100 text-gray-700 rounded-md py-1.5 hover:bg-gray-200">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Link Modal */}
      {showLinkModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30">
          <div className="bg-white border border-gray-200 rounded-xl shadow-2xl p-4 w-72">
            <p className="text-xs font-semibold text-gray-700 mb-2">Insertar enlace</p>
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://ejemplo.com"
              className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 mb-2"
              onKeyDown={(e) => { if (e.key === 'Enter') handleInsertLink(); }}
              autoFocus
            />
            <div className="flex gap-2">
              <button type="button" onClick={handleInsertLink} className="flex-1 text-xs bg-blue-600 text-white rounded-md py-1.5 hover:bg-blue-700 font-medium">Insertar</button>
              <button type="button" onClick={() => setShowLinkModal(false)} className="flex-1 text-xs bg-gray-100 text-gray-700 rounded-md py-1.5 hover:bg-gray-200">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Page Numbers Modal */}
      {showPageNumbers && (
        <PageNumbersModal
          onApply={handleApplyPageNumbers}
          onClose={() => setShowPageNumbers(false)}
        />
      )}
    </>
  );
}
