import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relativePath) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
const authContext = read('src/contexts/AuthContext.tsx');
const topNav = read('src/components/TopNav.tsx');
const sidebar = read('src/components/Sidebar.tsx');
const profile = read('src/app/mi-perfil/page.tsx');
const avatar = read('src/components/ui/UserAvatar.tsx');
const avatarStorageMigration = read(
  'supabase/migrations/20260921201507_avatar_storage_owner_read.sql'
);
const avatarDeleteMigration = read(
  'supabase/migrations/20260921202951_avatar_storage_owner_delete.sql'
);

test('authenticated profile exposes the canonical avatar globally', () => {
  assert.match(authContext, /avatar_url,email_verified/);
  assert.match(authContext, /userProfile,/);
  assert.match(authContext, /refreshUserProfile/);
});

test('top navigation and sidebar use the profile photo with their existing fallbacks', () => {
  assert.match(topNav, /const userAvatarUrl = userProfile\?\.avatar_url/);
  assert.ok((topNav.match(/<UserAvatar/g) || []).length >= 3);
  assert.match(topNav, /fallback=\{<User size=\{15\}/);
  assert.match(topNav, /\{userInitials \|\| 'U'\}/);
  assert.match(sidebar, /const userAvatarUrl = userProfile\?\.avatar_url/);
  assert.match(sidebar, /<UserAvatar/);
  assert.match(sidebar, /\{userInitials\}/);
});

test('avatar updates are staged until profile save and refresh global profile state', () => {
  assert.match(profile, /await refreshUserProfile\?\.\(\)/);
  assert.match(profile, /setAvatarPreviewUrl\(URL\.createObjectURL\(file\)\)/);
  assert.match(profile, /avatar_url: avatarUrlToPersist \|\| null/);
  assert.match(profile, /\.upload\(uploadedAvatarPath, avatarFile/);
  assert.match(profile, /setIsEditingProfile\(false\)/);
  assert.match(avatar, /onError=\{\(\) => setFailedSource/);
  assert.match(avatar, /fallback/);
});

test('profile photo can be staged for deletion, undone, or cancelled', () => {
  assert.match(profile, /const handleRemoveAvatar = \(\) =>/);
  assert.match(profile, /setAvatarRemovalPending\(true\)/);
  assert.match(profile, /const handleUndoRemoveAvatar = \(\) =>/);
  assert.match(profile, /const cancelProfileEditing = \(\) =>/);
  assert.match(profile, />\s*Eliminar foto\s*</);
  assert.match(profile, /La foto se eliminará al guardar los cambios\./);
});

test('avatar storage supports secure owner-scoped upserts', () => {
  assert.match(avatarStorageMigration, /FOR SELECT\s+TO authenticated/i);
  assert.match(avatarStorageMigration, /bucket_id = 'avatars'/);
  assert.match(avatarStorageMigration, /auth\.uid\(\)::text/);
  assert.match(avatarDeleteMigration, /FOR DELETE\s+TO authenticated/i);
  assert.match(avatarDeleteMigration, /bucket_id = 'avatars'/);
  assert.match(avatarDeleteMigration, /auth\.uid\(\)::text/);
});
