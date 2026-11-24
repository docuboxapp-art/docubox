import { publishArticle } from './edition';
import { satCertificate } from './sources';

export const participationArticles = [
  publishArticle({
    slug: 'firmar-un-documento',
    title: 'Firma un documento que te enviaron',
    summary:
      'Revisa el PDF, llena los campos solicitados y registra tu firma con el método habilitado.',
    category: 'firmar-y-participar',
    section: 'Firma de documentos',
    kind: 'tutorial',
    audiences: ['participar'],
    tags: ['firmante', 'firma autógrafa', 'Click & sign', 'verificación', 'campos'],
    searchTerms: [
      'cómo firmar un documento',
      'firma digital desde celular',
      'dibujar mi firma',
      'aceptar y participar',
    ],
    requirements: [
      'Entrar con el acceso de la invitación y tener el rol Firmante.',
      'Si el flujo está ordenado por turnos, esperar a que tu participación esté habilitada.',
    ],
    sections: [
      {
        id: 'revisar',
        title: 'Revisa el documento antes de aceptar',
        steps: [
          'Abre el visor. Lee el PDF y las condiciones de participación. Confirma que los datos y anexos correspondan a lo acordado.',
          'Pulsa «Aceptar y participar». Si ves «Completar requisitos», atiende primero las entregas que el remitente agregó al paquete documental.',
          'Cuando decidas participar, acepta las condiciones que muestra el flujo y elige «Continuar». Completa los campos que te correspondan.',
        ],
      },
      {
        id: 'firmar',
        title: 'Completa el método de firma habilitado',
        paragraphs: [
          'La solicitud determina qué método puedes usar. Con Firma Autógrafa Digital, prepara la firma visible con alguna de las opciones habilitadas en tu pantalla. Con Click & sign, confirma la acción indicada. Para e.firma SAT, sigue la guía de archivos y validación.',
          'Si el flujo pide un OTP, prueba de vida u otro control de identidad, complétalo en el paso correspondiente. En flujos con QR puedes continuar la captura desde el teléfono siguiendo las instrucciones de pantalla.',
          'Confirma la firma y espera el resultado. Verás el registro de tu participación. Revisa «Descargas» o el resumen para saber qué comprobantes puedes obtener en ese momento.',
        ],
      },
      {
        id: 'si-falta-la-accion',
        title: 'Si el botón de participación no aparece',
        paragraphs: [
          'Comprueba el correo con el que entraste, tu rol, el turno y la vigencia. Contacta al remitente si la acción asignada o el método requieren un ajuste.',
        ],
      },
    ],
    related: [
      'roles-y-turnos-de-participacion',
      'firmar-con-efirma',
      'que-sigue-despues-de-firmar',
    ],
  }),
  publishArticle({
    slug: 'firmar-con-efirma',
    title: 'Firma con tu e.firma del SAT',
    summary:
      'Prepara tu certificado, clave privada y contraseña para completar el método e.firma SAT.',
    category: 'firmar-y-participar',
    section: 'Firma de documentos',
    kind: 'tutorial',
    audiences: ['participar', 'gestionar'],
    tags: ['e.firma', 'FIEL', 'SAT', 'certificado', '.cer', '.key'],
    searchTerms: [
      'cómo firmar con efirma',
      'usar firma electrónica SAT',
      'cargar certificado cer key',
      'utilizar e.firma guardada',
    ],
    requirements: [
      'Que el remitente haya habilitado e.firma SAT para tu participación.',
      'Contar con el certificado vigente .cer, la clave privada .key correspondiente y la contraseña de esa clave.',
    ],
    sections: [
      {
        id: 'preparar',
        title: 'Prepara y valida la e.firma en Docubox',
        steps: [
          'Revisa el documento y avanza en tu participación hasta «Preparar firma con e.firma SAT».',
          'Usa «Cargar mi e.firma» y selecciona los archivos .cer y .key del mismo titular. Si el paso ofrece «Utilizar mi e.firma guardada», puedes elegirla e ingresar la contraseña de su clave privada.',
          'En el paso con archivos, captura la contraseña de la clave privada y elige «Validar e.firma y continuar». Revisa el titular y los datos que devuelve la validación.',
          'Continúa con los controles que solicite el flujo y confirma la firma. Espera el resultado antes de cerrar la pantalla.',
        ],
      },
      {
        id: 'validaciones',
        title: 'Qué revisar si no puedes continuar',
        paragraphs: [
          'Docubox puede advertir si el certificado está vencido, suspendido o revocado o si su vigencia no se pudo confirmar. Revisa que el par de archivos corresponda y que la contraseña desbloquee ese .key. Usa los servicios oficiales del SAT para verificar o renovar tu certificado.',
          'Usa archivos de e.firma. El Certificado de Sello Digital para facturación puede tener las mismas extensiones y cumple otra función. Mantén tu .key y su contraseña dentro del paso previsto para firmar.',
        ],
      },
    ],
    sources: [satCertificate],
    related: [
      'mi-efirma-no-funciona',
      'metodos-de-firma-y-consentimiento',
      'que-sigue-despues-de-firmar',
    ],
  }),
  publishArticle({
    slug: 'roles-y-turnos-de-participacion',
    title: 'Entiende los roles y turnos de un documento',
    summary:
      'Identifica quién debe firmar, aprobar, observar o atestiguar y cuándo le corresponde actuar.',
    category: 'firmar-y-participar',
    section: 'Roles y decisiones',
    kind: 'guia',
    audiences: ['participar', 'gestionar', 'organizacion'],
    tags: ['firmante', 'aprobador', 'observador', 'testigo', 'turno'],
    searchTerms: [
      'por qué aparece en espera',
      'cuál es mi rol',
      'diferencia entre aprobador y firmante',
      'no aparece botón de firmar',
    ],
    sections: [
      {
        id: 'roles',
        title: 'Lo que hace cada rol',
        items: [
          'Creador o emisor. Prepara el documento, asigna participantes, define el orden cuando procede y consulta el envío.',
          'Firmante. Registra su firma con el método habilitado para su participación.',
          'Aprobador. Revisa el documento y registra su visto bueno o aprobación cuando el flujo lo permite.',
          'Observador. Consulta el documento con el acceso asignado.',
          'Testigo. En el recorrido que contempla este rol, confirma que observó el acto electrónico y puede agregar una observación.',
        ],
      },
      {
        id: 'turno',
        title: 'Cuando ves En espera',
        paragraphs: [
          'En un flujo secuencial, debe avanzar el turno anterior para que el siguiente participante pueda actuar. Si ves «En espera», vuelve a consultar desde el enlace original o desde «Mis Participaciones».',
          'Los requisitos documentales, el estado del recurso y una participación ya concluida también cambian las acciones disponibles. El remitente puede confirmar qué intervención te asignó.',
        ],
      },
    ],
    related: [
      'firmar-un-documento',
      'aprobar-rechazar-o-solicitar-cambios',
      'configurar-participantes-y-metodos',
    ],
  }),
  publishArticle({
    slug: 'aprobar-rechazar-o-solicitar-cambios',
    title: 'Aprueba, rechaza o solicita cambios en un documento',
    summary: 'Elige la acción correspondiente a tu revisión y consulta el resultado en el visor.',
    category: 'firmar-y-participar',
    section: 'Roles y decisiones',
    kind: 'tutorial',
    audiences: ['participar', 'gestionar'],
    tags: ['visto bueno', 'aprobar', 'rechazo', 'observaciones', 'cambios'],
    searchTerms: [
      'quiero rechazar un documento',
      'cómo rechazar una firma',
      'solicitar cambios',
      'dar visto bueno',
    ],
    requirements: [
      'Tener acceso al visor y una participación que permita la acción.',
      'Revisar el contenido y el estado antes de confirmar.',
    ],
    sections: [
      {
        id: 'aprobar',
        title: 'Registra el visto bueno',
        steps: [
          'Abre el visor y elige «Aceptar y participar» cuando esté disponible.',
          'En el paso «Dar visto bueno», añade una observación si te sirve para explicar tu revisión.',
          'Elige «Confirmar aprobación» y espera la confirmación. Tu acción quedará registrada para esa participación.',
        ],
      },
      {
        id: 'rechazar-o-cambiar',
        title: 'Devuelve una observación o rechaza',
        steps: [
          'En el visor, abre «Más acciones».',
          'Elige «Solicitar cambios» para pedir una corrección o «Rechazar documento» para declinar la participación.',
          'Escribe el motivo en el diálogo y verifica la acción antes de confirmarla. Después, consulta el estado o comunícate con el remitente para acordar el siguiente paso.',
        ],
        paragraphs: [
          'Las opciones dependen de tu rol, el turno y si tu acción ya quedó registrada. «Cancelar documento» corresponde al propietario y tiene un efecto distinto sobre la solicitud.',
        ],
      },
    ],
    related: [
      'roles-y-turnos-de-participacion',
      'que-sigue-despues-de-firmar',
      'seguimiento-y-recordatorios',
    ],
  }),
  publishArticle({
    slug: 'mi-efirma-no-funciona',
    title: 'Mi e.firma no funciona',
    summary:
      'Revisa que el certificado esté vigente, que coincida con la clave y que el flujo permita e.firma.',
    category: 'solucion-de-problemas',
    section: 'Firma y descarga',
    kind: 'solucion',
    audiences: ['participar', 'gestionar'],
    tags: ['e.firma', 'certificado vencido', 'contraseña incorrecta', 'SAT', 'error de validación'],
    searchTerms: [
      'mi e.firma no funciona',
      'no valida la efirma',
      'error fiel',
      'contraseña de e firma incorrecta',
      'certificado no coincide',
    ],
    sections: [
      {
        id: 'causas',
        title: 'Descarta las causas más comunes',
        items: [
          'Si el método no aparece, pregunta al remitente qué firma asignó a tu participación.',
          'Si la clave y el certificado no coinciden, vuelve a seleccionar los archivos .cer y .key de la misma e.firma. Revisa que sean los archivos correspondientes a la última renovación.',
          'Si la pantalla indica contraseña incorrecta, verifica la de la clave privada. Si cambiaste la contraseña de Docubox, eso no sustituye la contraseña del .key.',
          'Si el certificado está vencido, suspendido o revocado, revisa tu situación directamente en el SAT. Si la consulta de vigencia está temporalmente indisponible, inténtalo más tarde o informa a soporte.',
        ],
      },
      {
        id: 'escalar',
        title: 'Cuando necesitas pedir ayuda',
        paragraphs: [
          'Comparte únicamente la etapa y el mensaje que ves. Guarda tus archivos de e.firma y su contraseña para el flujo de firma. Si un Certificado de Sello Digital se seleccionó por error, vuelve a elegir los archivos de e.firma aceptados.',
        ],
      },
    ],
    sources: [satCertificate],
    related: [
      'firmar-con-efirma',
      'diferencia-entre-codigos-y-contrasenas',
      'metodos-de-firma-y-consentimiento',
    ],
  }),
];
