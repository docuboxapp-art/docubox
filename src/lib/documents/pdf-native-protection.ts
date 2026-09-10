/**
 * Canonical representation of the PDF-only protection policy persisted on a
 * document. The database names predate this module; keeping the mapping here
 * avoids adding a second, competing policy record.
 */
export type PdfNativeProtectionPolicy = {
  denyPrint: boolean;
  denyCopyContent: boolean;
  denyModify: boolean;
  denyPageExtraction: boolean;
  denyDocumentAssembly: boolean;
};

export type StoredPdfNativeProtectionPolicy = {
  proteccion_firmado?: unknown;
  impedir_impresion?: unknown;
  evitar_copia_texto?: unknown;
  impedir_modificacion?: unknown;
  impedir_extraccion?: unknown;
  evitar_montaje?: unknown;
};

const disabledPolicy: PdfNativeProtectionPolicy = {
  denyPrint: false,
  denyCopyContent: false,
  denyModify: false,
  denyPageExtraction: false,
  denyDocumentAssembly: false,
};

export function pdfNativeProtectionPolicy(
  value: StoredPdfNativeProtectionPolicy | null | undefined
): PdfNativeProtectionPolicy {
  if (!value?.proteccion_firmado) return { ...disabledPolicy };

  return {
    denyPrint: value.impedir_impresion === true,
    denyCopyContent: value.evitar_copia_texto === true,
    denyModify: value.impedir_modificacion === true,
    denyPageExtraction: value.impedir_extraccion === true,
    denyDocumentAssembly: value.evitar_montaje === true,
  };
}

export function hasPdfNativeProtection(policy: PdfNativeProtectionPolicy): boolean {
  return Object.values(policy).some(Boolean);
}
