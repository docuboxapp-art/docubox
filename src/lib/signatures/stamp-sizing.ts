export type StampSizePresetId = 'short' | 'medium' | 'large';

export type SignatureMethod = 'autografa' | 'efirma' | 'clicksign';

export const DEFAULT_SIGNATURE_STAMP_STYLES: Readonly<Record<SignatureMethod, string>> = {
  autografa: 'AC0',
  efirma: 'EC2',
  clicksign: 'CC2',
};

export function getDefaultSignatureStampStyle(method: SignatureMethod) {
  return DEFAULT_SIGNATURE_STAMP_STYLES[method];
}

export type StampSizePreset = {
  id: StampSizePresetId;
  label: string;
  widthPercent: number;
  heightPercent: number;
  minimumRenderWidth: number;
  minimumRenderHeight: number;
};

export const STAMP_SIZE_PRESETS: readonly StampSizePreset[] = [
  {
    id: 'short',
    label: 'Corta',
    widthPercent: 24,
    heightPercent: 8,
    minimumRenderWidth: 145,
    minimumRenderHeight: 58,
  },
  {
    id: 'medium',
    label: 'Mediana',
    widthPercent: 34,
    heightPercent: 12,
    minimumRenderWidth: 205,
    minimumRenderHeight: 92,
  },
  {
    id: 'large',
    label: 'Larga',
    widthPercent: 44,
    heightPercent: 16,
    minimumRenderWidth: 265,
    minimumRenderHeight: 122,
  },
] as const;

export function getStampSizePreset(style: string | null | undefined) {
  const category = String(style || '')
    .trim()
    .toUpperCase()
    .charAt(1);
  const presetId: StampSizePresetId =
    category === 'L' ? 'large' : category === 'M' ? 'medium' : 'short';
  return STAMP_SIZE_PRESETS.find((preset) => preset.id === presetId) || STAMP_SIZE_PRESETS[0];
}
