import { CertificationSectionPage } from '@/components/certifica/CertificationSectionPage';
export default function Page() { return <CertificationSectionPage title="Lotes" description="Agrupa operaciones y revisa cada resultado sin perder trazabilidad individual." action={{ label: 'Nuevo lote', href: '/certificaciones/lotes/nuevo' }} items={[{ title: 'Procesamiento controlado', description: 'Cada archivo conserva su propia huella, estado, idempotencia y evidencia.' }, { title: 'Sin lotes recientes', description: 'Los nuevos lotes apareceran aqui con sus resultados e incidencias.' }]} />; }

