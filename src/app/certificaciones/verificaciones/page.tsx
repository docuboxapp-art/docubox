import { CertificationSectionPage } from '@/components/certifica/CertificationSectionPage';
export default function Page() { return <CertificationSectionPage title="Verificaciones" description="Historial de comprobaciones publicas, por folio, hash o archivo." action={{ label: 'Abrir verificador', href: '/verificar-certificacion' }} items={[{ title: 'Validacion independiente', description: 'La respuesta distingue resultado valido, advertencias y no verificable.' }, { title: 'Registro de consultas', description: 'Cada comprobacion conserva origen, duracion y version del validador.' }]} />; }

