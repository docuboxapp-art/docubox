export const TABLE_PAGE_SIZES = [10, 25, 50, 100, 200] as const;
export type TablePageSize = (typeof TABLE_PAGE_SIZES)[number];
export const DEFAULT_TABLE_PAGE_SIZE = 50 satisfies TablePageSize;

export function shouldShowTablePagination(total: number) {
  return total >= 10;
}

export function isTablePageSize(value: number): value is TablePageSize {
  return TABLE_PAGE_SIZES.some((size) => size === value);
}
