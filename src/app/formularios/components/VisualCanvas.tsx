'use client';

import React, { useRef, useState, useCallback } from 'react';
import { useFormBuilder, FormField } from '@/contexts/FormBuilderContext';
import { Move, CornerRightDown } from 'lucide-react';

const GRID = 8;
const CANVAS_WIDTH = 794;
const CANVAS_HEIGHT = 1122;

function snapToGrid(val: number): number {
  return Math.round(val / GRID) * GRID;
}

interface DragState {
  fieldId: string;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
}

interface ResizeState {
  fieldId: string;
  startX: number;
  startY: number;
  origW: number;
  origH: number;
}

export default function VisualCanvas() {
  const { state, dispatch, selectField } = useFormBuilder();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [resize, setResize] = useState<ResizeState | null>(null);

  const getCanvasOffset = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? { left: rect.left, top: rect.top } : { left: 0, top: 0 };
  };

  const handleFieldMouseDown = useCallback(
    (e: React.MouseEvent, field: FormField) => {
      e.stopPropagation();
      selectField(field.id);
      const offset = getCanvasOffset();
      setDrag({
        fieldId: field.id,
        startX: e.clientX - offset.left,
        startY: e.clientY - offset.top,
        origX: field.x ?? 50,
        origY: field.y ?? 50,
      });
    },
    [selectField]
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, field: FormField) => {
      e.stopPropagation();
      setResize({
        fieldId: field.id,
        startX: e.clientX,
        startY: e.clientY,
        origW: field.width ?? 300,
        origH: field.height ?? 40,
      });
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (drag) {
        const offset = getCanvasOffset();
        const dx = e.clientX - offset.left - drag.startX;
        const dy = e.clientY - offset.top - drag.startY;
        const newX = snapToGrid(Math.max(0, Math.min(drag.origX + dx, CANVAS_WIDTH - 100)));
        const newY = snapToGrid(Math.max(0, Math.min(drag.origY + dy, CANVAS_HEIGHT - 30)));
        dispatch({ type: 'UPDATE_FIELD', payload: { id: drag.fieldId, updates: { x: newX, y: newY } } });
      }
      if (resize) {
        const dx = e.clientX - resize.startX;
        const dy = e.clientY - resize.startY;
        const newW = snapToGrid(Math.max(80, resize.origW + dx));
        const newH = snapToGrid(Math.max(30, resize.origH + dy));
        dispatch({ type: 'UPDATE_FIELD', payload: { id: resize.fieldId, updates: { width: newW, height: newH } } });
      }
    },
    [drag, resize, dispatch]
  );

  const handleMouseUp = useCallback(() => {
    setDrag(null);
    setResize(null);
  }, []);

  return (
    <div
      className="flex-1 overflow-auto bg-gray-100 p-8 flex justify-center"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        ref={canvasRef}
        className="relative bg-white shadow-xl"
        style={{ width: CANVAS_WIDTH, minHeight: CANVAS_HEIGHT }}
        onClick={() => selectField(null)}
      >
        {/* Grid overlay */}
        <div
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent ${GRID - 1}px, #e5e7eb ${GRID - 1}px, #e5e7eb ${GRID}px), repeating-linear-gradient(90deg, transparent, transparent ${GRID - 1}px, #e5e7eb ${GRID - 1}px, #e5e7eb ${GRID}px)`,
          }}
        />

        {/* PDF base placeholder */}
        {state.template.pdfBasePath && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-sm pointer-events-none">
            PDF base cargado
          </div>
        )}

        {/* Fields */}
        {state.template.schema.map((field) => {
          const x = field.x ?? 50;
          const y = field.y ?? 50;
          const w = field.width ?? 300;
          const h = field.height ?? 40;
          const isSelected = state.selectedFieldId === field.id;

          return (
            <div
              key={field.id}
              className={`absolute border-2 rounded cursor-move select-none transition-shadow ${
                isSelected
                  ? 'border-primary shadow-lg z-10'
                  : 'border-blue-300 hover:border-primary/60 hover:shadow-sm'
              }`}
              style={{ left: x, top: y, width: w, height: h }}
              onMouseDown={(e) => handleFieldMouseDown(e, field)}
            >
              {/* Field label */}
              <div className="absolute -top-5 left-0 text-[10px] font-medium text-primary bg-white px-1 rounded whitespace-nowrap">
                {field.label}
              </div>

              {/* Move icon */}
              <div className="absolute top-1 left-1 text-muted-foreground opacity-50">
                <Move size={10} />
              </div>

              {/* Field type indicator */}
              <div className="w-full h-full flex items-center px-2 text-xs text-muted-foreground overflow-hidden">
                <span className="truncate">{field.placeholder || field.label}</span>
              </div>

              {/* Resize handle */}
              {isSelected && (
                <div
                  className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-center justify-center text-primary"
                  onMouseDown={(e) => handleResizeMouseDown(e, field)}
                >
                  <CornerRightDown size={10} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
