import { CertificationSectionPage } from '@/components/certifica/CertificationSectionPage';
export default function Page() { return <CertificationSectionPage title="Nuevo lote" description="Prepara un lote; los archivos se certifican como operaciones independientes." items={[{ title: '1. Define el servicio', description: 'Todos los elementos comparten producto y politica de custodia.' }, { title: '2. Carga y analiza', description: 'Se calcula la huella y se controla cada error por separado.' }, { title: '3. Confirma', description: 'La reserva y el envio son idempotentes.' }]} />; }

