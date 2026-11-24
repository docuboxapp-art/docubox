import { publishArticle } from './edition';

export const documentArticles = [
  publishArticle({
    slug: 'enviar-mi-primer-documento',
    title: 'Crea y envía tu primer documento',
    summary: 'Sube o selecciona un documento, configura quién participa y revisa el envío.',
    category: 'crear-y-enviar',
    section: 'Preparación y envío',
    kind: 'tutorial',
    audiences: ['gestionar', 'organizacion'],
    tags: ['crear documento', 'PDF', 'participantes', 'ajustes', 'enviar'],
    searchTerms: [
      'cómo enviar documento para firma',
      'subir pdf',
      'mandar invitaciones',
      'empezar a usar docubox',
    ],
    requirements: [
      'Iniciar sesión y verificar tu correo.',
      'Tener el documento listo, los destinatarios correctos y permiso para crear en el espacio activo.',
    ],
    sections: [
      {
        id: 'preparar',
        title: 'Prepara el envío desde Mi Espacio',
        steps: [
          'Selecciona tu espacio de trabajo y elige «Crear Documento» en Inicio o en Mi Espacio.',
          'En «Subir», selecciona el archivo o el origen que corresponda. Revisa el nombre y, si aplica, el tipo de documento y la carpeta.',
          'En «Participantes», define quién interviene, con qué rol y en qué orden. Comprueba el correo de cada destinatario.',
          'En «Ajustes», coloca los campos que se deben completar. Sigue los pasos adicionales si el modo incluye agrupamiento o flujo de trabajo.',
          'En «Enviar», revisa el resumen. Pulsa «Enviar documento» o, si elegiste programar, «Programar envío».',
        ],
      },
      {
        id: 'comprobar',
        title: 'Comprueba que la solicitud quedó registrada',
        paragraphs: [
          'Abre «Solicitudes Enviadas» en el mismo espacio de trabajo y busca el documento. Ahí podrás consultar el estado. Cuando se envía una invitación por correo, el destinatario usa el enlace del mensaje para abrir su acceso.',
          'Si el envío devuelve un error, revisa qué acción quedó registrada antes de repetirla. En un espacio de organización, una política puede limitar métodos y acciones.',
        ],
      },
    ],
    related: [
      'configurar-participantes-y-metodos',
      'seguimiento-y-recordatorios',
      'publicar-y-usar-plantillas',
    ],
    action: { label: 'Abrir Crear Documento', href: '/crear-documento' },
  }),
  publishArticle({
    slug: 'configurar-participantes-y-metodos',
    title: 'Configura participantes, métodos de firma y orden',
    summary: 'Decide quién actúa y qué controles debe completar antes de enviar.',
    category: 'crear-y-enviar',
    section: 'Preparación y envío',
    kind: 'guia',
    audiences: ['gestionar', 'organizacion'],
    tags: ['roles', 'secuencial', 'paralelo', 'método de firma', 'participantes'],
    searchTerms: [
      'qué firma elegir para el participante',
      'cómo configurar turno de firma',
      'orden de los firmantes',
      'notificación por correo',
    ],
    sections: [
      {
        id: 'roles-y-orden',
        title: 'Asigna el rol y el turno en Participantes',
        steps: [
          'Elige «Solo yo», «Yo y otros» o «Solo otros» según quién deba intervenir. Añade las personas correctas y revisa el correo de cada una.',
          'Asigna Firmante, Aprobador, Observador o Testigo según el trabajo que corresponda.',
          'Selecciona el orden disponible que necesites. En paralelo, el orden no obliga a esperar un turno anterior. En secuencial, comprueba la posición de cada participante.',
          'Revisa las opciones de firma de cada firmante y los canales realmente habilitados. Confirma los controles de identidad o requisitos adicionales pedidos por el flujo.',
        ],
      },
      {
        id: 'politica',
        title: 'Si una opción está limitada',
        paragraphs: [
          'El espacio de organización puede aplicar reglas de métodos y aprobación. Si un ajuste aparece bloqueado, consulta al administrador del espacio antes del envío.',
          'Para contactar a los participantes, verifica la selección de correo y los resultados del envío. Los canales adicionales están sujetos a la configuración del espacio y del proveedor.',
        ],
      },
    ],
    related: [
      'roles-y-turnos-de-participacion',
      'enviar-mi-primer-documento',
      'poner-en-marcha-mi-organizacion',
    ],
  }),
  publishArticle({
    slug: 'gestionar-contactos-carpetas-y-etiquetas',
    title: 'Organiza tus contactos, carpetas y etiquetas',
    summary: 'Encuentra personas y clasifica los recursos que usas con frecuencia.',
    category: 'crear-y-enviar',
    section: 'Organización de tu espacio',
    kind: 'guia',
    audiences: ['gestionar', 'organizacion'],
    tags: ['contactos', 'carpetas', 'etiquetas', 'grupos', 'favoritos', 'filtros'],
    searchTerms: [
      'agregar contacto',
      'crear grupo de contactos',
      'guardar filtro',
      'cómo ordenar mis documentos',
    ],
    sections: [
      {
        id: 'contactos',
        title: 'Añade y agrupa contactos',
        steps: [
          'Abre «Mis Contactos» y pulsa «Agregar contacto». Usa el criterio de búsqueda disponible y selecciona la persona correcta.',
          'La disponibilidad depende de la visibilidad y los permisos del perfil. Si la búsqueda no devuelve un resultado accesible, verifica el criterio o continúa con el flujo de invitación del recurso que quieras compartir.',
          'Desde la barra lateral, elige «Crear grupo» para organizar tu agenda. En la ficha de un contacto usa «Asignar a grupo» o «Gestionar etiquetas» cuando estén disponibles.',
        ],
      },
      {
        id: 'archivos',
        title: 'Clasifica documentos y expedientes',
        paragraphs: [
          'En Mi Espacio elige «Documentos» o «Expedientes». Usa «Crear Carpeta» y las acciones de fila para organizar los recursos que puedes gestionar.',
          'Marca como favorito lo que quieras encontrar rápido. Usa los filtros y «Crear filtro» para guardar criterios que consultarás otra vez. «Personalizar vista» ajusta las columnas y las opciones que ves.',
        ],
      },
    ],
    related: ['enviar-mi-primer-documento', 'integrar-un-expediente', 'privacidad-y-conservacion'],
    action: { label: 'Abrir Mis Contactos', href: '/contactos' },
  }),
  publishArticle({
    slug: 'que-sigue-despues-de-firmar',
    title: 'Ya firmé, ¿qué sigue?',
    summary: 'Comprueba tu participación y revisa si el documento aún espera otras acciones.',
    category: 'seguimiento',
    section: 'Estados y descargas',
    kind: 'pregunta',
    audiences: ['participar', 'gestionar'],
    tags: ['firmado', 'completado', 'estado', 'constancia individual'],
    searchTerms: [
      'ya firmé qué sigue',
      'firmé y sigue en progreso',
      'después de firmar',
      'espera a otros firmantes',
    ],
    sections: [
      {
        id: 'mi-participacion',
        title: 'Confirma el resultado de tu acción',
        paragraphs: [
          'Al terminar, Docubox muestra el resultado de tu firma, aprobación o intervención. Puedes revisar esa acción desde «Mis Participaciones» si tu cuenta tiene acceso.',
          'Tu participación puede estar registrada mientras la solicitud general sigue «En progreso». El cierre se determina según las acciones y requisitos configurados para el documento.',
        ],
      },
      {
        id: 'cierre',
        title: 'Consulta los archivos cuando estén listos',
        paragraphs: [
          'Revisa el estado del documento en el visor. La constancia individual, cuando se ofrece, acredita tu participación. El PDF final y su evidencia pueden requerir que concluya el proceso y que termine la verificación correspondiente.',
          'Si el estado no coincide con lo que ves después de volver a abrir el documento, consulta con el remitente o informa a soporte e indica el mensaje exacto.',
        ],
      },
    ],
    related: [
      'descargar-documentos-y-constancias',
      'roles-y-turnos-de-participacion',
      'que-evidencias-genera-docubox',
    ],
    action: { label: 'Abrir Mis Participaciones', href: '/mis-participaciones' },
  }),
  publishArticle({
    slug: 'descargar-documentos-y-constancias',
    title: 'Descarga el PDF y las constancias disponibles',
    summary: 'Encuentra los archivos de tu participación y del cierre desde el visor.',
    category: 'seguimiento',
    section: 'Estados y descargas',
    kind: 'tutorial',
    audiences: ['participar', 'gestionar', 'organizacion'],
    tags: ['PDF firmado', 'descargar', 'constancia', 'NOM-151', 'evidencia'],
    searchTerms: [
      'cómo descargar un documento firmado',
      'descargar un documento',
      'obtener mi constancia',
      'descargar el PDF final',
    ],
    requirements: [
      'Tener acceso al documento y permiso para el archivo que quieres descargar. El manejo de evidencias puede requerir un permiso distinto.',
    ],
    sections: [
      {
        id: 'descargar',
        title: 'Elige el archivo correcto en Descargas',
        steps: [
          'Abre el documento desde «Mi Espacio», «Solicitudes Enviadas», «Mis Participaciones» o tu enlace con acceso vigente.',
          'En el visor, abre «Descargas». Usa «Descargar PDF final» o «Descargar PDF firmado» una vez que esté habilitado. Algunas vistas ofrecen «Descargar PDF original» por separado.',
          'Si el resumen de firma ofrece «Descargar constancia de participación», úsala para conservar el comprobante individual. Cuando el documento ya tenga constancia NOM-151 o paquete de evidencia, revisa sus controles de descarga por separado.',
          'Verifica el tipo de archivo y conserva el PDF sin modificar junto con la evidencia descargada que corresponda.',
        ],
      },
      {
        id: 'pendientes',
        title: 'Qué significa una descarga pendiente',
        paragraphs: [
          'El visor puede indicar «Pendiente de NOM-151» u otro estado de certificación. En ese caso, revisa nuevamente cuando se complete la entrega final. Las opciones que ves también dependen del tipo de documento y de tu acceso.',
        ],
      },
    ],
    related: ['no-puedo-descargar', 'que-sigue-despues-de-firmar', 'que-evidencias-genera-docubox'],
  }),
  publishArticle({
    slug: 'no-puedo-descargar',
    title: 'No puedo descargar el PDF o la constancia',
    summary:
      'Comprueba si falta una participación, la certificación final o el permiso para ese archivo.',
    category: 'solucion-de-problemas',
    section: 'Firma y descarga',
    kind: 'solucion',
    audiences: ['participar', 'gestionar', 'organizacion'],
    tags: ['no puedo descargar', 'PDF final', 'pendiente', 'constancia', 'permiso'],
    searchTerms: [
      'no puedo descargar',
      'descarga deshabilitada',
      'no me deja bajar el pdf',
      'constancia no disponible',
    ],
    sections: [
      {
        id: 'estado',
        title: 'Comprueba qué está pendiente',
        steps: [
          'Abre el visor y revisa el estado general del documento. Si sigue en progreso, verifica con el remitente si faltan acciones o requisitos.',
          'En «Descargas», distingue el PDF original, el PDF final y las constancias. Cada archivo se habilita con condiciones distintas.',
          'Si ves un aviso de certificación pendiente, vuelve a consultar cuando termine el proceso. Si el aviso indica falta de acceso, solicita al propietario que revise el permiso.',
          'Cuando el botón esté habilitado y la descarga falle, prueba desde el navegador y anota el nombre de la opción y el mensaje. Informa a soporte si el error persiste.',
        ],
      },
    ],
    related: [
      'descargar-documentos-y-constancias',
      'que-sigue-despues-de-firmar',
      'el-enlace-del-documento-no-abre',
    ],
  }),
  publishArticle({
    slug: 'seguimiento-y-recordatorios',
    title: 'Da seguimiento a envíos y recordatorios',
    summary:
      'Identifica quién tiene una acción pendiente y revisa qué puedes hacer desde tu espacio.',
    category: 'seguimiento',
    section: 'Estados y descargas',
    kind: 'guia',
    audiences: ['gestionar', 'organizacion'],
    tags: ['solicitudes enviadas', 'recordatorios', 'cancelar', 'notificaciones', 'pendientes'],
    searchTerms: [
      'reenviar invitación a un firmante',
      'enviar recordatorio',
      'cancelar solicitud',
      'consultar estado de mi envío',
    ],
    sections: [
      {
        id: 'consultar',
        title: 'Consulta el envío y los participantes',
        steps: [
          'Abre «Solicitudes Enviadas». Selecciona «Documentos», «Formularios» o «Expedientes» y elige el estado que quieres consultar.',
          'Busca la solicitud y abre su detalle. Revisa la actividad, el plazo y las personas pendientes. En las listas de documentos también puedes cambiar entre Lista, Tablero y Calendario.',
          'Cuando esté disponible, usa «Enviar recordatorio» para la persona con una acción pendiente. Revisa la confirmación del envío. El destinatario conserva sus propias condiciones de acceso.',
        ],
      },
      {
        id: 'cancelar',
        title: 'Distingue recordar, corregir y cancelar',
        paragraphs: [
          'Si el correo o el contenido son incorrectos, revisa las opciones del propietario y coordina una corrección. Si eliges «Cancelar documento» en el visor, lee la confirmación y revisa a quién afecta antes de continuar.',
          'En Notificaciones puedes consultar avisos recibidos. En Configuración puedes revisar los canales del espacio o cuenta según los permisos disponibles.',
        ],
      },
    ],
    related: [
      'enviar-mi-primer-documento',
      'roles-y-turnos-de-participacion',
      'integrar-un-expediente',
    ],
    action: { label: 'Abrir Solicitudes Enviadas', href: '/mis-solicitudes' },
  }),
];
