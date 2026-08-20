import { CertificationSectionPage } from '@/components/certifica/CertificationSectionPage';
export default function Page() { return <CertificationSectionPage title="Documentos conservados" description="Consulta originales privados, evidencias y vigencias de custodia." items={[{ title: 'Custodia privada', description: 'El original nunca se sobrescribe y solo se descarga con permisos.' }, { title: 'Controles periodicos', description: 'Las comprobaciones de integridad comparan la huella esperada y calculada.' }]} />; }

