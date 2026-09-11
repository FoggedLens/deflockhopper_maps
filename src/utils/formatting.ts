/**
 * Format a number with commas for thousands
 */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Format percentage with sign
 */
export function formatPercent(value: number, showSign: boolean = true): string {
  const sign = showSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(0)}%`;
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;

  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Capitalize first letter
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Extract city and state from Nominatim display name
 */
export function formatAddress(displayName: string): string {
  const parts = displayName.split(',').map((p) => p.trim());
  if (parts.length >= 3) {
    // Take first 3 meaningful parts
    return parts.slice(0, 3).join(', ');
  }
  return displayName;
}

/**
 * Human-readable size for streamed downloads: "640 KB", "2.1 MB"
 */
export function formatBytes(bytes: number): string {
  const kb = Math.max(1, Math.round(bytes / 1000));
  if (kb >= 1000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${kb} KB`;
}


/**
 * "As of" label for a published snapshot: an ISO timestamp rendered as a
 * short UTC calendar date ("Sep 10, 2026"). Fixed locale and UTC so the label
 * matches the publisher's date everywhere. Null when unparseable.
 */
export function formatAsOfDate(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
