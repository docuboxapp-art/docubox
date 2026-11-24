import 'server-only';

const productReplyAddress = 'soporte@docubox.com.mx';
type HelpEnvironment = Record<string, string | undefined>;

export function getHelpSupportEmail(env: HelpEnvironment = process.env) {
  const configured =
    env.DOCUBOX_HELP_SUPPORT_EMAIL ?? env.RESEND_REPLY_TO_EMAIL ?? productReplyAddress;
  const email = configured.trim();
  return /^[a-z0-9_.+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email) ? email : null;
}

export function getHelpInstitutionalLinks(env: HelpEnvironment = process.env) {
  const documents = [
    { title: 'Términos y condiciones', url: env.DOCUBOX_HELP_TERMS_URL },
    { title: 'Aviso de privacidad', url: env.DOCUBOX_HELP_PRIVACY_URL },
  ];
  return documents.flatMap(({ title, url }) => {
    if (!url) return [];
    try {
      const link = new URL(url);
      if (link.protocol !== 'https:' || link.username || link.password) return [];
      return [{ title, href: link.href }];
    } catch {
      return [];
    }
  });
}
