export function formatLocationLabel(city: string, district: string): string {
  return [city, district]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
}
