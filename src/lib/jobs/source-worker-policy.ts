export function sourceRetryAt(attempts: number, retryAfterSeconds: number | null, now = new Date()) {
  const exponential = Math.min(6 * 60 * 60, 60 * (2 ** Math.max(0, attempts - 1)));
  const maximumProviderDelay = 7 * 24 * 60 * 60;
  const delaySeconds = Math.min(maximumProviderDelay, Math.max(exponential, retryAfterSeconds || 0));
  return new Date(now.getTime() + delaySeconds * 1_000).toISOString();
}
