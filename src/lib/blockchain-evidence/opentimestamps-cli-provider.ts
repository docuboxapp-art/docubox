import 'server-only';

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { blockchainEvidenceConfig } from './config';
import type { OpenTimestampProvider, ProofInspection, ProofVerification } from './types';

const execFileAsync = promisify(execFile);

function inspectionFromInfo(output: string): ProofInspection {
  const heightMatch =
    output.match(/BitcoinBlockHeaderAttestation\((\d+)\)/i) ||
    output.match(/Bitcoin[^\n]*block[^\d]*(\d+)/i);
  const height = heightMatch ? Number(heightMatch[1]) : null;
  const pending = /PendingAttestation|calendar/i.test(output) && height === null;
  return {
    proofIntegrity: true,
    pending,
    bitcoinAttestationFound: height !== null,
    bitcoinBlockHeight: Number.isSafeInteger(height) ? height : null,
    bitcoinBlockHash: null,
    bitcoinAttestedAt: null,
    rawSummary: output.slice(0, 8000),
  };
}

export class OpenTimestampsCliProvider implements OpenTimestampProvider {
  readonly providerId = 'opentimestamps-cli';

  private async run(args: string[], cwd: string) {
    const config = blockchainEvidenceConfig();
    try {
      return await execFileAsync(config.cliPath, args, {
        cwd,
        timeout: config.timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      const details = error as Error & { stdout?: string; stderr?: string; code?: string | number };
      const wrapped = new Error(details.stderr || details.stdout || details.message);
      wrapped.name =
        details.code === 'ENOENT'
          ? 'OPENTIMESTAMPS_CLI_UNAVAILABLE'
          : 'OPENTIMESTAMPS_COMMAND_FAILED';
      throw wrapped;
    }
  }

  private async workspace<T>(fn: (directory: string) => Promise<T>) {
    const directory = await mkdtemp(join(tmpdir(), 'docubox-ots-'));
    try {
      return await fn(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async createProof(input: {
    canonicalManifest: string;
    manifestHash: string;
    calendars: string[];
  }) {
    return this.workspace(async (directory) => {
      const manifestPath = join(directory, 'blockchain-evidence-manifest.json');
      await writeFile(manifestPath, input.canonicalManifest, { encoding: 'utf8', flag: 'wx' });
      const globalArgs = [
        '--no-default-whitelist',
        ...input.calendars.flatMap((url) => ['--whitelist', url]),
      ];
      const stampArgs = [
        'stamp',
        ...input.calendars.flatMap((url) => ['--calendar', url]),
        '-m',
        String(Math.min(2, input.calendars.length)),
        manifestPath,
      ];
      const result = await this.run([...globalArgs, ...stampArgs], directory);
      const proof = new Uint8Array(await readFile(`${manifestPath}.ots`));
      const output = `${result.stdout}\n${result.stderr}`;
      const failed = input.calendars.filter(
        (url) =>
          output.includes(url) &&
          /fail|error|timeout/i.test(
            output.slice(
              Math.max(0, output.indexOf(url) - 80),
              output.indexOf(url) + url.length + 180
            )
          )
      );
      return {
        proof,
        calendarsSucceeded: input.calendars.filter((url) => !failed.includes(url)),
        calendarsFailed: failed,
      };
    });
  }

  async upgradeProof(input: { proof: Uint8Array; calendars: string[] }) {
    return this.workspace(async (directory) => {
      const proofPath = join(directory, 'document.ots');
      await writeFile(proofPath, input.proof, { flag: 'wx' });
      const beforePath = join(directory, 'document.before.ots');
      await copyFile(proofPath, beforePath);
      const globalArgs = [
        '--no-default-whitelist',
        ...input.calendars.flatMap((url) => ['--whitelist', url]),
      ];
      await this.run(
        [
          ...globalArgs,
          'upgrade',
          ...input.calendars.flatMap((url) => ['--calendar', url]),
          proofPath,
        ],
        directory
      );
      const [before, after] = await Promise.all([readFile(beforePath), readFile(proofPath)]);
      return { proof: new Uint8Array(after), changed: !before.equals(after) };
    });
  }

  async getProofStatus(proof: Uint8Array) {
    return this.workspace(async (directory) => {
      const proofPath = join(directory, 'document.ots');
      await writeFile(proofPath, proof, { flag: 'wx' });
      const result = await this.run(['info', proofPath], directory);
      return inspectionFromInfo(`${result.stdout}\n${result.stderr}`);
    });
  }

  async verifyProof(input: {
    proof: Uint8Array;
    manifestHash: string;
  }): Promise<ProofVerification> {
    return this.workspace(async (directory) => {
      const proofPath = join(directory, 'document.ots');
      await writeFile(proofPath, input.proof, { flag: 'wx' });
      const info = await this.getProofStatus(input.proof);
      try {
        const result = await this.run(['verify', '-d', input.manifestHash, proofPath], directory);
        const output = `${result.stdout}\n${result.stderr}`;
        const timestampMatch = output.match(/attests data existed as of\s+(.+)/i);
        return {
          ...info,
          manifestHashMatches: true,
          bitcoinVerified:
            info.bitcoinAttestationFound && /success|attests data existed/i.test(output),
          bitcoinAttestedAt: timestampMatch?.[1]?.trim() || info.bitcoinAttestedAt,
          rawSummary: `${info.rawSummary}\n${output}`.slice(0, 8000),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ...info,
          manifestHashMatches: !/digest provided does not match/i.test(message),
          bitcoinVerified: false,
          rawSummary: `${info.rawSummary}\n${message}`.slice(0, 8000),
        };
      }
    });
  }
}
