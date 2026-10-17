export type AttendanceRecordInput = {
  user_id: string;
  work_date: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
};

export type AttendanceSummary = {
  employeeCount: number;
  recordedEntries: number;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  pendingDays: number;
  completedShifts: number;
  openCheckouts: number;
  invalidEntries: number;
  duplicateDays: number;
};

export type EmployeeNameInput = { id: string; full_name?: string | null };

export function mapEmployeeDisplayNames(profiles: EmployeeNameInput[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const profile of profiles) {
    const id = profile.id?.trim();
    const displayName = profile.full_name?.trim();
    if (id && displayName) names[id] = displayName;
  }
  return names;
}

function emptySummary(): AttendanceSummary {
  return { employeeCount: 0, recordedEntries: 0, presentDays: 0, halfDays: 0, absentDays: 0, pendingDays: 0, completedShifts: 0, openCheckouts: 0, invalidEntries: 0, duplicateDays: 0 };
}

function isDateInMonth(value: string, month: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !/^\d{4}-\d{2}$/.test(month) || value.slice(0, 7) !== month) return false;
  const [year, monthNumber, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === monthNumber - 1 && date.getUTCDate() === day;
}

export function attendanceElapsedMinutes(checkIn: string | null, checkOut: string | null): number | null {
  if (!checkIn || !checkOut) return null;
  const start = Date.parse(checkIn);
  const end = Date.parse(checkOut);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.floor((end - start) / 60_000);
}

export function formatAttendanceTime(value: string | null): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Review time';
  return new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(timestamp);
}

export function formatElapsedSpan(minutes: number | null): string {
  if (minutes === null) return '—';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${String(remainder).padStart(2, '0')}m`;
}

export function summarizeAttendanceRecords(rows: AttendanceRecordInput[], month: string): AttendanceSummary {
  const summary = emptySummary();
  const seenDays = new Set<string>();
  const employees = new Set<string>();

  for (const row of rows) {
    if (!row.user_id || !isDateInMonth(row.work_date, month)) continue;
    const key = `${row.user_id}:${row.work_date}`;
    if (seenDays.has(key)) {
      summary.duplicateDays += 1;
      continue;
    }
    seenDays.add(key);
    employees.add(row.user_id);
    summary.recordedEntries += 1;

    const hasCheckIn = Boolean(row.check_in);
    const hasCheckOut = Boolean(row.check_out);
    const elapsed = attendanceElapsedMinutes(row.check_in, row.check_out);
    if ((hasCheckIn && !Number.isFinite(Date.parse(row.check_in ?? ''))) || (hasCheckOut && !Number.isFinite(Date.parse(row.check_out ?? '')))) {
      summary.invalidEntries += 1;
    } else if (hasCheckOut && !hasCheckIn) {
      summary.invalidEntries += 1;
    }

    if (elapsed !== null) summary.completedShifts += 1;
    else if (hasCheckIn && !hasCheckOut) summary.openCheckouts += 1;
    else if (hasCheckIn && hasCheckOut) summary.invalidEntries += 1;

    // Attendance status determines the day equivalent; shift completeness is
    // tracked separately so a checked-in employee still counts as present.
    if (row.status === 'present') summary.presentDays += 1;
    else if (row.status === 'half_day') { summary.halfDays += 1; summary.presentDays += 0.5; }
    else if (row.status === 'absent') summary.absentDays += 1;
    if (row.status === 'pending_review' || (hasCheckIn && !hasCheckOut)) summary.pendingDays += 1;
  }

  summary.employeeCount = employees.size;
  return summary;
}
