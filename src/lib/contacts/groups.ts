import type { SupabaseClient } from '@supabase/supabase-js';
import { CUSTOM_FILTER_ICON_OPTIONS } from '@/lib/filters/custom-filter-icons';

type GroupClient = Pick<SupabaseClient, 'from' | 'rpc'>;

export type ContactGroupIcon = (typeof CUSTOM_FILTER_ICON_OPTIONS)[number];
export const DEFAULT_CONTACT_GROUP_ICON: ContactGroupIcon = '👥';
export type ContactGroupInfo = { id: string; name: string; icon: ContactGroupIcon };
type Member = { contactId: string; assignedAt: string };
export type ContactGroup = ContactGroupInfo & { members: Member[] };
export type ContactGroups = { groups: ContactGroup[] };
export type ContactGroupChange =
  | { group: ContactGroupInfo; member?: Member }
  | { groupId: string; contactId: string }
  | { deletedGroupId: string };

type GroupRow = { id: string; name: string; icon: string | null };
type MembershipRow = { group_id: string; contact_id: string; created_at: string };

const pageSize = 500;

export function cleanContactGroupName(name: string) {
  return name.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function groupInfo({ id, name, icon }: GroupRow): ContactGroupInfo {
  return {
    id,
    name,
    icon:
      CUSTOM_FILTER_ICON_OPTIONS.find((option) => option === icon) ?? DEFAULT_CONTACT_GROUP_ICON,
  };
}

async function allRows<T>(
  query: (
    from: number,
    to: number
  ) => PromiseLike<{
    data: T[] | null;
    error: { code: string } | null;
  }>
) {
  const rows: T[] = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await query(start, start + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

function sortGroups(groups: ContactGroup[]) {
  return groups.sort((a, b) => a.name.localeCompare(b.name, 'es-MX'));
}

export async function loadContactGroups(
  client: GroupClient,
  userId: string
): Promise<ContactGroups> {
  const [groups, memberships] = await Promise.all([
    allRows<GroupRow>((from, to) =>
      client
        .from('contact_groups')
        .select('id,name,icon')
        .eq('user_id', userId)
        .order('id')
        .range(from, to)
    ),
    allRows<MembershipRow>((from, to) =>
      client
        .from('contact_group_members')
        .select('group_id,contact_id,created_at')
        .eq('user_id', userId)
        .order('group_id')
        .order('contact_id')
        .range(from, to)
    ),
  ]);
  const membersByGroup = new Map<string, Member[]>();
  for (const row of memberships) {
    const members = membersByGroup.get(row.group_id) ?? [];
    members.push({ contactId: row.contact_id, assignedAt: row.created_at });
    membersByGroup.set(row.group_id, members);
  }
  return {
    groups: sortGroups(
      groups.map((group) => ({
        ...groupInfo(group),
        members: membersByGroup.get(group.id) ?? [],
      }))
    ),
  };
}

export async function saveContactGroup(
  client: GroupClient,
  userId: string,
  draft: Pick<ContactGroupInfo, 'name' | 'icon'>,
  groupId?: string
): Promise<ContactGroupInfo> {
  const name = cleanContactGroupName(draft.name);
  if (!name || [...name].length > 80) {
    throw new Error('Escribe un nombre de hasta 80 caracteres.');
  }
  const values = { name, icon: draft.icon };
  const table = client.from('contact_groups');
  const mutation = groupId
    ? table.update(values).eq('id', groupId).eq('user_id', userId)
    : table.insert({ ...values, user_id: userId });
  const { data, error } = await mutation.select('id,name,icon').single<GroupRow>();
  if (error?.code === '23505') throw new Error('Ya tienes un grupo con ese nombre.');
  if (error || !data) throw new Error('No se pudo guardar el grupo. Intenta de nuevo.');
  return groupInfo(data);
}

export async function assignContactToGroup(
  client: GroupClient,
  userId: string,
  contactId: string,
  group: ContactGroupInfo
): Promise<ContactGroupChange> {
  const { id, name, icon } = group;
  const member = await client
    .from('contact_group_members')
    .upsert(
      { group_id: id, contact_id: contactId, user_id: userId },
      { onConflict: 'group_id,contact_id', ignoreDuplicates: true }
    )
    .select('created_at')
    .maybeSingle();
  if (member.error) throw new Error('No se pudo asignar el grupo.');
  let assignedAt = member.data?.created_at;
  if (!assignedAt) {
    const { data, error } = await client
      .from('contact_group_members')
      .select('created_at')
      .eq('group_id', id)
      .eq('contact_id', contactId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) throw new Error('No se pudo confirmar la asignación. Intenta de nuevo.');
    assignedAt = data.created_at;
  }
  return { group: { id, name, icon }, member: { contactId, assignedAt } };
}

export async function removeContactGroupAssignment(
  client: GroupClient,
  userId: string,
  contactId: string,
  groupId: string
): Promise<ContactGroupChange> {
  const { error } = await client
    .from('contact_group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('contact_id', contactId)
    .eq('user_id', userId);
  if (error) throw new Error('No se pudo quitar al contacto del grupo.');
  return { groupId, contactId };
}

export async function deleteContactGroup(
  client: GroupClient,
  groupId: string,
  destinationId?: string
) {
  const { data, error } = await client.rpc('delete_contact_group', {
    p_group_id: groupId,
    p_reassign_to: destinationId ?? null,
  });
  if (error?.code === 'P0002') {
    throw new Error('Alguno de los grupos ya no está disponible. Actualiza la agenda.');
  }
  if (error || data !== true) throw new Error('No se pudo eliminar el grupo. Intenta de nuevo.');
}

export function applyContactGroupChange(
  collection: ContactGroups,
  change: ContactGroupChange
): ContactGroups {
  if ('deletedGroupId' in change) {
    return { groups: collection.groups.filter((group) => group.id !== change.deletedGroupId) };
  }
  if ('group' in change) {
    const { group, member } = change;
    const previousMembers = collection.groups.find((entry) => entry.id === group.id)?.members ?? [];
    const members = member
      ? [...previousMembers.filter((entry) => entry.contactId !== member.contactId), member]
      : previousMembers;
    return {
      ...collection,
      groups: sortGroups([
        ...collection.groups.filter((entry) => entry.id !== group.id),
        { ...group, members },
      ]),
    };
  }
  const groups = collection.groups.map((group) =>
    group.id === change.groupId
      ? {
          ...group,
          members: group.members.filter((member) => member.contactId !== change.contactId),
        }
      : group
  );
  return { ...collection, groups };
}
