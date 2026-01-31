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
