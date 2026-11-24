import 'server-only';

type HelpEvent =
  'search' | 'search_empty' | 'article_open' | 'contextual_help' | 'feedback' | 'support_email';

export function emitHelpUsage(event: HelpEvent) {
  console.info(
    JSON.stringify({
      marker: 'docubox.help.v1',
      event,
      at: new Date().toISOString(),
    })
  );
}
