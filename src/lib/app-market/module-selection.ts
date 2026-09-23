export const FREE_PLAN_MODULE_LIMIT = 2;

export function toggleFreePlanModule<T extends string>(activeIds: T[], id: T | null) {
  if (id === null) return { accepted: true, nextIds: [] as T[] };
  if (activeIds.includes(id)) {
    return { accepted: true, nextIds: activeIds.filter((activeId) => activeId !== id) };
  }
  if (activeIds.length >= FREE_PLAN_MODULE_LIMIT) {
    return { accepted: false, nextIds: activeIds };
  }
  return { accepted: true, nextIds: [...activeIds, id] };
}
