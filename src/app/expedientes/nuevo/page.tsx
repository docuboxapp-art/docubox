'use client';

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Copy,
  ChevronDown,
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  ClipboardList,
  Eye,
  FilePlus2,
  FileText,
  FolderKanban,
  Layers,
  LayoutTemplate,
  Loader2,
  Maximize2,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings2,
  Tag,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createClient } from '@/lib/supabase/client';
import { caseRequest } from '@/lib/case-files/runtime-client';
import {
  emptyCaseTemplate,
  fromPresetCaseTemplate,
  itemKindLabel,
  newCaseTemplateItem,
  parseStoredCaseTemplate,
  presetCaseTemplates,
  type CaseTemplateDraft,
  type CaseTemplateItem,
  type CaseTemplateItemKind,
  type CaseTemplateSection,
  type StoredCaseTemplate,
} from '@/lib/case-files/template-builder';
import {
  documentRequirementCategories,
  type DocumentRequirementCatalogItem,
} from '@/lib/case-files/template-catalog';
import { caseCategories, caseTags } from '@/lib/case-files/category-catalog';
import {
  isCaseWizardStepEnabled,
  readCaseDefaults,
  writeCaseDefaults,
} from '@/lib/case-files/experience';
import { duplicateContentItem, removeContentSection } from '@/lib/case-files/content';
import { resolvedCaseWorkflow, validateCaseWorkflow } from '@/lib/case-files/workflow';
import { CaseExperiencePanel } from '@/components/case-files/CaseExperiencePanel';
import { DocumentTypeModal, TagsModal } from '@/components/catalog/CatalogSelectionModals';
import { RequirementCatalog, VerificationStep } from './CaseWorkflowBuilder';
import { CaseReviewCloseStep } from './CaseReviewCloseStep';
import { CaseDesignStep } from './CaseDesignStep';

type CatalogItem = { id: string; name: string; version: string | null; revision: number | null };
type Catalogs = Record<'document_template' | 'form', CatalogItem[]>;
type SavedRequirement = {
  id: string;
  name: string;
  description: string;
  category_key: string;
  defaults?: { instructions?: string };
  scope: 'personal' | 'workspace';
};
const blankCatalogs: Catalogs = { document_template: [], form: [] };
const steps = [
  {
    id: 'general',
    label: 'General',
    icon: FolderKanban,
    description: 'Define la identidad y clasificación del tipo de expediente.',
  },
  {
    id: 'content',
    label: 'Contenido',
    icon: LayoutTemplate,
    description: 'Organiza secciones, documentos y formularios.',
  },
  {
    id: 'verification',
    label: 'Verificaciones',
    icon: CheckCircle2,
    description: 'Configura controles de identidad y cumplimiento cuando apliquen.',
  },
  {
    id: 'stages',
    label: 'Revisión y cierre',
    icon: ClipboardList,
    description:
      'Define cómo se revisa la información, quién autoriza el expediente y cuándo se considera completado.',
  },
  {
    id: 'design',
    label: 'Diseño',
    icon: Palette,
    description: 'Personaliza la presentación del expediente.',
  },
  {
    id: 'preview',
    label: 'Vista previa',
    icon: Eye,
    description: 'Revisa la estructura que se usará al abrir un expediente.',
  },
  {
    id: 'publish',
    label: 'Publicación',
    icon: CheckCircle2,
    description: 'Guarda un borrador o deja disponible este tipo de expediente.',
  },
] as const;
const sourceKinds: { kind: CaseTemplateItemKind; icon: LucideIcon; description: string }[] = [
  {
    kind: 'requested_document',
    icon: FileText,
    description: 'Solicita al participante un archivo para este requisito.',
  },
  {
    kind: 'new_document',
    icon: FilePlus2,
    description: 'Prepara un documento de trabajo independiente al abrir cada expediente.',
  },
  {
    kind: 'existing_document',
    icon: FileText,
    description: 'Elige un documento en progreso al abrir cada expediente.',
  },
  {
    kind: 'document_template',
    icon: LayoutTemplate,
    description: 'Convierte una plantilla en documento al usarla.',
  },
  {
    kind: 'form',
    icon: ClipboardList,
    description: 'Incluye un formulario publicado en el expediente.',
  },
];
const inputClass =
  'mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-background dark:text-foreground';
const secondaryClass =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-primary/30 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-card dark:text-foreground';
const primaryClass =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50';
const generalInputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-border dark:bg-background dark:text-foreground';
const catalogButtonClass =
  'flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-card dark:text-foreground';

export default function NuevoExpedientePage() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const workspaceId = activeWorkspace?.id;
  const initializedForWorkspace = useRef<string | null>(null);
  const [draft, setDraft] = useState<CaseTemplateDraft>(() => emptyCaseTemplate());
  const [savedDraftJson, setSavedDraftJson] = useState<string | null>(null);
  const savingRef = useRef(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string | null>(null);
  const [originalStatus, setOriginalStatus] = useState<StoredCaseTemplate['status'] | null>(null);
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [catalogs, setCatalogs] = useState<Catalogs>(blankCatalogs);
  const [savedRequirements, setSavedRequirements] = useState<SavedRequirement[]>([]);
  const [requirementCatalogError, setRequirementCatalogError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [requirementPickerOpen, setRequirementPickerOpen] = useState(false);
  const [sectionToRemove, setSectionToRemove] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [screenError, setScreenError] = useState('');
  const [errorTone, setErrorTone] = useState<'critical' | 'warning'>('critical');
  const [showValidation, setShowValidation] = useState(false);
  const [notice, setNotice] = useState('');
  const [defaultsNotice, setDefaultsNotice] = useState('');
  const [generalPicker, setGeneralPicker] = useState<'category' | 'type' | 'tags' | null>(null);
  const isDirty = savedDraftJson !== null && savedDraftJson !== JSON.stringify(draft);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isDirty]);

  const loadCatalogs = useCallback(async () => {
    if (!workspaceId) return;
    const supabase = createClient();
    const [templates, forms, requirements] = await Promise.all([
      supabase
        .from('plantillas')
        .select('id,nombre,version_publicada')
        .eq('workspace_id', workspaceId)
        .eq('estado', 'published')
        .order('updated_at', { ascending: false })
        .limit(100),
      supabase
        .from('form_templates')
        .select('id,name,version_number,revision_number')
        .eq('workspace_id', workspaceId)
        .eq('status', 'published')
        .order('updated_at', { ascending: false })
        .limit(100),
      supabase
        .from('case_requirement_catalog')
        .select('id,name,description,category_key,scope,defaults')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .order('name')
        .limit(500),
    ]);
    setCatalogs({
      document_template: (templates.data || []).map((item) => ({
        id: item.id,
        name: item.nombre || 'Plantilla sin nombre',
        version: item.version_publicada == null ? null : String(item.version_publicada),
        revision: null,
      })),
      form: (forms.data || []).map((item) => ({
        id: item.id,
        name: item.name || 'Formulario sin nombre',
        version: item.version_number == null ? null : String(item.version_number),
        revision: item.revision_number ?? null,
      })),
    });
    setCatalogError(
      [templates, forms].some((result) => result.error)
        ? 'No se pudieron cargar todos los recursos. Actualiza la lista para intentar de nuevo.'
        : ''
    );
    setSavedRequirements((requirements.data || []) as SavedRequirement[]);
    setRequirementCatalogError(
      requirements.error ? 'El catálogo personal y de organización aún no está disponible.' : ''
    );
  }, [workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCatalogs();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCatalogs]);

  useEffect(() => {
    if (!activeWorkspace?.id || initializedForWorkspace.current === activeWorkspace.id) return;
    initializedForWorkspace.current = activeWorkspace.id;
    let cancelled = false;
    const initialize = async () => {
      const setInitialDraft = (value: CaseTemplateDraft) => {
        setSavedDraftJson(JSON.stringify(value));
        setDraft(value);
      };
      const params = new URLSearchParams(window.location.search);
      const editId = params.get('id');
      const presetId = params.get('tipo');
      if (editId) {
        const { data, error: loadError } = await createClient()
          .from('case_file_templates')
          .select('*')
          .eq('workspace_id', activeWorkspace.id)
          .eq('id', editId)
          .maybeSingle();
        if (cancelled) return;
        if (loadError || !data)
          setScreenError(
            'No se pudo abrir este tipo de expediente. Puede que ya no esté disponible o que no tengas acceso en este espacio de trabajo.'
          );
        else {
          setTemplateId(data.id);
          setLoadedUpdatedAt(data.updated_at || null);
          setOriginalStatus(data.status as StoredCaseTemplate['status']);
          const editorDraft =
            data.editor_draft &&
            typeof data.editor_draft === 'object' &&
            !Array.isArray(data.editor_draft)
              ? (data.editor_draft as Record<string, unknown>)
              : null;
          setInitialDraft(
            parseStoredCaseTemplate({ ...data, ...(editorDraft || {}) } as StoredCaseTemplate)
          );
        }
      } else if (presetId) {
        const preset = presetCaseTemplates.find((item) => item.id === presetId);
        if (preset && !cancelled)
          setInitialDraft({
            ...fromPresetCaseTemplate(preset),
            ...readCaseDefaults(activeWorkspace.id),
          });
        else if (!preset) {
          const { data } = await createClient()
            .from('case_file_templates')
            .select('id,name,description,case_type,case_subtype,requirements_schema,status')
            .eq('workspace_id', activeWorkspace.id)
            .eq('id', presetId)
            .maybeSingle();
          if (data && !cancelled)
            setInitialDraft({
              ...parseStoredCaseTemplate(data as StoredCaseTemplate),
              ...readCaseDefaults(activeWorkspace.id),
            });
        }
      } else {
        setInitialDraft({ ...emptyCaseTemplate(), ...readCaseDefaults(activeWorkspace.id) });
      }
      if (!cancelled) setLoading(false);
    };
    void initialize();
    return () => {
      cancelled = true;
      initializedForWorkspace.current = null;
    };
  }, [activeWorkspace?.id]);

  const selectedSection =
    draft.sections.find((section) => section.id === activeSectionId) || draft.sections[0];
  const selectedItem =
    draft.sections.flatMap((section) => section.items).find((item) => item.id === activeItemId) ||
    null;
  const itemCount = draft.sections.reduce((count, section) => count + section.items.length, 0);
  const workflowStages = resolvedCaseWorkflow(draft);
  const workflowValidation = validateCaseWorkflow(draft, workflowStages);
  const visibleSteps = steps.filter((entry) => isCaseWizardStepEnabled(entry.id, draft.experience));
  const progress = Math.round((step / (visibleSteps.length - 1)) * 100);
  const activeStep = visibleSteps[step];
  const StepIcon = activeStep.icon;

  const updateSection = (
    sectionId: string,
    update: (section: CaseTemplateSection) => CaseTemplateSection
  ) => {
    setError('');
    setNotice('');
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId ? update(section) : section
      ),
    }));
  };
  const updateItem = (itemId: string, update: (item: CaseTemplateItem) => CaseTemplateItem) => {
    setError('');
    setNotice('');
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => ({
        ...section,
        items: section.items.map((item) => (item.id === itemId ? update(item) : item)),
      })),
    }));
  };
  const addSection = () => {
    const section = {
      id: crypto.randomUUID(),
      title: `Nueva sección ${draft.sections.length + 1}`,
      description: '',
      items: [],
      dueInDays: null,
    };
    setDraft((current) => ({ ...current, sections: [...current.sections, section] }));
    setActiveSectionId(section.id);
    setActiveItemId(null);
  };
  const addItem = (kind: CaseTemplateItemKind) => {
    if (kind === 'requested_document') {
      setRequirementPickerOpen(true);
      return;
    }
    const sectionId = selectedSection?.id;
    if (!sectionId) return;
    const item = newCaseTemplateItem(kind);
    updateSection(sectionId, (section) => ({ ...section, items: [...section.items, item] }));
    setActiveSectionId(sectionId);
    setActiveItemId(item.id);
    setCatalogSearch('');
  };
  const addCatalogRequirement = (catalogItem: DocumentRequirementCatalogItem) => {
    const sectionId = selectedSection?.id;
    if (
      !sectionId ||
      draft.sections.some((section) =>
        section.items.some((item) => item.catalogId === catalogItem.id)
      )
    )
      return;
    const item = {
      ...newCaseTemplateItem('requested_document'),
      title: catalogItem.title,
      description: catalogItem.description,
      catalogId: catalogItem.id,
      instructions: catalogItem.instructions || '',
      documentCategory: catalogItem.categories[0] || 'identity',
      required: catalogItem.defaults?.required ?? false,
      allowedFormats: [...(catalogItem.recommendedFormats || ['PDF', 'JPG', 'PNG'])],
      validityDays: catalogItem.suggestedValidityDays ?? null,
    };
    updateSection(sectionId, (section) => ({ ...section, items: [...section.items, item] }));
    setActiveSectionId(sectionId);
    setActiveItemId(item.id);
  };
  const createRequirement = async (input: {
    name: string;
    description: string;
    categoryKey: string;
    instructions: string;
    scope: 'template' | 'personal' | 'workspace';
  }): Promise<string | null> => {
    if (!input.description.trim()) return 'Escribe la descripción del requisito.';
    if (!selectedSection || !input.name.trim())
      return 'Selecciona una sección y escribe el nombre del requisito.';
    if (
      input.scope === 'workspace' &&
      (activeWorkspace?.workspaceType !== 'business' ||
        !['owner', 'admin'].includes(activeWorkspace.role))
    ) {
      return 'Solo los administradores pueden compartir requisitos en una organización.';
    }
    let catalogId: string | null = null;
    if (input.scope !== 'template') {
      if (!activeWorkspace?.id || !user?.id)
        return 'Selecciona un espacio de trabajo para guardar el requisito.';
      const { data, error: saveError } = await createClient()
        .from('case_requirement_catalog')
        .insert({
          workspace_id: activeWorkspace.id,
          owner_user_id: user.id,
          scope: input.scope,
          kind: 'document',
          name: input.name.trim(),
          description: input.description.trim(),
          category_key: input.categoryKey,
          defaults: { instructions: input.instructions.trim() },
        })
        .select('id')
        .single();
      if (saveError || !data)
        return saveError?.code === '23505'
          ? 'Ya existe un requisito activo con ese nombre en este catálogo.'
          : 'No se pudo guardar el requisito en el catálogo. Revisa tus permisos o intenta de nuevo.';
      catalogId = data.id;
      setSavedRequirements((current) => [
        ...current,
        {
          id: data.id,
          name: input.name.trim(),
          description: input.description.trim(),
          category_key: input.categoryKey,
          defaults: { instructions: input.instructions.trim() },
          scope: input.scope as 'personal' | 'workspace',
        },
      ]);
    }
    const item = {
      ...newCaseTemplateItem('requested_document'),
      title: input.name.trim(),
      description: input.description.trim(),
      catalogId,
      documentCategory: input.categoryKey,
      instructions: input.instructions.trim(),
    };
    updateSection(selectedSection.id, (section) => ({
      ...section,
      items: [...section.items, item],
    }));
    setActiveSectionId(selectedSection.id);
    setActiveItemId(item.id);
    return null;
  };
  const updateSavedRequirement = async (input: {
    id: string;
    name: string;
    description: string;
    categoryKey: string;
    instructions: string;
  }): Promise<string | null> => {
    if (!input.name.trim() || !input.description.trim())
      return 'El nombre y la descripción son obligatorios.';
    if (!activeWorkspace?.id) return 'Selecciona un espacio de trabajo.';
    const { data, error: updateError } = await createClient()
      .from('case_requirement_catalog')
      .update({
        name: input.name.trim(),
        description: input.description.trim(),
        category_key: input.categoryKey,
        defaults: { instructions: input.instructions.trim() },
      })
      .eq('id', input.id)
      .eq('workspace_id', activeWorkspace.id)
      .select('id')
      .maybeSingle();
    if (updateError || !data)
      return updateError?.code === '23505'
        ? 'Ya existe un requisito activo con ese nombre.'
        : 'No se pudo editar este requisito. Revisa tus permisos.';
    setSavedRequirements((current) =>
      current.map((item) =>
        item.id === input.id
          ? {
              ...item,
              name: input.name.trim(),
              description: input.description.trim(),
              category_key: input.categoryKey,
              defaults: { instructions: input.instructions.trim() },
            }
          : item
      )
    );
    return null;
  };
  const archiveSavedRequirement = async (id: string): Promise<string | null> => {
    if (!activeWorkspace?.id) return 'Selecciona un espacio de trabajo.';
    const { data, error: archiveError } = await createClient()
      .from('case_requirement_catalog')
      .update({ status: 'archived' })
      .eq('id', id)
      .eq('workspace_id', activeWorkspace.id)
      .select('id')
      .maybeSingle();
    if (archiveError || !data) return 'No se pudo archivar este requisito. Revisa tus permisos.';
    setSavedRequirements((current) => current.filter((item) => item.id !== id));
    return null;
  };
  const moveItem = (sectionId: string, index: number, direction: -1 | 1) => {
    updateSection(sectionId, (section) => {
      const items = [...section.items];
      const other = index + direction;
      if (other < 0 || other >= items.length) return section;
      [items[index], items[other]] = [items[other], items[index]];
      return { ...section, items };
    });
  };
  const moveItemToSection = (itemId: string, targetSectionId: string) => {
    const source = draft.sections.find((section) =>
      section.items.some((item) => item.id === itemId)
    );
    if (!source || source.id === targetSectionId) return;
    setDraft((current) => {
      const item = current.sections
        .flatMap((section) => section.items)
        .find((entry) => entry.id === itemId);
      if (!item || !current.sections.some((section) => section.id === targetSectionId))
        return current;
      return {
        ...current,
        sections: current.sections.map((section) =>
          section.id === source.id
            ? { ...section, items: section.items.filter((entry) => entry.id !== itemId) }
            : section.id === targetSectionId
              ? { ...section, items: [...section.items, item] }
              : section
        ),
      };
    });
    setActiveSectionId(targetSectionId);
  };
  const removeItem = (sectionId: string, itemId: string) => {
    const references =
      draft.workflowMode === 'custom'
        ? draft.stages.filter((stage) =>
            stage.activities?.some((activity) => activity.refId === itemId)
          )
        : [];
    if (
      references.length &&
      !window.confirm(
        `Este elemento se usa en ${references.length} etapas. Al eliminarlo se quitarán también esas actividades. ¿Continuar?`
      )
    )
      return;
    if (references.length)
      setDraft((current) => ({
        ...current,
        sections: current.sections.map((section) =>
          section.id === sectionId
            ? { ...section, items: section.items.filter((item) => item.id !== itemId) }
            : section
        ),
        stages: current.stages.map((stage) => ({
          ...stage,
          activities: (stage.activities || []).filter((activity) => activity.refId !== itemId),
        })),
      }));
    else {
      updateSection(sectionId, (section) => ({
        ...section,
        items: section.items.filter((item) => item.id !== itemId),
      }));
    }
    if (activeItemId === itemId) setActiveItemId(null);
  };
  const removeSection = (sectionId: string) => {
    if (draft.sections.length <= 1) return;
    const section = draft.sections.find((entry) => entry.id === sectionId);
    if (!section) return;
    if (section.items.length) {
      setSectionToRemove(sectionId);
      setMoveTarget(draft.sections.find((entry) => entry.id !== sectionId)?.id || '');
      return;
    }
    setDraft((current) => ({
      ...current,
      sections: current.sections.filter((section) => section.id !== sectionId),
    }));
    setActiveSectionId(null);
    setActiveItemId(null);
  };
  const duplicateItem = (sectionId: string, item: CaseTemplateItem) => {
    const copy = duplicateContentItem(item);
    updateSection(sectionId, (section) => ({ ...section, items: [...section.items, copy] }));
    setActiveItemId(copy.id);
    setActiveSectionId(sectionId);
  };
  const moveSection = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const sections = [...current.sections];
      const other = index + direction;
      if (other < 0 || other >= sections.length) return current;
      [sections[index], sections[other]] = [sections[other], sections[index]];
      return { ...current, sections };
    });
  };

  const validation = useMemo(() => {
    if (!draft.name.trim()) return 'Escribe el nombre del tipo de expediente.';
    if (draft.caseSubtype && !draft.caseType)
      return 'Selecciona una categoría para este tipo de expediente.';
    if (!draft.sections.every((section) => section.title.trim()))
      return 'Todas las secciones necesitan un nombre.';
    if (!draft.sections.every((section) => section.items.every((item) => item.title.trim())))
      return 'Todos los elementos necesitan un nombre.';
    if (
      draft.sections.some((section) =>
        section.items.some(
          (item) =>
            item.kind === 'requested_document' &&
            (!item.allowedFormats.length || item.maxSizeMb < 1 || item.maxSizeMb > 100)
        )
      )
    )
      return 'Revisa los formatos y el tamaño máximo de los documentos.';
    if (
      draft.sections.some((section) =>
        section.items.some(
          (item) =>
            item.validityDays !== null &&
            (!Number.isInteger(item.validityDays) || item.validityDays < 1)
        )
      )
    )
      return 'La vigencia debe expresarse en días enteros mayores a cero.';
    const invalidDeadline = (days: number | null) =>
      days !== null && (!Number.isInteger(days) || days < 1 || days > 3650);
    if (
      draft.experience.expireSections &&
      draft.sections.some((section) => invalidDeadline(section.dueInDays))
    )
      return 'Revisa los plazos de las secciones.';
    if (
      draft.experience.expireElements &&
      (draft.sections.some((section) =>
        section.items.some((item) => invalidDeadline(item.dueInDays))
      ) ||
        draft.verifications.some((verification) => invalidDeadline(verification.dueInDays)) ||
        invalidDeadline(draft.experience.signatureDueDays))
    )
      return 'Revisa los plazos de requisitos, verificaciones y firma.';
    if (
      draft.personality !== 'both' &&
      draft.sections.some((section) =>
        section.items.some(
          (item) => item.appliesTo !== 'both' && item.appliesTo !== draft.personality
        )
      )
    )
      return 'Hay requisitos asignados a una personalidad jurídica distinta de este tipo.';
    if (
      draft.sections.some((section) =>
        section.items.some((item) => item.conditional && !item.condition.trim())
      )
    )
      return 'Describe cuándo aplica cada requisito condicional.';
    if (
      draft.sections.some((section) =>
        section.items.some((item) => item.maxFiles < 1 || item.maxFiles > 20)
      )
    )
      return 'La cantidad de archivos debe estar entre 1 y 20.';
    if (
      draft.verifications.some(
        (item) =>
          !item.title.trim() || !item.subject.trim() || item.retryLimit < 0 || item.retryLimit > 10
      )
    )
      return 'Revisa el nombre, sujeto y reintentos de las verificaciones.';
    return '';
  }, [draft]);
  const publishValidation = (() => {
    if (validation) return validation;
    if (!itemCount) return 'Agrega al menos un documento o formulario antes de publicar.';
    if (workflowValidation.errors.length) return workflowValidation.errors[0].message;
    if (
      draft.sections.some((section) =>
        section.items.some(
          (item) => (item.kind === 'form' || item.kind === 'document_template') && !item.sourceId
        )
      )
    )
      return 'Selecciona el recurso de cada documento o formulario vinculado.';
    return '';
  })();
  const goToStep = (index: number) => {
    if (index > furthest) return;
    setStep(index);
    setError('');
    setNotice('');
  };
  const next = () => {
    setErrorTone('warning');
    setNotice('');
    setShowValidation(true);
    if (
      activeStep.id === 'content' &&
      draft.sections.some((section) =>
        section.items.some((item) => item.kind === 'requested_document' && !item.description.trim())
      )
    ) {
      const section = draft.sections.find((entry) =>
        entry.items.some((item) => item.kind === 'requested_document' && !item.description.trim())
      );
      if (section) {
        setActiveSectionId(section.id);
        setActiveItemId(
          section.items.find(
            (item) => item.kind === 'requested_document' && !item.description.trim()
          )?.id || null
        );
      }
      setError(
        'Todos los requisitos documentales necesitan una descripción. Puedes guardar el borrador y completarla después.'
      );
      return;
    }
    if (step === 0 && validation) {
      setError(validation);
      return;
    }
    setError('');
    setStep((current) => Math.min(visibleSteps.length - 1, current + 1));
    setFurthest((current) => Math.max(current, step + 1));
  };
  const save = async (status: 'draft' | 'active') => {
    setErrorTone('critical');
    setNotice('');
    setShowValidation(true);
    if (savingRef.current) return;
    if (originalStatus === 'archived') {
      setErrorTone('warning');
      setError('Restaura este tipo de expediente antes de editarlo.');
      return;
    }
    const issue = status === 'active' ? publishValidation : validation;
    if (issue) {
      setErrorTone('warning');
      setError(issue);
      return;
    }
    if (!activeWorkspace?.id || !user?.id) {
      setErrorTone('warning');
      setError('Selecciona un espacio de trabajo para guardar el tipo de expediente.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    const targetStatus =
      status === 'draft' && templateId && originalStatus && originalStatus !== 'draft'
        ? originalStatus
        : status;
    const payload = {
      workspace_id: activeWorkspace.id,
      name: draft.name.trim(),
      description: draft.description.trim(),
      case_type: draft.caseType.trim() || 'Sin especificar',
      case_subtype: draft.caseSubtype.trim() || null,
      requirements_schema: {
        version: 6,
        reviewPolicy: draft.reviewPolicy,
        categoryCode: draft.categoryCode,
        typeCode: draft.typeCode,
        folio: draft.folio.trim(),
        tagIds: draft.tagIds,
        personality: draft.personality,
        sections: draft.sections,
        verifications: draft.verifications,
        stages: workflowStages,
        workflowMode: draft.workflowMode,
        experience: draft.experience,
        appearance: draft.appearance,
      },
      forms_schema: draft.sections
        .flatMap((section) => section.items)
        .filter((item) => item.kind === 'form')
        .map((item) => ({
          id: item.id,
          form_template_id: item.sourceId,
          title: item.title,
          required: item.required,
          applies_to: item.appliesTo,
          customizable_at_launch: item.customizableAtLaunch,
        })),
      updated_at: new Date().toISOString(),
      status: targetStatus,
    };
    const supabase = createClient();
    const savedSnapshot = JSON.stringify(draft);
    let result: {
      data: { id: string; updated_at: string } | null;
      error: { code?: string } | null;
    };
    try {
      if (status === 'active') {
        const published = await caseRequest<{id:string;updated_at:string}>('/api/expedientes/publicar', { workspaceId:activeWorkspace.id,template:{...payload,id:templateId||'draft'},expectedUpdatedAt:loadedUpdatedAt||null });
        result={data:published,error:null};
      } else if (templateId && originalStatus && originalStatus !== 'draft' && status === 'draft') {
        result = await supabase
          .from('case_file_templates')
          .update({ editor_draft: payload, updated_at: new Date().toISOString() })
          .eq('id', templateId)
          .eq('workspace_id', activeWorkspace.id)
          .eq('updated_at', loadedUpdatedAt || '')
          .select('id,updated_at')
          .single();
      } else if (templateId) {
        result = await supabase
          .from('case_file_templates')
          .update(payload)
          .eq('id', templateId)
          .eq('workspace_id', activeWorkspace.id)
          .eq('updated_at', loadedUpdatedAt || '')
          .select('id,updated_at')
          .single();
      } else {
        result = await supabase
          .from('case_file_templates')
          .insert({ ...payload, created_by: user.id })
          .select('id,updated_at')
          .single();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el tipo de expediente.');
      return;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (result.error || !result.data) {
      setError(
        result.error?.code === 'PGRST116'
          ? 'El expediente cambió desde que lo abriste. Conserva tus cambios y vuelve a cargar la versión más reciente antes de guardar.'
          : 'No se pudo guardar el tipo de expediente. Revisa tus permisos e inténtalo de nuevo.'
      );
      return;
    }
    setTemplateId(result.data.id);
    setLoadedUpdatedAt(result.data.updated_at);
    setSavedDraftJson(savedSnapshot);
    setOriginalStatus(targetStatus);
    if (status === 'active') router.push('/expedientes');
    else
      setNotice(
        targetStatus === 'draft'
          ? 'Borrador guardado. Puedes continuar diseñando este tipo de expediente.'
          : 'Borrador guardado sin modificar la versión publicada.'
      );
  };

  if (loading)
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-primary" aria-label="Cargando constructor" />
      </div>
    );
  if (screenError)
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-4 dark:bg-background">
        <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 dark:border-border dark:bg-card">
          <AlertCircle size={24} className="text-red-600" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-semibold">No se pudo cargar el expediente</h1>
          <p role="alert" className="mt-2 text-sm text-slate-600 dark:text-muted-foreground">
            {screenError}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={() => window.location.reload()} className={primaryClass}>
              Reintentar
            </button>
            <button
              type="button"
              onClick={() => router.push('/expedientes')}
              className={secondaryClass}
            >
              Volver a expedientes
            </button>
          </div>
        </section>
      </main>
    );
  return (
    <div
      ref={containerRef}
      className="docubox-wizard fixed inset-0 flex min-h-0 flex-col overflow-hidden bg-slate-50 text-slate-950 dark:bg-background dark:text-foreground"
    >
      <header className="grid min-h-16 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 dark:border-border dark:bg-card sm:gap-4 sm:px-4 lg:px-6">
        <AppLogo size={34} imageClassName="max-sm:w-24" />
        <nav
          aria-label="Pasos para diseñar un tipo de expediente"
          className="mx-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-slate-200 bg-slate-100/80 p-1 dark:border-border dark:bg-muted/60 sm:gap-1"
        >
          {visibleSteps.map(({ label, icon: Icon }, index) => (
            <Fragment key={label}>
              <button
                type="button"
                title={label}
                aria-label={label}
                aria-current={index === step ? 'step' : undefined}
                disabled={saving || index > furthest}
                onClick={() => goToStep(index)}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-sm transition-colors sm:px-2.5 ${index === step ? 'bg-white text-primary shadow-[0_1px_3px_rgba(15,23,42,0.12)] dark:bg-card' : index <= furthest ? 'text-slate-700 hover:bg-white hover:text-primary dark:text-foreground dark:hover:bg-card' : 'text-slate-400'} disabled:cursor-default`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${index === step ? 'bg-primary text-white' : index < step ? 'bg-primary/10 text-primary' : 'bg-slate-200/70 text-slate-400'}`}
                >
                  {index < step ? <CheckCircle2 size={13} /> : <Icon size={13} />}
                </span>
                <span className="hidden md:inline">{label}</span>
              </button>
              {index < visibleSteps.length - 1 && (
                <span
                  className={`h-px w-1 shrink-0 sm:w-3 ${index < step ? 'bg-primary/50' : 'bg-slate-200'}`}
                />
              )}
            </Fragment>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Pantalla completa"
            aria-label="Pantalla completa"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void containerRef.current?.requestFullscreen();
            }}
            className="hidden h-9 w-9 items-center justify-center rounded-lg border border-transparent text-slate-500 hover:border-slate-200 hover:bg-white sm:flex"
          >
            <Maximize2 size={17} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (!isDirty || window.confirm('Hay cambios sin guardar. ¿Salir y descartarlos?'))
                router.push('/expedientes');
            }}
            title="Salir"
            aria-label="Salir"
            className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 sm:px-3"
          >
            <X size={16} />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </header>

      <section className="shrink-0 border-b border-slate-200 bg-[#edf3f8] px-4 py-2 dark:border-border dark:bg-muted lg:px-6">
        <div className="mx-auto flex w-full max-w-[1480px] flex-wrap items-center gap-x-4 gap-y-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <StepIcon size={16} />
            </span>
            <h1 className="min-w-0 break-words text-[20px] font-normal">{activeStep.label}</h1>
            <span className="shrink-0 rounded-md bg-slate-200/70 px-1.5 py-0.5 text-sm text-slate-600">
              Paso {step + 1} de {visibleSteps.length}
            </span>
            <p className="hidden min-w-0 truncate text-sm text-slate-500 lg:block">
              {activeStep.description}
            </p>
          </div>
          <div className="flex w-full items-center gap-2 text-sm text-slate-500 sm:w-44">
            <div
              role="progressbar"
              aria-label="Progreso"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200"
            >
              <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
            </div>
            <span className="w-8 text-right tabular-nums">{progress}%</span>
          </div>
          <p className="w-full truncate text-sm text-slate-500 lg:hidden">
            {activeStep.description}
          </p>
        </div>
      </section>

      <main className="flex min-h-0 flex-1 overflow-hidden">
        {activeStep.id === 'general' && (
          <div className="w-full overflow-y-auto px-4 py-6 lg:px-6">
            <div className="mx-auto grid w-full max-w-[1480px] grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-border dark:bg-card">
                <div className="mb-5">
                  <h2 className="text-base font-medium">Propiedades del expediente</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Define la información y clasificación del tipo de expediente.
                  </p>
                </div>
                <div className="space-y-4">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-foreground">
                      Nombre del tipo de expediente <span className="text-red-500">*</span>
                    </span>
                    <input
                      aria-invalid={showValidation && !draft.name.trim()}
                      aria-describedby={
                        showValidation && !draft.name.trim() ? 'case-name-error' : undefined
                      }
                      value={draft.name}
                      onChange={(event) => {
                        setDraft({ ...draft, name: event.target.value });
                        setError('');
                        setNotice('');
                      }}
                      placeholder="Nombre del tipo de expediente"
                      className={generalInputClass}
                    />
                    {showValidation && !draft.name.trim() && (
                      <span id="case-name-error" className="mt-1 block text-xs text-red-600">
                        Escribe el nombre del tipo de expediente.
                      </span>
                    )}
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-foreground">
                      Descripción
                    </span>
                    <textarea
                      value={draft.description}
                      onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                      placeholder="Añade un resumen sobre el contenido y uso del expediente."
                      rows={3}
                      className={`${generalInputClass} h-auto resize-none py-2.5`}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-foreground">
                      Número o folio de expediente
                    </span>
                    <input
                      value={draft.folio}
                      onChange={(event) => setDraft({ ...draft, folio: event.target.value })}
                      placeholder="Ej. EXP-2026-001"
                      className={generalInputClass}
                    />
                  </label>
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-foreground">
                      <Layers size={14} className="text-slate-400" />
                      Categoría de expediente
                    </label>
                    <div className="flex gap-2">
                      <div className="relative min-w-0 flex-1">
                        <input
                          readOnly
                          value={draft.caseType}
                          placeholder="Sin especificar"
                          className={`${generalInputClass} cursor-default pr-8`}
                        />
                        {draft.caseType && (
                          <button
                            type="button"
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                categoryCode: '',
                                caseType: '',
                                typeCode: '',
                                caseSubtype: '',
                              }))
                            }
                            aria-label="Quitar categoría de expediente"
                            className="absolute right-2.5 top-3 text-slate-400 hover:text-slate-600"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setGeneralPicker('category')}
                        className={catalogButtonClass}
                      >
                        <Search size={14} />
                        Buscar
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-foreground">
                      <FolderKanban size={14} className="text-slate-400" />
                      Tipo de expediente
                    </label>
                    <div className="flex gap-2">
                      <div className="relative min-w-0 flex-1">
                        <input
                          readOnly
                          disabled={!draft.categoryCode}
                          value={draft.caseSubtype}
                          placeholder="Sin especificar"
                          className={`${generalInputClass} cursor-default pr-8 disabled:bg-slate-50 disabled:text-slate-400`}
                        />
                        {draft.caseSubtype && (
                          <button
                            type="button"
                            onClick={() =>
                              setDraft((current) => ({ ...current, typeCode: '', caseSubtype: '' }))
                            }
                            aria-label="Quitar tipo de expediente"
                            className="absolute right-2.5 top-3 text-slate-400 hover:text-slate-600"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={!draft.categoryCode}
                        onClick={() => setGeneralPicker('type')}
                        className={catalogButtonClass}
                      >
                        <Search size={14} />
                        Buscar
                      </button>
                    </div>
                    {!draft.categoryCode && (
                      <p className="mt-1 text-xs text-slate-500">
                        Selecciona una categoría para activar los tipos relacionados.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-foreground">
                      <Tag size={14} className="text-slate-400" />
                      Etiquetas
                    </label>
                    <div className="flex gap-2">
                      <div className="flex min-h-10 min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-border dark:bg-background">
                        {draft.tagIds.length ? (
                          draft.tagIds.map((id) => {
                            const tag = caseTags.find((item) => item.id === id);
                            return (
                              tag && (
                                <span
                                  key={id}
                                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                                >
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: tag.color }}
                                  />
                                  {tag.nombre}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDraft((current) => ({
                                        ...current,
                                        tagIds: current.tagIds.filter((value) => value !== id),
                                      }))
                                    }
                                    aria-label={`Quitar etiqueta ${tag.nombre}`}
                                  >
                                    <X size={12} />
                                  </button>
                                </span>
                              )
                            );
                          })
                        ) : (
                          <span className="text-slate-400">Sin especificar</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setGeneralPicker('tags')}
                        className={catalogButtonClass}
                      >
                        <Search size={14} />
                        Buscar
                      </button>
                    </div>
                  </div>
                </div>
              </section>
              <aside className="xl:sticky xl:top-0">
                <CaseExperiencePanel
                  value={draft.experience}
                  onChange={(experience) => {
                    setDraft((current) => ({ ...current, experience }));
                    if (
                      experience.configureDesign !== draft.experience.configureDesign ||
                      experience.configureWorkflow !== draft.experience.configureWorkflow
                    )
                      setFurthest(0);
                    setDefaultsNotice('');
                  }}
                  onSaveDefaults={() => {
                    try {
                      writeCaseDefaults(workspaceId, {
                        experience: draft.experience,
                        appearance: draft.appearance,
                      });
                      setDefaultsNotice('Configuración aplicada como predeterminada.');
                    } catch {
                      setDefaultsNotice(
                        'No se pudieron guardar los predeterminados en este navegador.'
                      );
                    }
                  }}
                  status={defaultsNotice}
                />
              </aside>
            </div>
          </div>
        )}

        {activeStep.id === 'content' && (
          <>
            <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-4 dark:border-border dark:bg-card lg:block 2xl:w-[340px]">
              <h2 className="text-sm font-semibold">Biblioteca de contenido</h2>
              <p className="mt-1 text-xs text-slate-500">
                Agrega elementos a la sección seleccionada.
              </p>
              <div className="mt-4 space-y-2">
                {sourceKinds.map(({ kind, icon: Icon, description }) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => addItem(kind)}
                    className="flex w-full items-start gap-3 rounded-lg border border-slate-200 p-3 text-left transition hover:border-primary hover:bg-blue-50 dark:border-border"
                  >
                    <span className="rounded-md bg-primary/10 p-2 text-primary">
                      <Icon size={17} />
                    </span>
                    <span>
                      <span className="block text-sm font-medium">{itemKindLabel[kind]}</span>
                      <span className="mt-1 block text-xs leading-4 text-slate-500">
                        {description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-4">
                <RequirementCatalog
                  addedIds={
                    new Set(
                      draft.sections.flatMap((section) =>
                        section.items
                          .map((item) => item.catalogId)
                          .filter((id): id is string => Boolean(id))
                      )
                    )
                  }
                  onAdd={addCatalogRequirement}
                  savedRequirements={savedRequirements}
                  catalogError={requirementCatalogError}
                  canShare={
                    activeWorkspace?.workspaceType === 'business' &&
                    ['owner', 'admin'].includes(activeWorkspace.role)
                  }
                  onCreate={createRequirement}
                  onUpdate={updateSavedRequirement}
                  onArchive={archiveSavedRequirement}
                />
              </div>
            </aside>
            <div className="min-w-0 flex-1 overflow-y-auto p-4 lg:p-6">
              <div className="mx-auto max-w-[800px] space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">Estructura del expediente</h2>
                    <p className="text-sm text-slate-500">
                      {draft.sections.length} secciones · {itemCount} elementos
                    </p>
                  </div>
                  <button type="button" onClick={addSection} className={secondaryClass}>
                    <Plus size={15} /> Agregar sección
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 lg:hidden">
                  {sourceKinds.map(({ kind, icon: Icon }) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => addItem(kind)}
                      className={`${secondaryClass} justify-start px-2 text-xs`}
                    >
                      <Icon size={14} />
                      {itemKindLabel[kind]}
                    </button>
                  ))}
                </div>
                <div className="lg:hidden">
                  <RequirementCatalog
                    addedIds={
                      new Set(
                        draft.sections.flatMap((section) =>
                          section.items
                            .map((item) => item.catalogId)
                            .filter((id): id is string => Boolean(id))
                        )
                      )
                    }
                    onAdd={addCatalogRequirement}
                    savedRequirements={savedRequirements}
                    catalogError={requirementCatalogError}
                    canShare={
                      activeWorkspace?.workspaceType === 'business' &&
                      ['owner', 'admin'].includes(activeWorkspace.role)
                    }
                    onCreate={createRequirement}
                    onUpdate={updateSavedRequirement}
                    onArchive={archiveSavedRequirement}
                  />
                </div>
                {draft.sections.map((section, sectionIndex) => (
                  <section
                    key={section.id}
                    className={`rounded-xl border bg-white shadow-sm dark:bg-card ${selectedSection?.id === section.id ? 'border-primary/40' : 'border-slate-200 dark:border-border'}`}
                  >
                    <div className="flex items-start gap-2 border-b border-slate-100 p-4 dark:border-border">
                      <button
                        type="button"
                        aria-label={
                          (collapsedSections.has(section.id) ? 'Expandir ' : 'Colapsar ') +
                          section.title
                        }
                        aria-expanded={!collapsedSections.has(section.id)}
                        onClick={() =>
                          setCollapsedSections((current) => {
                            const next = new Set(current);
                            if (next.has(section.id)) next.delete(section.id);
                            else next.add(section.id);
                            return next;
                          })
                        }
                        className="rounded-md p-2 text-slate-500"
                      >
                        <ChevronDown
                          size={16}
                          className={collapsedSections.has(section.id) ? '-rotate-90' : ''}
                        />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="mb-1 text-xs text-slate-400">
                          {section.items.length} elementos
                        </p>
                        <input
                          aria-label="Nombre de la sección"
                          value={section.title}
                          onFocus={() => {
                            setActiveSectionId(section.id);
                            setActiveItemId(null);
                          }}
                          onChange={(event) =>
                            updateSection(section.id, (current) => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                          className="w-full bg-transparent text-base font-semibold outline-none focus:text-primary"
                        />
                        <input
                          aria-label="Descripción de la sección"
                          value={section.description}
                          onFocus={() => {
                            setActiveSectionId(section.id);
                            setActiveItemId(null);
                          }}
                          onChange={(event) =>
                            updateSection(section.id, (current) => ({
                              ...current,
                              description: event.target.value,
                            }))
                          }
                          placeholder="Descripción opcional de la sección"
                          className="mt-1 w-full bg-transparent text-xs text-slate-500 outline-none"
                        />
                        {draft.experience.expireSections && (
                          <label className="mt-3 block max-w-xs text-xs font-medium text-slate-600">
                            Vencimiento de la sección (días desde apertura)
                            <input
                              type="number"
                              min={1}
                              max={3650}
                              value={section.dueInDays ?? ''}
                              onChange={(event) =>
                                updateSection(section.id, (current) => ({
                                  ...current,
                                  dueInDays: event.target.value ? Number(event.target.value) : null,
                                }))
                              }
                              placeholder="Sin vencimiento"
                              className={inputClass}
                            />
                          </label>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveSectionId(section.id);
                          setActiveItemId(null);
                        }}
                        aria-label={`Seleccionar sección ${section.title}`}
                        aria-pressed={selectedSection?.id === section.id}
                        className="rounded-md px-2 py-1.5 text-xs font-medium text-primary hover:bg-blue-50"
                      >
                        {selectedSection?.id === section.id ? 'Seleccionada' : 'Seleccionar'}
                      </button>
                      <button
                        type="button"
                        disabled={sectionIndex === 0}
                        onClick={(event) => {
                          event.stopPropagation();
                          moveSection(sectionIndex, -1);
                        }}
                        aria-label={`Subir sección ${section.title}`}
                        className="rounded-md p-2 text-slate-400 hover:text-primary disabled:opacity-30"
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        type="button"
                        disabled={sectionIndex === draft.sections.length - 1}
                        onClick={(event) => {
                          event.stopPropagation();
                          moveSection(sectionIndex, 1);
                        }}
                        aria-label={`Bajar sección ${section.title}`}
                        className="rounded-md p-2 text-slate-400 hover:text-primary disabled:opacity-30"
                      >
                        <ArrowDown size={15} />
                      </button>
                      <button
                        type="button"
                        disabled={draft.sections.length === 1}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeSection(section.id);
                        }}
                        aria-label={`Eliminar sección ${section.title}`}
                        className="rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div hidden={collapsedSections.has(section.id)} className="space-y-2 p-3">
                      {section.items.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-9 text-center text-sm text-slate-400">
                          Selecciona un elemento de la biblioteca para comenzar.
                        </div>
                      ) : (
                        section.items.map((item, index) => {
                          const Icon =
                            sourceKinds.find((entry) => entry.kind === item.kind)?.icon || FileText;
                          return (
                            <div
                              key={item.id}
                              className={`flex items-center gap-3 rounded-lg border p-3 ${activeItemId === item.id ? 'border-primary bg-blue-50/60' : 'border-slate-200 hover:border-primary/30'}`}
                            >
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setActiveSectionId(section.id);
                                  setActiveItemId(item.id);
                                  setCatalogSearch('');
                                }}
                                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                              >
                                <span className="rounded-md bg-primary/10 p-2 text-primary">
                                  <Icon size={17} />
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-medium">
                                    {item.title || 'Sin nombre'}
                                  </span>
                                  <span className="block truncate text-xs text-slate-500">
                                    {itemKindLabel[item.kind]}
                                    {item.sourceName ? ` · ${item.sourceName}` : ''}
                                    {item.conditional
                                      ? ' · Condicional'
                                      : item.required
                                        ? ' · Obligatorio'
                                        : ' · Opcional'}
                                  </span>
                                </span>
                              </button>
                              <div className="flex shrink-0 items-center">
                                <button
                                  type="button"
                                  onClick={() => duplicateItem(section.id, item)}
                                  aria-label={'Duplicar ' + item.title}
                                  className="rounded p-1.5 text-slate-400 hover:text-primary"
                                >
                                  <Copy size={14} />
                                </button>
                                <button
                                  type="button"
                                  disabled={index === 0}
                                  onClick={() => moveItem(section.id, index, -1)}
                                  aria-label={`Subir ${item.title}`}
                                  className="rounded p-1.5 text-slate-400 hover:text-primary disabled:opacity-30"
                                >
                                  <ArrowUp size={14} />
                                </button>
                                <button
                                  type="button"
                                  disabled={index === section.items.length - 1}
                                  onClick={() => moveItem(section.id, index, 1)}
                                  aria-label={`Bajar ${item.title}`}
                                  className="rounded p-1.5 text-slate-400 hover:text-primary disabled:opacity-30"
                                >
                                  <ArrowDown size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeItem(section.id, item.id)}
                                  aria-label={`Eliminar ${item.title}`}
                                  className="rounded p-1.5 text-slate-400 hover:text-red-600"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </section>
                ))}
              </div>
            </div>
            <aside className="w-[330px] shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4 dark:border-border dark:bg-card max-xl:hidden">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Settings2 size={16} className="text-primary" /> Propiedades
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {selectedItem
                  ? 'Configura el elemento seleccionado.'
                  : selectedSection
                    ? 'Configura la sección seleccionada.'
                    : 'Selecciona un elemento de la estructura.'}
              </p>
              {!selectedItem && selectedSection && (
                <div className="mt-4 space-y-4">
                  <label className="block text-sm font-medium">
                    Nombre de la sección
                    <input
                      value={selectedSection.title}
                      onChange={(event) =>
                        updateSection(selectedSection.id, (current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="block text-sm font-medium">
                    Descripción
                    <textarea
                      value={selectedSection.description}
                      onChange={(event) =>
                        updateSection(selectedSection.id, (current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      rows={3}
                      className={inputClass}
                    />
                  </label>
                  <p className="text-xs text-slate-500">
                    Posición{' '}
                    {draft.sections.findIndex((section) => section.id === selectedSection.id) + 1} ·{' '}
                    {selectedSection.items.length} elementos
                  </p>
                  <button
                    type="button"
                    disabled={draft.sections.length < 2}
                    className={secondaryClass}
                    onClick={() => removeSection(selectedSection.id)}
                  >
                    Eliminar sección
                  </button>
                </div>
              )}
              {selectedItem && (
                <ItemInspector
                  showValidation={showValidation}
                  item={selectedItem}
                  sectionId={
                    draft.sections.find((section) =>
                      section.items.some((item) => item.id === selectedItem.id)
                    )?.id || ''
                  }
                  sections={draft.sections}
                  onMove={(sectionId) => moveItemToSection(selectedItem.id, sectionId)}
                  catalogs={catalogs}
                  catalogError={catalogError}
                  search={catalogSearch}
                  setSearch={setCatalogSearch}
                  onRefresh={() => void loadCatalogs()}
                  allowDeadline={draft.experience.expireElements}
                  onChange={(update) => updateItem(selectedItem.id, update)}
                />
              )}
            </aside>
          </>
        )}

        {activeStep.id === 'verification' && (
          <VerificationStep
            value={draft.verifications}
            allowDeadline={draft.experience.expireElements}
            onChange={(verifications) => setDraft((current) => ({ ...current, verifications }))}
          />
        )}

        {activeStep.id === 'stages' && (
          <CaseReviewCloseStep
            draft={draft}
            onChange={setDraft}
            onEditContent={(itemId) => {
              const section = draft.sections.find((entry) =>
                entry.items.some((item) => item.id === itemId)
              );
              setActiveSectionId(section?.id || null);
              setActiveItemId(itemId);
              setStep(visibleSteps.findIndex((entry) => entry.id === 'content'));
            }}
            onEditGeneral={() => setStep(0)}
          />
        )}

        {activeStep.id === 'design' && draft.experience.configureDesign && (
          <CaseDesignStep
            draft={draft}
            onChange={(appearance) => setDraft((current) => ({ ...current, appearance }))}
          />
        )}

        {activeStep.id === 'design' && !draft.experience.configureDesign && (
          <div className="w-full overflow-y-auto p-6">
            <section className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-5 dark:border-border dark:bg-card">
              <h2 className="text-sm font-semibold">Diseño del expediente</h2>
              <p className="mt-2 text-sm text-slate-500">
                Se conservará la presentación guardada. Puedes continuar o activar su edición.
              </p>
              <button
                type="button"
                className={secondaryClass + ' mt-4'}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    experience: { ...current.experience, configureDesign: true },
                  }))
                }
              >
                Configurar diseño
              </button>
            </section>
          </div>
        )}

        {activeStep.id === 'preview' && (
          <div className="w-full overflow-y-auto px-4 py-6 lg:px-6">
            <div
              className={`mx-auto space-y-4 rounded-xl p-4 ${draft.appearance.width === 'wide' ? 'max-w-[1480px]' : 'max-w-[1100px]'}`}
              style={{ backgroundColor: draft.appearance.backgroundColor }}
            >
              <div className={draft.appearance.headerAlignment === 'center' ? 'text-center' : ''}>
                <div
                  className="mb-2 h-1 w-16 rounded-full"
                  style={{
                    backgroundColor: draft.appearance.accentColor,
                    marginInline:
                      draft.appearance.headerAlignment === 'center' ? 'auto' : undefined,
                  }}
                />
                <h2 className="text-xl font-semibold">
                  {draft.appearance.headerText || draft.name || 'Nuevo tipo de expediente'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {draft.appearance.headerDescription || draft.description || 'Sin descripción'} ·{' '}
                  {draft.caseType || 'Sin especificar'}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <PreviewMetric value={itemCount} label="Requisitos" />
                <PreviewMetric
                  value={
                    draft.sections
                      .flatMap((section) => section.items)
                      .filter((item) => item.kind !== 'form').length
                  }
                  label="Documentos"
                />
                <PreviewMetric
                  value={
                    draft.sections
                      .flatMap((section) => section.items)
                      .filter((item) => item.kind === 'form').length
                  }
                  label="Formularios"
                />
              </div>
              {draft.sections.map((section, index) => (
                <section
                  key={section.id}
                  className="rounded-xl border border-slate-200 bg-white p-5 dark:border-border dark:bg-card"
                >
                  <div className="flex items-center gap-2">
                    {draft.appearance.showSectionNumbers && (
                      <span
                        className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold text-white"
                        style={{ backgroundColor: draft.appearance.accentColor }}
                      >
                        {index + 1}
                      </span>
                    )}
                    <h3 className="font-semibold">{section.title || 'Sección sin nombre'}</h3>
                  </div>
                  {draft.appearance.showSectionDescriptions && section.description && (
                    <p className="mt-1 text-sm text-slate-500">{section.description}</p>
                  )}
                  {draft.experience.expireSections && section.dueInDays && (
                    <p className="mt-1 text-xs text-amber-700">
                      Vence a los {section.dueInDays} días desde apertura
                    </p>
                  )}
                  <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 dark:border-border">
                    {section.items.length ? (
                      section.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex flex-wrap items-center justify-between gap-2 p-3"
                        >
                          <span>
                            <span className="block text-sm font-medium">
                              {item.title || 'Elemento sin nombre'}
                            </span>
                            <span className="block text-xs text-slate-500">
                              {itemKindLabel[item.kind]}
                              {item.sourceName ? ` · ${item.sourceName}` : ''}
                              {item.appliesTo === 'individual'
                                ? ' · Persona física'
                                : item.appliesTo === 'company'
                                  ? ' · Persona moral'
                                  : ''}
                            </span>
                            {item.kind === 'requested_document' && (
                              <span className="mt-1 block text-xs text-slate-500">
                                {item.allowedFormats.join(', ')} · hasta {item.maxSizeMb} MB
                                {item.validityDays
                                  ? ` · vigencia de ${item.validityDays} días`
                                  : ''}
                                {item.requiresReview ? ' · revisión manual' : ''}
                              </span>
                            )}
                            {draft.experience.expireElements && item.dueInDays && (
                              <span className="mt-1 block text-xs text-amber-700">
                                Vence a los {item.dueInDays} días desde apertura
                              </span>
                            )}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                            {item.conditional
                              ? 'Condicional'
                              : item.required
                                ? 'Obligatorio'
                                : 'Opcional'}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="p-4 text-sm text-slate-400">Sin elementos todavía.</p>
                    )}
                  </div>
                </section>
              ))}
              <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-border dark:bg-card">
                <h3 className="text-sm font-semibold">
                  Verificaciones de identidad y cumplimiento
                </h3>
                {draft.verifications.length ? (
                  <ul className="mt-3 space-y-2">
                    {draft.verifications.map((verification) => (
                      <li
                        key={verification.id}
                        className="rounded-md border border-slate-100 px-3 py-2 text-sm dark:border-border"
                      >
                        <span className="font-medium">{verification.title}</span>
                        <span className="ml-2 text-xs text-slate-500">
                          {verification.subject} · {verification.timing}
                          {verification.required ? ' · requerido' : ''}
                          {draft.experience.expireElements && verification.dueInDays
                            ? ` · vence a los ${verification.dueInDays} días`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">Sin verificaciones configuradas.</p>
                )}
              </section>
              {draft.experience.signAtClosure && (
                <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-border dark:bg-card">
                  <h3 className="text-sm font-semibold">Firma de cierre del expediente</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {draft.experience.expireElements && draft.experience.signatureDueDays
                      ? `Vence a los ${draft.experience.signatureDueDays} días desde la apertura.`
                      : 'Sin vencimiento específico.'}
                  </p>
                </section>
              )}
              <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-border dark:bg-card">
                <h3 className="text-sm font-semibold">Revisión y cierre</h3>
                <p className="mt-2 text-xs text-slate-500">
                  {draft.reviewPolicy.reviewTiming === 'progressive'
                    ? 'Revisión conforme se recibe.'
                    : 'Revisión al completar la recopilación.'}{' '}
                  {draft.reviewPolicy.approval.enabled
                    ? 'Con aprobación final.'
                    : 'Sin aprobación final.'}{' '}
                  {draft.reviewPolicy.completion.mode === 'manual'
                    ? 'Cierre mediante confirmación autorizada.'
                    : 'Cierre automático sujeto a condiciones.'}
                </p>
                {workflowStages.length ? (
                  <ol className="mt-3 space-y-2">
                    {workflowStages.map((stage, index) => (
                      <li
                        key={stage.id}
                        className="rounded-md border border-slate-100 px-3 py-2 text-sm dark:border-border"
                      >
                        <span className="font-medium">
                          {index + 1}. {stage.title}
                        </span>
                        <span className="ml-2 text-xs text-slate-500">
                          {stage.responsible} · {stage.activities?.length || 0} actividades
                          {stage.dependsOn?.length
                            ? ` · depende de ${stage.dependsOn.map((id) => workflowStages.find((item) => item.id === id)?.title || 'etapa no disponible').join(', ')}`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">Sin etapas configuradas.</p>
                )}
              </section>
              {draft.appearance.showFooter && (
                <p className="py-2 text-center text-xs text-slate-500">
                  {draft.appearance.footerText}
                </p>
              )}
            </div>
          </div>
        )}

        {activeStep.id === 'publish' && (
          <div className="w-full overflow-y-auto px-4 py-6 lg:px-6">
            <div className="mx-auto grid max-w-[1100px] gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
              <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-border dark:bg-card">
                <h2 className="text-lg font-semibold">Publicación</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Guarda para continuar después o publica este tipo para reutilizar su estructura en
                  nuevos expedientes.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void save('draft')}
                    className="rounded-lg border border-slate-200 p-4 text-left transition hover:border-primary hover:bg-blue-50"
                  >
                    <Save size={19} className="text-primary" />
                    <strong className="mt-3 block text-sm">Guardar borrador</strong>
                    <span className="mt-1 block text-xs text-slate-500">
                      Permite seguir diseñando este tipo más adelante.
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={saving || Boolean(publishValidation)}
                    onClick={() => void save('active')}
                    className="rounded-lg border border-primary bg-blue-50 p-4 text-left transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send size={19} className="text-primary" />
                    <strong className="mt-3 block text-sm">Publicar tipo de expediente</strong>
                    <span className="mt-1 block text-xs text-slate-500">
                      Deja disponible este tipo para usarlo al lanzar un expediente.
                    </span>
                  </button>
                </div>
                {publishValidation && (
                  <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    Para publicar: {publishValidation}
                  </p>
                )}
              </section>
              <aside className="rounded-xl border border-slate-200 bg-white p-5 dark:border-border dark:bg-card">
                <h3 className="text-sm font-semibold">Resumen del tipo</h3>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Nombre</dt>
                    <dd className="text-right font-medium">{draft.name || 'Sin nombre'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Categoría</dt>
                    <dd className="text-right font-medium">
                      {draft.caseType || 'Sin especificar'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Tipo</dt>
                    <dd className="text-right font-medium">
                      {draft.caseSubtype || 'Sin especificar'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Etiquetas</dt>
                    <dd>{draft.tagIds.length || 'Sin especificar'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Secciones</dt>
                    <dd>{draft.sections.length}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Elementos</dt>
                    <dd>{itemCount}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Verificaciones</dt>
                    <dd>{draft.verifications.length}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Etapas</dt>
                    <dd>{workflowStages.length}</dd>
                  </div>
                </dl>
                <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">
                  Esta acción guarda el tipo reutilizable. Al iniciar un expediente se elegirán los
                  requisitos aplicables, participantes y seguimiento.
                </p>
              </aside>
            </div>
          </div>
        )}
      </main>

      {activeStep.id === 'content' && selectedItem && (
        <div className="shrink-0 border-t border-slate-200 bg-white p-3 dark:border-border dark:bg-card xl:hidden">
          <details open={showValidation || undefined}>
            <summary className="cursor-pointer text-sm font-medium text-primary">
              Editar propiedades de {selectedItem.title}
            </summary>
            <ItemInspector
              showValidation={showValidation}
              item={selectedItem}
              sectionId={
                draft.sections.find((section) =>
                  section.items.some((item) => item.id === selectedItem.id)
                )?.id || ''
              }
              sections={draft.sections}
              onMove={(sectionId) => moveItemToSection(selectedItem.id, sectionId)}
              catalogs={catalogs}
              catalogError={catalogError}
              search={catalogSearch}
              setSearch={setCatalogSearch}
              onRefresh={() => void loadCatalogs()}
              allowDeadline={draft.experience.expireElements}
              onChange={(update) => updateItem(selectedItem.id, update)}
            />
          </details>
        </div>
      )}

      <footer className="z-20 flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-2 dark:border-border dark:bg-card lg:px-6">
        {(error || notice) && (
          <div
            id="case-wizard-feedback"
            role={error ? 'alert' : 'status'}
            aria-atomic="true"
            className={
              'flex w-full min-w-0 items-start gap-2 rounded-lg border px-3 py-2 text-sm ' +
              (error
                ? errorTone === 'warning'
                  ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100'
                  : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-100'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100')
            }
          >
            {error ? (
              errorTone === 'warning' ? (
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              ) : (
                <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              )
            ) : (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            )}
            <p className="max-h-24 min-w-0 flex-1 overflow-y-auto break-words">{error || notice}</p>
            <button
              type="button"
              onClick={() => {
                setError('');
                setNotice('');
              }}
              aria-label="Cerrar mensaje"
              className="shrink-0 rounded p-0.5 hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        )}
        <button
          type="button"
          disabled={step === 0 || saving}
          onClick={() => {
            setStep(step - 1);
            setError('');
            setNotice('');
          }}
          className={secondaryClass}
        >
          <ArrowLeft size={16} /> Atrás
        </button>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => void save('draft')}
            title="Guardar borrador"
            aria-label="Guardar borrador"
            className={`${secondaryClass} px-2 sm:px-3`}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            <span className="hidden sm:inline">Guardar borrador</span>
          </button>
          {step < visibleSteps.length - 1 ? (
            <button type="button" disabled={saving} onClick={next} className={primaryClass}>
              Siguiente <ArrowRight size={16} />
            </button>
          ) : (
            <button
              type="button"
              disabled={saving || Boolean(publishValidation)}
              onClick={() => void save('active')}
              className={primaryClass}
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}{' '}
              {originalStatus === 'paused' ? 'Reanudar tipo' : 'Publicar tipo'}
            </button>
          )}
        </div>
      </footer>
      {sectionToRemove && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-content-section-title"
        >
          <div className="w-full max-w-lg space-y-4 rounded-xl bg-white p-5 shadow-xl dark:bg-card">
            <h2 id="remove-content-section-title" className="font-semibold">
              Eliminar sección con contenido
            </h2>
            <p className="text-sm text-slate-500">
              Puedes mover sus elementos conservando sus asociaciones, o eliminarlos junto con las
              actividades que los referencian.
            </p>
            <label className="block text-sm">
              Mover a
              <select
                className={inputClass}
                value={moveTarget}
                onChange={(event) => setMoveTarget(event.target.value)}
              >
                {draft.sections
                  .filter((section) => section.id !== sectionToRemove)
                  .map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.title}
                    </option>
                  ))}
              </select>
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className={secondaryClass}
                onClick={() => setSectionToRemove(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={secondaryClass}
                onClick={() => {
                  setDraft((current) => removeContentSection(current, sectionToRemove, null));
                  setActiveItemId(null);
                  setActiveSectionId(null);
                  setSectionToRemove(null);
                }}
              >
                Eliminar elementos
              </button>
              <button
                type="button"
                className={primaryClass}
                onClick={() => {
                  setDraft((current) => removeContentSection(current, sectionToRemove, moveTarget));
                  setActiveSectionId(moveTarget);
                  setSectionToRemove(null);
                }}
              >
                Mover y eliminar sección
              </button>
            </div>
          </div>
        </div>
      )}
      {requirementPickerOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Solicitar documentos"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setRequirementPickerOpen(false);
          }}
        >
          <div className="flex max-h-[85dvh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:bg-card">
            <header className="flex items-center justify-between border-b border-slate-200 p-4">
              <div>
                <h2 className="text-base font-semibold">Solicitar documentos</h2>
                <p className="text-xs text-slate-500">Sección: {selectedSection?.title}</p>
              </div>
              <button
                autoFocus
                type="button"
                aria-label="Cerrar selector"
                onClick={() => setRequirementPickerOpen(false)}
                className="rounded-md p-2"
              >
                <X size={18} />
              </button>
            </header>
            <div className="overflow-y-auto p-4">
              <RequirementCatalog
                openByDefault
                multiSelect
                addedIds={
                  new Set(
                    draft.sections.flatMap((section) =>
                      section.items
                        .map((item) => item.catalogId)
                        .filter((id): id is string => Boolean(id))
                    )
                  )
                }
                onAdd={addCatalogRequirement}
                savedRequirements={savedRequirements}
                catalogError={requirementCatalogError}
                canShare={
                  activeWorkspace?.workspaceType === 'business' &&
                  ['owner', 'admin'].includes(activeWorkspace.role)
                }
                onCreate={createRequirement}
                onUpdate={updateSavedRequirement}
                onArchive={archiveSavedRequirement}
              />
            </div>
            <footer className="flex justify-end border-t border-slate-200 p-4">
              <button
                type="button"
                className={secondaryClass}
                onClick={() => setRequirementPickerOpen(false)}
              >
                Listo
              </button>
            </footer>
          </div>
        </div>
      )}
      {generalPicker === 'category' && (
        <DocumentTypeModal
          title="Categoría de expediente"
          searchPlaceholder="Buscar categoría..."
          typeTabLabel="Categorías"
          itemPluralLabel="categorías"
          favoriteStorageKey="case_category_favorites"
          showGroupTab={false}
          types={caseCategories.map((category) => ({
            id: category.code,
            nombre: category.name,
            grupo_id: null,
            descripcion: category.description,
          }))}
          groups={[]}
          selectedId={draft.categoryCode}
          onSelect={(code) => {
            const category = caseCategories.find((item) => item.code === code);
            if (category)
              setDraft((current) =>
                current.categoryCode === code
                  ? current
                  : {
                      ...current,
                      categoryCode: code,
                      caseType: category.name,
                      typeCode: '',
                      caseSubtype: '',
                    }
              );
            setGeneralPicker(null);
          }}
          onClose={() => setGeneralPicker(null)}
        />
      )}
      {generalPicker === 'type' && (
        <DocumentTypeModal
          title="Tipo de expediente"
          searchPlaceholder="Buscar tipo de expediente..."
          groupTabLabel="Por categoría"
          groupPluralLabel="Categorías"
          groupItemLabel="tipo"
          favoriteStorageKey="case_type_favorites"
          showGroupTab={false}
          types={(
            caseCategories.find((category) => category.code === draft.categoryCode)?.types || []
          ).map((type) => ({ id: type.code, nombre: type.name, grupo_id: draft.categoryCode }))}
          groups={caseCategories
            .filter((category) => category.code === draft.categoryCode)
            .map((category) => ({ id: category.code, nombre: category.name }))}
          selectedId={draft.typeCode}
          selectedGroupId={draft.categoryCode}
          onSelect={(code, groupCode) => {
            const category = caseCategories.find((item) => item.code === groupCode);
            const type = category?.types.find((item) => item.code === code);
            if (category && type)
              setDraft((current) => ({
                ...current,
                categoryCode: category.code,
                caseType: category.name,
                typeCode: type.code,
                caseSubtype: type.name,
              }));
            setGeneralPicker(null);
          }}
          onClose={() => setGeneralPicker(null)}
        />
      )}
      {generalPicker === 'tags' && (
        <TagsModal
          tags={caseTags}
          selectedIds={draft.tagIds}
          favoriteStorageKey="case_tag_favorites"
          onConfirm={(ids) => {
            setDraft((current) => ({ ...current, tagIds: ids }));
            setGeneralPicker(null);
          }}
          onClose={() => setGeneralPicker(null)}
        />
      )}
    </div>
  );
}

function ItemInspector({
  showValidation,
  item,
  sectionId,
  sections,
  onMove,
  catalogs,
  catalogError,
  search,
  setSearch,
  onRefresh,
  allowDeadline,
  onChange,
}: {
  showValidation: boolean;
  item: CaseTemplateItem;
  sectionId: string;
  sections: CaseTemplateSection[];
  onMove: (sectionId: string) => void;
  catalogs: Catalogs;
  catalogError: string;
  search: string;
  setSearch: (value: string) => void;
  onRefresh: () => void;
  allowDeadline: boolean;
  onChange: (update: (item: CaseTemplateItem) => CaseTemplateItem) => void;
}) {
  const fieldId = useId();
  const titleMissing = showValidation && !item.title.trim();
  const descriptionMissing =
    showValidation && item.kind === 'requested_document' && !item.description.trim();
  const choices =
    item.kind === 'document_template' || item.kind === 'form' ? catalogs[item.kind] : [];
  const visible = choices.filter((choice) =>
    choice.name.toLocaleLowerCase('es-MX').includes(search.toLocaleLowerCase('es-MX'))
  );
  return (
    <div className="mt-4 max-h-[50vh] space-y-4 overflow-y-auto pr-1 xl:max-h-none xl:overflow-visible">
      {sections.length > 1 && (
        <label className="block text-sm font-medium">
          Sección
          <select
            value={sectionId}
            onChange={(event) => onMove(event.target.value)}
            className={inputClass}
          >
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-sm font-medium">
        Nombre
        <input
          aria-invalid={titleMissing}
          aria-describedby={titleMissing ? fieldId + '-title-error' : undefined}
          value={item.title}
          onChange={(event) => onChange((current) => ({ ...current, title: event.target.value }))}
          className={inputClass}
        />
      </label>
      {titleMissing && (
        <p id={fieldId + '-title-error'} className="-mt-2 text-xs text-red-600">
          Escribe el nombre del elemento.
        </p>
      )}
      <label className="block text-sm font-medium">
        Descripción
        <textarea
          aria-invalid={descriptionMissing}
          aria-describedby={descriptionMissing ? fieldId + '-description-error' : undefined}
          value={item.description}
          onChange={(event) =>
            onChange((current) => ({ ...current, description: event.target.value }))
          }
          rows={3}
          placeholder="Describe el elemento y su finalidad"
          className={inputClass}
        />
      </label>
      {descriptionMissing && (
        <p id={fieldId + '-description-error'} className="-mt-2 text-xs text-red-600">
          Describe el documento que debe aportar el participante.
        </p>
      )}
      {item.kind === 'requested_document' && (
        <>
          <label className="block text-sm font-medium">
            Instrucciones para el participante
            <textarea
              value={item.instructions}
              onChange={(event) =>
                onChange((current) => ({ ...current, instructions: event.target.value }))
              }
              rows={3}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-medium">
            Categoría documental
            <select
              value={item.documentCategory}
              onChange={(event) =>
                onChange((current) => ({ ...current, documentCategory: event.target.value }))
              }
              className={inputClass}
            >
              {documentRequirementCategories.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {allowDeadline && (
        <label className="block text-sm font-medium">
          Vencimiento del requisito (días desde apertura)
          <input
            type="number"
            min={1}
            max={3650}
            value={item.dueInDays ?? ''}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                dueInDays: event.target.value ? Number(event.target.value) : null,
              }))
            }
            placeholder="Sin vencimiento"
            className={inputClass}
          />
        </label>
      )}
      <label className="block text-sm font-medium">
        Aplicación del requisito
        <select
          value={item.conditional ? 'conditional' : item.required ? 'required' : 'optional'}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              required: event.target.value === 'required',
              conditional: event.target.value === 'conditional',
              condition: event.target.value === 'conditional' ? current.condition : '',
            }))
          }
          className={inputClass}
        >
          <option value="required">Obligatorio</option>
          <option value="optional">Opcional</option>
          <option value="conditional" disabled>
            Condicional · pendiente de motor de reglas
          </option>
        </select>
      </label>
      {item.conditional && (
        <label className="block text-sm font-medium">
          Condición heredada (descriptiva, sin ejecución automática)
          <textarea
            rows={2}
            value={item.condition}
            readOnly
            onChange={(event) =>
              onChange((current) => ({ ...current, condition: event.target.value }))
            }
            placeholder="Ejemplo: si el proveedor cuenta con representante legal"
            className={inputClass}
          />
        </label>
      )}
      {item.kind === 'requested_document' && (
        <label className="block text-sm font-medium">
          Responsable de aportarlo
          <select
            value={item.responsibleRole}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                responsibleRole: event.target.value as CaseTemplateItem['responsibleRole'],
              }))
            }
            className={inputClass}
          >
            <option value="subject">Titular del expediente</option>
            <option value="external">Participante externo</option>
            <option value="representative">Representante legal</option>
            <option value="internal">Responsable interno</option>
          </select>
        </label>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={item.customizableAtLaunch}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              customizableAtLaunch: event.target.checked,
            }))
          }
          className="mt-1 accent-primary"
        />
        <span>
          Permitir decidir si aplica al iniciar un expediente
          <span className="mt-0.5 block text-xs text-slate-500">
            Sirve para adaptar este requisito a cada caso sin cambiar el tipo base.
          </span>
        </span>
      </label>
      {item.kind === 'requested_document' && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={item.requiresReview}
            onChange={(event) =>
              onChange((current) => ({ ...current, requiresReview: event.target.checked }))
            }
            className="accent-primary"
          />{' '}
          Revisión manual
        </label>
      )}
      {item.kind !== 'form' && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={item.requiresSignature} onChange={event=>onChange(current=>({...current,requiresSignature:event.target.checked}))} /><span>Usar la firma del documento vinculado<span className="mt-1 block text-xs text-slate-500">Los firmantes y el método se configuran en el documento.</span></span></label>}
      {item.requiresReview && (
        <label className="block text-sm font-medium">
          Rol revisor
          <select
            value={item.reviewerRole || ''}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                reviewerRole: (event.target.value || null) as CaseTemplateItem['reviewerRole'],
              }))
            }
            className={inputClass}
          >
            <option value="">Sin asignar</option>
            <option value="owner">Responsable del expediente</option>
            <option value="admin">Administrador autorizado</option>
            <option value="member">Integrador autorizado</option>
          </select>
        </label>
      )}
      <label className="block text-sm font-medium">
        Aplica a
        <select
          value={item.appliesTo}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              appliesTo: event.target.value as CaseTemplateItem['appliesTo'],
            }))
          }
          className={inputClass}
        >
          <option value="both">Personas físicas y morales</option>
          <option value="individual">Persona física</option>
          <option value="company">Persona moral</option>
        </select>
      </label>
      {item.kind === 'requested_document' && (
        <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-border">
          <h3 className="text-sm font-medium">Recepción del documento</h3>
          <fieldset>
            <legend className="text-xs text-slate-600">Formatos aceptados</legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {['PDF', 'JPG', 'PNG'].map((format) => (
                <label key={format} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={item.allowedFormats.includes(format)}
                    onChange={(event) =>
                      onChange((current) => ({
                        ...current,
                        allowedFormats: event.target.checked
                          ? [...current.allowedFormats, format]
                          : current.allowedFormats.filter((value) => value !== format),
                      }))
                    }
                    className="accent-primary"
                  />
                  {format}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-xs text-slate-600">
            Tamaño máximo (MB)
            <input
              type="number"
              min={1}
              max={100}
              value={item.maxSizeMb}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  maxSizeMb: Number(event.target.value),
                }))
              }
              className={inputClass}
            />
          </label>
          <label className="block text-xs text-slate-600">
            Cantidad máxima de archivos
            <input
              type="number"
              min={1}
              max={20}
              value={item.maxFiles}
              onChange={(event) =>
                onChange((current) => ({ ...current, maxFiles: Number(event.target.value) }))
              }
              className={inputClass}
            />
          </label>
          <label className="block text-xs text-slate-600">
            Antigüedad máxima del documento (días, opcional)
            <input
              type="number"
              min={1}
              value={item.validityDays ?? ''}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  validityDays: event.target.value ? Number(event.target.value) : null,
                }))
              }
              placeholder="Sin vencimiento definido"
              className={inputClass}
            />
            <span className="mt-1 block text-[11px] text-slate-500">
              Regla para revisar la vigencia al usar este tipo de expediente.
            </span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={item.askIssueDate}
              onChange={(event) =>
                onChange((current) => ({ ...current, askIssueDate: event.target.checked }))
              }
              className="accent-primary"
            />{' '}
            Solicitar fecha de emisión
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={item.allowReplacement}
              onChange={(event) =>
                onChange((current) => ({ ...current, allowReplacement: event.target.checked }))
              }
              className="accent-primary"
            />{' '}
            Permitir nueva versión
          </label>
        </div>
      )}
      {item.kind === 'requested_document' ? (
        <p className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
          Este requisito solicita una entrega documental. La descripción y las reglas se guardan en
          la plantilla.
        </p>
      ) : item.kind === 'existing_document' ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          Este elemento queda pendiente de vincular por instancia. El selector de documentos se
          habilitará en la apertura del expediente; la plantilla no guarda un documento privado.
          {item.sourceId && (
            <button
              type="button"
              className="mt-2 block font-semibold underline"
              onClick={() =>
                onChange((current) => ({ ...current, sourceId: null, sourceName: '' }))
              }
            >
              Quitar vínculo heredado
            </button>
          )}
        </div>
      ) : item.kind === 'new_document' ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
          Este elemento representa un documento de trabajo independiente para cada expediente. No
          solicita un archivo al participante.
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">
              {itemKindLabel[item.kind]} <span className="text-red-500">*</span>
            </h3>
            <button
              type="button"
              onClick={onRefresh}
              title="Actualizar recursos"
              aria-label="Actualizar recursos"
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-4 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar recurso..."
              className={`${inputClass} pl-9`}
            />
          </div>
          {catalogError && <p className="mt-2 text-xs text-amber-700">{catalogError}</p>}
          <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1 dark:border-border">
            {visible.length ? (
              visible.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() =>
                    onChange((current) => ({
                      ...current,
                      sourceId: choice.id,
                      sourceName: choice.name,
                      sourceVersion: choice.version,
                      sourceRevision: choice.revision,
                      title:
                        current.sourceId ||
                        ![
                          'Nuevo documento',
                          'Documento en progreso',
                          'Documento desde plantilla',
                          'Formulario',
                        ].includes(current.title)
                          ? current.title
                          : choice.name,
                    }))
                  }
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-xs ${item.sourceId === choice.id ? 'bg-blue-50 text-primary' : 'hover:bg-slate-50'}`}
                >
                  <span className="truncate">{choice.name}</span>
                  {item.sourceId === choice.id && <Check size={14} />}
                </button>
              ))
            ) : (
              <p className="p-3 text-xs text-slate-500">
                No hay recursos disponibles con esta búsqueda.
              </p>
            )}
          </div>
          {item.sourceId && (
            <div className="mt-2 text-xs text-emerald-700">
              Vinculado: {item.sourceName} · versión {item.sourceVersion || 'sin confirmar'}
              <button
                type="button"
                className="ml-2 underline"
                onClick={() =>
                  onChange((current) => ({
                    ...current,
                    sourceId: null,
                    sourceName: '',
                    sourceVersion: null,
                    sourceRevision: null,
                  }))
                }
              >
                Desvincular
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PreviewMetric({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
      <strong className="text-2xl font-semibold text-primary">{value}</strong>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </div>
  );
}
