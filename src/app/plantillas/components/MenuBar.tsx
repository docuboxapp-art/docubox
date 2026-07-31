'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MenuBarProps {
  onSaveDraft?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function execCmd(cmd: string, value?: string) {
  document.execCommand(cmd, false, value);
}

function insertHtmlAtCursor(html: string) {
  document.execCommand('insertHTML', false, html);
}

// ─── Find & Replace Modal ─────────────────────────────────────────────────────

function FindReplaceModal({ onClose }: { onClose: () => void }) {
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [message, setMessage] = useState('');

  const handleReplace = () => {
    if (!findText) return;
    const pages = document.querySelectorAll('[contenteditable="true"]');
    let count = 0;
    pages.forEach((page) => {
      let html = page.innerHTML;
      const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const matches = html.match(regex);
      if (matches) count += matches.length;
      page.innerHTML = html.replace(regex, replaceText);
    });
    setMessage(count > 0 ? `${count} reemplazo(s) realizado(s)` : 'No se encontraron coincidencias');
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Buscar y reemplazar</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-md">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Buscar</label>
            <input
              type="text"
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="Texto a buscar..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Reemplazar con</label>
            <input
              type="text"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="Texto de reemplazo..."
            />
          </div>
          {message && <p className="text-xs text-blue-600">{message}</p>}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cerrar</button>
          <button type="button" onClick={handleReplace} className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700">Reemplazar todo</button>
        </div>
      </div>
    </div>
  );
}

// ─── Insert Link Modal ────────────────────────────────────────────────────────

function InsertLinkModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');

  const handleInsert = () => {
    if (!url) return;
    if (text) {
      insertHtmlAtCursor(`<a href="${url}" target="_blank">${text}</a>`);
    } else {
      execCmd('createLink', url);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Insertar enlace</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-md">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">URL</label>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus placeholder="https://ejemplo.com"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              onKeyDown={(e) => { if (e.key === 'Enter') handleInsert(); }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Texto (opcional)</label>
            <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Texto del enlace"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
          <button type="button" onClick={handleInsert} className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700">Insertar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Insert Image Modal ───────────────────────────────────────────────────────

function InsertImageModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleInsertUrl = () => {
    if (!url) return;
    insertHtmlAtCursor(`<img src="${url}" alt="Imagen" style="max-width:100%;height:auto;" />`);
    onClose();
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      if (src) insertHtmlAtCursor(`<img src="${src}" alt="Imagen" style="max-width:100%;height:auto;" />`);
      onClose();
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Insertar imagen</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-md">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">URL de imagen</label>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus placeholder="https://..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">o</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>
          <button type="button" onClick={() => fileRef.current?.click()}
            className="w-full py-2 text-xs text-gray-600 border border-dashed border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Subir desde computadora
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
          <button type="button" onClick={handleInsertUrl} disabled={!url} className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">Insertar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Insert Table Modal ───────────────────────────────────────────────────────

function InsertTableModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);

  const handleInsert = () => {
    let html = '<table style="border-collapse:collapse;width:100%;margin:8px 0;">';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) {
        const tag = r === 0 ? 'th' : 'td';
        html += `<${tag} style="border:1px solid #ccc;padding:6px 8px;text-align:left;">&nbsp;</${tag}>`;
      }
      html += '</tr>';
    }
    html += '</table>';
    insertHtmlAtCursor(html);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xs mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Insertar tabla</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-md">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">Filas</label>
              <input type="number" min={1} max={20} value={rows} onChange={(e) => setRows(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">Columnas</label>
              <input type="number" min={1} max={10} value={cols} onChange={(e) => setCols(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
          <button type="button" onClick={handleInsert} className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700">Insertar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Line Spacing Modal ───────────────────────────────────────────────────────

function LineSpacingModal({ onClose }: { onClose: () => void }) {
  const options = [
    { label: 'Simple (1.0)', value: '1' },
    { label: '1.15', value: '1.15' },
    { label: '1.5', value: '1.5' },
    { label: 'Doble (2.0)', value: '2' },
    { label: '2.5', value: '2.5' },
    { label: 'Triple (3.0)', value: '3' },
  ];

  const applySpacing = (value: string) => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const ancestor = range.commonAncestorContainer;
      let block: HTMLElement | null = ancestor instanceof HTMLElement ? ancestor : ancestor.parentElement;
      while (block && !['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'LI'].includes(block.tagName)) {
        block = block.parentElement;
      }
      if (block) block.style.lineHeight = value;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xs mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Interlineado</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-md">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="py-1">
          {options.map((opt) => (
            <button key={opt.value} type="button" onClick={() => applySpacing(opt.value)}
              className="w-full text-left px-5 py-2.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Columns Modal ────────────────────────────────────────────────────────────

function ColumnsModal({ onClose }: { onClose: () => void }) {
  const options = [
    { label: '1 columna', value: 1 },
    { label: '2 columnas', value: 2 },
    { label: '3 columnas', value: 3 },
  ];

  const applyColumns = (cols: number) => {
    const pages = document.querySelectorAll('[contenteditable="true"]');
    pages.forEach((page) => {
      (page as HTMLElement).style.columnCount = String(cols);
      (page as HTMLElement).style.columnGap = cols > 1 ? '24px' : '';
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xs mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Columnas</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-md">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="py-1">
          {options.map((opt) => (
            <button key={opt.value} type="button" onClick={() => applyColumns(opt.value)}
              className="w-full text-left px-5 py-2.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Symbols Modal ────────────────────────────────────────────────────────────

function SymbolsModal({ onClose }: { onClose: () => void }) {
  const symbols = ['©', '®', '™', '°', '±', '×', '÷', '≠', '≤', '≥', '∞', '∑', '√', 'π', 'Ω', 'α', 'β', 'γ', 'δ', 'ε', '→', '←', '↑', '↓', '↔', '⇒', '⇐', '⇔', '•', '◦', '▪', '▫', '★', '☆', '♦', '♠', '♣', '♥', '✓', '✗', '✦', '✧', '€', '£', '¥', '¢', '§', '¶', '†', '‡'];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Insertar símbolo</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-md">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="p-4 grid grid-cols-10 gap-1 max-h-48 overflow-y-auto">
          {symbols.map((sym) => (
            <button key={sym} type="button"
              onClick={() => { insertHtmlAtCursor(sym); onClose(); }}
              className="w-8 h-8 flex items-center justify-center text-base text-gray-700 hover:bg-blue-50 hover:text-blue-700 rounded transition-colors"
              title={sym}
            >
              {sym}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Paragraph Styles Modal ───────────────────────────────────────────────────

function ParagraphStylesModal({ onClose }: { onClose: () => void }) {
  const styles = [
    { label: 'Texto normal', cmd: 'p' },
    { label: 'Título 1', cmd: 'h1' },
    { label: 'Título 2', cmd: 'h2' },
    { label: 'Título 3', cmd: 'h3' },
    { label: 'Título 4', cmd: 'h4' },
    { label: 'Subtítulo', cmd: 'h5' },
  ];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xs mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Estilos de párrafo</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-md">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="py-1">
          {styles.map((s) => (
            <button key={s.cmd} type="button"
              onClick={() => { document.execCommand('formatBlock', false, `<${s.cmd}>`); onClose(); }}
              className="w-full text-left px-5 py-2.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Align & Indent Modal ─────────────────────────────────────────────────────

function AlignIndentModal({ onClose }: { onClose: () => void }) {
  const options = [
    { label: 'Alinear a la izquierda', action: () => execCmd('justifyLeft') },
    { label: 'Centrar', action: () => execCmd('justifyCenter') },
    { label: 'Alinear a la derecha', action: () => execCmd('justifyRight') },
    { label: 'Justificar', action: () => execCmd('justifyFull') },
    { label: 'Aumentar sangría', action: () => execCmd('indent') },
    { label: 'Reducir sangría', action: () => execCmd('outdent') },
  ];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xs mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Alinear y aplicar sangría</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-md">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="py-1">
          {options.map((opt) => (
            <button key={opt.label} type="button"
              onClick={() => { opt.action(); onClose(); }}
              className="w-full text-left px-5 py-2.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Bullets Modal ────────────────────────────────────────────────────────────

function BulletsModal({ onClose }: { onClose: () => void }) {
  const options = [
    { label: 'Lista con viñetas', action: () => execCmd('insertUnorderedList') },
    { label: 'Lista numerada', action: () => execCmd('insertOrderedList') },
  ];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xs mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Viñetas y numeración</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-md">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="py-1">
          {options.map((opt) => (
            <button key={opt.label} type="button"
              onClick={() => { opt.action(); onClose(); }}
              className="w-full text-left px-5 py-2.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Header Footer Modal ──────────────────────────────────────────────────────

function HeaderFooterModal({ onClose }: { onClose: () => void }) {
  const [headerText, setHeaderText] = useState('');
  const [footerText, setFooterText] = useState('');

  const apply = () => {
    const pages = document.querySelectorAll('[data-page-id]');
    pages.forEach((page) => {
      const pageEl = page as HTMLElement;
      // Remove existing header/footer
      pageEl.querySelectorAll('[data-header], [data-footer]').forEach((el) => el.remove());
      if (headerText) {
        const header = document.createElement('div');
        header.setAttribute('data-header', 'true');
        header.style.cssText = 'border-bottom:1px solid #e5e7eb;padding:4px 0 8px;margin-bottom:8px;font-size:10pt;color:#6b7280;text-align:center;';
        header.textContent = headerText;
        pageEl.insertBefore(header, pageEl.firstChild);
      }
      if (footerText) {
        const footer = document.createElement('div');
        footer.setAttribute('data-footer', 'true');
        footer.style.cssText = 'border-top:1px solid #e5e7eb;padding:8px 0 4px;margin-top:8px;font-size:10pt;color:#6b7280;text-align:center;';
        footer.textContent = footerText;
        pageEl.appendChild(footer);
      }
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Encabezados y pies de página</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-md">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Encabezado</label>
            <input type="text" value={headerText} onChange={(e) => setHeaderText(e.target.value)} placeholder="Texto del encabezado..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Pie de página</label>
            <input type="text" value={footerText} onChange={(e) => setFooterText(e.target.value)} placeholder="Texto del pie de página..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
          <button type="button" onClick={apply} className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700">Aplicar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Orientation Modal ────────────────────────────────────────────────────────

function OrientationModal({ onClose }: { onClose: () => void }) {
  const options = [
    { label: 'Vertical (Portrait)', value: 'portrait' },
    { label: 'Horizontal (Landscape)', value: 'landscape' },
  ];

  const apply = (value: string) => {
    const pages = document.querySelectorAll('[data-page-id]');
    pages.forEach((page) => {
      const pageEl = page as HTMLElement;
      if (value === 'landscape') {
        pageEl.style.width = '1122px';
        pageEl.style.minHeight = '793px';
      } else {
        pageEl.style.width = '816px';
        pageEl.style.minHeight = '1056px';
      }
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xs mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Orientación de la página</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-md">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="py-1">
          {options.map((opt) => (
            <button key={opt.value} type="button" onClick={() => apply(opt.value)}
              className="w-full text-left px-5 py-2.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Text Size Submenu ────────────────────────────────────────────────────────

const TEXT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48', '60', '72'];

// ─── Capitalization Submenu ───────────────────────────────────────────────────

function applyCapitalization(type: 'upper' | 'lower' | 'title') {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const text = range.toString();
  if (!text) return;
  let result = text;
  if (type === 'upper') result = text.toUpperCase();
  else if (type === 'lower') result = text.toLowerCase();
  else if (type === 'title') result = text.replace(/\b\w/g, (c) => c.toUpperCase());
  range.deleteContents();
  range.insertNode(document.createTextNode(result));
}

// ─── Menu Item Component ──────────────────────────────────────────────────────

interface MenuItemDef {
  label: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
  submenu?: MenuItemDef[];
}

function MenuItem({
  item,
  onClose,
  depth = 0,
}: {
  item: MenuItemDef;
  onClose: () => void;
  depth?: number;
}) {
  const [showSub, setShowSub] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  if (item.separator) {
    return <div className="my-1 border-t border-gray-100" />;
  }

  const handleClick = () => {
    if (item.submenu) return;
    if (item.action) item.action();
    onClose();
  };

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => item.submenu && setShowSub(true)}
      onMouseLeave={() => item.submenu && setShowSub(false)}
    >
      <button
        type="button"
        onClick={handleClick}
        disabled={item.disabled}
        className={`w-full flex items-center justify-between px-4 py-1.5 text-sm transition-colors ${
          item.disabled ? 'text-gray-300 cursor-default' : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
        }`}
      >
        <span>{item.label}</span>
        <div className="flex items-center gap-2 ml-8">
          {item.shortcut && <span className="text-xs text-gray-400">{item.shortcut}</span>}
          {item.submenu && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
      </button>
      {item.submenu && showSub && (
        <div
          className="absolute left-full top-0 bg-white border border-gray-200 rounded-lg shadow-xl py-1 z-[300] min-w-[180px]"
          style={{ marginLeft: '2px' }}
        >
          {item.submenu.map((sub, i) => (
            <MenuItem key={i} item={sub} onClose={onClose} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Menu Dropdown ────────────────────────────────────────────────────────────

function MenuDropdown({
  label,
  items,
  isOpen,
  onToggle,
  onClose,
}: {
  label: string;
  items: MenuItemDef[];
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={`px-3 py-1 text-sm rounded transition-colors ${
          isOpen ? 'bg-blue-100 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        {label}
      </button>
      {isOpen && (
        <div className="absolute left-0 top-full mt-0.5 bg-white border border-gray-200 rounded-lg shadow-xl py-1 z-[150] min-w-[220px]">
          {items.map((item, i) => (
            <MenuItem key={i} item={item} onClose={onClose} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main MenuBar Component ───────────────────────────────────────────────────

export function MenuBar({ onSaveDraft }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [modal, setModal] = useState<string | null>(null);

  const closeMenu = useCallback(() => setOpenMenu(null), []);
  const openModal = useCallback((name: string) => { setModal(name); closeMenu(); }, [closeMenu]);

  const toggleMenu = (name: string) => {
    setOpenMenu((prev) => (prev === name ? null : name));
  };

  // ── Editar menu ──────────────────────────────────────────────────────────
  const editarItems: MenuItemDef[] = [
    {
      label: 'Deshacer',
      shortcut: 'Ctrl+Z',
      action: () => execCmd('undo'),
    },
    {
      label: 'Rehacer',
      shortcut: 'Ctrl+Y',
      action: () => execCmd('redo'),
    },
    { separator: true },
    {
      label: 'Cortar',
      shortcut: 'Ctrl+X',
      action: () => execCmd('cut'),
    },
    {
      label: 'Copiar',
      shortcut: 'Ctrl+C',
      action: () => execCmd('copy'),
    },
    {
      label: 'Pegar',
      shortcut: 'Ctrl+V',
      action: () => execCmd('paste'),
    },
    {
      label: 'Pegar sin formato',
      shortcut: 'Ctrl+Mayús+V',
      action: () => {
        navigator.clipboard.readText().then((text) => {
          insertHtmlAtCursor(text.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
        }).catch(() => execCmd('paste'));
      },
    },
    { separator: true },
    {
      label: 'Seleccionar todo',
      shortcut: 'Ctrl+A',
      action: () => execCmd('selectAll'),
    },
    {
      label: 'Eliminar',
      action: () => execCmd('delete'),
    },
    { separator: true },
    {
      label: 'Buscar y reemplazar',
      shortcut: 'Ctrl+H',
      action: () => openModal('findReplace'),
    },
  ];

  // ── Insertar menu ────────────────────────────────────────────────────────
  const insertarItems: MenuItemDef[] = [
    {
      label: 'Imagen',
      action: () => openModal('image'),
    },
    {
      label: 'Tabla',
      action: () => openModal('table'),
    },
    {
      label: 'Elementos de creación',
      submenu: [
        { label: 'Cuadro de texto', action: () => insertHtmlAtCursor('<div style="border:1px solid #ccc;padding:8px;min-height:40px;display:inline-block;min-width:100px;">Cuadro de texto</div>') },
        { label: 'Forma rectangular', action: () => insertHtmlAtCursor('<div style="border:2px solid #3B82F6;padding:8px;display:inline-block;min-width:80px;min-height:40px;"></div>') },
      ],
    },
    {
      label: 'Chips inteligentes',
      submenu: [
        { label: 'Fecha actual', action: () => insertHtmlAtCursor(`<span style="background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;border-radius:4px;padding:1px 7px;font-size:inherit;">{{Fecha}}</span>`) },
        { label: 'Nombre del firmante', action: () => insertHtmlAtCursor(`<span style="background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;border-radius:4px;padding:1px 7px;font-size:inherit;">{{Nombre}}</span>`) },
        { label: 'Número de folio', action: () => insertHtmlAtCursor(`<span style="background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;border-radius:4px;padding:1px 7px;font-size:inherit;">{{Folio}}</span>`) },
      ],
    },
    {
      label: 'Enlace',
      shortcut: 'Ctrl+K',
      action: () => openModal('link'),
    },
    {
      label: 'Dibujo',
      submenu: [
        { label: 'Línea', action: () => insertHtmlAtCursor('<hr style="border:none;border-top:2px solid #374151;margin:8px 0;" />') },
        { label: 'Flecha', action: () => insertHtmlAtCursor('<span style="font-size:1.5em;">→</span>') },
      ],
    },
    {
      label: 'Símbolos',
      action: () => openModal('symbols'),
    },
    { separator: true },
    {
      label: 'Tabulador',
      shortcut: 'Mayús+F11',
      action: () => insertHtmlAtCursor('&emsp;'),
    },
    {
      label: 'Línea horizontal',
      action: () => insertHtmlAtCursor('<hr style="border:none;border-top:1px solid #ccc;margin:8px 0;" />'),
    },
    {
      label: 'Saltos',
      submenu: [
        { label: 'Salto de página', action: () => insertHtmlAtCursor('<div style="page-break-after:always;border-top:1px dashed #ccc;margin:16px 0;"></div>') },
        { label: 'Salto de línea', action: () => insertHtmlAtCursor('<br />') },
        { label: 'Salto de sección', action: () => insertHtmlAtCursor('<hr style="border:none;border-top:2px dashed #9CA3AF;margin:16px 0;" />') },
      ],
    },
    {
      label: 'Marcador',
      action: () => {
        const id = `marcador-${Date.now()}`;
        insertHtmlAtCursor(`<a id="${id}" name="${id}" style="color:#3B82F6;font-size:0.8em;" title="Marcador">🔖</a>`);
      },
    },
  ];

  // ── Formato menu ─────────────────────────────────────────────────────────
  const formatoItems: MenuItemDef[] = [
    {
      label: 'Texto',
      submenu: [
        { label: 'Negrita', shortcut: 'Ctrl+B', action: () => execCmd('bold') },
        { label: 'Cursiva', shortcut: 'Ctrl+I', action: () => execCmd('italic') },
        { label: 'Subrayar', shortcut: 'Ctrl+U', action: () => execCmd('underline') },
        { label: 'Tachar', shortcut: 'Alt+Mayús+5', action: () => execCmd('strikeThrough') },
        { label: 'Versalita', action: () => {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            const span = document.createElement('span');
            span.style.fontVariant = 'small-caps';
            range.surroundContents(span);
          }
        }},
        { label: 'Superíndice', shortcut: 'Ctrl+.', action: () => execCmd('superscript') },
        { label: 'Subíndice', shortcut: 'Ctrl+,', action: () => execCmd('subscript') },
        { separator: true },
        {
          label: 'Tamaño',
          submenu: TEXT_SIZES.map((s) => ({
            label: `${s}pt`,
            action: () => {
              document.execCommand('fontSize', false, '7');
              const spans = document.querySelectorAll('font[size="7"]');
              spans.forEach((span) => {
                const el = span as HTMLElement;
                el.removeAttribute('size');
                el.style.fontSize = `${s}pt`;
              });
            },
          })),
        },
        {
          label: 'Mayúsculas',
          submenu: [
            { label: 'MAYÚSCULAS', action: () => applyCapitalization('upper') },
            { label: 'minúsculas', action: () => applyCapitalization('lower') },
            { label: 'Tipo Título', action: () => applyCapitalization('title') },
          ],
        },
      ],
    },
    {
      label: 'Estilos de párrafo',
      action: () => openModal('paragraphStyles'),
    },
    {
      label: 'Alinear y aplicar sangría',
      action: () => openModal('alignIndent'),
    },
    {
      label: 'Interlineado',
      action: () => openModal('lineSpacing'),
    },
    {
      label: 'Columnas',
      action: () => openModal('columns'),
    },
    {
      label: 'Viñetas',
      action: () => openModal('bullets'),
    },
    { separator: true },
    {
      label: 'Encabezados y pies de página',
      action: () => openModal('headerFooter'),
    },
    {
      label: 'Orientación',
      action: () => openModal('orientation'),
    },
    { separator: true },
    {
      label: 'Borrar formato',
      shortcut: 'Ctrl+\\',
      action: () => execCmd('removeFormat'),
    },
  ];

  return (
    <>
      {/* Menu bar */}
      <div className="flex items-center gap-0.5 px-2 py-0.5 bg-white border-b border-gray-200 select-none">
        <MenuDropdown
          label="Editar"
          items={editarItems}
          isOpen={openMenu === 'editar'}
          onToggle={() => toggleMenu('editar')}
          onClose={closeMenu}
        />
        <MenuDropdown
          label="Insertar"
          items={insertarItems}
          isOpen={openMenu === 'insertar'}
          onToggle={() => toggleMenu('insertar')}
          onClose={closeMenu}
        />
        <MenuDropdown
          label="Formato"
          items={formatoItems}
          isOpen={openMenu === 'formato'}
          onToggle={() => toggleMenu('formato')}
          onClose={closeMenu}
        />
      </div>

      {/* Modals */}
      {modal === 'findReplace' && <FindReplaceModal onClose={() => setModal(null)} />}
      {modal === 'image' && <InsertImageModal onClose={() => setModal(null)} />}
      {modal === 'table' && <InsertTableModal onClose={() => setModal(null)} />}
      {modal === 'link' && <InsertLinkModal onClose={() => setModal(null)} />}
      {modal === 'symbols' && <SymbolsModal onClose={() => setModal(null)} />}
      {modal === 'paragraphStyles' && <ParagraphStylesModal onClose={() => setModal(null)} />}
      {modal === 'alignIndent' && <AlignIndentModal onClose={() => setModal(null)} />}
      {modal === 'lineSpacing' && <LineSpacingModal onClose={() => setModal(null)} />}
      {modal === 'columns' && <ColumnsModal onClose={() => setModal(null)} />}
      {modal === 'bullets' && <BulletsModal onClose={() => setModal(null)} />}
      {modal === 'headerFooter' && <HeaderFooterModal onClose={() => setModal(null)} />}
      {modal === 'orientation' && <OrientationModal onClose={() => setModal(null)} />}
    </>
  );
}
