import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const profileSource = await readFile('src/app/mi-perfil/page.tsx', 'utf8');
const documentsSource = await readFile('src/app/mis-documentos/page.tsx', 'utf8');
const settingsSource = await readFile('src/app/configuracion/page.tsx', 'utf8');

test('profile sidebar uses the same responsive width as Mi espacio', () => {
  const responsiveWidth = /md:w-60[\s\S]*?2xl:w-64/;
  assert.match(profileSource, responsiveWidth);
  assert.match(documentsSource, /w-60[\s\S]*?2xl:w-64/);
  assert.match(settingsSource, responsiveWidth);
});

test('settings sidebar matches the grouped profile navigation language', () => {
  assert.match(settingsSource, /const sidebarSections:/);
  assert.match(settingsSource, /label: 'Principal'/);
  assert.match(settingsSource, /label: 'Configuración del espacio'/);
  assert.match(settingsSource, /label: 'Seguridad e integraciones'/);
  assert.match(settingsSource, /sidebarSections\.map\(\(section, sectionIndex\)/);
  assert.match(settingsSource, /md:gap-0\.5/);
  assert.match(settingsSource, /rounded-md/);
  assert.match(settingsSource, /bg-primary\/10 text-primary/);
  assert.match(settingsSource, /uppercase tracking-widest text-muted-foreground\/60/);

  const workspace = settingsSource.indexOf("id: 'espacios-trabajo'");
  const notifications = settingsSource.indexOf("id: 'notificaciones'");
  const templates = settingsSource.indexOf("id: 'plantillas'");
  const regional = settingsSource.indexOf("id: 'regional'");
  const storage = settingsSource.indexOf("id: 'almacenamiento'");
  const integrations = settingsSource.indexOf("id: 'integraciones'");
  const audit = settingsSource.indexOf("id: 'auditoria'");
  const verification = settingsSource.indexOf("href: '/configuracion/verificacion-identidad'");

  assert.ok(
    workspace < notifications &&
      notifications < templates &&
      templates < regional &&
      regional < storage &&
      storage < integrations &&
      integrations < audit &&
      audit < verification
  );
});

test('profile navigation is grouped by user workflow', () => {
  assert.match(profileSource, /const sidebarSections = \[/);
  assert.match(profileSource, /label: 'Principal'/);
  assert.match(profileSource, /label: 'Firma y seguridad'/);
  assert.match(profileSource, /label: 'Actividad'/);
  assert.match(profileSource, /sidebarSections\.map\(\(section, sectionIndex\)/);
  assert.match(profileSource, /uppercase tracking-widest text-muted-foreground\/60/);

  const personal = profileSource.indexOf("id: 'informacion-personal'");
  const verification = profileSource.indexOf("id: 'verificacion'");
  const file = profileSource.indexOf("id: 'mi-expediente'");
  const signatures = profileSource.indexOf("id: 'firmas'");
  const protection = profileSource.indexOf("id: 'proteccion-acceso'");
  const security = profileSource.indexOf("id: 'seguridad'");
  const privacy = profileSource.indexOf("id: 'privacidad'");
  const history = profileSource.indexOf("id: 'historial-eliminaciones'");

  assert.ok(
    personal < verification &&
      verification < file &&
      file < signatures &&
      signatures < protection &&
      protection < security &&
      security < privacy &&
      privacy < history
  );
});
