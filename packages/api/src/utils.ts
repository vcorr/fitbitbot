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
