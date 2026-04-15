type AmountLike = { amount: number };

const numberFormatter = new Intl.NumberFormat("en-US");

export function formatSats(amount: number): string {
  return `${numberFormatter.format(amount)} sats`;
}

export function formatDateTime(timestamp: number): string {
  const normalized = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1_000;
  return new Date(normalized).toLocaleString();
}

export function formatRelativeExpiry(timestamp: number): string {
  const normalized = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1_000;
  const diffMs = normalized - Date.now();
  const diffMinutes = Math.round(diffMs / 60_000);

  if (Math.abs(diffMinutes) < 1) {
    return "less than a minute";
  }

  const unit = Math.abs(diffMinutes) === 1 ? "minute" : "minutes";
  const direction = diffMinutes >= 0 ? "left" : "ago";
  return `${Math.abs(diffMinutes)} ${unit} ${direction}`;
}

export function sumAmounts<T extends AmountLike>(items: T[]): number {
  return items.reduce((total, item) => total + item.amount, 0);
}

export function truncateMiddle(value: string, head = 14, tail = 10): string {
  if (value.length <= head + tail + 3) {
    return value;
  }

  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function getMintLabel(url: string, fallback?: string): string {
  try {
    const parsed = new URL(url);
    return fallback?.trim() || parsed.hostname;
  } catch {
    return fallback?.trim() || url;
  }
}
