import type { FormTemplate } from '@/lib/forms/schema';
import { resolveFormWebHeader } from '@/lib/forms/web-header';

export function FormWebHeader({
  template,
  documentTypeName,
  headingLevel = 2,
}: {
  template: FormTemplate;
  documentTypeName?: string;
  headingLevel?: 1 | 2;
}) {
  const appearance = template.settings.appearance;
  const content = resolveFormWebHeader(template, documentTypeName);
  if (!appearance.showHeader || !Object.values(content).some(Boolean)) return null;

  const headingClass = 'text-xl font-semibold text-[#0F172A] dark:text-foreground';
  return (
    <div className="border-b border-[#E2E8F0] px-6 py-6 dark:border-border" style={{ textAlign: appearance.headerAlignment }}>
      {content.title && (headingLevel === 1
        ? <h1 className={headingClass}>{content.title}</h1>
        : <h2 className={headingClass}>{content.title}</h2>)}
      {content.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#475569] dark:text-muted-foreground">{content.description}</p>}
      {content.documentNumber && <p className="mt-3 text-xs text-[#64748B] dark:text-muted-foreground">Número o clave: <span className="font-medium text-[#334155] dark:text-foreground">{content.documentNumber}</span></p>}
      {content.documentType && <p className="mt-1 text-xs text-[#64748B] dark:text-muted-foreground">Tipo de formulario: <span className="font-medium text-[#334155] dark:text-foreground">{content.documentType}</span></p>}
    </div>
  );
}
