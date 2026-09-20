'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Participant } from './types';
import { PackageConfiguration } from './PackageConfiguration';
import { InfoTooltip } from './SharedComponents';
import {
  DEFAULT_REQUIREMENT_MIME_TYPES,
  MAX_PACKAGE_FILE_BYTES,
  type ParticipantRequirementDraft,
  type SupplementalDocumentDraft,
} from '@/lib/document-package/types';

type Props = {
  participants: Participant[];
  onParticipantsChange: Dispatch<SetStateAction<Participant[]>>;
  inPersonEnabled: boolean;
  onInPersonEnabledChange: (enabled: boolean) => void;
  resources: SupplementalDocumentDraft[];
  onResourcesChange: (resources: SupplementalDocumentDraft[]) => void;
  requirements: ParticipantRequirementDraft[];
  onRequirementsChange: (requirements: ParticipantRequirementDraft[]) => void;
};

function participantLabel(participant: Participant) {
  return participant.name || participant.email || 'Participante sin nombre';
}

export function ParticipationDocumentOptions({
  participants,
  onParticipantsChange,
  inPersonEnabled,
  onInPersonEnabledChange,
  resources,
  onResourcesChange,
  requirements,
  onRequirementsChange,
}: Props) {
  const [requirementsOpen, setRequirementsOpen] = useState(false);
  const [requirementName, setRequirementName] = useState('');
  const [requirementRequired, setRequirementRequired] = useState(true);
  const [error, setError] = useState('');

  const eligibleSigners = participants.filter(
    (participant) => participant.acto === 'Firmante' || participant.role === 'firmante'
  );

  const setInPersonParticipant = (participantId: string, checked: boolean) => {
    onParticipantsChange((current) =>
      current.map((participant) =>
        participant.id === participantId
          ? { ...participant, deliveryMode: checked ? 'in_person' : 'remote' }
          : participant
      )
    );
  };

  const setRequirementParticipant = (
    requirement: ParticipantRequirementDraft,
    participantId: string,
    checked: boolean
  ) => {
    onParticipantsChange((current) =>
      current.map((participant) => {
        if (participant.id !== participantId) return participant;
        const assigned = participant.requirements || [];
        return {
          ...participant,
          requirements: checked
            ? [...assigned.filter((item) => item.id !== requirement.id), requirement]
            : assigned.filter((item) => item.id !== requirement.id),
        };
      })
    );
  };

  const addRequirement = () => {
    const name = requirementName.trim();
    if (!name) {
      setError('Indica el nombre del documento requerido.');
      return;
    }
    if (requirements.some((requirement) => requirement.name.toLowerCase() === name.toLowerCase())) {
      setError('Ya existe un requisito con ese nombre.');
      return;
    }
    onRequirementsChange([
      ...requirements,
      {
        id: crypto.randomUUID(),
        name,
        description: '',
        required: requirementRequired,
        allowedMimeTypes: [...DEFAULT_REQUIREMENT_MIME_TYPES],
        maxSizeBytes: MAX_PACKAGE_FILE_BYTES,
      },
    ]);
    setRequirementName('');
    setRequirementRequired(true);
    setError('');
  };

  const removeRequirement = (requirementId: string) => {
    onRequirementsChange(requirements.filter((requirement) => requirement.id !== requirementId));
    onParticipantsChange((current) =>
      current.map((participant) => ({
        ...participant,
        requirements: (participant.requirements || []).filter(
          (requirement) => requirement.id !== requirementId
        ),
      }))
    );
  };

  return (
    <div className="space-y-1.5">
      <div className="rounded-lg px-3 py-2 hover:bg-gray-50">
        <label className="group/option flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={inPersonEnabled}
            onChange={(event) => {
              const enabled = event.target.checked;
              onInPersonEnabledChange(enabled);
              if (!enabled) {
                onParticipantsChange((current) =>
                  current.map((participant) => ({ ...participant, deliveryMode: 'remote' }))
                );
              }
            }}
            className="h-4 w-4 rounded border-gray-300 accent-primary"
          />
          <span className="flex-1 text-sm font-normal text-gray-700">Activar firma presencial</span>
          <InfoTooltip
            showOnParentHover
            text="Permite que uno o más participantes firmen presencialmente en este dispositivo."
          />
        </label>

        {inPersonEnabled && (
          <div className="ml-7 mt-2 rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-600 text-slate-700">
              ¿A quién se le recolectará presencialmente?
            </p>
            {eligibleSigners.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                Agrega y configura firmantes en el paso Participantes para asignarlos.
              </p>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {eligibleSigners.map((participant) => (
                  <label
                    key={participant.id}
                    className="flex cursor-pointer items-center gap-2 text-xs text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={participant.deliveryMode === 'in_person'}
                      onChange={(event) =>
                        setInPersonParticipant(participant.id, event.target.checked)
                      }
                      className="h-4 w-4 rounded border-slate-300 accent-primary"
                    />
                    <span className="truncate">{participantLabel(participant)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <PackageConfiguration
        resources={resources}
        onChange={onResourcesChange}
        participants={participants}
        onParticipantsChange={onParticipantsChange}
      />

      <div>
        <button
          type="button"
          onClick={() => setRequirementsOpen(true)}
          className="group/option flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-gray-50"
        >
          <input
            type="checkbox"
            checked={requirements.length > 0}
            readOnly
            tabIndex={-1}
            className="pointer-events-none h-4 w-4 rounded border-gray-300 accent-primary"
          />
          <span className="flex-1 text-sm font-normal !font-normal text-gray-700">
            Solicitar documentos a los participantes
          </span>
          {requirements.length > 0 && (
            <span className="text-xs text-slate-500">{requirements.length}</span>
          )}
          <InfoTooltip
            showOnParentHover
            text="Define los documentos que determinados participantes deberán entregar."
          />
        </button>
      </div>

      {requirementsOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="requirements-title"
            className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <div>
                <h2 id="requirements-title" className="text-lg font-600 text-slate-950">
                  Documentos requeridos
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Agrega requisitos y elige a qué participantes se solicitarán.
                </p>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                <div>
                  <label className="mb-1.5 block text-xs font-600 text-slate-600">
                    Nombre del requisito *
                  </label>
                  <input
                    value={requirementName}
                    onChange={(event) => {
                      setRequirementName(event.target.value);
                      setError('');
                    }}
                    maxLength={180}
                    placeholder="Ej. Identificación oficial"
                    className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                  />
                </div>
                <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={requirementRequired}
                    onChange={(event) => setRequirementRequired(event.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  Obligatorio
                </label>
                <button
                  type="button"
                  onClick={addRequirement}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-600 text-white hover:bg-primary/90"
                >
                  <Plus size={15} /> Agregar
                </button>
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}

              {requirements.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                  Aún no has agregado requisitos documentales.
                </div>
              ) : (
                <div className="space-y-3">
                  {requirements.map((requirement) => (
                    <div key={requirement.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-600 text-slate-900">
                            {requirement.name}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {requirement.required ? 'Obligatorio' : 'Opcional'} · PDF, JPG o PNG
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeRequirement(requirement.id)}
                          aria-label={`Eliminar ${requirement.name}`}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        <p className="mb-2 text-xs font-600 text-slate-600">Solicitar a:</p>
                        {participants.length === 0 ? (
                          <p className="text-xs text-slate-500">
                            Agrega participantes para asignar este requisito.
                          </p>
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {participants.map((participant) => (
                              <label
                                key={participant.id}
                                className="flex cursor-pointer items-center gap-2 text-xs text-slate-700"
                              >
                                <input
                                  type="checkbox"
                                  checked={(participant.requirements || []).some(
                                    (item) => item.id === requirement.id
                                  )}
                                  onChange={(event) =>
                                    setRequirementParticipant(
                                      requirement,
                                      participant.id,
                                      event.target.checked
                                    )
                                  }
                                  className="h-4 w-4 rounded border-slate-300 accent-primary"
                                />
                                <span className="truncate">{participantLabel(participant)}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                onClick={() => setRequirementsOpen(false)}
                className="h-9 rounded-lg border border-slate-200 px-4 text-sm font-600 text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => setRequirementsOpen(false)}
                className="h-9 rounded-lg bg-primary px-4 text-sm font-600 text-white hover:bg-primary/90"
              >
                Guardar configuración
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
