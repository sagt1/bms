import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { formatCell } from '../src/lib/presentation.ts';
import { canEditModule, canViewModule, getAttendanceCapabilities } from '../src/lib/permissions.ts';
import { attendanceElapsedMinutes, formatElapsedSpan, mapEmployeeDisplayNames, summarizeAttendanceRecords } from '../src/lib/attendance-summary.ts';
import { canOpenDraft, documentFields, editorIdentity, matchesEditor } from '../src/lib/document-editor.ts';
import { isAllowedSupabaseUrl, isBrowserSafeSupabaseKey } from '../src/lib/project-boundary.ts';
import { buildClientPaymentPayload, buildClientPayload, buildCorrectionPayload, buildExpensePayload, buildHolidayPayload, buildLeavePayload, buildMilestonePayload, buildProjectPayload, currentPayrollMonth, normalizeCompletedPayrollMonth, normalizeNonNegativeAmount, normalizePayrollMonth, previousCompletedPayrollMonth } from '../src/lib/workflow-validation.ts';
import { summarizePayrollDays } from '../src/lib/payroll-summary.ts';

const attendance = {
  key: 'attendance',
  permission: 'attendance',
  navigation: 'nav_attendance',
};

test('employee navigation requires both navigation and view permissions', () => {
  assert.equal(canViewModule({ role: 'employee', is_active: true, nav_attendance: true, can_view_attendance: true }, attendance), true);
  assert.equal(canViewModule({ role: 'employee', is_active: true, nav_attendance: false, can_view_attendance: true }, attendance), false);
  assert.equal(canViewModule({ role: 'employee', is_active: true, nav_attendance: true, can_view_attendance: false }, attendance), false);
});

test('inactive profiles and employee team-management access are denied', () => {
  assert.equal(canViewModule({ role: 'admin', is_active: false }, { key: 'dashboard' }), false);
  assert.equal(canViewModule({ role: 'admin' }, { key: 'dashboard' }), false);
  assert.equal(canViewModule({ role: 'employee', is_active: true }, { key: 'team' }), false);
});

test('dashboard and payroll navigation follow the existing access model', () => {
  assert.equal(canViewModule({ role: 'employee', is_active: true, nav_dashboard: false }, { key: 'dashboard' }), false);
  assert.equal(canViewModule({ role: 'employee', is_active: true, nav_dashboard: true }, { key: 'dashboard' }), true);
  assert.equal(canViewModule({ role: 'employee', is_active: true, nav_payroll: true, can_view_payroll: true }, { key: 'payroll', permission: 'payroll', navigation: 'nav_payroll' }), false);
});

test('edit permissions require active view access and an explicit edit flag', () => {
  const module = { key: 'attendance', permission: 'attendance', navigation: 'nav_attendance' };
  assert.equal(canEditModule({ role: 'employee', is_active: true, nav_attendance: true, can_view_attendance: true, can_edit_attendance: true }, module), true);
  assert.equal(canEditModule({ role: 'employee', is_active: true, nav_attendance: true, can_view_attendance: true, can_edit_attendance: false }, module), false);
  assert.equal(canEditModule({ role: 'employee', is_active: true, nav_attendance: false, can_view_attendance: true, can_edit_attendance: true }, module), false);
  assert.equal(canEditModule({ role: 'admin', is_active: false }, module), false);
});

test('attendance capabilities separate employee tracking from administrator review', () => {
  const admin = getAttendanceCapabilities({ role: 'admin', is_active: true });
  assert.deepEqual(admin, { canView: true, canRecordAttendance: false, canRequestCorrection: false, canReviewCorrections: true, isAdmin: true });

  const viewOnly = getAttendanceCapabilities({ role: 'employee', is_active: true, nav_attendance: true, can_view_attendance: true, can_edit_attendance: false });
  assert.equal(viewOnly.canView, true);
  assert.equal(viewOnly.canRecordAttendance, false);
  assert.equal(viewOnly.canRequestCorrection, false);
  assert.equal(viewOnly.canReviewCorrections, false);

  const editor = getAttendanceCapabilities({ role: 'employee', is_active: true, nav_attendance: true, can_view_attendance: true, can_edit_attendance: true });
  assert.equal(editor.canRecordAttendance, true);
  assert.equal(editor.canRequestCorrection, true);
  assert.equal(editor.canReviewCorrections, false);

  const hidden = getAttendanceCapabilities({ role: 'employee', is_active: true, nav_attendance: false, can_view_attendance: true, can_edit_attendance: true });
  assert.equal(hidden.canView, false);
  assert.equal(hidden.canRecordAttendance, false);
  assert.equal(getAttendanceCapabilities({ role: 'admin', is_active: false }).canReviewCorrections, false);
});

test('attendance summaries are month-scoped, permission-agnostic, deduplicated, and do not infer absences', () => {
  const summary = summarizeAttendanceRecords([
    { user_id: 'employee-1', work_date: '2026-10-02', check_in: '2026-10-02T09:00:00+05:30', check_out: '2026-10-02T18:00:00+05:30', status: 'present' },
    { user_id: 'employee-1', work_date: '2026-10-03', check_in: '2026-10-03T09:00:00+05:30', check_out: '2026-10-03T13:00:00+05:30', status: 'half_day' },
    { user_id: 'employee-2', work_date: '2026-10-04', check_in: '2026-10-04T09:00:00+05:30', check_out: null, status: 'present' },
    { user_id: 'employee-2', work_date: '2026-10-05', check_in: null, check_out: null, status: 'absent' },
    { user_id: 'employee-1', work_date: '2026-09-30', check_in: '2026-09-30T09:00:00+05:30', check_out: '2026-09-30T18:00:00+05:30', status: 'present' },
    { user_id: 'employee-1', work_date: '2026-10-02', check_in: '2026-10-02T09:00:00+05:30', check_out: '2026-10-02T18:00:00+05:30', status: 'present' },
  ], '2026-10');

  assert.deepEqual(summary, { employeeCount: 2, recordedEntries: 4, presentDays: 2.5, halfDays: 1, absentDays: 1, pendingDays: 1, completedShifts: 2, openCheckouts: 1, invalidEntries: 0, duplicateDays: 1 });
  assert.equal(attendanceElapsedMinutes('2026-10-02T09:00:00+05:30', '2026-10-02T18:00:00+05:30'), 540);
  assert.equal(attendanceElapsedMinutes('invalid', '2026-10-02T18:00:00+05:30'), null);
  assert.equal(formatElapsedSpan(545), '9h 05m');
});

test('administrator attendance rows resolve profile IDs to employee names', () => {
  assert.deepEqual(mapEmployeeDisplayNames([
    { id: 'employee-1', full_name: '  Priya Kumar  ' },
    { id: 'employee-2', full_name: ' ' },
  ]), { 'employee-1': 'Priya Kumar' });
});

test('leave and attendance correction inputs enforce database constraints', () => {
  assert.deepEqual(buildLeavePayload({ userId: 'user-1', leaveType: 'casual', startDate: '2026-10-17', endDate: '2026-10-18', reason: ' Family appointment ' }), {
    user_id: 'user-1', leave_type: 'casual', start_date: '2026-10-17', end_date: '2026-10-18', reason: 'Family appointment', status: 'pending',
  });
  assert.throws(() => buildLeavePayload({ userId: 'user-1', leaveType: 'casual', startDate: '2026-02-30', endDate: '2026-03-01', reason: 'Reason' }), /valid start and end dates/);
  assert.throws(() => buildLeavePayload({ userId: 'user-1', leaveType: 'casual', startDate: '2026-10-18', endDate: '2026-10-17', reason: 'Reason' }), /on or after/);
  assert.deepEqual(buildCorrectionPayload({ userId: 'user-1', workDate: '2026-10-17', correctionType: 'missed_check_in', checkIn: '09:15', checkOut: '', reason: 'Missed the app reminder', today: new Date('2026-10-17T07:00:00Z') }).requested_check_out, null);
  assert.throws(() => buildCorrectionPayload({ userId: 'user-1', workDate: '2026-10-17', correctionType: 'both', checkIn: '10:00', checkOut: '09:00', reason: 'Reason' }), /later than check-in/);
  assert.throws(() => buildCorrectionPayload({ userId: 'user-1', workDate: '2026-10-18', correctionType: 'missed_check_in', checkIn: '09:15', checkOut: '', reason: 'Reason', today: new Date('2026-10-17T07:00:00Z') }), /cannot be in the future/);
  assert.throws(() => buildCorrectionPayload({ userId: 'user-1', workDate: '2026-10-17', correctionType: 'missed_check_in', checkIn: '13:00', checkOut: '', reason: 'Reason', today: new Date('2026-10-17T07:00:00Z') }), /times cannot be in the future/);
});

test('expense, holiday, and payroll inputs are normalized and bounded', () => {
  assert.equal(buildExpensePayload({ userId: 'user-1', module: 'office_expense', category: 'Travel', expenseDate: '2026-10-17', amount: 12.345, description: 'Taxi', paymentMethod: '', paymentStatus: 'paid' }).amount, 12.35);
  assert.throws(() => buildExpensePayload({ userId: 'user-1', module: 'office_expense', category: 'Travel', expenseDate: '2026-10-17', amount: 0, description: 'Taxi', paymentMethod: '', paymentStatus: 'paid' }), /greater than zero/);
  assert.deepEqual(buildHolidayPayload({ userId: 'admin-1', date: '2026-12-25', name: ' Christmas ' }), { created_by: 'admin-1', holiday_date: '2026-12-25', name: 'Christmas' });
  assert.equal(normalizePayrollMonth('2026-09', new Date('2026-10-17T00:00:00Z')), '2026-09-01');
  assert.throws(() => normalizePayrollMonth('2026-11', new Date('2026-10-17T00:00:00Z')), /future month/);
  assert.equal(normalizeNonNegativeAmount('123.456', 'Salary'), 123.46);
  assert.throws(() => normalizeNonNegativeAmount('-1', 'Salary'), /non-negative/);
});

test('payroll defaults to the last completed India month and blocks partial or future months', () => {
  assert.equal(previousCompletedPayrollMonth(new Date('2026-10-17T08:00:00Z')), '2026-09');
  assert.equal(previousCompletedPayrollMonth(new Date('2026-12-31T20:00:00Z')), '2026-12');
  assert.equal(currentPayrollMonth(new Date('2026-12-31T20:00:00Z')), '2027-01');
  assert.equal(normalizeCompletedPayrollMonth('2026-09', new Date('2026-10-17T08:00:00Z')), '2026-09-01');
  assert.throws(() => normalizeCompletedPayrollMonth('2026-10', new Date('2026-10-17T08:00:00Z')), /after the selected month has ended/);
  assert.throws(() => normalizeCompletedPayrollMonth('2026-11', new Date('2026-10-17T08:00:00Z')), /future month/);
});

test('payroll day summaries distinguish attendance, leave, absences, Sundays, and holidays', () => {
  const summary = summarizePayrollDays([
    { user_id: 'employee-1', day_type: 'working', attendance_status: 'present', payable_fraction: 1 },
    { user_id: 'employee-1', day_type: 'working', attendance_status: 'half_day', payable_fraction: 0.5 },
    { user_id: 'employee-1', day_type: 'working', attendance_status: 'paid_leave', payable_fraction: 1 },
    { user_id: 'employee-1', day_type: 'working', attendance_status: 'unpaid_leave', payable_fraction: 0 },
    { user_id: 'employee-1', day_type: 'working', attendance_status: 'absent', payable_fraction: 0 },
    { user_id: 'employee-1', day_type: 'working', attendance_status: 'pending_review', payable_fraction: 0 },
    { user_id: 'employee-1', day_type: 'sunday', attendance_status: 'sunday', payable_fraction: 0 },
    { user_id: 'employee-1', day_type: 'holiday', attendance_status: 'holiday', payable_fraction: 0 },
  ]);
  assert.deepEqual(summary['employee-1'], {
    workingDays: 6, presentDays: 1.5, paidLeaveDays: 1, absentDays: 1, unpaidLeaveDays: 1, pendingDays: 1, holidayDays: 1, sundayDays: 1,
  });
});

test('payroll attendance totals only count working days and de-duplicate saved daily rows', () => {
  const summary = summarizePayrollDays([
    { user_id: 'employee-1', payroll_month_id: 'month-1', work_date: '2026-10-01', day_type: 'working', attendance_status: 'present', payable_fraction: 1 },
    { user_id: 'employee-1', payroll_month_id: 'month-1', work_date: '2026-10-01', day_type: 'working', attendance_status: 'present', payable_fraction: 1 },
    { user_id: 'employee-1', payroll_month_id: 'month-1', work_date: '2026-10-02', day_type: 'holiday', attendance_status: 'present', payable_fraction: 1 },
    { user_id: 'employee-1', payroll_month_id: 'month-1', work_date: '2026-10-03', day_type: 'sunday', attendance_status: 'paid_leave', payable_fraction: 1 },
  ]);
  assert.deepEqual(summary['employee-1'], { workingDays: 1, presentDays: 1, paidLeaveDays: 0, absentDays: 0, unpaidLeaveDays: 0, pendingDays: 0, holidayDays: 1, sundayDays: 1 });
});

test('client, project, milestone, and payment inputs match the proposed database constraints', () => {
  const client = buildClientPayload({ userId: 'admin-1', name: '  Acme Survey  ', contactName: '', email: 'FINANCE@ACME.EXAMPLE', phone: '', address: '', taxId: '', status: 'active' });
  assert.equal(client.display_name, 'Acme Survey');
  assert.equal(client.email, 'finance@acme.example');
  const project = buildProjectPayload({ userId: 'admin-1', clientId: 'client-1', name: 'Topographic survey', code: '', amount: 12500, currency: 'inr', status: 'active', startDate: '2026-09-01', targetDate: '2026-10-01', notes: '' });
  assert.equal(project.currency_code, 'INR');
  assert.equal(project.contract_amount, 12500);
  const milestone = buildMilestonePayload({ userId: 'admin-1', projectId: 'project-1', name: 'Field survey', amount: 5000, dueDate: '2026-09-30', sequence: 1 });
  assert.equal(milestone.expected_amount, 5000);
  const payment = buildClientPaymentPayload({ userId: 'employee-1', projectId: 'project-1', milestoneId: '', paidOn: '2026-10-17', amount: 123.456, method: 'upi', reference: ' UTR-1 ', note: '', today: new Date('2026-10-17T08:00:00Z') });
  assert.deepEqual({ amount: payment.amount, milestone_id: payment.milestone_id, reference: payment.reference }, { amount: 123.46, milestone_id: null, reference: 'UTR-1' });
  assert.throws(() => buildClientPayload({ userId: 'admin-1', name: ' ', contactName: '', email: '', phone: '', address: '', taxId: '', status: 'active' }), /Client name is required/);
  assert.throws(() => buildProjectPayload({ userId: 'admin-1', clientId: 'client-1', name: 'Project', code: '', amount: 1, currency: 'US', status: 'active', startDate: '', targetDate: '', notes: '' }), /3-letter currency/);
  assert.throws(() => buildProjectPayload({ userId: 'admin-1', clientId: 'client-1', name: 'Project', code: '', amount: 1, currency: 'INR', status: 'active', startDate: '2026-10-02', targetDate: '2026-10-01', notes: '' }), /on or after/);
  assert.throws(() => buildMilestonePayload({ userId: 'admin-1', projectId: 'project-1', name: 'Milestone', amount: 0, dueDate: '', sequence: 1 }), /greater than zero/);
  assert.throws(() => buildClientPaymentPayload({ userId: 'employee-1', projectId: 'project-1', milestoneId: '', paidOn: '2026-02-30', amount: 100, method: 'upi', reference: '', note: '' }), /valid payment date/);
  assert.throws(() => buildClientPaymentPayload({ userId: 'employee-1', projectId: 'project-1', milestoneId: '', paidOn: '2026-10-18', amount: 100, method: 'upi', reference: '', note: '', today: new Date('2026-10-17T08:00:00Z') }), /cannot be in the future/);
});

test('admin navigation includes all modules except invoices and survey reports', () => {
  const admin = { role: 'admin', is_active: true };
  assert.equal(canViewModule(admin, { key: 'dashboard' }), true);
  assert.equal(canViewModule(admin, { key: 'clients' }), true);
  for (const key of ['attendance', 'leave', 'flat_expense', 'office_expense', 'payroll', 'payslip', 'holidays', 'team']) {
    assert.equal(canViewModule(admin, { key }), true, `${key} should be visible to admins`);
  }
  assert.equal(canViewModule(admin, { key: 'documents', permission: 'invoice' }), false);
  assert.equal(canViewModule(admin, { key: 'surveys', permission: 'survey' }), false);
  assert.equal(canEditModule(admin, attendance), true);
  assert.equal(canEditModule(admin, { key: 'clients' }), true);
  assert.equal(canEditModule(admin, { key: 'documents' }), false);
  assert.equal(canEditModule(admin, { key: 'surveys' }), false);
});

test('legacy invoice and survey permission columns remain explicit for employees', () => {
  assert.equal(canViewModule({ role: 'employee', is_active: true, can_view_invoices: true }, { key: 'documents', permission: 'invoice' }), true);
  assert.equal(canViewModule({ role: 'employee', is_active: true, can_view_surveys: false }, { key: 'surveys', permission: 'survey' }), false);
});

test('legacy invoice and survey payloads map to safe owner drafts', () => {
  const invoice = { schema: 'SAGT-DOC-STUDIO-V10.0', type: 'quotation', documentId: 'doc-1', title: '  QUOTATION  ', number: 'QUO-001', client: '  Acme  ', items: [] };
  assert.equal(matchesEditor('documents', invoice), true);
  assert.equal(editorIdentity('documents', invoice), 'doc-1');
  assert.deepEqual(documentFields('documents', invoice), { module: 'quotation', title: 'QUOTATION', document_number: 'QUO-001', client_name: 'Acme' });
  assert.equal(matchesEditor('documents', { ...invoice, schema: 'untrusted' }), false);

  const survey = { app: 'SAGT_A4_SURVEY_REPORT', editorId: 'survey-1', data: { documentNo: 'DOC-9', reportNo: 'RPT-9', applicant: '  Example Client  ' } };
  assert.equal(matchesEditor('surveys', survey), true);
  assert.equal(editorIdentity('surveys', survey), 'survey-1');
  assert.deepEqual(documentFields('surveys', survey), { module: 'survey', title: 'Survey Report · Example Client', document_number: 'DOC-9', client_name: 'Example Client' });

  const row = { id: 'record-1', status: 'draft', created_by: 'owner-1', content: invoice };
  assert.equal(canOpenDraft('documents', row, 'owner-1'), true);
  assert.equal(canOpenDraft('documents', { ...row, status: 'finalized' }, 'owner-1'), false);
  assert.equal(canOpenDraft('documents', row, 'other-user'), false);
});

test('private numeric pay fields are redacted before formatting for employees', () => {
  assert.equal(formatCell('monthly_salary', 125000, 'employee'), 'Restricted');
  assert.notEqual(formatCell('monthly_salary', 125000, 'admin'), 'Restricted');
});

test('invalid dates and non-finite currency values render safely', () => {
  assert.equal(formatCell('work_date', 'not-a-date', 'employee'), '—');
  assert.equal(formatCell('amount', Number.NaN, 'employee'), '—');
});

test('Supabase URL is restricted to the existing SAGT - Verify project', () => {
  assert.equal(isAllowedSupabaseUrl('https://gewvwdfolaaipkpbqpmr.supabase.co'), true);
  assert.equal(isAllowedSupabaseUrl('http://gewvwdfolaaipkpbqpmr.supabase.co'), false);
  assert.equal(isAllowedSupabaseUrl('https://sagt-bms.supabase.co'), false);
});

test('only publishable or anon-role keys are accepted by the browser client', () => {
  const anonPayload = Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url');
  const servicePayload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
  assert.equal(isBrowserSafeSupabaseKey('sb_publishable_public_test_key'), true);
  assert.equal(isBrowserSafeSupabaseKey(`header.${anonPayload}.signature`), true);
  assert.equal(isBrowserSafeSupabaseKey(`header.${servicePayload}.signature`), false);
  assert.equal(isBrowserSafeSupabaseKey('sb_secret_test_key'), false);
});
