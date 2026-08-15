'use client';

import React, { useRef } from 'react';
import { X, Printer } from 'lucide-react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextAlign } from '@tiptap/extension-text-align';
import { FontFamily } from '@tiptap/extension-font-family';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { Underline } from '@tiptap/extension-underline';
import { Image } from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { VariableFieldNode } from '../extensions/VariableFieldNode';

interface PreviewModalProps {
  content: Record<string, unknown>;
  templateName: string;
  onClose: () => void;
}

export function PreviewModal({ content, templateName, onClose }: PreviewModalProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const previewEditor = useEditor({
    extensions: [
      StarterKit.configure({ horizontalRule: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      FontFamily,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Underline,
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      HorizontalRule,
      VariableFieldNode,
    ],
    content,
    editable: false,
  });

  const handlePrint = () => {
    const printContent = printRef.current?.innerHTML || '';
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${templateName}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              background: white;
              font-family: Arial, sans-serif;
              font-size: 12px;
              color: #111;
            }
            .page {
              width: 816px;
              min-height: 1056px;
              padding: 96px 80px;
              margin: 0 auto;
              page-break-after: always;
            }
            table { border-collapse: collapse; width: 100%; }
            td, th { border: 1px solid #d1d5db; padding: 6px 10px; }
            hr { border: none; border-top: 2px solid #e5e7eb; margin: 16px 0; }
            ul { list-style-type: disc; padding-left: 1.5em; }
            ol { list-style-type: decimal; padding-left: 1.5em; }
            h1 { font-size: 28px; font-weight: 700; margin: 16px 0 8px; }
            h2 { font-size: 22px; font-weight: 600; margin: 14px 0 8px; }
            h3 { font-size: 18px; font-weight: 600; margin: 12px 0 6px; }
            p { margin: 0 0 8px; line-height: 1.5; }
            @media print {
              body { margin: 0; }
              .page { page-break-after: always; }
            }
          </style>
        </head>
        <body>
          <div class="page">${printContent}</div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 300);
  };

  return (
    <>
      <style>{`
        .preview-page-sheet {
          width: 816px;
          min-height: 1056px;
          background: white;
          padding: 96px 80px;
          margin: 0 auto 32px auto;
          box-shadow: 0 4px 24px rgba(0,0,0,0.13), 0 1px 4px rgba(0,0,0,0.07);
          border-radius: 2px;
          position: relative;
          font-family: Arial, sans-serif;
          font-size: 12px;
          color: #111;
          line-height: 1.5;
        }
        .preview-page-sheet .ProseMirror {
          outline: none;
          min-height: 864px;
        }
        .preview-page-sheet .ProseMirror table {
          border-collapse: collapse;
          width: 100%;
        }
        .preview-page-sheet .ProseMirror td,
        .preview-page-sheet .ProseMirror th {
          border: 1px solid #d1d5db;
          padding: 6px 10px;
        }
        .preview-page-sheet .ProseMirror hr {
          border: none;
          border-top: 2px solid #e5e7eb;
          margin: 16px 0;
        }
        .preview-page-sheet .ProseMirror ul {
          list-style-type: disc;
          padding-left: 1.5em;
        }
        .preview-page-sheet .ProseMirror ol {
          list-style-type: decimal;
          padding-left: 1.5em;
        }
        .preview-page-sheet .ProseMirror h1 {
          font-size: 28px;
          font-weight: 700;
          line-height: 1.25;
          margin: 16px 0 8px;
        }
        .preview-page-sheet .ProseMirror h2 {
          font-size: 22px;
          font-weight: 600;
          line-height: 1.3;
          margin: 14px 0 8px;
        }
        .preview-page-sheet .ProseMirror h3 {
          font-size: 18px;
          font-weight: 600;
          line-height: 1.35;
          margin: 12px 0 6px;
        }
        .preview-page-sheet .ProseMirror p {
          margin: 0 0 8px;
          line-height: 1.5;
        }
        .preview-page-sheet .ProseMirror img {
          max-width: 100%;
          height: auto;
        }
        /* Page ruler lines at top and bottom */
        .preview-page-sheet::before,
        .preview-page-sheet::after {
          content: '';
          display: block;
          position: absolute;
          left: 0;
          right: 0;
          height: 1px;
          background: rgba(0,0,0,0.06);
        }
        .preview-page-sheet::before { top: 96px; }
        .preview-page-sheet::after { bottom: 96px; }
      `}</style>

      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[95vh] flex flex-col overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1E6BFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Vista Previa</h2>
                <p className="text-xs text-gray-400">{templateName}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Print button */}
              <button
                type="button"
                onClick={handlePrint}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
              >
                <Printer size={15} />
                Imprimir
              </button>

              {/* Close button */}
              <button
                type="button"
                onClick={onClose}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                <X size={15} />
                Cerrar
              </button>
            </div>
          </div>

          {/* Document area — scrollable gray background with page sheet */}
          <div className="flex-1 overflow-y-auto bg-gray-200 py-10 px-6">
            <div className="preview-page-sheet" ref={printRef}>
              <EditorContent editor={previewEditor} />
            </div>
          </div>

          {/* Footer bar */}
          <div className="shrink-0 flex items-center justify-between px-6 py-2 border-t border-gray-200 bg-gray-50">
            <span className="text-xs text-gray-400">Formato: Carta (8.5&quot; × 11&quot;) · 816 × 1056 px</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrint}
                className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
              >
                <Printer size={13} />
                Imprimir documento
              </button>
              <span className="text-gray-300">·</span>
              <button
                type="button"
                onClick={onClose}
                className="text-xs text-gray-500 hover:text-gray-700 font-medium transition-colors"
              >
                Cerrar vista previa
              </button>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
