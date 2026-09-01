const ALLEY_TITLE_SUFFIX = "站街";

export function withAlleyTitleSuffix(value: string): string {
  if (!value || value.endsWith(ALLEY_TITLE_SUFFIX)) return value;
  return `${value}${ALLEY_TITLE_SUFFIX}`;
}
