const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

export function getChinaCalendarDayRange(now: Date = new Date()) {
  const chinaTime = new Date(now.getTime() + CHINA_OFFSET_MS);
  const year = chinaTime.getUTCFullYear();
  const month = chinaTime.getUTCMonth();
  const day = chinaTime.getUTCDate();

  return {
    start: new Date(Date.UTC(year, month, day) - CHINA_OFFSET_MS),
    end: new Date(Date.UTC(year, month, day + 1) - CHINA_OFFSET_MS),
  };
}
