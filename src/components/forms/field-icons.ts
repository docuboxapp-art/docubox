import {
  AlignLeft, BadgeDollarSign, BriefcaseBusiness, Calendar, CheckSquare, ChevronDown,
  CircleDot, Clock3, FileCheck2, FileText, FileUp, Fingerprint, Hash, Image,
  Landmark, ListChecks, Mail, MapPinned, Minus, MousePointerClick, PenLine,
  Phone, Scale, ShieldCheck, Type, UserRound, UserRoundCheck, WalletCards,
  type LucideIcon,
} from 'lucide-react';
import type { FieldType } from '@/lib/forms/schema';

const icons: Record<FieldType, LucideIcon> = {
  text: Type, textarea: AlignLeft, email: Mail, phone: Phone, number: Hash,
  date: Calendar, time: Clock3, currency: BadgeDollarSign, checkbox: CheckSquare,
  checkbox_group: ListChecks, radio: CircleDot, select: ChevronDown, yes_no: CheckSquare,
  estado_mx: MapPinned, rfc: Landmark, curp: Fingerprint, nss: Hash,
  clave_elector: FileText, business_name: BriefcaseBusiness, fiscal_address: MapPinned,
  person_first_name: UserRound, person_last_name: UserRound, person_second_last_name: UserRound,
  consentimiento: FileCheck2, declaration: Scale, firma_efirma: ShieldCheck,
  firma_autografa: PenLine, firma_click: MousePointerClick, signature_block: UserRoundCheck,
  iniciales: WalletCards, imagen: Image, documento: FileUp, divider: Minus,
  texto_bloque: FileText, imagen_estatica: Image, columnas: FileText,
};

export function getFormFieldIcon(type: FieldType): LucideIcon {
  return icons[type] || FileText;
}
