export type GovernanceLayerName = 'default' | 'organization' | 'unit' | 'template' | 'document';
export type GovernanceConfiguration = Record<string, unknown>;

export type GovernanceLayer = {
  name: GovernanceLayerName;
  values?: GovernanceConfiguration | null;
  lockedPaths?: string[];
};

export type GovernanceResolution = {
  values: GovernanceConfiguration;
  sources: Record<string, GovernanceLayerName>;
  lockedPaths: string[];
};

function isPlainObject(value: unknown): value is GovernanceConfiguration {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pathIsLocked(path: string, lockedPaths: Set<string>) {
  return [...lockedPaths].some((locked) => path === locked || path.startsWith(`${locked}.`));
}

function mergeLayer(
  target: GovernanceConfiguration,
  sourceMap: Record<string, GovernanceLayerName>,
  incoming: GovernanceConfiguration,
  layer: GovernanceLayerName,
  lockedPaths: Set<string>,
  prefix = ''
) {
  for (const [key, value] of Object.entries(incoming)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (pathIsLocked(path, lockedPaths)) continue;
    if (isPlainObject(value)) {
      const current = isPlainObject(target[key]) ? (target[key] as GovernanceConfiguration) : {};
      target[key] = current;
      mergeLayer(current, sourceMap, value, layer, lockedPaths, path);
      continue;
    }
    target[key] = Array.isArray(value) ? [...value] : value;
    sourceMap[path] = layer;
  }
}

export function resolveGovernanceLayers(layers: GovernanceLayer[]): GovernanceResolution {
  const values: GovernanceConfiguration = {};
  const sources: Record<string, GovernanceLayerName> = {};
  const lockedPaths = new Set<string>();

  for (const layer of layers) {
    if (layer.values) mergeLayer(values, sources, layer.values, layer.name, lockedPaths);
    for (const path of layer.lockedPaths || []) {
      if (path.trim()) lockedPaths.add(path.trim());
    }
  }

  return { values, sources, lockedPaths: [...lockedPaths] };
}

export function resolveOrganizationGovernance(input: {
  defaults?: GovernanceConfiguration | null;
  organization?: GovernanceConfiguration | null;
  unit?: GovernanceConfiguration | null;
  template?: GovernanceConfiguration | null;
  document?: GovernanceConfiguration | null;
  locks?: Partial<Record<GovernanceLayerName, string[]>>;
}) {
  return resolveGovernanceLayers([
    { name: 'default', values: input.defaults, lockedPaths: input.locks?.default },
    { name: 'organization', values: input.organization, lockedPaths: input.locks?.organization },
    { name: 'unit', values: input.unit, lockedPaths: input.locks?.unit },
    { name: 'template', values: input.template, lockedPaths: input.locks?.template },
    { name: 'document', values: input.document, lockedPaths: input.locks?.document },
  ]);
}

const signatureMethodAliases: Record<string, string> = {
  biometria: 'biometrica',
  efirma: 'efirma_sat',
};

export function normalizeOrganizationSignatureMethod(method: unknown) {
  const value = String(method || '')
    .trim()
    .toLowerCase();
  return signatureMethodAliases[value] || value;
}

export function findUnsupportedOrganizationSignatureMethods(
  participants: Array<{ tipoFirma?: unknown[]; tipo_firma?: unknown[] }>,
  allowedMethods: unknown[]
) {
  const allowed = new Set(allowedMethods.map(normalizeOrganizationSignatureMethod));
  const requested = participants
    .flatMap((participant) => participant.tipoFirma || participant.tipo_firma || [])
    .map(normalizeOrganizationSignatureMethod)
    .filter(Boolean);
  return [...new Set(requested.filter((method) => !allowed.has(method)))];
}
