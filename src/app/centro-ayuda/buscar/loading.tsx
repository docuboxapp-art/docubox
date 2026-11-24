import { LoaderCircle } from 'lucide-react';
import styles from '../help.module.css';

export default function LoadingHelpSearch() {
  return (
    <div className={styles.wrap + ' ' + styles.page}>
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircle
          size={18}
          className="motion-safe:animate-spin text-primary"
          aria-hidden="true"
        />
        Buscando artículos…
      </p>
    </div>
  );
}
