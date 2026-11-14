/** Returns the civil date used for billing in the merchant's Brazil timezone. */
export function businessDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new RangeError('Invalid business date.');
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: 'year' | 'month' | 'day') => parts.find((item) => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  if (!year || !month || !day) throw new RangeError('Could not determine business date.');
  return `${year}-${month}-${day}`;
}
