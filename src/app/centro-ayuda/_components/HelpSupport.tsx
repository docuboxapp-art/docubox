import { LifeBuoy, Mail } from 'lucide-react';
import { getHelpSupportEmail } from '@/lib/help/support.server';
import { HelpSupportEmailLink } from './HelpActions';
import styles from '../help.module.css';

export default function HelpSupport() {
  const email = getHelpSupportEmail();
  return (
    <section
      id="soporte"
      className={styles.section + ' ' + styles.panel + ' scroll-mt-4'}
      aria-labelledby="help-support-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className={styles.iconTile}>
            <LifeBuoy size={20} aria-hidden="true" />
          </span>
          <div>
            <h2 id="help-support-heading" className="text-lg font-semibold">
              ¿Necesitas más ayuda?
            </h2>
            <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
              Pide al remitente que revise una invitación, un turno o un permiso. Para un error de
              Docubox, indica la pantalla, la hora aproximada y el mensaje que apareció.
            </p>
          </div>
        </div>
        {email && <HelpSupportEmailLink email={email} />}
      </div>
      <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
        <Mail size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
        {email
          ? 'El botón abre tu aplicación de correo. Describe el problema sin incluir contraseñas, claves privadas, enlaces de invitación ni códigos.'
          : 'Si perteneces a una organización, también puedes pedir orientación a su administrador. Comparte solo el mensaje visible, sin credenciales ni códigos.'}
      </p>
    </section>
  );
}
