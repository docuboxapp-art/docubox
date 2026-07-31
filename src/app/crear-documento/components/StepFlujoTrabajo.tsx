'use client';

import React, { useState } from 'react';
import { GitBranch, X, Flag, Save, Trash2, Plus, Zap, Settings2, AlertCircle, Target, ChevronDown } from 'lucide-react';
import type { Participant } from './types';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Condition {
  id: string;
  basadoEn: string;
  campo: string;
  operador: string;
  valor: string;
}

type ActionType =
  | 'enviar_siguiente' |'saltar_paso' |'enviar_notificacion' |'cambiar_estado' |'autocompletar_campos' |'bloquear_seccion' |'redirigir_aprobador' |'expirar_documento' |'detener_flujo';

interface Action {
  id: string;
  tipo: ActionType | '';
  asignadoA: string; // participant id or 'todos'
  config: Record<string, string>;
}

interface WorkflowStep {
  id: string;
  nombre: string;
  asignadoA: string;
  conditions: Condition[];
  actions: Action[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTION_OPTIONS: { value: ActionType; label: string }[] = [
  { value: 'enviar_siguiente', label: 'Enviar a siguiente participante' },
  { value: 'saltar_paso', label: 'Saltar este paso' },
  { value: 'enviar_notificacion', label: 'Enviar Notificación (Email/SMS)' },
  { value: 'cambiar_estado', label: 'Cambiar estado del documento' },
  { value: 'autocompletar_campos', label: 'Autocompletar campos' },
  { value: 'bloquear_seccion', label: 'Bloquear sección' },
  { value: 'redirigir_aprobador', label: 'Redirigir a otro aprobador' },
  { value: 'expirar_documento', label: 'Expirar documento automáticamente' },
  { value: 'detener_flujo', label: 'Detener flujo' },
];

const DOCUMENT_STATES = ['Borrador', 'Enviado', 'En proceso', 'Completado', 'Rechazado', 'Vencido'];

const BASADO_EN_OPTIONS = [
  { value: '', label: 'Seleccionar base...' },
  { value: 'participante', label: 'Participante' },
  { value: 'campo', label: 'Campo del documento' },
  { value: 'evento', label: 'Evento' },
  { value: 'fecha', label: 'Fecha' },
  { value: 'estado', label: 'Estado del documento' },
  { value: 'rol', label: 'Rol' },
];

const CAMPO_OPTIONS: Record<string, { value: string; label: string }[]> = {
  participante: [
    { value: '', label: 'Seleccionar atributo...' },
    { value: 'nombre', label: 'Nombre' },
    { value: 'email', label: 'Correo electrónico' },
    { value: 'telefono', label: 'Teléfono' },
    { value: 'rfc', label: 'RFC' },
    { value: 'curp', label: 'CURP' },
    { value: 'firmado', label: '¿Ha firmado?' },
    { value: 'verificado', label: '¿Está verificado?' },
  ],
  campo: [
    { value: '', label: 'Seleccionar campo...' },
    { value: 'monto', label: 'Monto' },
    { value: 'fecha_vencimiento', label: 'Fecha de vencimiento' },
    { value: 'tipo_contrato', label: 'Tipo de contrato' },
    { value: 'numero_folio', label: 'Número de folio' },
    { value: 'descripcion', label: 'Descripción' },
    { value: 'referencia', label: 'Referencia' },
  ],
  evento: [
    { value: '', label: 'Seleccionar evento...' },
    { value: 'firma_completada', label: 'Firma completada' },
    { value: 'documento_enviado', label: 'Documento enviado' },
    { value: 'documento_visto', label: 'Documento visto' },
    { value: 'rechazo_firma', label: 'Rechazo de firma' },
    { value: 'caducidad', label: 'Caducidad alcanzada' },
  ],
  fecha: [
    { value: '', label: 'Seleccionar fecha...' },
    { value: 'fecha_creacion', label: 'Fecha de creación' },
    { value: 'fecha_envio', label: 'Fecha de envío' },
    { value: 'fecha_firma', label: 'Fecha de firma' },
    { value: 'fecha_vencimiento', label: 'Fecha de vencimiento' },
    { value: 'fecha_actual', label: 'Fecha actual' },
  ],
  estado: [
    { value: '', label: 'Seleccionar estado...' },
    { value: 'borrador', label: 'Borrador' },
    { value: 'enviado', label: 'Enviado' },
    { value: 'en_proceso', label: 'En proceso de firma' },
    { value: 'completado', label: 'Completado' },
    { value: 'rechazado', label: 'Rechazado' },
    { value: 'vencido', label: 'Vencido' },
  ],
  rol: [
    { value: '', label: 'Seleccionar rol...' },
    { value: 'firmante', label: 'Firmante' },
    { value: 'revisor', label: 'Revisor' },
    { value: 'aprobador', label: 'Aprobador' },
    { value: 'testigo', label: 'Testigo' },
    { value: 'notificado', label: 'Notificado' },
  ],
};

const OPERATOR_OPTIONS: Record<string, { value: string; label: string }[]> = {
  default: [
    { value: 'igual', label: 'Igual a (=)' },
    { value: 'diferente', label: 'Diferente de (≠)' },
    { value: 'contiene', label: 'Contiene' },
    { value: 'no_contiene', label: 'No contiene' },
    { value: 'empieza_con', label: 'Empieza con' },
    { value: 'termina_con', label: 'Termina con' },
    { value: 'vacio', label: 'Está vacío' },
    { value: 'no_vacio', label: 'No está vacío' },
  ],
  numeric: [
    { value: 'igual', label: 'Igual a (=)' },
    { value: 'diferente', label: 'Diferente de (≠)' },
    { value: 'mayor', label: 'Mayor que (>)' },
    { value: 'mayor_igual', label: 'Mayor o igual que (≥)' },
    { value: 'menor', label: 'Menor que (<)' },
    { value: 'menor_igual', label: 'Menor o igual que (≤)' },
    { value: 'entre', label: 'Entre' },
  ],
  date: [
    { value: 'igual', label: 'Igual a (=)' },
    { value: 'antes', label: 'Antes de' },
    { value: 'despues', label: 'Después de' },
    { value: 'entre', label: 'Entre' },
    { value: 'hace_menos', label: 'Hace menos de (días)' },
    { value: 'hace_mas', label: 'Hace más de (días)' },
    { value: 'proximos', label: 'En los próximos (días)' },
  ],
  boolean: [
    { value: 'es_verdadero', label: 'Es verdadero (Sí)' },
    { value: 'es_falso', label: 'Es falso (No)' },
  ],
  event: [
    { value: 'ocurrio', label: 'Ocurrió' },
    { value: 'no_ocurrio', label: 'No ocurrió' },
    { value: 'ocurrio_antes', label: 'Ocurrió antes de' },
    { value: 'ocurrio_despues', label: 'Ocurrió después de' },
  ],
  status: [
    { value: 'igual', label: 'Es igual a' },
    { value: 'diferente', label: 'Es diferente de' },
    { value: 'en_lista', label: 'Está en la lista' },
    { value: 'no_en_lista', label: 'No está en la lista' },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createDefaultStep(index: number): WorkflowStep {
  return {
    id: `step-${Date.now()}-${index}`,
    nombre: `Paso ${index}`,
    asignadoA: '',
    conditions: [],
    actions: [],
  };
}

function createDefaultAction(): Action {
  return {
    id: `action-${Date.now()}-${Math.random()}`,
    tipo: '',
    asignadoA: '',
    config: {},
  };
}

function getOperatorOptions(basadoEn: string, campo: string) {
  if (basadoEn === 'evento') return OPERATOR_OPTIONS.event;
  if (basadoEn === 'estado') return OPERATOR_OPTIONS.status;
  if (basadoEn === 'fecha') return OPERATOR_OPTIONS.date;
  if (campo === 'monto') return OPERATOR_OPTIONS.numeric;
  if (campo === 'firmado' || campo === 'verificado') return OPERATOR_OPTIONS.boolean;
  return OPERATOR_OPTIONS.default;
}

function needsValueInput(operador: string) {
  return !['vacio', 'no_vacio', 'es_verdadero', 'es_falso', 'ocurrio', 'no_ocurrio'].includes(operador);
}

function getParticipantLabel(p: Participant) {
  return p.name || p.email || `Participante`;
}

// ─── ConditionRow ─────────────────────────────────────────────────────────────

function ConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: Condition;
  onChange: (updated: Condition) => void;
  onRemove: () => void;
}) {
  const campoOptions = CAMPO_OPTIONS[condition.basadoEn] || [{ value: '', label: 'Seleccionar atributo...' }];
  const operatorOptions = getOperatorOptions(condition.basadoEn, condition.campo);
  const showValueInput = needsValueInput(condition.operador);

  const handleBasadoEnChange = (val: string) => {
    onChange({ ...condition, basadoEn: val, campo: '', operador: '' });
  };

  const handleCampoChange = (val: string) => {
    onChange({ ...condition, campo: val, operador: '' });
  };

  return (
    <div className="space-y-2 bg-gray-50 rounded-lg p-2.5 border border-gray-100">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5 block">Basado en</label>
          <select
            value={condition.basadoEn}
            onChange={(e) => handleBasadoEnChange(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          >
            {BASADO_EN_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5 block">
            {condition.basadoEn === 'participante' ? 'Atributo' : condition.basadoEn === 'evento' ? 'Evento' : condition.basadoEn === 'fecha' ? 'Tipo de fecha' : condition.basadoEn === 'estado' ? 'Estado' : 'Campo'}
          </label>
          <select
            value={condition.campo}
            onChange={(e) => handleCampoChange(e.target.value)}
            disabled={!condition.basadoEn}
            className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:bg-gray-100 disabled:text-gray-400"
          >
            {campoOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={onRemove}
          className="text-gray-400 hover:text-red-500 transition-colors p-1 mt-4 flex-shrink-0"
        >
          <X size={15} />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5 block">Operador</label>
          <select
            value={condition.operador}
            onChange={(e) => onChange({ ...condition, operador: e.target.value })}
            disabled={!condition.campo}
            className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:bg-gray-100 disabled:text-gray-400"
          >
            <option value="">Seleccionar operador...</option>
            {operatorOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        {showValueInput && (
          <div className="flex-1">
            <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5 block">Valor a comparar</label>
            <input
              type="text"
              placeholder="Ingresa un valor..."
              value={condition.valor}
              onChange={(e) => onChange({ ...condition, valor: e.target.value })}
              disabled={!condition.operador}
              className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:bg-gray-100 disabled:text-gray-400"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ActionExtraConfig ────────────────────────────────────────────────────────

function ActionExtraConfig({
  action,
  participants,
  onChange,
}: {
  action: Action;
  participants: Participant[];
  onChange: (updated: Action) => void;
}) {
  const setConfig = (key: string, value: string) => {
    onChange({ ...action, config: { ...action.config, [key]: value } });
  };

  switch (action.tipo) {
    case 'enviar_notificacion':
      return (
        <div className="mt-2 space-y-1.5">
          <div>
            <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5 block">Canal</label>
            <select
              value={action.config.canal || ''}
              onChange={(e) => setConfig('canal', e.target.value)}
              className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-primary/30"
            >
              <option value="">Seleccionar canal...</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="ambos">Email y SMS</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5 block">Mensaje</label>
            <input
              type="text"
              placeholder="Mensaje de notificación..."
              value={action.config.mensaje || ''}
              onChange={(e) => setConfig('mensaje', e.target.value)}
              className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
        </div>
      );
    case 'cambiar_estado':
      return (
        <div className="mt-2">
          <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5 block">Nuevo estado</label>
          <select
            value={action.config.estado || ''}
            onChange={(e) => setConfig('estado', e.target.value)}
            className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-primary/30"
          >
            <option value="">Seleccionar estado...</option>
            {DOCUMENT_STATES.map((s) => (
              <option key={s} value={s.toLowerCase()}>{s}</option>
            ))}
          </select>
        </div>
      );
    case 'autocompletar_campos':
      return (
        <div className="mt-2">
          <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5 block">Campo a completar</label>
          <input
            type="text"
            placeholder="Nombre del campo..."
            value={action.config.campo || ''}
            onChange={(e) => setConfig('campo', e.target.value)}
            className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      );
    case 'bloquear_seccion':
      return (
        <div className="mt-2">
          <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5 block">Sección a bloquear</label>
          <input
            type="text"
            placeholder="Nombre de la sección..."
            value={action.config.seccion || ''}
            onChange={(e) => setConfig('seccion', e.target.value)}
            className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      );
    case 'redirigir_aprobador':
      return (
        <div className="mt-2">
          <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5 block">Redirigir a</label>
          <select
            value={action.config.aprobador || ''}
            onChange={(e) => setConfig('aprobador', e.target.value)}
            className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-primary/30"
          >
            <option value="">Seleccionar participante...</option>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>{getParticipantLabel(p)}</option>
            ))}
          </select>
        </div>
      );
    case 'expirar_documento':
      return (
        <div className="mt-2">
          <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5 block">Días hasta expiración</label>
          <input
            type="number"
            placeholder="Ej: 7"
            min="1"
            value={action.config.dias || ''}
            onChange={(e) => setConfig('dias', e.target.value)}
            className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      );
    default:
      return null;
  }
}

// ─── ActionRow ────────────────────────────────────────────────────────────────

function ActionRow({
  action,
  participants,
  onChange,
  onRemove,
}: {
  action: Action;
  participants: Participant[];
  onChange: (updated: Action) => void;
  onRemove: () => void;
}) {
  return (
    <div className="bg-orange-50/60 border border-orange-100 rounded-lg p-2.5 space-y-1.5">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5 block">Acción</label>
          <div className="relative">
            <select
              value={action.tipo}
              onChange={(e) => onChange({ ...action, tipo: e.target.value as ActionType | '', config: {} })}
              className="w-full appearance-none border border-orange-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-orange-300/40 focus:border-orange-400 pr-7"
            >
              <option value="">Seleccionar acción...</option>
              {ACTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <button
          onClick={onRemove}
          className="text-gray-400 hover:text-red-500 transition-colors p-1 mt-4 flex-shrink-0"
        >
          <X size={15} />
        </button>
      </div>

      {/* Participant assignment */}
      {action.tipo && (
        <div>
          <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5 block">Asignar a participante</label>
          <select
            value={action.asignadoA}
            onChange={(e) => onChange({ ...action, asignadoA: e.target.value })}
            className="w-full border border-orange-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-orange-300/40"
          >
            <option value="">Sin asignar</option>
            <option value="todos">Todos los participantes</option>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>{getParticipantLabel(p)}</option>
            ))}
          </select>
        </div>
      )}

      {/* Extra config per action type */}
      <ActionExtraConfig action={action} participants={participants} onChange={onChange} />
    </div>
  );
}

// ─── StepCard ─────────────────────────────────────────────────────────────────

function StepCard({
  step,
  participants,
  onUpdate,
  onDelete,
}: {
  step: WorkflowStep;
  participants: Participant[];
  onUpdate: (updated: WorkflowStep) => void;
  onDelete: () => void;
}) {
  const addCondition = () => {
    onUpdate({
      ...step,
      conditions: [
        ...step.conditions,
        { id: `cond-${Date.now()}`, basadoEn: '', campo: '', operador: '', valor: '' },
      ],
    });
  };

  const updateCondition = (id: string, updated: Condition) => {
    onUpdate({
      ...step,
      conditions: step.conditions.map((c) => (c.id === id ? updated : c)),
    });
  };

  const removeCondition = (id: string) => {
    onUpdate({ ...step, conditions: step.conditions.filter((c) => c.id !== id) });
  };

  const addAction = () => {
    onUpdate({
      ...step,
      actions: [...step.actions, createDefaultAction()],
    });
  };

  const updateAction = (id: string, updated: Action) => {
    onUpdate({
      ...step,
      actions: step.actions.map((a) => (a.id === id ? updated : a)),
    });
  };

  const removeAction = (id: string) => {
    onUpdate({ ...step, actions: step.actions.filter((a) => a.id !== id) });
  };

  return (
    <div className="w-full bg-white border-2 border-blue-500 rounded-xl shadow-sm overflow-hidden">
      {/* Step header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-3 flex-1">
          <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center flex-shrink-0">
            <Settings2 size={14} className="text-blue-500" />
          </div>
          <div className="flex-1">
            <input
              type="text"
              value={step.nombre}
              onChange={(e) => onUpdate({ ...step, nombre: e.target.value })}
              className="w-full max-w-xs border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xs text-gray-500">Asignado a:</span>
              <select
                value={step.asignadoA}
                onChange={(e) => onUpdate({ ...step, asignadoA: e.target.value })}
                className="border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                <option value="">Sin asignar</option>
                <option value="todos">Todos los participantes</option>
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>{getParticipantLabel(p)}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <button
          onClick={onDelete}
          className="text-gray-400 hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-red-50"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* Conditions & Actions */}
      <div className="grid grid-cols-2 divide-x divide-gray-100">
        {/* Conditions */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <Settings2 size={14} className="text-blue-500" />
              <span className="text-sm font-semibold text-blue-600">Condiciones</span>
            </div>
            <button
              onClick={addCondition}
              className="flex items-center gap-1 text-xs font-medium text-orange-500 hover:text-orange-600 transition-colors"
            >
              <Plus size={12} />
              Añadir
            </button>
          </div>
          <div className="space-y-3">
            {step.conditions.length === 0 ? (
              <div className="flex items-center justify-center py-6 px-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-400 italic text-center">Sin condiciones. Este paso se ejecutará siempre.</p>
              </div>
            ) : (
              step.conditions.map((cond) => (
                <ConditionRow
                  key={cond.id}
                  condition={cond}
                  onChange={(updated) => updateCondition(cond.id, updated)}
                  onRemove={() => removeCondition(cond.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <Zap size={14} className="text-orange-500" />
              <span className="text-sm font-semibold text-orange-500">Acciones</span>
            </div>
            <button
              onClick={addAction}
              className="flex items-center gap-1 text-xs font-medium text-orange-500 hover:text-orange-600 transition-colors"
            >
              <Plus size={12} />
              Añadir
            </button>
          </div>
          <div className="space-y-2">
            {step.actions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 bg-orange-50/40 rounded-lg border border-orange-100">
                <AlertCircle size={18} className="text-gray-400" />
                <span className="text-xs text-gray-400 italic">Sin acciones definidas.</span>
              </div>
            ) : (
              step.actions.map((action) => (
                <ActionRow
                  key={action.id}
                  action={action}
                  participants={participants}
                  onChange={(updated) => updateAction(action.id, updated)}
                  onRemove={() => removeAction(action.id)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── WorkflowEditorModal ──────────────────────────────────────────────────────

function WorkflowEditorModal({ participants, onClose, documentoId }: { participants: Participant[]; onClose: () => void; documentoId?: string }) {
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const addStep = () => {
    setSteps((prev) => [...prev, createDefaultStep(prev.length + 1)]);
  };

  const updateStep = (id: string, updated: WorkflowStep) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? updated : s)));
  };

  const deleteStep = (id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id));
  };

  const handleGuardarFlujo = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSaveError('Debes iniciar sesión para guardar el flujo.');
        return;
      }
      const payload = {
        created_by: user.id,
        nombre: 'Flujo de Trabajo',
        steps: steps,
        ...(documentoId ? { documento_id: documentoId } : {}),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('workflow_flows')
        .insert(payload)
        .select()
        .single();
      if (error) {
        setSaveError('Error al guardar el flujo: ' + error.message);
        return;
      }
      setSaveSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      setSaveError('Error inesperado: ' + (err?.message || 'Intenta de nuevo.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl mx-4 flex flex-col" style={{ maxHeight: '90vh' }}>
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <div className="flex items-center gap-2">
              <GitBranch size={20} className="text-primary" />
              <h2 className="text-lg font-bold text-gray-900">Editor de Flujo de Trabajo Avanzado</h2>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              Configura condiciones complejas y acciones automatizadas. Arrastra los elementos para reordenar.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors ml-4 mt-0.5"
          >
            <X size={20} />
          </button>
        </div>

        {/* Canvas area */}
        <div className="flex-1 overflow-auto bg-gray-50 px-6 py-6 flex flex-col items-center gap-0" style={{ minHeight: 0 }}>
          {/* INICIO node */}
          <div className="mb-2">
            <div className="flex items-center gap-2 px-5 py-2 bg-green-100 border border-green-300 rounded-full text-green-700 font-bold text-sm shadow-sm">
              <Flag size={14} />
              INICIO
            </div>
          </div>

          {/* Connector line from INICIO */}
          <div className="w-px h-6 bg-gray-300" />

          {steps.length === 0 ? (
            /* Empty state */
            <div className="w-full border-2 border-dashed border-gray-200 rounded-xl bg-white flex flex-col items-center justify-center py-16 px-8 gap-4">
              <div className="text-gray-300">
                <GitBranch size={52} strokeWidth={1.2} />
              </div>
              <div className="text-center">
                <p className="text-gray-600 font-semibold text-lg">El flujo está vacío</p>
                <p className="text-gray-400 text-sm mt-1">
                  Comienza añadiendo un paso para definir las reglas de<br />negocio y automatización.
                </p>
              </div>
              <button
                onClick={addStep}
                className="flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
              >
                + Añadir Primer Paso
              </button>
            </div>
          ) : (
            /* Steps list */
            <div className="w-full flex flex-col items-center gap-0">
              {steps.map((step, idx) => (
                <React.Fragment key={step.id}>
                  <div className="w-full">
                    <StepCard
                      step={step}
                      participants={participants}
                      onUpdate={(updated) => updateStep(step.id, updated)}
                      onDelete={() => deleteStep(step.id)}
                    />
                  </div>
                  {idx < steps.length - 1 && <div className="w-px h-6 bg-gray-300" />}
                </React.Fragment>
              ))}
              <div className="w-px h-6 bg-gray-300" />
            </div>
          )}

          {/* FIN node */}
          {steps.length > 0 && (
            <div className="mt-0">
              <div className="flex items-center gap-2 px-5 py-2 bg-gray-900 rounded-full text-white font-bold text-sm shadow-sm">
                <Target size={14} />
                FIN
              </div>
            </div>
          )}
        </div>

        {/* Error / Success feedback */}
        {saveError && (
          <div className="mx-6 mb-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            {saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="mx-6 mb-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-600">
            ¡Flujo guardado correctamente!
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 bg-white rounded-b-xl">
          <button
            onClick={addStep}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            + Añadir Paso
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancelar
            </button>
            <button
              onClick={handleGuardarFlujo}
              disabled={saving || steps.length === 0}
              className="flex items-center gap-2 px-5 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={14} />
              {saving ? 'Guardando...' : 'Guardar Flujo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── StepFlujoTrabajo ─────────────────────────────────────────────────────────

export function StepFlujoTrabajo({ participants = [], documentoId }: { participants?: Participant[]; documentoId?: string }) {
  const [showModal, setShowModal] = useState(false);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white border border-gray-200 rounded-xl p-8">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900">Flujo de Trabajo Condicional</h2>
          <p className="text-sm text-gray-500 mt-1">
            Define la secuencia de pasos, condiciones lógicas y acciones automatizadas para el proceso de firma.
          </p>
        </div>

        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="text-gray-300">
            <GitBranch size={64} strokeWidth={1.2} />
          </div>
          <div className="text-center">
            <p className="text-gray-500 font-medium">Aún no has definido un flujo de trabajo.</p>
            <p className="text-gray-400 text-sm mt-1">
              Configura condiciones avanzadas basadas en campos, participantes o eventos.
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="mt-2 flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
          >
            + Crear Flujo de Trabajo
          </button>
        </div>
      </div>

      {showModal && <WorkflowEditorModal participants={participants} documentoId={documentoId} onClose={() => setShowModal(false)} />}
    </div>
  );
}
