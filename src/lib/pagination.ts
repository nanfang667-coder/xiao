export function parsePage(value: string | string[] | undefined): number {
  const page = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function pageUrl(path: string, page: number): string {
  return page > 1 ? path + "?page=" + page : path;
}
