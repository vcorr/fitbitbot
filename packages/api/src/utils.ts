/**
 * Format a date as YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
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
