export type PayrollDayInput = {
  user_id: string;
  payroll_month_id?: string;
  work_date?: string;
  day_type: string;
  attendance_status: string;
  payable_fraction: number;
};

export type PayrollDaySummary = {
  workingDays: number;
  presentDays: number;
  paidLeaveDays: number;
  absentDays: number;
  unpaidLeaveDays: number;
  pendingDays: number;
  holidayDays: number;
  sundayDays: number;
};

function emptySummary(): PayrollDaySummary {
  return { workingDays: 0, presentDays: 0, paidLeaveDays: 0, absentDays: 0, unpaidLeaveDays: 0, pendingDays: 0, holidayDays: 0, sundayDays: 0 };
}

export function summarizePayrollDays(rows: PayrollDayInput[]): Record<string, PayrollDaySummary> {
  const result: Record<string, PayrollDaySummary> = {};
  const seenDays = new Set<string>();
  for (const row of rows) {
    if (!row.user_id || !['working', 'holiday', 'sunday'].includes(row.day_type)) continue;
    if (row.work_date) {
      const key = `${row.payroll_month_id ?? ''}:${row.user_id}:${row.work_date}`;
      if (seenDays.has(key)) continue;
      seenDays.add(key);
    }
    const summary = result[row.user_id] ?? emptySummary();
    const fraction = Number(row.payable_fraction);
    const payableFraction = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;

    if (row.day_type === 'working') summary.workingDays += 1;
    if (row.day_type === 'holiday') summary.holidayDays += 1;
    if (row.day_type === 'sunday') summary.sundayDays += 1;
    if (row.day_type === 'working') {
      if (row.attendance_status === 'present' || row.attendance_status === 'half_day') summary.presentDays += payableFraction;
      if (row.attendance_status === 'paid_leave') summary.paidLeaveDays += payableFraction;
      if (row.attendance_status === 'absent') summary.absentDays += 1;
      if (row.attendance_status === 'unpaid_leave') summary.unpaidLeaveDays += 1;
      if (row.attendance_status === 'pending_review') summary.pendingDays += 1;
    }

    result[row.user_id] = summary;
  }
  return result;
}
