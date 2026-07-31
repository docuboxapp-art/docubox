'use client';

import React, { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useFormBuilder } from '@/contexts/FormBuilderContext';
import FieldCard from './FieldCard';
import { Plus, Layers } from 'lucide-react';

function SortableFieldCard({ fieldId }: { fieldId: string }) {
  const { state, selectField } = useFormBuilder();
  const field = state.template.schema.find((f) => f.id === fieldId);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: fieldId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  if (!field) return null;

  return (
    <div ref={setNodeRef} style={style}>
      <FieldCard
        field={field}
        isSelected={state.selectedFieldId === fieldId}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

export default function BuilderCanvas() {
  const { state, dispatch, selectField } = useFormBuilder();
  const [insertAfter, setInsertAfter] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = state.template.schema.findIndex((f) => f.id === active.id);
    const newIndex = state.template.schema.findIndex((f) => f.id === over.id);
    const reordered = arrayMove(state.template.schema, oldIndex, newIndex);
    dispatch({ type: 'REORDER_FIELDS', payload: reordered });
  };

  const fieldIds = state.template.schema.map((f) => f.id);

  if (state.template.schema.length === 0) {
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center p-8 text-center"
        onClick={() => selectField(null)}
      >
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
          <Layers size={28} className="text-primary" />
        </div>
        <h3 className="text-base font-semibold text-foreground mb-2">
          Tu formulario está vacío
        </h3>
        <p className="text-sm text-muted-foreground max-w-xs">
          Haz clic en cualquier campo del panel izquierdo para agregarlo al formulario.
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex-1 overflow-y-auto p-4"
      onClick={() => selectField(null)}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={fieldIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-2 max-w-2xl mx-auto">
            {state.template.schema.map((field, idx) => (
              <div key={field.id}>
                {/* Insert before first */}
                {idx === 0 && (
                  <InsertButton
                    show={insertAfter === `before-${field.id}`}
                    onMouseEnter={() => setInsertAfter(`before-${field.id}`)}
                    onMouseLeave={() => setInsertAfter(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      // Insert at beginning — handled by addField with no afterId
                    }}
                  />
                )}
                <SortableFieldCard fieldId={field.id} />
                <InsertButton
                  show={insertAfter === field.id}
                  onMouseEnter={() => setInsertAfter(field.id)}
                  onMouseLeave={() => setInsertAfter(null)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function InsertButton({
  show,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: {
  show: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className="relative h-4 flex items-center justify-center group"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={`absolute inset-x-0 h-0.5 bg-primary/30 transition-opacity ${show ? 'opacity-100' : 'opacity-0'}`} />
      <button
        onClick={onClick}
        className={`relative z-10 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center shadow-sm transition-all ${
          show ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
        }`}
      >
        <Plus size={12} />
      </button>
    </div>
  );
}
