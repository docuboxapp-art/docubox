'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, Layers, Loader2, Save, Search, Tag, X } from 'lucide-react';
import { snapshotPdfSectionLayout, useFormBuilder } from '@/contexts/FormBuilderContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { ExperienceOption, InfoTooltip } from '@/components/forms/ExperienceOption';
import { FormTypographySelect } from '@/components/forms/FormTypographySelect';
import { hasFormExperienceChanges, snapshotFormExperience } from '@/lib/forms/experience-defaults';
import { normalizeFormAppearanceDefaults, reusableFormAppearance } from '@/lib/forms/appearance-defaults';
import { normalizeFormPdfDefaults, PDF_CONTENT_OPTIONS } from '@/lib/forms/pdf-defaults';
import { formDefaultsErrorMessage, loadFormDefaults, saveFormDefault } from '@/lib/forms/remote-defaults';
import { formSaveError } from '@/lib/forms/lifecycle';
import { FormDesignSaveError, saveFormAndDesignDefaults } from '@/lib/forms/design-save';
import { WizardDesignPreview } from './WizardDesignPreview';
import { createClient } from '@/lib/supabase/client';
import {
  DocumentTypeModal,
  TagsModal,
  type CatalogTag,
  type DocumentType,
  type DocumentTypeGroup,
} from '@/components/catalog/CatalogSelectionModals';

const formInputBaseClass =
  'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-border dark:bg-background dark:text-foreground';
const formInputClass = `w-full ${formInputBaseClass}`;

export function GeneralSettings() {
  const { state, dispatch } = useFormBuilder();
  const { activeWorkspace } = useWorkspace();
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [groups, setGroups] = useState<DocumentTypeGroup[]>([]);
  const [tags, setTags] = useState<CatalogTag[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [experienceError, setExperienceError] = useState('');
  const defaultsRevision = useRef(0);
  const [expirationUnit, setExpirationUnit] = useState<'minutes' | 'hours'>(() =>
    state.template.settings.expirationHours < 1 || !Number.isInteger(state.template.settings.expirationHours)
      ? 'minutes' : 'hours'
  );
  const [picker, setPicker] = useState<'types' | 'tags' | null>(null);
  const settings = state.template.settings;
  const experienceChanged = hasFormExperienceChanges(settings, state.savedExperience);
  const invalidExpiration = settings.configureLinkExpiration &&
    (!Number.isFinite(settings.expirationHours) || settings.expirationHours < 1 / 60 || settings.expirationHours > 720);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    let active = true;
    const revision = defaultsRevision.current;
    void loadFormDefaults(activeWorkspace.id).then((defaults) => {
      if (active && defaultsRevision.current === revision) {
        dispatch({ type: 'SAVE_EXPERIENCE_DEFAULTS', payload: defaults.experience });
        setExperienceError('');
      }
    }).catch((error) => { if (active && defaultsRevision.current === revision) setExperienceError(formDefaultsErrorMessage(error)); });
    return () => { active = false; };
  }, [activeWorkspace?.id, dispatch]);

  const saveExperienceDefaults = async () => {
    if (!activeWorkspace?.id) {
      setExperienceError('Selecciona un espacio de trabajo antes de guardar estas opciones.');
      return;
    }
    if (invalidExpiration) return;
    defaultsRevision.current += 1;
    try {
      const values = snapshotFormExperience(settings);
      const saved = await saveFormDefault(activeWorkspace.id, 'experience', values);
      dispatch({ type: 'SAVE_EXPERIENCE_DEFAULTS', payload: saved });
      setExperienceError('');
    } catch (error) {
      setExperienceError(formDefaultsErrorMessage(error));
    }
  };

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void Promise.all([
      supabase.from('grupo_tipo_documento').select('id, nombre').order('nombre'),
      supabase.from('tipo_documento').select('id, nombre, grupo_id').order('nombre'),
      supabase.from('etiquetas').select('id, nombre, color').order('nombre'),
    ]).then(([groupResult, typeResult, tagResult]) => {
      if (!active) return;
      if (groupResult.error || typeResult.error || tagResult.error)
        setCatalogError('No se pudieron cargar los catálogos.');
      if (!groupResult.error) setGroups(groupResult.data || []);
      if (!typeResult.error) setTypes(typeResult.data || []);
      if (!tagResult.error) setTags(tagResult.data || []);
    });
    return () => {
      active = false;
    };
  }, []);

  const selectedType = types.find((item) => item.id === settings.documentTypeId);
  const selectedTags = tags.filter((item) => settings.tagIds.includes(item.id));
  return (
    <div className="mx-auto grid w-full max-w-[1480px] grid-cols-1 items-start gap-5 p-5 sm:p-8 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-border dark:bg-card">
        <div className="mb-5">
          <h2 className="text-base font-medium text-slate-950 dark:text-foreground">
            Propiedades del formulario
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Define la información y clasificación del formulario.
          </p>
        </div>
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700 dark:text-foreground">Acceso al formulario</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                { value: 'private', title: 'Invitación privada', description: 'Se envía a una persona. Accede por el portal de invitaciones y crea su cuenta si es su primera vez.' },
                { value: 'public', title: 'Enlace público', description: 'Cualquier persona con una cuenta de Docubox puede responder. Se solicitará prueba de vida al firmar.' },
              ] as const).map((option) => (
                <label key={option.value} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${settings.accessMode === option.value ? 'border-primary bg-blue-50/60' : 'border-slate-200 bg-white dark:border-border dark:bg-card'}`}>
                  <input type="radio" name="form-access-mode" value={option.value} checked={settings.accessMode === option.value} onChange={() => dispatch({ type: 'SET_SETTINGS', payload: { accessMode: option.value, allowedSignatureTypes: option.value === 'public' ? ['autografa_digital'] : [] } })} className="mt-1 accent-primary" />
                  <span><span className="block text-sm font-medium text-slate-900 dark:text-foreground">{option.title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-foreground">
              Nombre del formulario <span className="text-red-500">*</span>
            </span>
            <input
              value={state.template.name}
              onChange={(event) =>
                dispatch({ type: 'SET_TEMPLATE_META', payload: { name: event.target.value } })
              }
              placeholder="Nombre del formulario"
              className={formInputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-foreground">
              Descripción
            </span>
            <textarea
              value={state.template.description}
              onChange={(event) =>
                dispatch({
                  type: 'SET_TEMPLATE_META',
                  payload: { description: event.target.value },
                })
              }
              placeholder="Añade un resumen o notas sobre el contenido del formulario."
              rows={3}
              className={`${formInputClass} h-auto resize-none py-2.5`}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-foreground">
              Número o clave del formulario
            </span>
            <input
              value={settings.documentNumber}
              onChange={(event) =>
                dispatch({ type: 'SET_SETTINGS', payload: { documentNumber: event.target.value } })
              }
              placeholder="Ej. FORM-2026-001"
              className={formInputClass}
            />
          </label>
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-foreground">
              <Layers size={14} className="text-slate-400" />
              Tipo de formulario <span className="font-normal text-slate-400">(Opcional)</span>
            </label>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  readOnly
                  value={selectedType?.nombre || ''}
                  placeholder="Seleccionar tipo de formulario..."
                  className={`${formInputClass} pr-8`}
                />
                {settings.documentTypeId && (
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({ type: 'SET_SETTINGS', payload: { documentTypeId: '', documentTypeName: '' } })
                    }
                    aria-label="Quitar tipo de formulario"
                    className="absolute right-2.5 top-3 text-slate-400 hover:text-slate-600"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPicker('types')}
                className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-border dark:bg-card dark:text-foreground"
              >
                <Search size={14} />
                Buscar
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-foreground">
              <Tag size={14} className="text-slate-400" />
              Etiquetas
            </label>
            <div className="flex gap-2">
              <div className="flex min-h-10 min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-border dark:bg-background">
                {selectedTags.length ? (
                  selectedTags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: tag.color || '#64748B' }}
                      />
                      {tag.nombre}
                      <button
                        type="button"
                        onClick={() =>
                          dispatch({
                            type: 'SET_SETTINGS',
                            payload: { tagIds: settings.tagIds.filter((id) => id !== tag.id) },
                          })
                        }
                        aria-label={`Quitar etiqueta ${tag.nombre}`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="text-slate-400">Seleccionar etiquetas...</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPicker('tags')}
                className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-border dark:bg-card dark:text-foreground"
              >
                <Search size={14} />
                Buscar
              </button>
            </div>
          </div>
          {catalogError && (
            <p role="alert" className="text-sm text-red-600">
              {catalogError}
            </p>
          )}
        </div>
      </section>
      <aside className="h-fit xl:sticky xl:top-5 xl:max-h-[calc(100dvh-220px)] xl:overflow-y-auto">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-border dark:bg-card">
          <h2 className="text-base font-medium leading-5 text-slate-950 dark:text-foreground">
            Experiencia del participante
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">
            Define cómo se presenta y guarda la captura.
          </p>
          <div className="mt-5 divide-y divide-slate-100 dark:divide-border">
            <ExperienceOption
              title="Mostrar por pasos"
              description="Presenta una sección del formulario a la vez."
              checked={settings.multiStep}
              onChange={(value) =>
                dispatch({
                  type: 'SET_SETTINGS',
                  payload: { multiStep: value, mode: value ? 'multistep' : 'scroll' },
                })
              }
            />
            <ExperienceOption
              title="Permitir guardar avance"
              description="Guarda las respuestas en este navegador para retomarlas después."
              checked={settings.allowSaveProgress}
              onChange={(value) =>
                dispatch({ type: 'SET_SETTINGS', payload: { allowSaveProgress: value } })
              }
            />
            <ExperienceOption
              title="Configurar diseño del formulario"
              description="Añade el paso Diseño para personalizar el formulario web."
              checked={settings.configureFormDetails}
              onChange={(value) =>
                dispatch({ type: 'SET_SETTINGS', payload: { configureFormDetails: value } })
              }
            />
            <ExperienceOption
              title="Configurar diseño del PDF"
              description="Añade el paso PDF para personalizar el documento generado."
              checked={settings.configurePdfDetails}
              onChange={(value) =>
                dispatch({ type: 'SET_SETTINGS', payload: { configurePdfDetails: value } })
              }
            />
            <div className="flex items-start gap-3 border-t border-slate-100 py-4 text-sm dark:border-border">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900 dark:text-foreground">Firma obligatoria</p>
                <p className="mt-1 text-xs text-slate-500">Agrega el campo Firma en Contenido para publicar el formulario. El tipo de firma se elige al lanzarlo.</p>
              </div>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-primary">Siempre activa</span>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-1 dark:border-border">
            <ExperienceOption
              title="Establecer vigencia del enlace"
              description="Define la vigencia sugerida al compartirlo. Si se omite, se usan 72 horas."
              checked={settings.configureLinkExpiration}
              onChange={(value) =>
                dispatch({ type: 'SET_SETTINGS', payload: { configureLinkExpiration: value } })
              }
            />
          </div>
          {settings.configureLinkExpiration && <div className="border-t border-slate-100 pt-4 dark:border-border">
            <div className="flex items-center gap-1">
              <label htmlFor="form-link-expiration" className="text-sm font-medium text-slate-700 dark:text-foreground">
                Vigencia predeterminada del enlace
              </label>
              <InfoTooltip label="Vigencia predeterminada del enlace" description="Puedes ajustarla para cada envío al compartir el formulario." />
            </div>
            <div className="mt-2 flex gap-2">
              <input
                id="form-link-expiration"
                type="number"
                min={expirationUnit === 'minutes' ? 1 : 1 / 60}
                step={expirationUnit === 'minutes' ? 1 : 'any'}
                max={expirationUnit === 'minutes' ? 43200 : 720}
                value={settings.expirationHours > 0 ? expirationUnit === 'minutes' ? Math.round(settings.expirationHours * 60) : Number(settings.expirationHours.toFixed(2)) : ''}
                onChange={(event) =>
                  dispatch({
                    type: 'SET_SETTINGS',
                    payload: { expirationHours: (Number(event.target.value) || 0) / (expirationUnit === 'minutes' ? 60 : 1) },
                  })
                }
                aria-invalid={settings.expirationHours < 1 / 60 || settings.expirationHours > 720}
                className={`${formInputBaseClass} min-w-0 flex-1`}
              />
              <select
                aria-label="Unidad de vigencia"
                value={expirationUnit}
                onChange={(event) => setExpirationUnit(event.target.value as 'minutes' | 'hours')}
                className={`${formInputBaseClass} w-28 shrink-0`}
              >
                <option value="minutes">Minutos</option>
                <option value="hours">Horas</option>
              </select>
            </div>
            {(settings.expirationHours < 1 / 60 || settings.expirationHours > 720) && (
              <p className="mt-1 text-xs text-red-600">Elige entre 1 minuto y 720 horas.</p>
            )}
          </div>}
          <div className="mt-4 border-t border-slate-100 pt-4 dark:border-border">
            {(experienceChanged || Boolean(experienceError)) && state.template.status === 'draft' && (
              <button
                type="button"
                onClick={saveExperienceDefaults}
                disabled={state.isSaving || invalidExpiration}
                title="Guardar solo estas opciones como predeterminadas"
                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {state.isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {state.isSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            )}
            {!experienceChanged && !experienceError && (
              <span role="status" className="flex items-center gap-2 text-xs text-slate-500 dark:text-muted-foreground">
                <Check size={14} className="text-emerald-600" /> Configuración aplicada
              </span>
            )}
            {experienceError && <p role="alert" className="mt-2 text-xs text-red-600">{experienceError}</p>}
          </div>
        </section>
      </aside>
      {picker === 'types' && (
        <DocumentTypeModal
          types={types}
          groups={groups}
          selectedId={settings.documentTypeId}
          onSelect={(id) => {
            dispatch({ type: 'SET_SETTINGS', payload: {
              documentTypeId: id,
              documentTypeName: types.find((item) => item.id === id)?.nombre || '',
            } });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'tags' && (
        <TagsModal
          tags={tags}
          selectedIds={settings.tagIds}
          onConfirm={(ids) => {
            dispatch({ type: 'SET_SETTINGS', payload: { tagIds: ids } });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

export function FormAppearanceSettings({ onSaveForm }: { onSaveForm: () => Promise<string | undefined> }) {
  const { state, dispatch } = useFormBuilder();
  const { activeWorkspace } = useWorkspace();
  const appearance = state.template.settings.appearance;
  const update = (payload: Partial<typeof appearance>) => dispatch({ type: 'SET_APPEARANCE', payload });
  const [saveError, setSaveError] = useState('');
  const [savingDesign, setSavingDesign] = useState(false);
  const [catalogType, setCatalogType] = useState<{ id: string; name: string } | null>(null);
  const documentTypeId = state.template.settings.documentTypeId;
  const documentTypeName = state.template.settings.documentTypeName ||
    (catalogType?.id === documentTypeId ? catalogType.name : '');
  useEffect(() => {
    if (!documentTypeId || state.template.settings.documentTypeName) return;
    let active = true;
    void Promise.resolve(createClient().from('tipo_documento').select('nombre').eq('id', documentTypeId).maybeSingle())
      .then(({ data }) => {
        if (!active) return;
        const name = data?.nombre || '';
        setCatalogType({ id: documentTypeId, name });
        if (name) dispatch({ type: 'SET_SETTINGS', payload: { documentTypeName: name } });
      }).catch(() => { if (active) setCatalogType({ id: documentTypeId, name: '' }); });
    return () => { active = false; };
  }, [dispatch, documentTypeId, state.template.settings.documentTypeName]);
  const hasChanges = JSON.stringify(normalizeFormAppearanceDefaults(appearance)) !==
    JSON.stringify(normalizeFormAppearanceDefaults(state.savedAppearance));

  const saveDefaults = async () => {
    if (!hasChanges || savingDesign) return;
    if (!activeWorkspace?.id) {
      setSaveError('Selecciona un espacio de trabajo antes de guardar el diseño.');
      return;
    }
    setSaveError('');
    setSavingDesign(true);
    try {
      await saveFormAndDesignDefaults(
        onSaveForm,
        () => saveFormDefault(activeWorkspace.id, 'appearance', reusableFormAppearance(appearance))
      );
      dispatch({ type: 'SAVE_APPEARANCE_DESIGN', payload: normalizeFormAppearanceDefaults(appearance) });
      setSaveError('');
    } catch (error) {
      setSaveError(error instanceof FormDesignSaveError && error.stage === 'defaults'
        ? `Se guardó el formulario actual, pero no el diseño predeterminado. ${formDefaultsErrorMessage(error.cause)}`
        : formSaveError(error instanceof FormDesignSaveError ? error.cause : error));
    } finally {
      setSavingDesign(false);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-[1680px] grid-cols-1 items-start gap-5 p-5 sm:p-8 xl:grid-cols-[minmax(0,1fr)_minmax(440px,0.85fr)]">
      <div className="min-w-0 space-y-5">
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card">
          <h2 className="text-base font-medium text-slate-950 dark:text-foreground">Encabezado del formulario</h2>
          <p className="mt-1 text-sm text-slate-500">Define la identidad visible al abrir el formulario.</p>
          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Texto superior</span>
              <input value={appearance.headerText || state.template.name} onChange={(event) => update({ headerText: event.target.value })} maxLength={120} placeholder="Nombre del formulario" className={formInputClass} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Descripción visible</span>
              <textarea value={appearance.headerDescription || state.template.description} onChange={(event) => update({ headerDescription: event.target.value })} maxLength={500} rows={3} placeholder="Descripción del formulario" className={`${formInputClass} h-auto resize-y py-2.5`} />
            </label>
            <p className="text-xs text-slate-500">Estos textos solo cambian la vista del participante. Si los dejas vacíos, se usan el nombre y la descripción de General.</p>
            <div className="space-y-4">
              <div>
                <span className="mb-1.5 block text-sm font-medium">Número o clave del formulario</span>
                <div className={`${formInputClass} flex items-center truncate bg-slate-50 text-slate-600 dark:bg-muted`}>{state.template.settings.documentNumber || 'Sin código'}</div>
              </div>
              <div>
                <span className="mb-1.5 block text-sm font-medium">Tipo de formulario</span>
                <div className={`${formInputClass} flex items-center truncate bg-slate-50 text-slate-600 dark:bg-muted`}>{documentTypeName || 'Sin tipo seleccionado'}</div>
              </div>
            </div>
            <p className="text-xs text-slate-500">El código y el tipo se eligen en General.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Alineación</span>
                <select value={appearance.headerAlignment} onChange={(event) => update({ headerAlignment: event.target.value as typeof appearance.headerAlignment })} className={formInputClass}>
                  <option value="left">Izquierda</option><option value="center">Centro</option><option value="right">Derecha</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Color principal</span>
                <span className="flex h-10 items-center gap-3 rounded-lg border border-slate-200 px-3 dark:border-border">
                  <input type="color" aria-label="Color principal del formulario" value={appearance.accentColor} onChange={(event) => update({ accentColor: event.target.value })} className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0" />
                  <span className="font-mono text-sm text-slate-600">{appearance.accentColor}</span>
                </span>
              </label>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-border">
              <ExperienceOption title="Mostrar encabezado" checked={appearance.showHeader} onChange={(showHeader) => update({ showHeader })} />
              <ExperienceOption title="Mostrar nombre del formulario" checked={appearance.showTitle} onChange={(showTitle) => update({ showTitle })} />
              <ExperienceOption title="Mostrar franja de color" checked={appearance.showAccentBar} onChange={(showAccentBar) => update({ showAccentBar })} />
              <ExperienceOption title="Mostrar descripción del formulario" checked={appearance.showDescription} onChange={(showDescription) => update({ showDescription })} />
              <ExperienceOption title="Mostrar número o clave" checked={appearance.showDocumentNumber} onChange={(showDocumentNumber) => update({ showDocumentNumber })} />
              <ExperienceOption title="Mostrar tipo de formulario" checked={appearance.showDocumentType} onChange={(showDocumentType) => update({ showDocumentType })} />
              <ExperienceOption title="Mostrar barra de progreso" description="Indica cuánto falta para completar el formulario." checked={appearance.showProgressBar} onChange={(showProgressBar) => update({ showProgressBar })} />
            </div>
          </div>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card">
          <h2 className="text-base font-medium text-slate-950 dark:text-foreground">Contenido y estructura</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Ancho del formulario</span>
              <select value={appearance.width} onChange={(event) => update({ width: event.target.value as typeof appearance.width })} className={formInputClass}>
                <option value="standard">Estándar</option><option value="wide">Amplio</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Tipografía</span>
              <FormTypographySelect value={appearance.typography} onChange={(typography) => update({ typography })} className={formInputClass} />
            </label>
          </div>
          <div className="mt-4 divide-y divide-slate-100 dark:divide-border">
            <ExperienceOption title="Numerar secciones" checked={appearance.showSectionNumbers} onChange={(showSectionNumbers) => update({ showSectionNumbers })} />
            <ExperienceOption title="Mostrar descripciones de secciones" checked={appearance.showSectionDescriptions} onChange={(showSectionDescriptions) => update({ showSectionDescriptions })} />
            <ExperienceOption title="Espaciado compacto" checked={appearance.compactSpacing} onChange={(compactSpacing) => update({ compactSpacing })} />
          </div>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card">
          <h2 className="text-base font-medium text-slate-950 dark:text-foreground">Pie y cierre</h2>
          <div className="mt-5 space-y-4">
            <ExperienceOption title="Mostrar pie del formulario" checked={appearance.showFooter} onChange={(showFooter) => update({ showFooter })} />
            {appearance.showFooter && <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
              <label className="block"><span className="mb-1.5 block text-sm font-medium">Texto del pie</span><input value={appearance.footerText} onChange={(event) => update({ footerText: event.target.value })} maxLength={200} className={formInputClass} /></label>
              <label className="block"><span className="mb-1.5 block text-sm font-medium">Alineación</span><select value={appearance.footerAlignment} onChange={(event) => update({ footerAlignment: event.target.value as typeof appearance.footerAlignment })} className={formInputClass}><option value="left">Izquierda</option><option value="center">Centro</option><option value="right">Derecha</option></select></label>
            </div>}
            <label className="block"><span className="mb-1.5 block text-sm font-medium">Mensaje tras enviar</span><textarea rows={2} value={appearance.confirmationMessage} onChange={(event) => update({ confirmationMessage: event.target.value })} maxLength={300} className={formInputClass + ' h-auto resize-y py-2.5'} /><span className="mt-1 block text-xs text-slate-500">Se muestra después de registrar la respuesta.</span></label>
          </div>
        </section>
      </div>
      <WizardDesignPreview mode="web" hasChanges={hasChanges} isSaving={savingDesign || state.isSaving} onSaveDefaults={saveDefaults} saveError={hasChanges ? saveError : ''} documentTypeName={documentTypeName} />
    </div>
  );
}

export function PdfSettings({ onSaveForm }: { onSaveForm: () => Promise<string | undefined> }) {
  const { state, dispatch } = useFormBuilder();
  const { activeWorkspace } = useWorkspace();
  const pdf = state.template.settings.pdfSchema;
  const [saveError, setSaveError] = useState('');
  const [savingDesign, setSavingDesign] = useState(false);
  const hasChanges = JSON.stringify(normalizeFormPdfDefaults({ pdfSchema: pdf }).pdfSchema) !==
    JSON.stringify(normalizeFormPdfDefaults({ pdfSchema: state.savedPdfSchema }).pdfSchema) ||
    JSON.stringify(snapshotPdfSectionLayout(state.template.sections)) !== JSON.stringify(state.savedPdfSections);

  const saveDefaults = async () => {
    if (!hasChanges || savingDesign) return;
    if (!activeWorkspace?.id) {
      setSaveError('Selecciona un espacio de trabajo antes de guardar el diseño del PDF.');
      return;
    }
    setSaveError('');
    setSavingDesign(true);
    try {
      const saved = await saveFormAndDesignDefaults(
        onSaveForm,
        () => saveFormDefault(activeWorkspace.id, 'pdf', {
          configurePdfDetails: state.template.settings.configurePdfDetails,
          pdfSchema: pdf,
        })
      );
      dispatch({ type: 'SAVE_PDF_DESIGN', payload: { pdfSchema: saved.pdfSchema, sections: state.template.sections } });
      setSaveError('');
    } catch (error) {
      setSaveError(error instanceof FormDesignSaveError && error.stage === 'defaults'
        ? `Se guardó el formulario actual, pero no el diseño predeterminado del PDF. ${formDefaultsErrorMessage(error.cause)}`
        : formSaveError(error instanceof FormDesignSaveError ? error.cause : error));
    } finally {
      setSavingDesign(false);
    }
  };
  return (
    <div className="mx-auto grid w-full max-w-[1680px] grid-cols-1 items-start gap-5 p-5 sm:p-8 xl:grid-cols-[minmax(0,1fr)_minmax(440px,0.85fr)]">
      <div className="min-w-0 space-y-5">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-border dark:bg-card">
          <h2 className="text-base font-medium text-slate-950 dark:text-foreground">
            Identidad del PDF
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Define la identidad y el formato del documento generado.
          </p>
          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-foreground">
                Encabezado
              </span>
              <input
                value={pdf.header}
                onChange={(event) =>
                  dispatch({ type: 'SET_PDF_SCHEMA', payload: { header: event.target.value } })
                }
                className={formInputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-foreground">
                Pie de página
              </span>
              <textarea
                value={pdf.footer}
                onChange={(event) =>
                  dispatch({ type: 'SET_PDF_SCHEMA', payload: { footer: event.target.value } })
                }
                rows={3}
                className={`${formInputClass} h-auto resize-none py-2.5`}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-foreground">
                  Tamaño de página
                </span>
                <select
                  value={pdf.pageSize}
                  onChange={(event) =>
                    dispatch({
                      type: 'SET_PDF_SCHEMA',
                      payload: { pageSize: event.target.value as 'letter' | 'a4' },
                    })
                  }
                  className={formInputClass}
                >
                  <option value="letter">Carta</option>
                  <option value="a4">A4</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-foreground">
                  Color principal
                </span>
                <span className="flex h-10 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 dark:border-border dark:bg-background">
                  <input
                    type="color"
                    value={pdf.primaryColor}
                    onChange={(event) =>
                      dispatch({
                        type: 'SET_PDF_SCHEMA',
                        payload: { primaryColor: event.target.value },
                      })
                    }
                    className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0"
                  />
                  <span className="font-mono text-sm text-slate-600 dark:text-muted-foreground">
                    {pdf.primaryColor}
                  </span>
                </span>
              </label>
            </div>
          </div>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card"><h2 className="text-base font-medium">Formato y distribución</h2><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-foreground">Orientación</span><select value={pdf.orientation} onChange={(event) => dispatch({ type: 'SET_PDF_SCHEMA', payload: { orientation: event.target.value as 'portrait' | 'landscape' } })} className={formInputClass}><option value="portrait">Vertical</option><option value="landscape">Horizontal</option></select></label><label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-foreground">Márgenes</span><select value={pdf.margins} onChange={(event) => dispatch({ type: 'SET_PDF_SCHEMA', payload: { margins: event.target.value as 'normal' | 'narrow' | 'wide' } })} className={formInputClass}><option value="normal">Normales</option><option value="narrow">Estrechos</option><option value="wide">Amplios</option></select></label><label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-foreground">Tipografía</span><FormTypographySelect value={pdf.typography} onChange={(typography) => dispatch({ type: 'SET_PDF_SCHEMA', payload: { typography } })} className={formInputClass} /></label><label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-foreground">Alineación del encabezado</span><select value={pdf.headerAlignment} onChange={(event) => dispatch({ type: 'SET_PDF_SCHEMA', payload: { headerAlignment: event.target.value as 'left' | 'center' | 'right' } })} className={formInputClass}><option value="left">Izquierda</option><option value="center">Centro</option><option value="right">Derecha</option></select></label><label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-foreground">Distribución de respuestas</span><select value={pdf.columns} onChange={(event) => dispatch({ type: 'SET_PDF_SCHEMA', payload: { columns: event.target.value as 'one' | 'two' } })} className={formInputClass}><option value="one">Una columna</option><option value="two">Dos columnas</option></select></label></div><ExperienceOption title="Numerar secciones" checked={pdf.showSectionNumbers} onChange={(value) => dispatch({ type: 'SET_PDF_SCHEMA', payload: { showSectionNumbers: value } })} /><ExperienceOption title="Mostrar descripción del formulario" checked={pdf.showDescription} onChange={(value) => dispatch({ type: 'SET_PDF_SCHEMA', payload: { showDescription: value } })} /><ExperienceOption title="Incluir campos sin respuesta" checked={pdf.showUnanswered} onChange={(value) => dispatch({ type: 'SET_PDF_SCHEMA', payload: { showUnanswered: value } })} /></section>
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-border dark:bg-card">
          <h2 className="text-base font-medium text-slate-950 dark:text-foreground">
            Secciones del PDF
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Controla qué secciones aparecen y dónde inicia cada una.
          </p>
          <div className="mt-4 divide-y divide-slate-100 dark:divide-border">
            {state.template.sections.map((section) => (
              <div key={section.id} className="py-3 first:pt-0 last:pb-0">
                <h3 className="break-words text-sm font-medium text-slate-800 dark:text-foreground">
                  {section.title}
                </h3>
                <div className="mt-2 grid gap-x-8 sm:grid-cols-2">
                  <ExperienceOption
                    title="Mostrar en PDF"
                    checked={section.showInPdf}
                    onChange={(showInPdf) =>
                      dispatch({
                        type: 'UPDATE_SECTION',
                        payload: { id: section.id, updates: { showInPdf } },
                      })
                    }
                  />
                  <ExperienceOption
                    title="Salto de página antes"
                    checked={section.pageBreakBefore}
                    onChange={(pageBreakBefore) =>
                      dispatch({
                        type: 'UPDATE_SECTION',
                        payload: { id: section.id, updates: { pageBreakBefore } },
                      })
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card">
          <h2 className="text-base font-medium text-slate-950 dark:text-foreground">Contenido automático</h2>
          <p className="mt-1 text-sm text-slate-500">Controla qué datos y hojas se incluyen en el documento.</p>
          <div className="mt-4 grid gap-x-6 divide-y divide-slate-100 dark:divide-border sm:grid-cols-2 sm:divide-y-0">
            <PdfToggles />
          </div>
        </section>
      </div>
      <WizardDesignPreview mode="pdf" hasChanges={hasChanges} isSaving={savingDesign || state.isSaving} onSaveDefaults={saveDefaults} saveError={hasChanges ? saveError : ''} />
    </div>
  );
}

function PdfToggles() {
  const { state, dispatch } = useFormBuilder();
  const pdf = state.template.settings.pdfSchema;
  return (
    <>
      {PDF_CONTENT_OPTIONS.map(([key, label]) => (
        <ExperienceOption
          key={key}
          title={label}
          checked={Boolean(pdf[key])}
          onChange={(value) => dispatch({ type: 'SET_PDF_SCHEMA', payload: { [key]: value } })}
        />
      ))}
    </>
  );
}
