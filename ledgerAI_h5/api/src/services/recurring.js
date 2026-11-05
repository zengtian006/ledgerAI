const CADENCES = [
  { name: 'weekly', min: 6, max: 8, days: 7 },
  { name: 'every 2 weeks', min: 12, max: 16, days: 14 },
  { name: 'monthly', min: 25, max: 35, days: 30 },
  { name: 'quarterly', min: 75, max: 105, days: 91 },
  { name: 'yearly', min: 345, max: 385, days: 365 },
];

const dayNumber = (date) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
const normalizedMerchant = (merchant) => merchant.toLowerCase().replace(/[^a-z0-9]/g, '');

export function detectRecurringExpenses(rows, asOfDate = new Date().toISOString().slice(0, 10)) {
  const asOf = dayNumber(asOfDate);
  const groups = new Map();
  for (const row of rows) {
    const key = `${normalizedMerchant(row.merchant_name)}|${row.currency}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const results = new Map();
  for (const group of groups.values()) {
    group.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
    for (const anchor of group) {
      const tolerance = Math.max(1, Math.abs(anchor.total_amount) * 0.1);
      const similar = group.filter((row) => Math.abs(row.total_amount - anchor.total_amount) <= tolerance);
      if (similar.length < 3) continue;

      for (const cadence of CADENCES) {
        let run = [];
        const consider = () => {
          if (run.length < 3) return;

          const last = run.at(-1);
          const age = asOf - dayNumber(last.transaction_date);
          if (age < 0 || age > cadence.days * 1.6) return;
          const average = run.reduce((sum, row) => sum + row.total_amount, 0) / run.length;
          const key = `${normalizedMerchant(last.merchant_name)}|${last.currency}|${cadence.name}`;
          const current = results.get(key);
          if (current && (
            current.occurrence_count > run.length
            || (current.occurrence_count === run.length && current.last_charged >= last.transaction_date)
          )) return;

          results.set(key, {
            merchant_name: last.merchant_name,
            currency: last.currency,
            average_amount: Math.round(average * 100) / 100,
            cadence: cadence.name,
            occurrence_count: run.length,
            last_charged: last.transaction_date,
            expected_date: new Date((dayNumber(last.transaction_date) + cadence.days) * 86_400_000).toISOString().slice(0, 10),
          });
        };
        for (const row of similar) {
          if (run.length) {
            const gap = dayNumber(row.transaction_date) - dayNumber(run.at(-1).transaction_date);
            if (gap < cadence.min || gap > cadence.max) {
              consider();
              run = [];
            }
          }
          run.push(row);
        }
        consider();
      }
    }
  }

  return [...results.values()].sort((a, b) => a.expected_date.localeCompare(b.expected_date));
}
