import {
  Activity,
  BadgeCheck,
  Building2,
  FileKey2,
  Fingerprint,
  IdCard,
  Landmark,
  Library,
  Network,
  Palette,
  ReceiptText,
  ScrollText,
  ShieldCheck,
  ShieldAlert,
  Users,
  UsersRound,
  Workflow,
} from 'lucide-react';
import type { OrganizationSection } from '@/lib/organization/sections';

const icons = {
  overview: Building2,
  profile: Landmark,
  members: Users,
  teams: UsersRound,
  roles: ShieldCheck,
  directory: IdCard,
  authorities: BadgeCheck,
  workflows: Workflow,
  signatures: FileKey2,
  resources: Library,
  continuity: ShieldAlert,
  security: Fingerprint,
  certificates: ScrollText,
  integrations: Network,
  branding: Palette,
  billing: ReceiptText,
  audit: Activity,
};

export default function OrganizationSectionIcon({
  section,
  size = 17,
  className,
}: {
  section: OrganizationSection['key'];
  size?: number;
  className?: string;
}) {
  const Icon = icons[section];
  return <Icon size={size} className={className} aria-hidden="true" />;
}
