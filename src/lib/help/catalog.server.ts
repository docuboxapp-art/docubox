import 'server-only';

import { accessArticles } from './content/access';
import { documentArticles } from './content/documents';
import { legalArticles } from './content/legal';
import { participationArticles } from './content/participation';
import { workspaceArticles } from './content/workspaces';
import type { HelpAudience, HelpCategory } from './model';
import { buildHelpIndex } from './search';

const editorialArticles = [
  ...accessArticles,
  ...participationArticles,
  ...documentArticles,
  ...workspaceArticles,
  ...legalArticles,
];

export const publicHelpArticles = editorialArticles.filter(
  (article) => article.status === 'published' && article.visibility === 'public'
);

const publishedBySlug = new Map(publicHelpArticles.map((article) => [article.slug, article]));

export const getPublicHelpArticle = (slug: string) => publishedBySlug.get(slug);

export function listHelpCategory(category: HelpCategory, preferredAudience?: HelpAudience) {
  const articles = publicHelpArticles.filter((article) => article.category === category);
  if (!preferredAudience) return articles;
  return articles.sort(
    (left, right) =>
      Number(right.audiences.includes(preferredAudience)) -
      Number(left.audiences.includes(preferredAudience))
  );
}

export function listSelectedArticles(slugs: readonly string[]) {
  return slugs.flatMap((slug) => {
    const article = getPublicHelpArticle(slug);
    return article ? [article] : [];
  });
}

export const searchHelp = buildHelpIndex(publicHelpArticles);
