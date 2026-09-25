const DEFAULT_RETURN = "/adminzhangzhang/teachers";
const ALLOWED_PATHS = [DEFAULT_RETURN, "/adminzhangzhang/submissions"];

export function adminTeacherReturnTo(value: string | undefined): string {
  return value && !/[\r\n\\]/.test(value) && ALLOWED_PATHS.some((path) => value === path || value.startsWith(`${path}?`))
    ? value
    : DEFAULT_RETURN;
}
