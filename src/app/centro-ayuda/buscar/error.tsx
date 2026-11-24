'use client';

import Link from 'next/link';
import { HELP_ROOT } from '@/lib/help/model';
import styles from '../help.module.css';

export default function HelpSearchError({ reset }: { reset: () => void }) {
  return (
    <div className={styles.wrap + ' ' + styles.page}>
      <h1 className={styles.pageTitle}>La búsqueda no está disponible</h1>
      <p className={styles.intro}>Vuelve a intentarlo o consulta los artículos por tema.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={styles.button} onClick={reset}>
          Reintentar
        </button>
        <Link href={HELP_ROOT + '/guias'} className={styles.button}>
          Explorar guías
        </Link>
      </div>
    </div>
  );
}
