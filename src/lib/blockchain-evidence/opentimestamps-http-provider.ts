import 'server-only';

import { createHash } from 'node:crypto';
import { blockchainEvidenceConfig } from './config';
import type {
  OpenTimestampProvider,
  OpenTimestampsHealth,
  ProofInspection,
  ProofVerification,
} from './types';

type RuntimeResponse = {
  proofBase64?: string;
  changed?: boolean;
  calendarsSucceeded?: string[];
  calendarsFailed?: string[];
  inspection?: ProofInspection;
  verification?: ProofVerification;
  health?: OpenTimestampsHealth;
  error?: string;
  code?: string;
};

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export class OpenTimestampsHttpProvider implements OpenTimestampProvider {
  readonly providerId = 'opentimestamps-official-python-runtime';

  private async request(action: string, payload: Record<string, unknown> = {}) {
    const config = blockchainEvidenceConfig();
    if (!config.workerUrl || !config.workerSecret) {
      const error = new Error('OpenTimestamps runtime is not configured.');
      error.name = 'OTS_RUNTIME_UNSUPPORTED';
      throw error;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(config.workerUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.workerSecret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ action, ...payload }),
        cache: 'no-store',
        signal: controller.signal,
      });
      const result = (await response.json().catch(() => ({}))) as RuntimeResponse;
      if (!response.ok) {
        const error = new Error(result.error || 'OpenTimestamps runtime request failed.');
        error.name = result.code || 'OTS_RUNTIME_UNSUPPORTED';
        throw error;
      }
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        const timeoutError = new Error('OpenTimestamps runtime timed out.');
        timeoutError.name = 'OTS_CALENDAR_UNAVAILABLE';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async createProof(input: {
    canonicalManifest: string;
    manifestHash: string;
    calendars: string[];
  }) {
    if (sha256(input.canonicalManifest) !== input.manifestHash) {
      const error = new Error('The manifest hash does not match the submitted bytes.');
      error.name = 'OTS_INVALID_PROOF';
      throw error;
    }
    const result = await this.request('stamp', {
      manifestBase64: Buffer.from(input.canonicalManifest, 'utf8').toString('base64'),
      manifestHash: input.manifestHash,
      calendars: input.calendars,
    });
    if (!result.proofBase64) {
      const error = new Error('OpenTimestamps returned an empty proof.');
      error.name = 'OTS_INVALID_PROOF';
      throw error;
    }
    return {
      proof: new Uint8Array(Buffer.from(result.proofBase64, 'base64')),
      calendarsSucceeded: result.calendarsSucceeded || [],
      calendarsFailed: result.calendarsFailed || [],
    };
  }

  async upgradeProof(input: { proof: Uint8Array; calendars: string[] }) {
    const result = await this.request('upgrade', {
      proofBase64: Buffer.from(input.proof).toString('base64'),
      proofSha256: createHash('sha256').update(input.proof).digest('hex'),
      calendars: input.calendars,
    });
    if (!result.proofBase64) {
      const error = new Error('OpenTimestamps returned an empty upgraded proof.');
      error.name = 'OTS_INVALID_PROOF';
      throw error;
    }
    return {
      proof: new Uint8Array(Buffer.from(result.proofBase64, 'base64')),
      changed: result.changed === true,
    };
  }

  async getProofStatus(proof: Uint8Array) {
    const result = await this.request('inspect', {
      proofBase64: Buffer.from(proof).toString('base64'),
      proofSha256: createHash('sha256').update(proof).digest('hex'),
    });
    if (!result.inspection) {
      const error = new Error('OpenTimestamps did not return proof inspection data.');
      error.name = 'OTS_INVALID_PROOF';
      throw error;
    }
    return result.inspection;
  }

  async verifyProof(input: { proof: Uint8Array; manifestHash: string }) {
    const result = await this.request('verify', {
      proofBase64: Buffer.from(input.proof).toString('base64'),
      proofSha256: createHash('sha256').update(input.proof).digest('hex'),
      manifestHash: input.manifestHash,
    });
    if (!result.verification) {
      const error = new Error('OpenTimestamps did not return verification data.');
      error.name = 'OTS_VERIFY_FAILED';
      throw error;
    }
    return result.verification;
  }

  async healthCheck() {
    const result = await this.request('health');
    if (!result.health) {
      return {
        available: false,
        clientVersion: null,
        calendarsReachable: 0,
        calendarsConfigured: 0,
        errorCode: 'OTS_CLIENT_UNAVAILABLE',
      };
    }
    return result.health;
  }
}
