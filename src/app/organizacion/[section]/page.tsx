'use client';

import { useParams } from 'next/navigation';
import OrganizationSections, { type SectionKey } from '../_components/OrganizationSections';
import OrganizationGovernance, {
  type GovernanceSection,
} from '../_components/OrganizationGovernance';
import OrganizationAdvancedAdministration, {
  type AdvancedSection,
} from '../_components/OrganizationAdvancedAdministration';
import OrganizationContinuity from '../_components/OrganizationContinuity';
import OrganizationStructureAdministration from '../_components/OrganizationStructureAdministration';
import OrganizationProfile from '../_components/OrganizationProfile';

const governance = new Set<GovernanceSection>([
  'directorio',
  'facultades',
  'flujos',
  'politicas-firma',
  'recursos',
]);
const advanced = new Set<AdvancedSection>([
  'seguridad',
  'certificados',
  'integraciones',
  'marca-comunicaciones',
  'plan-consumo',
  'auditoria',
]);
const allowed = new Set<SectionKey>([
  'perfil',
  'miembros',
  'equipos',
  'roles',
  'directorio',
  'facultades',
  'flujos',
  'politicas-firma',
]);

export default function OrganizationSectionPage() {
  const params = useParams<{ section: string }>();
  if (governance.has(params.section as GovernanceSection)) {
    return <OrganizationGovernance section={params.section as GovernanceSection} />;
  }
  if (params.section === 'marca') {
    return <OrganizationAdvancedAdministration section="marca-comunicaciones" />;
  }
  if (params.section === 'continuidad') {
    return <OrganizationContinuity />;
  }
  if (params.section === 'perfil') {
    return <OrganizationProfile />;
  }
  if (params.section === 'equipos' || params.section === 'roles') {
    return <OrganizationStructureAdministration section={params.section} />;
  }
  if (advanced.has(params.section as AdvancedSection)) {
    return <OrganizationAdvancedAdministration section={params.section as AdvancedSection} />;
  }
  const section = params.section as SectionKey;
  if (!allowed.has(section))
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">Sección no disponible.</div>
    );
  return <OrganizationSections section={section} />;
}
