export type LeaveType = 'casual' | 'sick' | 'unpaid' | 'other';
export type CorrectionType = 'missed_check_in' | 'missed_check_out' | 'both';

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function requiredText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return normalized;
}

export function buildLeavePayload(input: {
  userId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
}) {
  if (!input.userId) throw new Error('Sign in again before submitting this request.');
  if (!['casual', 'sick', 'unpaid', 'other'].includes(input.leaveType)) throw new Error('Choose a valid leave type.');
  if (!isDateOnly(input.startDate) || !isDateOnly(input.endDate)) throw new Error('Enter valid start and end dates.');
  if (input.endDate < input.startDate) throw new Error('The end date must be on or after the start date.');
  return {
    user_id: input.userId,
    leave_type: input.leaveType as LeaveType,
    start_date: input.startDate,
    end_date: input.endDate,
    reason: requiredText(input.reason, 'Reason', 1000),
    status: 'pending' as const,
  };
}

export function buildCorrectionPayload(input: {
  userId: string;
  workDate: string;
  correctionType: string;
  checkIn: string;
  checkOut: string;
  reason: string;
  today?: Date;
}) {
  if (!input.userId) throw new Error('Sign in again before submitting this request.');
  if (!isDateOnly(input.workDate)) throw new Error('Enter a valid attendance date.');
  if (input.workDate > todayDateInIndia(input.today)) throw new Error('Attendance correction date cannot be in the future.');
  if (!['missed_check_in', 'missed_check_out', 'both'].includes(input.correctionType)) throw new Error('Choose a valid correction type.');
  const needsIn = input.correctionType === 'missed_check_in' || input.correctionType === 'both';
  const needsOut = input.correctionType === 'missed_check_out' || input.correctionType === 'both';
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if ((needsIn && !timePattern.test(input.checkIn)) || (needsOut && !timePattern.test(input.checkOut))) {
    throw new Error('Enter the requested time or times.');
  }
  if (needsIn && needsOut && input.checkOut <= input.checkIn) throw new Error('Check-out must be later than check-in.');
    if (input.workDate === todayDateInIndia(input.today)) {
      const now = input.today ?? new Date();
      const currentTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
      if ((needsIn && input.checkIn > currentTime) || (needsOut && input.checkOut > currentTime)) {
        throw new Error('Requested attendance times cannot be in the future.');
      }
    }
  return {
    user_id: input.userId,
    work_date: input.workDate,
    correction_type: input.correctionType as CorrectionType,
    requested_check_in: needsIn ? `${input.workDate}T${input.checkIn}:00+05:30` : null,
    requested_check_out: needsOut ? `${input.workDate}T${input.checkOut}:00+05:30` : null,
    reason: requiredText(input.reason, 'Reason', 1000),
    status: 'pending' as const,
  };
}

export function buildExpensePayload(input: {
  userId: string;
  module: 'flat_expense' | 'office_expense';
  category: string;
  expenseDate: string;
  amount: number;
  description: string;
  paymentMethod: string;
  paymentStatus: string;
}) {
  if (!input.userId) throw new Error('Sign in again before saving this expense.');
  if (!['flat_expense', 'office_expense'].includes(input.module)) throw new Error('Choose a valid expense module.');
  const category = requiredText(input.category, 'Category', 120);
  if (!isDateOnly(input.expenseDate)) throw new Error('Enter a valid expense date.');
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1_000_000_000) throw new Error('Enter a valid amount greater than zero.');
  if (!['', 'Cash', 'UPI', 'Bank transfer', 'Card', 'Cheque'].includes(input.paymentMethod)) throw new Error('Choose a valid payment method.');
  if (!['paid', 'unpaid'].includes(input.paymentStatus)) throw new Error('Choose a valid payment status.');
  return {
    submitted_by: input.userId,
    expense_module: input.module,
    category,
    expense_date: input.expenseDate,
    amount: Math.round(input.amount * 100) / 100,
    description: requiredText(input.description, 'Description', 2000),
    payment_method: input.paymentMethod || null,
    payment_status: input.paymentStatus as 'paid' | 'unpaid',
    approval_status: 'pending' as const,
  };
}

export function buildHolidayPayload(input: { userId: string; date: string; name: string }) {
  if (!input.userId) throw new Error('Sign in again before saving this holiday.');
  if (!isDateOnly(input.date)) throw new Error('Enter a valid holiday date.');
  return { created_by: input.userId, holiday_date: input.date, name: requiredText(input.name, 'Holiday name', 120) };
}

export function normalizePayrollMonth(value: string, today = new Date()): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('Choose a valid payroll month.');
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(today);
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const currentMonth = `${year}-${month}`;
  if (value > currentMonth) throw new Error('Payroll cannot be generated for a future month.');
  return `${value}-01`;
}

export function currentPayrollMonth(today = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(today);
  return `${parts.find((part) => part.type === 'year')?.value ?? ''}-${parts.find((part) => part.type === 'month')?.value ?? ''}`;
}

export function previousCompletedPayrollMonth(today = new Date()): string {
  const current = currentPayrollMonth(today);
  const [year, month] = current.split('-').map(Number);
  const index = year * 12 + month - 2;
  const previousYear = Math.floor(index / 12);
  const previousMonth = (index % 12) + 1;
  return `${previousYear}-${String(previousMonth).padStart(2, '0')}`;
}

export function normalizeCompletedPayrollMonth(value: string, today = new Date()): string {
  const normalized = normalizePayrollMonth(value, today);
  if (value >= currentPayrollMonth(today)) throw new Error('Payroll can only be calculated after the selected month has ended.');
  return normalized;
}

export function normalizeNonNegativeAmount(value: string, label: string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) throw new Error(`${label} must be a valid non-negative amount.`);
  return Math.round(amount * 100) / 100;
}

export type ClientStatus = 'active' | 'inactive';
export type ProjectStatus = 'planned' | 'active' | 'on_hold' | 'completed' | 'cancelled';
export type MilestoneStatus = 'planned' | 'in_progress' | 'completed' | 'on_hold';
export type ClientPaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'card' | 'cheque' | 'other';

function optionalDate(value: string, label: string): string | null {
  if (!value) return null;
  if (!isDateOnly(value)) throw new Error(`Enter a valid ${label}.`);
  return value;
}

function todayDateInIndia(today = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(today);
  return `${parts.find((part) => part.type === 'year')?.value ?? ''}-${parts.find((part) => part.type === 'month')?.value ?? ''}-${parts.find((part) => part.type === 'day')?.value ?? ''}`;
}

function currencyCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error('Enter a valid 3-letter currency code.');
  return normalized;
}

export function buildClientPayload(input: {
  userId: string; name: string; contactName: string; email: string; phone: string; address: string; taxId: string; status: string;
}) {
  if (!input.userId) throw new Error('Sign in again before saving this client.');
  if (!['active', 'inactive'].includes(input.status)) throw new Error('Choose a valid client status.');
  const email = input.email.trim().toLowerCase();
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Enter a valid client email address.');
  const phone = input.phone.trim();
  if (phone.length > 40) throw new Error('Phone must be 40 characters or fewer.');
  return {
    display_name: requiredText(input.name, 'Client name', 160),
    contact_name: input.contactName.trim().slice(0, 120) || null,
    email: email || null,
    phone: phone || null,
    address: input.address.trim().slice(0, 1000) || null,
    tax_identifier: input.taxId.trim().slice(0, 40) || null,
    status: input.status as ClientStatus,
    created_by: input.userId,
    updated_by: input.userId,
  };
}

export function buildProjectPayload(input: {
  userId: string; clientId: string; name: string; code: string; amount: number; currency: string; status: string; startDate: string; targetDate: string; notes: string;
}) {
  if (!input.userId || !input.clientId) throw new Error('Choose a client and sign in again before saving this project.');
  if (!['planned', 'active', 'on_hold', 'completed', 'cancelled'].includes(input.status)) throw new Error('Choose a valid project status.');
  const startDate = optionalDate(input.startDate, 'start date');
  const targetDate = optionalDate(input.targetDate, 'target date');
  if (startDate && targetDate && targetDate < startDate) throw new Error('The target date must be on or after the start date.');
  if (!Number.isFinite(input.amount) || input.amount < 0 || input.amount > 100_000_000_000) throw new Error('Enter a valid non-negative contract amount.');
  return {
    client_id: input.clientId,
    project_name: requiredText(input.name, 'Project name', 180),
    project_code: input.code.trim().slice(0, 60) || null,
    contract_amount: Math.round(input.amount * 100) / 100,
    currency_code: currencyCode(input.currency),
    status: input.status as ProjectStatus,
    start_date: startDate,
    target_date: targetDate,
    notes: input.notes.trim().slice(0, 4000) || null,
    created_by: input.userId,
    updated_by: input.userId,
  };
}

export function buildMilestonePayload(input: { userId: string; projectId: string; name: string; amount: number; dueDate: string; sequence: number; status?: string }) {
  if (!input.userId || !input.projectId) throw new Error('Choose a project and sign in again before saving this milestone.');
  const dueDate = optionalDate(input.dueDate, 'milestone due date');
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 100_000_000_000) throw new Error('Milestone amount must be greater than zero.');
  if (!Number.isInteger(input.sequence) || input.sequence < 1 || input.sequence > 10000) throw new Error('Milestone order must be a positive whole number.');
  const status = input.status ?? 'planned';
  if (!['planned', 'in_progress', 'completed', 'on_hold'].includes(status)) throw new Error('Choose a valid milestone status.');
  return {
    project_id: input.projectId,
    milestone_name: requiredText(input.name, 'Milestone name', 180),
    expected_amount: Math.round(input.amount * 100) / 100,
    due_date: dueDate,
    sequence: input.sequence,
    status: status as MilestoneStatus,
    created_by: input.userId,
    updated_by: input.userId,
  };
}

export function buildClientPaymentPayload(input: {
  userId: string; projectId: string; milestoneId: string; paidOn: string; amount: number; method: string; reference: string; note: string; today?: Date;
}) {
  if (!input.userId || !input.projectId) throw new Error('Choose a project and sign in again before recording a payment.');
  if (!isDateOnly(input.paidOn)) throw new Error('Enter a valid payment date.');
  if (input.paidOn > todayDateInIndia(input.today)) throw new Error('Payment date cannot be in the future.');
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 100_000_000_000) throw new Error('Payment amount must be greater than zero.');
  if (!['cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other'].includes(input.method)) throw new Error('Choose a valid payment method.');
  return {
    project_id: input.projectId,
    milestone_id: input.milestoneId || null,
    paid_on: input.paidOn,
    amount: Math.round(input.amount * 100) / 100,
    payment_method: input.method as ClientPaymentMethod,
    reference: input.reference.trim().slice(0, 120) || null,
    note: input.note.trim().slice(0, 1000) || null,
    recorded_by: input.userId,
  };
}
