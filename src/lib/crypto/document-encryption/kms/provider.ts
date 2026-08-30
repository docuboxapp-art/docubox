export type DocumentKeyMetadata = {
  provider: string;
  keyId: string;
  keyVersion: string;
  algorithm: 'GOOGLE_SYMMETRIC_ENCRYPTION' | string;
  protectionLevel: 'hsm' | 'software' | 'external' | 'unknown';
  status: 'active' | 'unavailable';
};

export type WrappedDocumentKey = {
  wrappedKey: Buffer;
  provider: string;
  keyId: string;
  keyVersion: string;
};

export interface DocumentKeyManagementProvider {
  wrapKey(input: { plaintextKey: Uint8Array; aad: Uint8Array }): Promise<WrappedDocumentKey>;
  unwrapKey(input: {
    wrappedKey: Uint8Array;
    aad: Uint8Array;
    keyId: string;
    keyVersion: string;
  }): Promise<Buffer>;
  getKeyMetadata(): Promise<DocumentKeyMetadata>;
  healthCheck(): Promise<{ ready: boolean; missing: string[]; metadata?: DocumentKeyMetadata }>;
}
