import Link from 'next/link';
import { HELP_ROOT } from '@/lib/help/model';
import styles from './help.module.css';

export default function HelpPageNotFound() {
  return (
    <div className={styles.wrap + ' ' + styles.page}>
      <h1 className={styles.pageTitle}>Esta página de ayuda no está disponible</h1>
      <p className={styles.intro}>Vuelve al centro o explora los artículos disponibles por tema.</p>
      <Link href={HELP_ROOT} prefetch={false} className={styles.button + ' mt-4'}>
        Volver al Centro de ayuda
      </Link>
    </div>
  );
}
