import type { HelpArticle } from '../model';

// Editorial dates are part of the content and change only when it is reviewed.
const firstEdition = '2026-11-24';
type EditionFields = 'id' | 'status' | 'visibility' | 'updatedAt' | 'reviewedAt';
type ArticleDraft = Omit<HelpArticle, EditionFields> & Partial<Pick<HelpArticle, EditionFields>>;

export function publishArticle(draft: ArticleDraft): HelpArticle {
  return {
    id: draft.slug,
    status: 'published',
    visibility: 'public',
    updatedAt: firstEdition,
    reviewedAt: firstEdition,
    ...draft,
  };
}
