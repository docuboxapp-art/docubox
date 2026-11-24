import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { consumeServerRateLimit } from '@/lib/security/server-rate-limit';
import { createServiceClient } from '@/lib/supabase/server';
import { HELP_FEEDBACK_REASONS } from './model';
import { getPublicHelpArticle } from './catalog.server';
import { HelpRequestError } from './request.server';

export function validateHelpVote(body: Record<string, unknown>) {
  const { article, voter, helpful, reason } = body;
  if (typeof article !== 'string' || !getPublicHelpArticle(article)) {
    throw new HelpRequestError(400, 'El artículo no está disponible para valorar.');
  }
  if (
    typeof voter !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(voter) ||
    typeof helpful !== 'boolean' ||
    (reason != null &&
      (helpful || typeof reason !== 'string' || !Object.hasOwn(HELP_FEEDBACK_REASONS, reason)))
  ) {
    throw new HelpRequestError(400, 'La valoración no tiene un formato válido.');
  }
  return {
    article_slug: article,
    voter_hash: createHash('sha256')
      .update('help:' + article + ':' + voter.toLowerCase())
      .digest('hex'),
    helpful,
    reason: typeof reason === 'string' ? reason : null,
    updated_at: new Date().toISOString(),
  };
}

export async function saveHelpVote(request: Request, vote: ReturnType<typeof validateHelpVote>) {
  if (process.env.NODE_ENV === 'development') {
    // Local QA stays isolated even when .env.local points at the hosted database.
    const directory = join(process.cwd(), '.tmp', 'centro-ayuda', 'valoraciones');
    const target = join(directory, vote.article_slug + '-' + vote.voter_hash + '.json');
    const pending = join(directory, randomUUID() + '.tmp');
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(pending, JSON.stringify(vote), { flag: 'wx', mode: 0o600 });
      await rename(pending, target);
    } finally {
      await rm(pending, { force: true }).catch(() => undefined);
    }
    return true;
  }

  const source = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const allowed = await consumeServerRateLimit({
    scope: 'help-article-feedback',
    identifiers: [source],
    limit: 30,
    windowSeconds: 300,
  });
  if (!allowed) return false;
  const { error } = await createServiceClient()
    .from('help_article_feedback')
    .upsert(vote, { onConflict: 'article_slug,voter_hash' });
  if (error) throw new Error('HELP_FEEDBACK_UNAVAILABLE');
  return true;
}
