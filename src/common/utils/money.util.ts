/** Basis-point share of an amount in cents, rounded half up. */
export function bpsOf(amountCents: number, bps: number): number {
  return Math.round((amountCents * bps) / 10_000);
}

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** PayPal amount strings ("12.34") to cents without float drift. */
export function toCents(value: string): number {
  const negative = value.trim().startsWith('-');
  const [whole, fraction = ''] = value.trim().replace('-', '').split('.');
  const cents =
    parseInt(whole || '0', 10) * 100 +
    parseInt(fraction.padEnd(2, '0').slice(0, 2), 10);
  return negative ? -cents : cents;
}

export function toAmountString(cents: number): string {
  return (cents / 100).toFixed(2);
}
