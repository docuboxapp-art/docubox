import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('src/app/crear-documento/page.tsx', 'utf8');
const uploadStep = readFileSync('src/app/crear-documento/components/StepSubir.tsx', 'utf8');
const participantStep = readFileSync(
  'src/app/crear-documento/components/StepParticipantes.tsx',
  'utf8'
);
const options = readFileSync(
  'src/app/crear-documento/components/ParticipationDocumentOptions.tsx',
  'utf8'
);
const packageConfiguration = readFileSync(
  'src/app/crear-documento/components/PackageConfiguration.tsx',
  'utf8'
);
const sharedComponents = readFileSync(
  'src/app/crear-documento/components/SharedComponents.tsx',
  'utf8'
);

test('step one owns the additional participation options', () => {
  assert.match(uploadStep, /<ParticipationDocumentOptions/);
  assert.doesNotMatch(options, /Opciones adicionales/);
  assert.doesNotMatch(options, /Configura las capacidades del documento/);
  assert.match(options, /Activar firma presencial/);
  assert.match(options, /Solicitar documentos a los participantes/);
  assert.match(options, /<PackageConfiguration/);
  assert.match(options, /<InfoTooltip/);
  assert.match(packageConfiguration, /<InfoTooltip/);
});

test('participant configuration stays compact and hides normal activation controls', () => {
  assert.doesNotMatch(participantStep, /Activación de la participación/);
  assert.doesNotMatch(participantStep, /Modalidad de entrega/);
  assert.doesNotMatch(participantStep, /Ej\. Identificación oficial/);
  assert.match(
    participantStep,
    /inPersonSigningEnabled \|\|\s+supplementalResources\.length > 0 \|\|\s+availableRequirements\.length > 0/
  );
  assert.match(participantStep, />Firma presencial</);
  assert.match(participantStep, /Documentos complementarios/);
  assert.match(participantStep, /Documentos requeridos/);
});

test('step one and participant controls share the existing participant assignments', () => {
  assert.match(page, /participants=\{participants\}/);
  assert.match(page, /onParticipantsChange=\{setParticipants\}/);
  assert.match(options, /deliveryMode: checked \? 'in_person' : 'remote'/);
  assert.match(options, /participant\.requirements \|\| \[\]/);
  assert.match(packageConfiguration, /participant\.visibleResourceIds \|\| \[\]/);
  assert.match(participantStep, /deliveryMode === 'in_person'/);
  assert.match(participantStep, /setVisibleResourceIds/);
  assert.match(participantStep, /setRequirements/);
});

test('routing values remain preserved even though activation is no longer shown here', () => {
  assert.match(participantStep, /routingMode,/);
  assert.match(participantStep, /routingDelayAmount:/);
  assert.match(participantStep, /routingDate:/);
  assert.match(participantStep, /routingAfterEvent:/);
});

test('additional options and their tooltips use the same visual typography', () => {
  assert.equal((options.match(/text-sm font-normal(?: !font-normal)? text-gray-700/g) || []).length, 2);
  assert.equal((options.match(/hover:bg-gray-50/g) || []).length, 2);
  assert.match(options, /Solicitar documentos a los participantes/);
  assert.match(options, /text-sm font-normal !font-normal text-gray-700/);
  assert.match(packageConfiguration, /text-sm font-normal !font-normal text-gray-700/);
  assert.match(sharedComponents, /text-\[12px\] font-normal leading-4 tracking-normal/);
});
