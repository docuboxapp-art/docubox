import { publishArticle } from './edition';

export const workspaceArticles = [
  publishArticle({
    slug: 'integrar-un-expediente',
    title: 'Lanza e integra un expediente',
    summary:
      'Reúne documentos, respuestas y verificaciones en un expediente con seguimiento propio.',
    category: 'seguimiento',
    section: 'Integración de expedientes',
    kind: 'tutorial',
    audiences: ['participar', 'gestionar', 'organizacion'],
    tags: ['expediente', 'requisitos', 'cargar documentos', 'formularios vinculados', 'QR'],
    searchTerms: [
      'cómo lanzar expediente',
      'subir documentos del expediente',
      'dónde ver avance',
      'expediente con código y qr',
    ],
    requirements: [
      'Para lanzar, tener Expedientes habilitado, un tipo disponible y permiso en el espacio activo.',
      'Para entregar, contar con la invitación y el acceso correspondiente.',
    ],
    sections: [
      {
        id: 'lanzar',
        title: 'Lanza un expediente en tu espacio',
        steps: [
          'En Expedientes o en la pestaña Expedientes de Mi Espacio, elige «Lanzar expediente». Selecciona el tipo de expediente.',
          'Configura si el acceso es privado o público con código. Selecciona participantes y responsables según corresponda y revisa la vigencia y el envío.',
          'Confirma el lanzamiento y abre «Consultar expedientes» o la pestaña Expedientes de Mi Espacio para ver el avance.',
        ],
      },
      {
        id: 'entregar',
        title: 'Entrega desde el portal del expediente',
        steps: [
          'Abre el enlace de la invitación. En el acceso con código, captura el código correspondiente y sigue la verificación de identidad que indica el portal, incluido el QR cuando se muestre.',
          'Cuando aparezcan tus requisitos, abre cada uno y adjunta el documento o completa el formulario vinculado. Revisa el resultado de cada entrega antes de salir.',
          'Si tienes acceso de gestión, consulta el avance del expediente. La revisión, la aprobación, la firma y el cierre dependen de la configuración del tipo y las asignaciones.',
        ],
        paragraphs: [
          'Si el acceso venció o falta un requisito, contacta al remitente. El código y los formularios vinculados pertenecen a ese expediente.',
        ],
      },
    ],
    related: [
      'diferencia-entre-codigos-y-contrasenas',
      'crear-lanzar-y-responder-formularios',
      'seguimiento-y-recordatorios',
    ],
    action: { label: 'Abrir Expedientes', href: '/expedientes' },
  }),
  publishArticle({
    slug: 'publicar-y-usar-plantillas',
    title: 'Publica y reutiliza una plantilla documental',
    summary:
      'Prepara el contenido que repites y selecciona una plantilla publicada al crear un documento.',
    category: 'plantillas-y-formularios',
    section: 'Plantillas',
    kind: 'tutorial',
    audiences: ['gestionar', 'organizacion'],
    tags: ['plantilla', 'publicar', 'borrador', 'campos', 'versiones'],
    searchTerms: [
      'cómo usar una plantilla',
      'hacer una plantilla de documento',
      'no aparece mi plantilla',
    ],
    requirements: [
      'Tener acceso a Plantillas en el espacio activo. La publicación puede requerir permisos o aprobación.',
    ],
    sections: [
      {
        id: 'preparar',
        title: 'Prepara una plantilla',
        steps: [
          'Abre «Plantillas» y entra al editor de una nueva plantilla. Define nombre, clasificación y contenido.',
          'Revisa la vista previa y los campos reutilizables. Guarda como borrador si todavía la estás preparando.',
          'En la publicación, usa la acción permitida para ese espacio. Si se requiere aprobación, espera la resolución antes de usar la versión publicada.',
        ],
      },
      {
        id: 'reutilizar',
        title: 'Úsala en un nuevo documento',
        paragraphs: [
          'En «Crear Documento», selecciona el origen de plantilla disponible en «Subir». Revisa que estás usando la versión publicada del espacio correcto.',
          'Comprueba los campos y continúa con Participantes, Ajustes y Enviar. Si la plantilla no aparece, revisa su estado y el espacio de trabajo.',
        ],
      },
    ],
    related: [
      'enviar-mi-primer-documento',
      'crear-lanzar-y-responder-formularios',
      'poner-en-marcha-mi-organizacion',
    ],
    action: { label: 'Abrir Plantillas', href: '/plantillas' },
  }),
  publishArticle({
    slug: 'crear-lanzar-y-responder-formularios',
    title: 'Crea, lanza y responde un formulario',
    summary: 'Publica un formulario, comparte su acceso y comprueba qué respuestas se registraron.',
    category: 'plantillas-y-formularios',
    section: 'Formularios y respuestas',
    kind: 'tutorial',
    audiences: ['participar', 'gestionar', 'organizacion'],
    tags: ['formulario', 'respuestas', 'lanzar formulario', 'código', 'firma de respuesta'],
    searchTerms: [
      'cómo crear formulario',
      'responder un formulario',
      'dónde se ven las respuestas',
      'firma pendiente formulario',
    ],
    requirements: [
      'Para crear o lanzar, contar con acceso al módulo Formularios en el espacio. Para responder, usar el acceso indicado en la invitación.',
    ],
    sections: [
      {
        id: 'publicar',
        title: 'Prepara y lanza el formulario',
        steps: [
          'Ve a Formularios y selecciona «Nuevo formulario». Define los datos generales, las secciones y los campos que vas a solicitar.',
          'Revisa la presentación web y el PDF. En publicación, elige «Publicar formulario», «Enviar a aprobación» o la opción de borrador según el estado y las políticas disponibles.',
          'Con el formulario publicado usa «Lanzar formulario». Selecciona acceso privado o con código, vigencia y entrega según las opciones que correspondan.',
        ],
      },
      {
        id: 'responder',
        title: 'Responde y verifica el registro',
        paragraphs: [
          'Abre el enlace de la invitación y verifica el acceso tal como lo indica la pantalla. Completa los campos obligatorios y envía la respuesta. Si el formulario requiere firma, continúa con esa etapa para concluir.',
          'Como emisor, abre «Ver respuestas» desde el menú de la fila. Si ves una firma pendiente, comprueba el estado de la respuesta y del paso de firma.',
          'Si el formulario está vinculado como requisito a un expediente, empieza en el portal de ese expediente y finaliza la entrega ahí.',
        ],
      },
    ],
    related: [
      'integrar-un-expediente',
      'diferencia-entre-codigos-y-contrasenas',
      'firmar-un-documento',
    ],
    action: { label: 'Abrir Formularios', href: '/formularios' },
  }),
  publishArticle({
    slug: 'poner-en-marcha-mi-organizacion',
    title: 'Pon en marcha tu organización',
    summary:
      'Selecciona el espacio de organización, revisa sus datos e invita al equipo con el rol adecuado.',
    category: 'cuenta-y-organizacion',
    section: 'Administración del espacio',
    kind: 'tutorial',
    audiences: ['organizacion', 'gestionar'],
    tags: ['organización', 'miembros', 'equipos', 'roles', 'permisos', 'invitar'],
    searchTerms: [
      'cómo invitar al equipo',
      'cómo asignar rol o permisos',
      'agregar miembro organización',
      'diferencia cuenta personal y organización',
    ],
    requirements: [
      'Pertenecer a un espacio de organización y contar con permisos para las acciones que vas a realizar.',
    ],
    sections: [
      {
        id: 'organizar',
        title: 'Selecciona el espacio y configura los accesos',
        steps: [
          'En el selector de espacio, cambia del espacio personal al de tu organización. Abre «Mi organización».',
          'En el panel de administración revisa «Datos generales y contacto». Si vas a modificar datos o políticas, consulta qué permiso requiere la sección.',
          'Usa «Invitar al equipo» para crear la invitación con el correo y rol adecuados. Comprueba el estado de la invitación antes de repetirla.',
          'Organiza a los miembros desde «Equipos y áreas». En «Definir roles y permisos», asigna solo los permisos necesarios para el trabajo de cada persona.',
        ],
      },
      {
        id: 'comprobar',
        title: 'Comprueba la invitación y el rol',
        paragraphs: [
          'Cuando la persona acepte la invitación y su acceso esté activo, revisa su estado y asignaciones en Miembros. Tener este rol dentro de la organización permite actuar según sus permisos del espacio.',
          'Si Docubox solicita confirmar la identidad al administrar roles, completa ese control desde el flujo oficial. Si no ves una sección, comprueba que estés en el espacio correcto y pide al administrador que revise tus permisos.',
        ],
      },
    ],
    related: [
      'configuracion-planes-e-integraciones',
      'configurar-participantes-y-metodos',
      'privacidad-y-conservacion',
    ],
    action: { label: 'Abrir Mi organización', href: '/organizacion' },
  }),
  publishArticle({
    slug: 'configuracion-planes-e-integraciones',
    title: 'Consulta tu configuración, aplicaciones y plan',
    summary: 'Ubica qué se ajusta en tu cuenta y qué depende del espacio o la organización.',
    category: 'cuenta-y-organizacion',
    section: 'Preferencias y servicios',
    kind: 'guia',
    audiences: ['gestionar', 'organizacion'],
    tags: ['mi perfil', 'configuración', 'app market', 'plan', 'facturación', 'integraciones'],
    searchTerms: [
      'dónde ver mi plan',
      'activar módulo',
      'cambiar notificaciones',
      'configurar espacio de trabajo',
      'integraciones de organización',
    ],
    sections: [
      {
        id: 'preferencias',
        title: 'Distingue cuenta y espacio',
        items: [
          'En «Mi perfil», consulta tu información personal, opciones de firma y privacidad que estén disponibles.',
          'En «Configuración», revisa las preferencias que aparecen para tu cuenta o espacio, como notificaciones y formatos regionales.',
          'En «App Market», revisa las aplicaciones disponibles para el espacio y tu plan. Si una aplicación está habilitada, busca su acceso en el menú.',
          'En «Plan y Facturación», consulta el plan y la información de facturación a la que tengas acceso.',
        ],
      },
      {
        id: 'integraciones',
        title: 'Revisa los permisos antes de habilitar un servicio',
        paragraphs: [
          'Las opciones de integración y gobierno de una organización dependen del espacio, sus módulos y tus permisos. Abre la sección habilitada de Mi organización y verifica el estado de la configuración antes de basar un flujo en ella.',
          'Si la administración corresponde a otra persona de tu organización, pídele que confirme el acceso o el límite aplicable.',
        ],
      },
    ],
    related: [
      'poner-en-marcha-mi-organizacion',
      'privacidad-y-conservacion',
      'seguimiento-y-recordatorios',
    ],
    action: { label: 'Abrir Configuración', href: '/configuracion' },
  }),
];
