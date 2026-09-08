import 'server-only';

import { blockchainEvidenceConfig } from './config';
import { OpenTimestampsCliProvider } from './opentimestamps-cli-provider';
import { OpenTimestampsHttpProvider } from './opentimestamps-http-provider';
import type { OpenTimestampProvider } from './types';

export function createOpenTimestampProvider(): OpenTimestampProvider {
  return blockchainEvidenceConfig().providerMode.toUpperCase() === 'HTTP'
    ? new OpenTimestampsHttpProvider()
    : new OpenTimestampsCliProvider();
}
