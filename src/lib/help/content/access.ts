import { publishArticle } from './edition';

export const accessArticles = [
  publishArticle({
    slug: 'abrir-una-invitacion',
    title: 'Abre tu invitación para participar',
    summary: 'Usa el enlace que recibiste y entra con la cuenta asociada a la invitación.',
    category: 'acceso',
    section: 'Invitaciones y cuenta',
    kind: 'tutorial',
    audiences: ['participar'],
    tags: ['correo', 'invitación', 'registro', 'acceso', 'portal'],
    searchTerms: [
      'me invitaron a firmar',
      'abrir enlace de invitación',
      'necesito crear cuenta',
      'entrar a firmar',
    ],
    requirements: [
      'Tener el enlace original y acceso al correo al que te invitaron.',
      'Reconocer al remitente y el documento antes de continuar.',
    ],
    sections: [
      {
        id: 'entrar',
        title: 'Elige la opción que muestra el portal',
        steps: [
          'Abre la invitación más reciente. En el Portal de Participantes revisa el documento asignado, el remitente y la vigencia si se muestra.',
          'Si el portal muestra «Acceder con mi cuenta», inicia sesión con el mismo correo de la invitación. Usa «Restablecer contraseña» si ya tienes cuenta y necesitas recuperar el acceso.',
          'Si aparece «Crear mi acceso», completa el registro solicitado por el portal y verifica tu correo cuando se te indique.',
          'Al entrar, revisa el documento y tu acción asignada. El visor muestra las opciones según tu rol y el estado de la solicitud.',
        ],
      },
      {
        id: 'otras-invitaciones',
        title: 'Si recibiste un acceso con código',
        paragraphs: [
          'Algunos formularios o expedientes se comparten con un código. En esos casos, abre su enlace específico y sigue la verificación que indique esa pantalla. La guía de registro anterior corresponde al Portal de Participantes de documentos.',
          'Si el enlace venció, el destinatario es distinto o el remitente resulta desconocido, comunica la situación al remitente antes de intentar continuar.',
        ],
      },
    ],
    related: [
      'el-enlace-del-documento-no-abre',
      'diferencia-entre-codigos-y-contrasenas',
      'firmar-un-documento',
    ],
  }),
  publishArticle({
    slug: 'recuperar-el-acceso-a-mi-cuenta',
    title: 'Restablece la contraseña de tu cuenta',
    summary: 'Solicita un código de recuperación y vuelve a entrar con una contraseña nueva.',
    category: 'acceso',
    section: 'Invitaciones y cuenta',
    kind: 'tutorial',
    audiences: ['participar', 'gestionar', 'organizacion'],
    tags: ['recuperación', 'contraseña', 'cuenta', 'correo'],
    searchTerms: [
      'olvidé mi contraseña',
      'recuperar mi cuenta docubox',
      'cambiar contraseña login',
      'no me acuerdo de la clave',
    ],
    requirements: ['Tener acceso al correo de la cuenta de Docubox.'],
    sections: [
      {
        id: 'recuperar',
        title: 'Verifica tu correo y define una contraseña',
        steps: [
          'Abre la recuperación de contraseña desde la pantalla de acceso o desde «Restablecer contraseña» en el portal.',
          'Escribe el correo de la cuenta y elige «Enviar código de verificación».',
          'Consulta tu correo, escribe el código de recuperación en Docubox y pulsa «Verificar código».',
          'Completa la pantalla de nueva contraseña. Al terminar, vuelve a iniciar sesión y abre tu invitación original si venías a participar.',
        ],
      },
      {
        id: 'si-no-llega',
        title: 'Si no recibes el correo',
        paragraphs: [
          'Confirma la dirección y revisa correo no deseado. Usa «¿No recibiste el código? Reenviar» cuando esté disponible. Si pediste otro código, utiliza el más reciente de esa operación.',
          'Si ya no tienes acceso al buzón, utiliza el canal de soporte disponible. Si el problema es que la invitación se dirigió a otro correo, contacta al remitente para corregir el destinatario.',
        ],
      },
    ],
    related: ['no-recibo-el-codigo', 'abrir-una-invitacion', 'privacidad-y-conservacion'],
    action: { label: 'Abrir recuperación de contraseña', href: '/olvide-contrasena' },
  }),
  publishArticle({
    slug: 'diferencia-entre-codigos-y-contrasenas',
    title: '¿Qué código o contraseña me pide Docubox?',
    summary: 'Identifica la credencial correcta según la pantalla que estás usando.',
    category: 'acceso',
    section: 'Códigos y verificación',
    kind: 'pregunta',
    audiences: ['participar', 'gestionar', 'organizacion'],
    tags: ['código de acceso', 'OTP', 'contraseña', 'verificación', 'e.firma'],
    searchTerms: [
      'qué código debo ingresar',
      'diferencia entre otp y código',
      'cuál es la contraseña que pide',
      'código para abrir expediente',
    ],
    sections: [
      {
        id: 'identificar',
        title: 'Reconoce la pantalla y el uso del código',
        items: [
          'Contraseña de la cuenta. Es la que utilizas en «Iniciar sesión». La recuperación cambia esa contraseña.',
          'Código de acceso. Lo recibes con determinadas invitaciones a formularios o expedientes. Se introduce en el acceso de ese recurso y está sujeto a su vigencia.',
          'Código de verificación u OTP. Es de un solo uso para la operación que lo solicitó, como la recuperación de la cuenta o una etapa de firma que lo requiera.',
          'Contraseña de la clave privada de e.firma. Protege el archivo .key del SAT. Se captura solo en el paso de e.firma cuando elegiste ese método.',
          'Código de tu aplicación de autenticación. Si el inicio de sesión solicita verificación en dos pasos, toma el número de la aplicación vinculada a tu cuenta.',
        ],
      },
      {
        id: 'proteger',
        title: 'Protege tus credenciales',
        paragraphs: [
          'Escribe cada código en la pantalla que lo pidió. Soporte puede orientarte con el nombre de la pantalla y el texto del error, sin pedirte tu contraseña, la clave privada ni el código.',
        ],
      },
    ],
    related: ['no-recibo-el-codigo', 'recuperar-el-acceso-a-mi-cuenta', 'firmar-con-efirma'],
  }),
  publishArticle({
    slug: 'no-recibo-el-codigo',
    title: 'No recibo mi código de verificación',
    summary:
      'Identifica qué código esperas, revisa el correo correcto y vuelve a solicitarlo cuando el flujo lo permita.',
    category: 'solucion-de-problemas',
    section: 'Invitaciones y códigos',
    kind: 'solucion',
    audiences: ['participar', 'gestionar', 'organizacion'],
    tags: ['OTP', 'correo', 'reenviar', 'código', 'spam'],
    searchTerms: [
      'no me llega el código',
      'no recibí mi código',
      'no encuentro el correo del otp',
      'reenviar código',
      'código vencido',
    ],
    sections: [
      {
        id: 'revisar',
        title: 'Comprueba qué envío esperas',
        steps: [
          'Si la pantalla muestra «Enviar código OTP» o «Enviar código de verificación», solicítalo primero y revisa la dirección indicada.',
          'Revisa la bandeja de entrada, correo no deseado y los filtros del buzón. Si usas una cuenta de organización, pregunta por correos retenidos.',
          'Usa «Reenviar código» cuando esté habilitado y captura el más reciente. Evita mezclar el código de recuperación con el solicitado al firmar.',
          'Para un expediente o formulario con código de acceso, vuelve al correo correspondiente a esa invitación. Si el acceso venció, solicita al remitente que revise la invitación.',
        ],
      },
      {
        id: 'pedir-ayuda',
        title: 'Decide a quién pedir ayuda',
        paragraphs: [
          'Contacta al remitente si el destinatario o el enlace es incorrecto. Si Docubox muestra un error al solicitar o verificar el código, usa el canal de soporte disponible e indica el flujo y el mensaje visible.',
          'Cuando el código corresponde a una aplicación de autenticación, abre esa aplicación y revisa que la hora del dispositivo sea automática.',
        ],
      },
    ],
    related: [
      'diferencia-entre-codigos-y-contrasenas',
      'recuperar-el-acceso-a-mi-cuenta',
      'el-enlace-del-documento-no-abre',
    ],
  }),
  publishArticle({
    slug: 'el-enlace-del-documento-no-abre',
    title: 'Mi invitación, enlace o visor no abre',
    summary: 'Distingue un enlace vencido, una cuenta equivocada y una falla de visualización.',
    category: 'solucion-de-problemas',
    section: 'Invitaciones y códigos',
    kind: 'solucion',
    audiences: ['participar', 'gestionar'],
    tags: ['enlace', 'invitación', 'visor PDF', 'permiso', 'expirado'],
    searchTerms: [
      'no abre la liga',
      'link vencido',
      'no puedo abrir el visor',
      'pantalla en blanco pdf',
      'me dice acceso denegado',
      'no me llegó la invitación',
    ],
    sections: [
      {
        id: 'enlace',
        title: 'Revisa el acceso al recurso',
        steps: [
          'Abre el enlace más reciente desde el correo de invitación. Si tu correo se abre dentro de otra aplicación, prueba abrirlo directamente en el navegador.',
          'Si aparece la pantalla de acceso, entra con el correo al que te invitaron y vuelve al enlace original.',
          'Si Docubox indica acceso vencido o no disponible, pide al remitente que revise la vigencia, el destinatario y el estado del recurso.',
        ],
      },
      {
        id: 'visor',
        title: 'Si el visor carga sin mostrar el PDF',
        paragraphs: [
          'Comprueba la conexión y vuelve a abrir el visor en una pestaña nueva, conservando la pestaña original si tienes datos capturados. Si el archivo sigue sin mostrarse, toma nota del mensaje de error y del tipo de dispositivo.',
          'Si lo que falta es la descarga del PDF firmado, revisa el estado y la guía de descargas. Si ni el visor ni otros documentos autorizados abren, contacta a soporte por el canal disponible.',
        ],
      },
    ],
    related: ['abrir-una-invitacion', 'no-puedo-descargar', 'roles-y-turnos-de-participacion'],
  }),
];
