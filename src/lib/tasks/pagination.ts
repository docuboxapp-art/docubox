type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/** Read every ordered PostgREST page so search and filters cover the full workspace. */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 200
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await fetchPage(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}
