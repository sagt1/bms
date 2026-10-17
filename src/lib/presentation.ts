import { money, niceDate, niceDateTime } from './utils.ts';

const privateColumn = /(salary|bank|account_number|pan|aadhaar|aadhar|tax_id)/i;
const currencyColumn = /(amount|salary|pay|deduction|cost|advance)/i;

export function formatCell(key: string, value: unknown, role: string): string {
  if (value === null || value === undefined || value === '') return '—';

  // Redact private fields before number/date formatting can expose their values.
  if (role !== 'admin' && privateColumn.test(key)) return 'Restricted';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number' && currencyColumn.test(key)) return money(value);
  if (typeof value === 'string' && /^check_(in|out)$/i.test(key)) return niceDateTime(value);
  if (typeof value === 'string' && /(date|payroll_month)/i.test(key)) return niceDate(value);
  if (typeof value === 'object') return 'Details';

  return String(value);
}
