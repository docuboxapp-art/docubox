export const MAX_MOBILE_CAPTURE_PAYLOAD_CHARS = 3_500_000;

type MobileCaptureInput = {
  token: string;
  anverso: string | null;
  reverso: string | null;
  selfiePhoto: string;
  selfieVideo: string | null;
  curp: string | null;
  nombre: string | null;
  apellidoPaterno: string | null;
  apellidoMaterno: string | null;
  profileCurp: string | null;
  usingStoredId: boolean;
};

export function createMobileCapturePayload(input: MobileCaptureInput): string {
  return JSON.stringify({
    token: input.token,
    anversoData: input.usingStoredId ? null : input.anverso,
    reversoData: input.usingStoredId ? null : input.reverso,
    selfieData: input.selfiePhoto,
    selfieVideo: input.selfieVideo,
    curpExtracted: input.curp,
    nombreExtracted: input.nombre
      ? `${input.nombre} ${input.apellidoPaterno || ''} ${input.apellidoMaterno || ''}`.trim()
      : null,
    curpProfileFallback: input.profileCurp,
    usingStoredId: input.usingStoredId,
  });
}
