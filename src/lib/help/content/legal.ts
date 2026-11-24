import { publishArticle } from './edition';
import {
  advancedSignature,
  certificationProviders,
  civil,
  civilElectronicConsent,
  commerce,
  nom151,
  privacyLaw,
  satCertificate,
  satDigitalSeal,
} from './sources';

export const legalArticles = [
  publishArticle({
    slug: 'validez-de-la-firma-electronica',
    title: '¿Tiene validez una firma electrónica en México?',
    summary:
      'Entiende cómo se reconoce el medio electrónico, qué exige el acto y qué puede acreditar tu evidencia.',
    category: 'legal-y-seguridad',
    section: 'Marco legal en México',
    kind: 'legal',
    audiences: ['participar', 'gestionar', 'organizacion'],
    tags: ['validez legal', 'México', 'código de comercio', 'consentimiento', 'mensaje de datos'],
    searchTerms: [
      'tiene validez legal',
      'es válida una firma digital',
      'sirve un contrato electrónico',
      'validar legalmente una firma',
    ],
    scope:
      'Operaciones mercantiles y referencias civiles federales en México. Para un acto específico consulta también la legislación local y las formalidades que lo rigen.',
    sections: [
      {
        id: 'reconocimiento',
        title: 'El medio electrónico puede producir efectos jurídicos',
        paragraphs: [
          'El artículo 89 bis del Código de Comercio reconoce los mensajes de datos. En actos mercantiles importa conservar información íntegra y accesible y poder atribuir la firma cuando se exige, conforme al artículo 93.',
          'En asuntos civiles federales, el artículo 1803 permite manifestar consentimiento por medios electrónicos. El artículo 1834 bis aborda cómo satisfacer la forma escrita y la firma cuando la información es íntegra, atribuible y accesible para consulta.',
        ],
      },
      {
        id: 'acto',
        title: 'Revisa las reglas del acto y la evidencia disponible',
        paragraphs: [
          'Por ejemplo, antes de firmar un acuerdo de servicios, confirma quiénes pueden obligar a las partes y qué medio aceptaron. Si el acto exige un fedatario u otra formalidad, consulta los requisitos aplicables para cumplirlos.',
          'La Ley de Firma Electrónica Avanzada regula los actos comprendidos en su ámbito, incluidas las actuaciones previstas para dependencias y entidades federales. Para un acuerdo entre particulares, identifica primero el régimen que le corresponde.',
          'Conserva la versión acordada y las evidencias que se generen. La fiabilidad del método es relevante para valorar un mensaje de datos como prueba.',
        ],
      },
    ],
    sources: [commerce, civil, civilElectronicConsent, advancedSignature],
    related: [
      'identidad-facultades-y-formalidades',
      'metodos-de-firma-y-consentimiento',
      'integridad-y-valor-probatorio',
    ],
  }),
  publishArticle({
    slug: 'metodos-de-firma-y-consentimiento',
    title: 'Métodos de firma, consentimiento y e.firma SAT',
    summary:
      'Compara la acción que realiza una persona, la marca que ve y la evidencia que genera cada método.',
    category: 'legal-y-seguridad',
    section: 'Marco legal en México',
    kind: 'legal',
    audiences: ['participar', 'gestionar', 'organizacion'],
    tags: ['Click & sign', 'autógrafa digital', 'firma avanzada', 'e.firma', 'CSD', 'atribución'],
    searchTerms: [
      'qué diferencia hay entre firma autógrafa y e.firma',
      'certificado de sello digital',
      'biometría es firma',
      'consentimiento otp',
    ],
    scope:
      'Describe métodos que el producto puede habilitar y los requisitos de atribución y fiabilidad de los artículos 89 y 97 del Código de Comercio.',
    sections: [
      {
        id: 'metodos',
        title: 'Qué acredita cada parte del proceso',
        items: [
          'Click & sign registra la confirmación expresa en la etapa de participación y las evidencias que el flujo capture.',
          'Firma Autógrafa Digital incorpora una representación visible de la firma y se acompaña de la evidencia de la acción registrada.',
          'e.firma SAT emplea el certificado y la clave privada del titular en el proceso habilitado. La verificación técnica debe considerar el certificado y el alcance de la firma que efectivamente se aplicó.',
          'OTP y prueba de vida son controles de autenticación o identidad cuando el flujo los requiere. La manifestación de voluntad se registra en la acción de firmar o confirmar.',
        ],
      },
      {
        id: 'avanzada',
        title: 'Cuándo se evalúa como firma avanzada o fiable',
        paragraphs: [
          'El artículo 97 considera, entre otros elementos, que los datos de creación correspondan al firmante y estén bajo su control al firmar, y que se puedan detectar alteraciones posteriores. Una marca gráfica o un código aislado no permiten concluir por sí solos que se cumplan esos requisitos.',
          'El SAT utiliza el Certificado de Sello Digital para facturación. Aunque un CSD también tenga archivos .cer y .key, selecciona la e.firma cuando Docubox solicite ese método.',
        ],
      },
    ],
    sources: [commerce, advancedSignature, satCertificate, satDigitalSeal],
    related: [
      'firmar-con-efirma',
      'validez-de-la-firma-electronica',
      'que-evidencias-genera-docubox',
    ],
  }),
  publishArticle({
    slug: 'identidad-facultades-y-formalidades',
    title: 'Revisa identidad, representación y formalidades antes de firmar',
    summary: 'Verifica quién interviene, con qué facultades y qué requisitos exige el documento.',
    category: 'legal-y-seguridad',
    section: 'Marco legal en México',
    kind: 'legal',
    audiences: ['participar', 'gestionar', 'organizacion'],
    tags: ['representación', 'facultades', 'fedatario', 'poder', 'identidad'],
    searchTerms: [
      'puedo firmar por mi empresa',
      'representante legal',
      'se necesita notario',
      'qué revisar antes de firmar',
    ],
    scope:
      'Principios generales de representación y forma. Los requisitos concretos dependen del acto, la materia y la legislación aplicable.',
    sections: [
      {
        id: 'identidad',
        title: 'Identidad y facultades responden preguntas diferentes',
        paragraphs: [
          'Identificar a una persona permite vincularle una acción. Determinar sus facultades requiere revisar si puede obligarse por sí misma o representar a otra persona u organización para ese acto.',
          'Por ejemplo, si firmas a nombre de una empresa, revisa el poder o la autorización vigente y sus límites. Un rol administrativo en un espacio de Docubox concede permisos para usar la plataforma. Las facultades para representar a la empresa se comprueban por separado.',
        ],
      },
      {
        id: 'antes',
        title: 'Antes de confirmar tu participación',
        items: [
          'Comprueba la identidad de las partes, la versión, las cláusulas y los anexos.',
          'Revisa qué intervención estás realizando y qué facultades tienes para esa intervención.',
          'Si el acto requiere instrumento público, testigos, registro u otra forma, coordina su cumplimiento con quien corresponda.',
          'Al terminar, conserva la versión acordada y las evidencias pertinentes.',
        ],
      },
    ],
    sources: [civil, commerce],
    related: [
      'validez-de-la-firma-electronica',
      'roles-y-turnos-de-participacion',
      'integridad-y-valor-probatorio',
    ],
  }),
  publishArticle({
    slug: 'integridad-y-valor-probatorio',
    title: 'Integridad del documento y valor probatorio',
    summary:
      'Entiende qué ayuda a demostrar una huella digital y cómo conservar el archivo verificable.',
    category: 'legal-y-seguridad',
    section: 'Marco legal en México',
    kind: 'legal',
    audiences: ['participar', 'gestionar', 'organizacion'],
    tags: ['integridad', 'huella digital', 'hash', 'prueba', 'conservar PDF'],
    searchTerms: [
      'cómo compruebo que no alteraron el pdf',
      'qué valor probatorio tiene',
      'qué guardar después de firmar',
    ],
    scope:
      'Integridad y valoración de mensajes de datos en materia mercantil. La fuerza de la evidencia se analiza en el caso concreto.',
    sections: [
      {
        id: 'huella',
        title: 'Qué puedes verificar en el archivo',
        paragraphs: [
          'Una huella digital permite comparar los bytes del archivo con una referencia registrada. Compara el archivo exacto al que se vincula la evidencia. Una copia reimpresa o editada puede tener una huella diferente.',
          'El artículo 93 bis del Código de Comercio contempla que la información se mantenga completa y confiablemente íntegra y pueda mostrarse cuando se requiera. El artículo 1298-A considera la fiabilidad del método con que se generó, archivó, comunicó o conservó el mensaje para valorar su fuerza probatoria.',
        ],
      },
      {
        id: 'conservar',
        title: 'Conserva los archivos y sus referencias',
        items: [
          'Guarda el PDF final exacto y conserva por separado los originales o versiones previas si los necesitas.',
          'Guarda la constancia individual que corresponda, el paquete de evidencia y la constancia de conservación cuando se hayan emitido y tengas permiso.',
          'Conserva el folio o la referencia que permite verificar cada archivo. Usa el verificador indicado por el documento o por la entidad que emitió esa evidencia.',
        ],
      },
    ],
    sources: [commerce, nom151],
    related: [
      'que-evidencias-genera-docubox',
      'sellos-de-tiempo-y-nom-151',
      'descargar-documentos-y-constancias',
    ],
    action: { label: 'Abrir Verificar documento', href: '/verificar-documento' },
  }),
  publishArticle({
    slug: 'sellos-de-tiempo-y-nom-151',
    title: 'Sellos de tiempo y constancias NOM-151',
    summary:
      'Identifica quién emite cada evidencia, a qué archivo corresponde y cuándo puede consultarse.',
    category: 'legal-y-seguridad',
    section: 'Seguridad y evidencias de Docubox',
    kind: 'legal',
    audiences: ['participar', 'gestionar', 'organizacion'],
    tags: ['NOM-151', 'sello de tiempo', 'prestador', 'PSC', 'conservación', 'constancia'],
    searchTerms: [
      'qué es la nom 151',
      'diferencia entre sello de tiempo y constancia de conservación',
      'pendiente de nom151',
      'quién emite la constancia',
    ],
    scope:
      'Conservación de mensajes de datos y digitalización dentro del campo de aplicación de NOM-151. En Docubox la disponibilidad depende de la emisión y verificación del documento.',
    sections: [
      {
        id: 'sello',
        title: 'Qué aporta un sello digital de tiempo',
        paragraphs: [
          'Un servicio de sellado vincula una huella con una fecha y hora verificables. Revisa la entidad emisora, la huella a la que se refiere y el resultado de validación.',
          'En una constancia de conservación, un Prestador de Servicios de Certificación acreditado aplica los requisitos de la norma. El Apéndice A describe la formación y verificación de la constancia y sus sellos de tiempo.',
        ],
      },
      {
        id: 'descarga',
        title: 'Consulta la emisión para tu propio documento',
        steps: [
          'Abre «Descargas» o el apartado de certificación del visor, si tu acceso lo permite.',
          'Revisa si hay una constancia NOM-151 verificada y qué PDF está asociado a ella. Si la interfaz identifica una prueba, usa ese resultado únicamente para revisar el entorno de prueba.',
          'Conserva el archivo de la constancia junto al PDF indicado. Usa los datos del emisor y el mecanismo de verificación que corresponda.',
        ],
        paragraphs: [
          'El artículo 49 del Código de Comercio establece obligaciones de conservación para comerciantes en supuestos específicos. Ese deber se analiza para cada operación. El periodo de almacenamiento de la cuenta se rige por las políticas y condiciones aplicables al servicio.',
        ],
      },
    ],
    sources: [nom151, commerce, certificationProviders],
    related: [
      'que-evidencias-genera-docubox',
      'integridad-y-valor-probatorio',
      'descargar-documentos-y-constancias',
    ],
  }),
  publishArticle({
    slug: 'que-evidencias-genera-docubox',
    title: 'Qué evidencias puedes encontrar en Docubox',
    summary:
      'Distingue el comprobante de tu participación, el PDF final y la certificación que los acompaña.',
    category: 'legal-y-seguridad',
    section: 'Seguridad y evidencias de Docubox',
    kind: 'legal',
    audiences: ['participar', 'gestionar', 'organizacion'],
    tags: [
      'PAdES',
      'firma visible',
      'auditoría',
      'evidencias',
      'constancia individual',
      'PDF final',
    ],
    searchTerms: [
      'qué evidencia deja una firma',
      'qué incluye paquete evidencia',
      'certificado de integridad',
      'quién firma el pdf',
      'dónde veo la auditoría',
    ],
    scope:
      'Describe las evidencias que el visor y los flujos de firma pueden mostrar. La variante disponible depende del método, el cierre, la configuración y el permiso.',
    sections: [
      {
        id: 'participacion',
        title: 'Evidencias de tu participación',
        items: [
          'Firma visible o estampa. La vista y el PDF pueden mostrar la marca preparada durante el flujo. Sirve para identificar visualmente una participación.',
          'Firma criptográfica personal. Si la operación usa el certificado del participante, verifica ese certificado, su referencia y qué se firmó. El certificado del firmante y el sello posterior del PDF pueden corresponder a entidades distintas.',
          'Autenticación y actividad. Docubox registra los eventos y controles que se completaron en ese flujo. La constancia individual y Auditoría muestran los datos que tu permiso permite consultar.',
          'Constancia individual. Se puede obtener desde el resumen de participación cuando la descarga está habilitada. Describe la intervención registrada de esa persona.',
        ],
      },
      {
        id: 'cierre',
        title: 'Evidencias del cierre del documento',
        items: [
          'PDF final. Desde «Descargas», cuando termina la certificación requerida y tu rol permite obtener el archivo, consulta la variante final disponible.',
          'Sellado técnico del PDF. Cuando el documento muestra una certificación PAdES, revisa el certificado que aplicó el sello y el reporte de verificación. El sello de la plataforma acredita esa protección técnica y se identifica por su propio certificado.',
          'Sello de tiempo y constancia de conservación. Cuando el servicio correspondiente los emite y verifica, consulta el emisor, la fecha y la huella del archivo. Guarda juntos el PDF y la evidencia vinculada.',
          'Paquete y verificación. Si existe un paquete de evidencia o reporte de verificación, descárgalo desde el visor con el permiso aplicable. Usa el verificador indicado para conocer qué comprobaciones cubre.',
        ],
        paragraphs: [
          'El estado de certificación y el permiso para ver un documento determinan qué archivos aparecen. Si una descarga sigue pendiente, consulta su estado específico antes de repetir el envío o la firma.',
        ],
      },
    ],
    sources: [commerce, nom151, certificationProviders],
    related: [
      'descargar-documentos-y-constancias',
      'sellos-de-tiempo-y-nom-151',
      'privacidad-y-conservacion',
    ],
  }),
  publishArticle({
    slug: 'privacidad-y-conservacion',
    title: 'Privacidad, acceso y conservación de tus datos',
    summary:
      'Revisa quién puede consultar un recurso, cómo cuidar tus credenciales y dónde solicitar atención de privacidad.',
    category: 'legal-y-seguridad',
    section: 'Seguridad y evidencias de Docubox',
    kind: 'legal',
    audiences: ['participar', 'gestionar', 'organizacion'],
    tags: ['privacidad', 'ARCO', 'retención', 'eliminar', 'permisos', 'protección de datos'],
    searchTerms: [
      'cómo ejercer mis derechos arco',
      'quién ve mis documentos',
      'qué pasa al eliminar un documento',
      'puedo compartir mi otp',
    ],
    scope:
      'Orientación general conforme a la ley aplicable a particulares. Las finalidades, responsables y canales se consultan en el aviso correspondiente al tratamiento.',
    sections: [
      {
        id: 'permisos',
        title: 'Protege tu acceso y los datos de cada recurso',
        paragraphs: [
          'El visor y sus descargas validan el acceso al documento. El rol, una invitación vigente, el espacio de trabajo o un permiso concedido pueden cambiar qué acciones y archivos ves.',
          'Mantén privados los enlaces de invitación y los códigos. Para recibir ayuda basta describir la pantalla y el error visible. Conserva tu contraseña, clave privada y OTP para las pantallas que los solicitan.',
        ],
      },
      {
        id: 'derechos',
        title: 'Consulta el tratamiento y los derechos ARCO',
        paragraphs: [
          'El aviso de privacidad debe identificar al responsable, las finalidades, los datos y los medios para ejercer acceso, rectificación, cancelación y oposición. Solicita al responsable el aviso aplicable si necesitas conocer cómo se trata una entrega, evidencia o verificación de identidad.',
          'La sección «Privacidad» de Mi perfil controla opciones de visibilidad y contacto que la cuenta tiene disponibles. Para una solicitud de derechos, usa los medios que designe el aviso aplicable.',
        ],
      },
      {
        id: 'retencion',
        title: 'Revisa las condiciones de conservación y eliminación',
        paragraphs: [
          'Pasar un documento a Papelera y eliminarlo definitivamente son acciones diferentes. Los permisos, las reglas de retención y los bloqueos de conservación aplicables pueden impedir que se elimine en ese momento.',
          'En espacios con políticas de retención, consulta al administrador qué regla aplica. Para una solicitud relativa a tus datos, utiliza el canal definido por el responsable y describe el alcance que necesitas atender.',
        ],
      },
    ],
    sources: [privacyLaw, commerce],
    related: [
      'diferencia-entre-codigos-y-contrasenas',
      'poner-en-marcha-mi-organizacion',
      'sellos-de-tiempo-y-nom-151',
    ],
  }),
];
