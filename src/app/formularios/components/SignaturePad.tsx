'use client';

import React, { useEffect, useRef, useState } from 'react';
import SignaturePadLib from 'signature_pad';
import { Trash2, RotateCcw, Minus, Plus } from 'lucide-react';

interface SignaturePadProps {
  onChange: (dataUrl: string | null) => void;
  value?: string | null;
}

export default function SignaturePad({ onChange, value }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const [penWidth, setPenWidth] = useState(2);
  const [penColor, setPenColor] = useState('#000000');
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(ratio, ratio);

    padRef.current = new SignaturePadLib(canvas, {
      minWidth: penWidth * 0.5,
      maxWidth: penWidth * 2,
      penColor,
    });

    padRef.current.addEventListener('endStroke', () => {
      if (padRef.current && !padRef.current.isEmpty()) {
        setIsEmpty(false);
        onChange(padRef.current.toDataURL('image/png'));
      }
    });

    if (value) {
      padRef.current.fromDataURL(value);
      setIsEmpty(false);
    }

    return () => {
      padRef.current?.off();
    };
  }, []);

  // Update pen settings
  useEffect(() => {
    if (!padRef.current) return;
    padRef.current.minWidth = penWidth * 0.5;
    padRef.current.maxWidth = penWidth * 2;
    padRef.current.penColor = penColor;
  }, [penWidth, penColor]);

  const handleClear = () => {
    padRef.current?.clear();
    setIsEmpty(true);
    onChange(null);
  };

  const handleUndo = () => {
    if (!padRef.current) return;
    const data = padRef.current.toData();
    if (data && data.length > 0) {
      data.pop();
      padRef.current.fromData(data);
      if (padRef.current.isEmpty()) {
        setIsEmpty(true);
        onChange(null);
      } else {
        onChange(padRef.current.toDataURL('image/png'));
      }
    }
  };

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPenWidth((w) => Math.max(1, w - 1))}
            className="p-1 rounded border border-border hover:bg-muted transition-colors"
          >
            <Minus size={12} />
          </button>
          <span className="text-xs text-muted-foreground w-8 text-center">{penWidth}px</span>
          <button
            type="button"
            onClick={() => setPenWidth((w) => Math.min(8, w + 1))}
            className="p-1 rounded border border-border hover:bg-muted transition-colors"
          >
            <Plus size={12} />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPenColor('#000000')}
            className={`w-5 h-5 rounded-full bg-black border-2 transition-all ${penColor === '#000000' ? 'border-primary scale-110' : 'border-transparent'}`}
          />
          <button
            type="button"
            onClick={() => setPenColor('#1a56db')}
            className={`w-5 h-5 rounded-full bg-blue-600 border-2 transition-all ${penColor === '#1a56db' ? 'border-primary scale-110' : 'border-transparent'}`}
          />
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            onClick={handleUndo}
            disabled={isEmpty}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-muted disabled:opacity-40 transition-colors"
          >
            <RotateCcw size={11} /> Deshacer
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={isEmpty}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-muted disabled:opacity-40 transition-colors text-destructive"
          >
            <Trash2 size={11} /> Limpiar
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative border-2 border-dashed border-border rounded-xl bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full touch-none"
          style={{ height: 140 }}
        />
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-muted-foreground">Firma aquí</p>
          </div>
        )}
      </div>
    </div>
  );
}
