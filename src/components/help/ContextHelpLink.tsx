import { CircleHelp } from 'lucide-react';
import { contextualHelpHref, type HelpAudience } from '@/lib/help/model';

type Props = {
  slug: string;
  audience?: HelpAudience;
  children: string;
  className?: string;
};

export default function ContextHelpLink({ slug, audience, children, className = '' }: Props) {
  return (
    <a
      href={contextualHelpHref(slug, audience)}
      target="_blank"
      rel="noopener noreferrer"
      className={
        'inline-flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
        className
      }
    >
      <CircleHelp size={15} className="shrink-0" aria-hidden="true" />
      {children}
      <span className="sr-only"> (abre en otra pestaña)</span>
    </a>
  );
}
