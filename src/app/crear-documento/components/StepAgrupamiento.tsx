'use client';

import React, { useState, useRef } from 'react';
import { Plus, Trash2, GripVertical, ChevronDown, MessageSquare, Info, Users, Pencil, Check } from 'lucide-react';
import type { Participant } from './types';

export interface GrupoFirma {
  id: string;
  nombre: string;
  tipo: 'paralelo' | 'secuencial';
  mensaje: string;
  participantIds: string[];
}

interface StepAgrupamientoProps {
  participants: Participant[];
  grupos: GrupoFirma[];
  onChange: (grupos: GrupoFirma[]) => void;
}

function generateGrupoId(): string {
  return `grupo-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

export function StepAgrupamiento({ participants, grupos, onChange }: StepAgrupamientoProps) {
  const [dragOverGrupoIndex, setDragOverGrupoIndex] = useState<number | null>(null);
  const dragGrupoIndexRef = useRef<number | null>(null);
  const [tipoDropdownOpen, setTipoDropdownOpen] = useState<string | null>(null);
  const [editingNombreId, setEditingNombreId] = useState<string | null>(null);
  const [editingNombreValue, setEditingNombreValue] = useState<string>('');

  // Participants not assigned to any group
  const assignedIds = new Set(grupos.flatMap((g) => g.participantIds));
  const unassignedParticipants = participants.filter((p) => !assignedIds.has(p.id));

  const handleAddGrupo = () => {
    const newGrupo: GrupoFirma = {
      id: generateGrupoId(),
      nombre: `Grupo ${grupos.length + 1}`,
      tipo: 'paralelo',
      mensaje: '',
      participantIds: [],
    };
    onChange([...grupos, newGrupo]);
  };

  const handleDeleteGrupo = (grupoId: string) => {
    onChange(grupos.filter((g) => g.id !== grupoId));
  };

  const handleUpdateGrupo = (grupoId: string, updates: Partial<GrupoFirma>) => {
    onChange(grupos.map((g) => (g.id === grupoId ? { ...g, ...updates } : g)));
  };

  const handleStartEditNombre = (grupo: GrupoFirma) => {
    setEditingNombreId(grupo.id);
    setEditingNombreValue(grupo.nombre);
  };

  const handleConfirmNombre = (grupoId: string) => {
    const trimmed = editingNombreValue.trim();
    if (trimmed) {
      handleUpdateGrupo(grupoId, { nombre: trimmed });
    }
    setEditingNombreId(null);
  };

  const handleNombreKeyDown = (e: React.KeyboardEvent, grupoId: string) => {
    if (e.key === 'Enter') handleConfirmNombre(grupoId);
    if (e.key === 'Escape') setEditingNombreId(null);
  };

  // Drag & drop for groups reordering
  const handleGrupoDragStart = (index: number) => {
    dragGrupoIndexRef.current = index;
  };

  const handleGrupoDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverGrupoIndex(index);
  };

  const handleGrupoDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = dragGrupoIndexRef.current;
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragOverGrupoIndex(null);
      return;
    }
    const updated = [...grupos];
    const [moved] = updated.splice(dragIndex, 1);
    updated.splice(dropIndex, 0, moved);
    onChange(updated);
    dragGrupoIndexRef.current = null;
    setDragOverGrupoIndex(null);
  };

  const handleGrupoDragEnd = () => {
    dragGrupoIndexRef.current = null;
    setDragOverGrupoIndex(null);
  };

  // Drag participant from left panel into a group
  const [draggingParticipantId, setDraggingParticipantId] = useState<string | null>(null);
  const [dragOverParticipantGrupo, setDragOverParticipantGrupo] = useState<string | null>(null);

  const handleParticipantDragStart = (participantId: string) => {
    setDraggingParticipantId(participantId);
  };

  const handleParticipantDragOver = (e: React.DragEvent, grupoId: string) => {
    e.preventDefault();
    setDragOverParticipantGrupo(grupoId);
  };

  const handleParticipantDrop = (e: React.DragEvent, grupoId: string) => {
    e.preventDefault();
    if (!draggingParticipantId) return;
    // Remove from any existing group first
    const updated = grupos.map((g) => ({
      ...g,
      participantIds: g.participantIds.filter((id) => id !== draggingParticipantId),
    }));
    // Add to target group
    const target = updated.find((g) => g.id === grupoId);
    if (target && !target.participantIds.includes(draggingParticipantId)) {
      target.participantIds.push(draggingParticipantId);
    }
    onChange(updated);
    setDraggingParticipantId(null);
    setDragOverParticipantGrupo(null);
  };

  const handleParticipantDragEnd = () => {
    setDraggingParticipantId(null);
    setDragOverParticipantGrupo(null);
  };

  const handleRemoveParticipantFromGrupo = (grupoId: string, participantId: string) => {
    onChange(grupos.map((g) => g.id === grupoId ? { ...g, participantIds: g.participantIds.filter((id) => id !== participantId) } : g));
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Agrupamiento de Participantes</h1>
        <p className="text-gray-500 mt-1 text-sm">Organiza a los participantes en grupos y define el orden de firma.</p>
      </div>

      <div className="flex gap-6 items-start">
        {/* Left panel: unassigned participants */}
        <div className="w-64 shrink-0 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} className="text-gray-500" />
            <span className="text-sm font-semibold text-gray-800">
              Participantes ({unassignedParticipants.length})
            </span>
          </div>
          {unassignedParticipants.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">Todos los participantes han sido asignados a un grupo.</p>
          ) : (
            <div className="space-y-2">
              {unassignedParticipants.map((p) => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={() => handleParticipantDragStart(p.id)}
                  onDragEnd={handleParticipantDragEnd}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border border-gray-200 bg-gray-50 cursor-grab active:cursor-grabbing hover:border-primary/40 hover:bg-blue-50 transition-colors ${draggingParticipantId === p.id ? 'opacity-50' : ''}`}
                >
                  <GripVertical size={14} className="text-gray-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{p.name}</p>
                    <p className="text-xs text-gray-400 truncate">{p.email}</p>
                  </div>
                  {p.acto && (
                    <span className="ml-auto shrink-0 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">{p.acto}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right panel: groups */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Grupos de Firma</h2>
            <button
              onClick={handleAddGrupo}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
            >
              <Plus size={15} />
              Nuevo Grupo
            </button>
          </div>

          {grupos.length === 0 ? (
            <div className="border-2 border-dashed border-gray-200 rounded-xl py-12 text-center">
              <p className="text-sm text-gray-400">No hay grupos creados. Haz clic en "+ Nuevo Grupo" para comenzar.</p>
            </div>
          ) : (
            <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
              {grupos.map((grupo, index) => (
                <div
                  key={grupo.id}
                  draggable
                  onDragStart={() => handleGrupoDragStart(index)}
                  onDragOver={(e) => handleGrupoDragOver(e, index)}
                  onDrop={(e) => handleGrupoDrop(e, index)}
                  onDragEnd={handleGrupoDragEnd}
                  className={`bg-white border border-gray-200 rounded-xl shadow-sm transition-all ${dragOverGrupoIndex === index ? 'border-primary/50 bg-blue-50/30' : ''}`}
                >
                  {/* Group header */}
                  <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-gray-100">
                    <GripVertical size={16} className="text-gray-400 cursor-grab shrink-0" />
                    {editingNombreId === grupo.id ? (
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <input
                          autoFocus
                          type="text"
                          value={editingNombreValue}
                          onChange={(e) => setEditingNombreValue(e.target.value)}
                          onKeyDown={(e) => handleNombreKeyDown(e, grupo.id)}
                          onBlur={() => handleConfirmNombre(grupo.id)}
                          className="flex-1 min-w-0 text-sm font-bold text-gray-900 border border-primary/50 rounded-md px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        <button
                          onClick={() => handleConfirmNombre(grupo.id)}
                          className="w-6 h-6 flex items-center justify-center rounded text-primary hover:bg-blue-50 transition-colors shrink-0"
                        >
                          <Check size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 flex-1 min-w-0 group/name">
                        <span className="text-sm font-bold text-gray-900 truncate">{grupo.nombre}</span>
                        <button
                          onClick={() => handleStartEditNombre(grupo)}
                          className="w-5 h-5 flex items-center justify-center rounded text-gray-300 hover:text-primary opacity-0 group-hover/name:opacity-100 transition-all shrink-0"
                        >
                          <Pencil size={12} />
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => handleDeleteGrupo(grupo.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  <div className="px-4 py-3 space-y-3">
                    {/* Tipo selector */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setTipoDropdownOpen(tipoDropdownOpen === grupo.id ? null : grupo.id)}
                        className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:border-gray-300 transition-colors bg-white"
                      >
                        <span className="font-medium">{grupo.tipo === 'paralelo' ? 'Paralelo' : 'Secuencial'}</span>
                        <ChevronDown size={14} className={`text-gray-400 transition-transform ${tipoDropdownOpen === grupo.id ? 'rotate-180' : ''}`} />
                      </button>
                      {tipoDropdownOpen === grupo.id && (
                        <div className="absolute z-50 left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden w-56">
                          <button
                            type="button"
                            onClick={() => { handleUpdateGrupo(grupo.id, { tipo: 'paralelo' }); setTipoDropdownOpen(null); }}
                            className={`w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors flex items-center gap-2 ${grupo.tipo === 'paralelo' ? 'bg-blue-50' : ''}`}
                          >
                            {grupo.tipo === 'paralelo' && <span className="text-primary">✓</span>}
                            <div>
                              <span className="text-sm font-semibold text-gray-800">Paralelo</span>
                              <span className="text-xs text-gray-400 ml-2">(Todos a la vez)</span>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => { handleUpdateGrupo(grupo.id, { tipo: 'secuencial' }); setTipoDropdownOpen(null); }}
                            className={`w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors flex items-center gap-2 ${grupo.tipo === 'secuencial' ? 'bg-blue-50' : ''}`}
                          >
                            {grupo.tipo === 'secuencial' && <span className="text-primary">✓</span>}
                            <div>
                              <span className="text-sm font-semibold text-gray-800">Secuencial</span>
                              <span className="text-xs text-gray-400 ml-2">(Uno tras otro)</span>
                            </div>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Message */}
                    <div>
                      <label className="flex items-center gap-1.5 text-xs text-gray-500 mb-1.5">
                        <MessageSquare size={12} />
                        Mensaje personalizado para el grupo (opcional)
                      </label>
                      <textarea
                        value={grupo.mensaje}
                        onChange={(e) => handleUpdateGrupo(grupo.id, { mensaje: e.target.value })}
                        placeholder="Escribe un mensaje..."
                        rows={2}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                      />
                    </div>

                    {/* Drop zone for participants */}
                    <div
                      onDragOver={(e) => handleParticipantDragOver(e, grupo.id)}
                      onDrop={(e) => handleParticipantDrop(e, grupo.id)}
                      className={`min-h-[48px] rounded-lg border-2 border-dashed transition-colors ${dragOverParticipantGrupo === grupo.id ? 'border-primary bg-blue-50' : 'border-gray-200'}`}
                    >
                      {grupo.participantIds.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-3">
                          Arrastra participantes aquí
                        </p>
                      ) : (
                        <div className="p-2 space-y-1.5">
                          {grupo.participantIds.map((pid) => {
                            const p = participants.find((x) => x.id === pid);
                            if (!p) return null;
                            return (
                              <div key={pid} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg">
                                <GripVertical size={14} className="text-gray-400 shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                                  <p className="text-xs text-gray-400 truncate">{p.email}</p>
                                </div>
                                {p.acto && (
                                  <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">{p.acto}</span>
                                )}
                                <button
                                  onClick={() => handleRemoveParticipantFromGrupo(grupo.id, pid)}
                                  className="w-5 h-5 flex items-center justify-center rounded text-gray-300 hover:text-red-500 transition-colors shrink-0"
                                >
                                  ×
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Info footer */}
          <div className="mt-4 flex items-start gap-2 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700">
            <Info size={16} className="shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Orden de Grupos</span>
              <p className="text-xs mt-0.5 text-blue-600">Cuando todos los participantes de un grupo hayan terminado su participación (firmar, revisar, etc.), el proceso se moverá automáticamente al siguiente grupo en el orden definido.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
