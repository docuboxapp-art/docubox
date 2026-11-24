import type { HelpArticle, HelpFilters, HelpSearchResult } from './model';
import { cleanHelpQuery } from './query';

const stopWords = new Set(
  'a al algo como con cual cuando de del donde el en es esta esto ha hay la las le lo los me mi mis no o para por que se si su sus te tu un una y ya'.split(
    ' '
  )
);

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\be[.\s-]+firma\b/g, 'efirma')
    .replace(/\bclick\s*(?:&|y)\s*sign\b/g, 'click sign')
    .replace(/\bnom[\s-]*151\b/g, 'nom151')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const words = (normalized: string) =>
  normalized.split(' ').filter((word) => word.length > 1 && !stopWords.has(word));

// A single substitution, insertion, deletion or transposition handles common typos.
function oneEditAway(typed: string, indexed: string) {
  if (typed.length < 4 || Math.abs(typed.length - indexed.length) > 1) return false;
  const [shorter, longer] = typed.length <= indexed.length ? [typed, indexed] : [indexed, typed];
  let position = 0;
  while (position < shorter.length && shorter[position] === longer[position]) position += 1;
  if (shorter.length !== longer.length) {
    return shorter.slice(position) === longer.slice(position + 1);
  }
  if (shorter.slice(position + 1) === longer.slice(position + 1)) return true;
  return (
    shorter[position] === longer[position + 1] &&
    shorter[position + 1] === longer[position] &&
    shorter.slice(position + 2) === longer.slice(position + 2)
  );
}

export function buildHelpIndex(entries: readonly HelpArticle[]) {
  const indexed = entries
    .filter((article) => article.visibility === 'public' && article.status === 'published')
    .map((article) => {
      const hints = article.searchTerms.map(normalize);
      const title = normalize(article.title);
      const body = article.sections.flatMap(
        ({ title: heading, paragraphs = [], steps = [], items = [] }) => [
          heading,
          ...paragraphs,
          ...steps,
          ...items,
        ]
      );
      const weights = new Map<string, number>();
      const fieldScores = [
        { value: title, weight: 14 },
        { value: hints.join(' '), weight: 11 },
        { value: normalize(article.tags.join(' ')), weight: 12 },
        { value: normalize(article.summary), weight: 7 },
        { value: normalize(body.join(' ')), weight: 2 },
      ];
      for (const { value, weight } of fieldScores) {
        for (const token of words(value)) {
          if (!weights.has(token) || weights.get(token)! < weight) weights.set(token, weight);
        }
      }
      return { article, hints, title, weights, body };
    });

  return (value: string, filters: HelpFilters = {}, limit = 40): HelpSearchResult[] => {
    const query = normalize(cleanHelpQuery(value));
    const tokens = [...new Set(words(query))].slice(0, 12);
    if (!tokens.length) return [];
    return indexed
      .filter(
        ({ article }) =>
          (!filters.categoria || article.category === filters.categoria) &&
          (!filters.tipo || article.kind === filters.tipo) &&
          (!filters.audiencia || article.audiences.includes(filters.audiencia))
      )
      .flatMap(({ article, hints, title, weights, body }) => {
        let score = 0;
        let matches = 0;
        for (const term of tokens) {
          let weight = weights.get(term) ?? 0;
          if (!weight && term.length >= 3) {
            for (const [candidate, candidateWeight] of weights) {
              if (candidate.startsWith(term)) weight = Math.max(weight, candidateWeight * 0.7);
              else if (oneEditAway(term, candidate))
                weight = Math.max(weight, candidateWeight * 0.47);
            }
          }
          if (weight) matches += 1;
          score += weight;
        }
        const exactIntent = hints.includes(query);
        const inTitle = title.includes(query);
        const inHint = hints.some((hint) => hint.includes(query));
        if (!exactIntent && !inTitle && !inHint && matches < Math.ceil(tokens.length * 0.6))
          return [];
        score += (exactIntent ? 110 : 0) + (inTitle ? 42 : 0) + (inHint ? 22 : 0);
        const { slug, category, kind } = article;
        const matchedParagraph =
          score < 18
            ? body.find(
                (line) => line.length > 42 && tokens.some((term) => normalize(line).includes(term))
              )
            : undefined;
        const excerpt =
          matchedParagraph && matchedParagraph.length > 180
            ? matchedParagraph.slice(0, 178).trimEnd() + '…'
            : matchedParagraph || article.summary;
        return [{ slug, title: article.title, category, kind, excerpt, score }];
      })
      .sort(
        (left, right) => right.score - left.score || left.title.localeCompare(right.title, 'es-MX')
      )
      .slice(0, limit)
      .map(({ slug, title, category, kind, excerpt }) => ({
        slug,
        title,
        category,
        kind,
        excerpt,
      }));
  };
}
