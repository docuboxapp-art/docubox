'use client';

import React from 'react';
import {
  DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, FilePlus2, Plus, Trash2 } from 'lucide-react';
import { useFormBuilder } from '@/contexts/FormBuilderContext';
import FieldCard from './FieldCard';

function SortableField({ fieldId }: { fieldId: string }) {
  const { state } = useFormBuilder();
  const field = state.template.schema.find((item) => item.id === fieldId);
  const sortable = useSortable({ id: fieldId });
  if (!field) return null;

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.45 : 1,
      }}
    >
      <FieldCard
        field={field}
        isSelected={state.selectedFieldId === field.id}
        dragHandleProps={{ ...sortable.attributes, ...sortable.listeners }}
      />
    </div>
  );
}

export default function BuilderCanvas() {
  const { state, dispatch, addField, addSection } = useFormBuilder();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oldIndex = state.template.schema.findIndex((field) => field.id === active.id);
    const newIndex = state.template.schema.findIndex((field) => field.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const targetSectionId = state.template.schema[newIndex].sectionId;
    if (targetSectionId && state.template.schema[oldIndex].sectionId !== targetSectionId) {
      dispatch({ type: 'UPDATE_FIELD', payload: { id: String(active.id), updates: { sectionId: targetSectionId } } });
    }
    dispatch({ type: 'REORDER_FIELDS', payload: arrayMove(state.template.schema, oldIndex, newIndex) });
  };

  const allIds = state.template.schema.map((field) => field.id);

  return (
    <div className="h-full overflow-y-auto bg-[#F6F8FB] px-4 py-5 dark:bg-background md:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 rounded-lg border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-border dark:bg-card">
          <input
            value={state.template.name}
            onChange={(event) => dispatch({ type: 'SET_TEMPLATE_META', payload: { name: event.target.value } })}
            className="w-full border-0 bg-transparent p-0 text-xl font-semibold text-[#0F172A] outline-none placeholder:text-[#94A3B8] dark:text-foreground"
            placeholder="Nombre del formulario"
          />
          <textarea
            value={state.template.description}
            onChange={(event) => dispatch({ type: 'SET_TEMPLATE_META', payload: { description: event.target.value } })}
            rows={2}
            className="mt-2 w-full resize-none border-0 bg-transparent p-0 text-sm leading-6 text-[#475569] outline-none placeholder:text-[#94A3B8] dark:text-muted-foreground"
            placeholder="Describe el propósito y alcance legal de este formulario."
          />
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={allIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-4">
              {state.template.sections.map((section, sectionIndex) => {
                const sectionFields = state.template.schema.filter((field) => field.sectionId === section.id);
                const isSelected = state.selectedSectionId === section.id;
                return (
                  <section
                    key={section.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      dispatch({ type: 'SELECT_SECTION', payload: section.id });
                    }}
                    className={`overflow-hidden rounded-lg border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition dark:bg-card ${isSelected ? 'border-[#BFDBFE]' : 'border-[#E2E8F0] dark:border-border'}`}
                  >
                    <header className="flex items-start gap-3 border-b border-[#E2E8F0] px-5 py-4 dark:border-border">
                      <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-[#EFF6FF] text-xs font-semibold text-[#1E6BFF]">
                        {sectionIndex + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <input
                          value={section.title}
                          onChange={(event) => dispatch({ type: 'UPDATE_SECTION', payload: { id: section.id, updates: { title: event.target.value } } })}
                          className="w-full border-0 bg-transparent p-0 text-sm font-semibold text-[#0F172A] outline-none dark:text-foreground"
                        />
                        <input
                          value={section.description || ''}
                          onChange={(event) => dispatch({ type: 'UPDATE_SECTION', payload: { id: section.id, updates: { description: event.target.value } } })}
                          placeholder="Descripción de la sección"
                          className="mt-1 w-full border-0 bg-transparent p-0 text-xs text-[#64748B] outline-none placeholder:text-[#94A3B8] dark:text-muted-foreground"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        {section.pageBreakBefore && sectionIndex > 0 && (
                          <span className="mr-2 rounded bg-[#F8FAFC] px-2 py-1 text-[10px] font-medium text-[#64748B]">Salto PDF</span>
                        )}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            dispatch({ type: 'UPDATE_SECTION', payload: { id: section.id, updates: { collapsed: !section.collapsed } } });
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-[#64748B] hover:bg-[#F8FAFC]"
                          title={section.collapsed ? 'Expandir sección' : 'Contraer sección'}
                        >
                          <ChevronDown size={15} className={`transition ${section.collapsed ? '-rotate-90' : ''}`} />
                        </button>
                        {state.template.sections.length > 1 && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              dispatch({ type: 'DELETE_SECTION', payload: section.id });
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-[#94A3B8] hover:bg-red-50 hover:text-red-600"
                            title="Eliminar sección"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </header>

                    {!section.collapsed && (
                      <div className="space-y-2 p-4">
                        {sectionFields.map((field) => <SortableField key={field.id} fieldId={field.id} />)}
                        {sectionFields.length === 0 && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              dispatch({ type: 'SELECT_SECTION', payload: section.id });
                              addField('text');
                            }}
                            className="flex min-h-[90px] w-full flex-col items-center justify-center rounded-md border border-dashed border-[#CBD5E1] text-[#64748B] transition hover:border-[#1E6BFF]/50 hover:bg-[#EFF6FF] hover:text-[#1E6BFF]"
                          >
                            <FilePlus2 size={18} />
                            <span className="mt-2 text-xs font-medium">Agregar el primer campo</span>
                          </button>
                        )}
                        {sectionFields.length > 0 && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              dispatch({ type: 'SELECT_SECTION', payload: section.id });
                              addField('text');
                            }}
                            className="flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-[#1E6BFF] hover:bg-[#EFF6FF]"
                          >
                            <Plus size={14} /> Agregar pregunta
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>

        <button
          type="button"
          onClick={addSection}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#BFDBFE] bg-white text-sm font-medium text-[#1E6BFF] transition hover:bg-[#EFF6FF] dark:border-blue-900/60 dark:bg-card dark:hover:bg-blue-950/30"
        >
          <Plus size={15} /> Agregar sección
        </button>
      </div>
    </div>
  );
}
