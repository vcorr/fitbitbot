/**
 * Format a date as YYYY-MM-DD using local timezone
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get a date N days ago
 */
export function daysAgo(n: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return date;
}

/**
 * Get today's date string
 */
export function today(): string {
  return formatDate(new Date());
}

/**
 * Get yesterday's date string
 */
export function yesterday(): string {
  return formatDate(daysAgo(1));
}

/**
 * Arithmetic mean, ignoring nulls.
 */
export function mean(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Split a date range into chunks of at most `maxDays` days.
 * Both startDate and endDate are inclusive YYYY-MM-DD strings.
 * Returns an array of { startDate, endDate } pairs covering the full range.
 */
export function getDateChunks(
  startDate: string,
  endDate: string,
  maxDays = 30,
): Array<{ startDate: string; endDate: string }> {
  const chunks: Array<{ startDate: string; endDate: string }> = [];
  let cursor = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");

  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + maxDays - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    chunks.push({
      startDate: formatDate(cursor),
      endDate: formatDate(chunkEnd),
    });

    cursor = new Date(chunkEnd);
    cursor.setDate(cursor.getDate() + 1);
  }

  return chunks;
}

/**
 * Population standard deviation, ignoring nulls.
 */
export function stddev(values: (number | null)[]): number | null {
  const m = mean(values);
  if (m === null) return null;
  const nums = values.filter((v): v is number => v !== null);
  const variance = nums.reduce((sum, v) => sum + (v - m) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

/**
 * Compute z-scores for a series of values.
 * Nulls are excluded from mean/std but preserved in output.
 * If invert is true, z-scores are negated (for metrics where lower = better).
 * If std === 0, all z-scores are 0.
 */
export function zScores(values: (number | null)[], invert = false): (number | null)[] {
  const m = mean(values);
  const s = stddev(values);
  if (m === null || s === null) return values.map(() => null);
  return values.map((v) => {
    if (v === null) return null;
    const z = s === 0 ? 0 : (v - m) / s;
    return Math.round((invert ? -z : z) * 100) / 100;
  });
}
