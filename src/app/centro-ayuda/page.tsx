import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  CircleHelp,
  FileText,
  KeyRound,
  PenLine,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { listSelectedArticles } from '@/lib/help/catalog.server';
import {
  HELP_AUDIENCES,
  HELP_ROOT,
  helpArticleHref,
  helpCategoryHref,
  readHelpFilters,
  type HelpAudience,
  type HelpCategory,
  type HelpSearchParams,
} from '@/lib/help/model';
import { emitHelpUsage } from '@/lib/observability/help-usage';
import { HelpArticleList, HelpCategoryCards } from './_components/HelpCollections';
import HelpSearch from './_components/HelpSearch';
import HelpSupport from './_components/HelpSupport';
import styles from './help.module.css';

const audiences = {
  participar: {
    icon: PenLine,
    title: 'Me invitaron a participar',
    description: 'Abre tu enlace, reconoce tu rol y descubre qué hacer si el acceso falla.',
    articles: ['abrir-una-invitacion', 'firmar-un-documento', 'roles-y-turnos-de-participacion'],
    categories: [
      'acceso',
      'firmar-y-participar',
      'seguimiento',
      'crear-y-enviar',
      'plantillas-y-formularios',
      'cuenta-y-organizacion',
    ],
  },
  gestionar: {
    icon: FileText,
    title: 'Voy a enviar un documento',
    description: 'Prepara el archivo, elige quién participa y consulta el resultado del envío.',
    articles: [
      'enviar-mi-primer-documento',
      'configurar-participantes-y-metodos',
      'seguimiento-y-recordatorios',
    ],
    categories: [
      'crear-y-enviar',
      'seguimiento',
      'plantillas-y-formularios',
      'firmar-y-participar',
      'acceso',
      'cuenta-y-organizacion',
    ],
  },
  organizacion: {
    icon: UsersRound,
    title: 'Voy a configurar mi organización',
    description: 'Selecciona tu espacio, invita al equipo y revisa los permisos de cada rol.',
    articles: [
      'poner-en-marcha-mi-organizacion',
      'configuracion-planes-e-integraciones',
      'configurar-participantes-y-metodos',
    ],
    categories: [
      'cuenta-y-organizacion',
      'crear-y-enviar',
      'seguimiento',
      'plantillas-y-formularios',
      'acceso',
      'firmar-y-participar',
    ],
  },
} satisfies Record<
  HelpAudience,
  {
    icon: typeof PenLine;
    title: string;
    description: string;
    articles: string[];
    categories: HelpCategory[];
  }
>;

const quickLinks = [
  { label: 'No me llega el código', slug: 'no-recibo-el-codigo' },
  { label: 'Firmar con e.firma', slug: 'firmar-con-efirma' },
  { label: 'Descargar un documento', slug: 'descargar-documentos-y-constancias' },
  { label: 'Validez de la firma', slug: 'validez-de-la-firma-electronica' },
];

export default async function CentroAyudaPage({
  searchParams,
}: {
  searchParams: Promise<HelpSearchParams>;
}) {
  const params = await searchParams;
  const audience = readHelpFilters(params).audiencia ?? 'participar';
  const entry = audiences[audience];
  const LeadIcon = entry.icon;
  const featured = listSelectedArticles(entry.articles);
  const troubles = listSelectedArticles([
    'no-recibo-el-codigo',
    'el-enlace-del-documento-no-abre',
    'mi-efirma-no-funciona',
    'no-puedo-descargar',
  ]);
  const questions = listSelectedArticles([
    'que-sigue-despues-de-firmar',
    'diferencia-entre-codigos-y-contrasenas',
    'validez-de-la-firma-electronica',
  ]);
  if (params.origen === 'flujo') emitHelpUsage('contextual_help');

  return (
    <>
      <section className={styles.hero} aria-labelledby="help-home-title">
        <div className={styles.wrap + ' ' + styles.heroGrid}>
          <div>
            <h1 className={styles.heroTitle} id="help-home-title">
              ¿Cómo podemos ayudarte?
            </h1>
            <p className={styles.intro}>
              Encuentra guías para usar Docubox, resolver problemas y conocer cómo funcionan tus
              firmas y documentos.
            </p>
            <HelpSearch />
            <div className={styles.quickLinks} aria-label="Consultas frecuentes">
              {quickLinks.map(({ label, slug }) => (
                <Link
                  href={helpArticleHref(slug)}
                  prefetch={false}
                  key={slug}
                  className={styles.chip}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
          <aside className={styles.feature} aria-labelledby="help-start-title">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary">
              <BookOpen size={15} aria-hidden="true" /> Primeros pasos
            </div>
            <div className="mt-3 flex items-start gap-3">
              <span className={styles.iconTile}>
                <LeadIcon size={20} aria-hidden="true" />
              </span>
              <div>
                <h2 id="help-start-title" className="text-lg font-semibold leading-tight">
                  {entry.title}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {entry.description}
                </p>
              </div>
            </div>
            <div className="mt-2">
              <HelpArticleList articles={featured} />
            </div>
          </aside>
        </div>
      </section>

      <div className={styles.wrap}>
        <section id="temas" className={styles.section} aria-labelledby="help-topics-title">
          <h2 id="help-topics-title" className={styles.sectionHeading}>
            Explora por tema
          </h2>
          <nav className={styles.audiences} aria-label="Guías recomendadas por audiencia">
            {Object.entries(HELP_AUDIENCES).map(([value, label]) => {
              const Icon = audiences[value as HelpAudience].icon;
              return (
                <Link
                  key={value}
                  href={HELP_ROOT + '?audiencia=' + value}
                  prefetch={false}
                  scroll={false}
                  aria-current={value === audience ? 'true' : undefined}
                  className={styles.audience}
                >
                  <Icon size={16} aria-hidden="true" /> {label}
                </Link>
              );
            })}
          </nav>
          <HelpCategoryCards categories={entry.categories} audience={audience} />
        </section>

        <div className={styles.twoColumns}>
          <section className={styles.panel} aria-labelledby="help-troubleshooting-title">
            <div className="flex items-center gap-3">
              <span className={styles.iconTile}>
                <CircleHelp size={20} aria-hidden="true" />
              </span>
              <h2 id="help-troubleshooting-title" className="text-lg font-semibold">
                Resuelve un problema
              </h2>
            </div>
            <HelpArticleList articles={troubles} />
            <Link
              href={helpCategoryHref('solucion-de-problemas')}
              prefetch={false}
              className={styles.arrowLink + ' mt-2 text-sm'}
            >
              Ver soluciones <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </section>
          <section className={styles.panel} aria-labelledby="help-faq-title">
            <div className="flex items-center gap-3">
              <span className={styles.iconTile}>
                <KeyRound size={20} aria-hidden="true" />
              </span>
              <h2 id="help-faq-title" className="text-lg font-semibold">
                Preguntas frecuentes
              </h2>
            </div>
            {questions.map((article) => (
              <details key={article.slug} className="border-b border-border px-1 py-3">
                <summary className="cursor-pointer text-sm font-semibold">{article.title}</summary>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {article.summary}
                </p>
                <Link
                  href={helpArticleHref(article.slug)}
                  prefetch={false}
                  className={styles.inlineLink + ' text-sm'}
                >
                  Leer respuesta completa
                </Link>
              </details>
            ))}
          </section>
        </div>

        <section
          className={styles.section + ' ' + styles.panel + ' ' + styles.legalPanel}
          aria-labelledby="help-legal-title"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 gap-3">
              <span className={styles.iconTile}>
                <ShieldCheck size={20} aria-hidden="true" />
              </span>
              <div>
                <h2 id="help-legal-title" className="text-xl font-semibold">
                  Aspectos legales y seguridad
                </h2>
                <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
                  Consulta las fuentes sobre firma electrónica en México y aprende a interpretar la
                  evidencia, las constancias y los permisos de tu documento.
                </p>
              </div>
            </div>
            <Link
              href={helpCategoryHref('legal-y-seguridad')}
              prefetch={false}
              className={styles.button}
            >
              Explorar aspectos legales <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </section>
        <HelpSupport />
      </div>
    </>
  );
}
