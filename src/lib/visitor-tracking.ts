const BACKOFFICE_PATH_PREFIXES = ["/team", "/adminzhangzhang"];

export function isBackofficePath(pathname: string): boolean {
  return BACKOFFICE_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
