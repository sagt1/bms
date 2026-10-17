import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { canEditModule, getAttendanceCapabilities } from '../lib/permissions';
import { attendanceElapsedMinutes, formatAttendanceTime, formatElapsedSpan, mapEmployeeDisplayNames, summarizeAttendanceRecords } from '../lib/attendance-summary';
import type { AttendanceRecordInput } from '../lib/attendance-summary';
import { summarizePayrollDays } from '../lib/payroll-summary';
import type { PayrollDaySummary } from '../lib/payroll-summary';
import { buildCorrectionPayload, buildExpensePayload, buildHolidayPayload, buildLeavePayload, currentPayrollMonth, normalizeCompletedPayrollMonth, normalizeNonNegativeAmount, normalizePayrollMonth, previousCompletedPayrollMonth } from '../lib/workflow-validation';
import ClientPaymentsWorkflow from './ClientPaymentsWorkflow';
import LegacyDocumentWorkflow from './LegacyDocumentWorkflow';

type AppProfile = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  [key: string]: unknown;
};

type ModuleInfo = { key: string; permission?: string; navigation?: string };
type Row = Record<string, unknown>;

type WorkflowPanelProps = {
  module: ModuleInfo;
  profile: AppProfile;
  rows: Row[];
  onRefresh: () => Promise<void>;
  onNotify: (message: string) => void;
};

function cleanError() {
  return 'The change could not be saved. Check your access or try again later.';
}

function todayLocal() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function monthLocal() {
  return todayLocal().slice(0, 7);
}

function currency(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount) : '—';
}

export default function WorkflowPanel({ module, profile, rows, onRefresh, onNotify }: WorkflowPanelProps) {
  const editable = canEditModule(profile, module);
  const isAdmin = profile.role === 'admin';

  if (module.key === 'attendance') return <AttendanceWorkflow profile={profile} onRefresh={onRefresh} onNotify={onNotify} />;
  if (module.key === 'leave') return <LeaveWorkflow editable={editable} isAdmin={isAdmin} profile={profile} rows={rows} onRefresh={onRefresh} onNotify={onNotify} />;
  if (module.key === 'flat_expense' || module.key === 'office_expense') return <ExpenseWorkflow editable={editable} isAdmin={isAdmin} profile={profile} moduleKey={module.key} rows={rows} onRefresh={onRefresh} onNotify={onNotify} />;
  if (module.key === 'holidays') return <HolidayWorkflow editable={editable} isAdmin={isAdmin} profile={profile} rows={rows} onRefresh={onRefresh} onNotify={onNotify} />;
  if (module.key === 'payroll') return <PayrollWorkflow profile={profile} onRefresh={onRefresh} onNotify={onNotify} />;
  if (module.key === 'payslip') return <PayslipWorkflow profile={profile} />;
  if (module.key === 'clients') return <ClientPaymentsWorkflow profile={profile} editable={editable} />;
  if (module.key === 'team') return <TeamWorkflow profile={profile} onNotify={onNotify} />;
  if (module.key === 'documents' || module.key === 'surveys') return <LegacyDocumentWorkflow key={module.key} editable={editable} profile={profile} moduleKey={module.key} rows={rows} onRefresh={onRefresh} />;
  return null;
}

function AttendanceWorkflow({ profile, onRefresh, onNotify }: Omit<WorkflowPanelProps, 'module' | 'rows'>) {
  const capabilities = getAttendanceCapabilities(profile);
  const { canView, canRecordAttendance, canRequestCorrection, canReviewCorrections, isAdmin } = capabilities;
  const [busy, setBusy] = useState(false);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRecordInput[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState('');
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});
  const [employeeNamesLoading, setEmployeeNamesLoading] = useState(false);
  const [todayRecord, setTodayRecord] = useState<AttendanceRecordInput | null>(null);
  const [todayRecordLoaded, setTodayRecordLoaded] = useState(false);
  const [month, setMonth] = useState(monthLocal());
  const [requests, setRequests] = useState<Row[]>([]);
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [workDate, setWorkDate] = useState(todayLocal());
  const [kind, setKind] = useState('missed_check_in');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const attendanceRequest = useRef(0);
  const correctionRequest = useRef(0);
  const employeeNamesRequest = useRef(0);

  const loadEmployeeNames = useCallback(async () => {
    const requestId = ++employeeNamesRequest.current;
    if (!supabase || !isAdmin) {
      setEmployeeNames({});
      setEmployeeNamesLoading(false);
      return;
    }
    setEmployeeNamesLoading(true);
    try {
      const { data, error } = await supabase.from('profiles')
        .select('id,full_name').eq('role', 'employee').order('full_name').limit(1000);
      if (error) throw error;
      if (requestId === employeeNamesRequest.current) {
        setEmployeeNames(mapEmployeeDisplayNames((data ?? []) as { id: string; full_name: string | null }[]));
      }
    } catch {
      if (requestId === employeeNamesRequest.current) setEmployeeNames({});
    } finally {
      if (requestId === employeeNamesRequest.current) setEmployeeNamesLoading(false);
    }
  }, [isAdmin]);

  function employeeName(userId: string) {
    return employeeNames[userId] ?? (employeeNamesLoading ? 'Loading name…' : 'Employee name unavailable');
  }

  const loadAttendanceRecords = useCallback(async () => {
    const requestId = ++attendanceRequest.current;
    if (!supabase || !canView) {
      setAttendanceRows([]);
      setAttendanceLoading(false);
      return;
    }
    const [year, monthNumber] = month.split('-').map(Number);
    const start = `${month}-01`;
    const end = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
    setAttendanceLoading(true);
    setAttendanceError('');
    try {
      const allRows: AttendanceRecordInput[] = [];
      for (let from = 0; ; from += 1000) {
        let query = supabase.from('attendance_records')
          .select('user_id,work_date,check_in,check_out,status')
          .gte('work_date', start).lt('work_date', end)
          .order('work_date', { ascending: false }).order('user_id', { ascending: true });
        if (!isAdmin) query = query.eq('user_id', profile.id);
        const { data, error } = await query.range(from, from + 999);
        if (error) throw error;
        const pageRows = (data ?? []) as unknown as AttendanceRecordInput[];
        allRows.push(...pageRows);
        if (pageRows.length < 1000) break;
      }
      if (requestId === attendanceRequest.current) setAttendanceRows(allRows);
    } catch {
      if (requestId === attendanceRequest.current) {
        setAttendanceRows([]);
        setAttendanceError('Attendance records could not be loaded. Check your attendance access and refresh.');
      }
    } finally {
      if (requestId === attendanceRequest.current) setAttendanceLoading(false);
    }
  }, [canView, isAdmin, month, profile.id]);

  const loadTodayRecord = useCallback(async () => {
    if (isAdmin) { setTodayRecord(null); setTodayRecordLoaded(true); return; }
    if (!supabase || !canView) { setTodayRecordLoaded(false); return; }
    setTodayRecordLoaded(false);
    try {
      const { data, error } = await supabase.from('attendance_records')
        .select('user_id,work_date,check_in,check_out,status')
        .eq('user_id', profile.id).eq('work_date', todayLocal()).maybeSingle();
      if (error) throw error;
      setTodayRecord((data ?? null) as unknown as AttendanceRecordInput | null);
      setTodayRecordLoaded(true);
    } catch {
      setTodayRecord(null);
      setTodayRecordLoaded(false);
      setAttendanceError('Today’s attendance status could not be checked. Refresh before recording a time.');
    }
  }, [canView, isAdmin, profile.id]);

  const loadRequests = useCallback(async () => {
    const requestId = ++correctionRequest.current;
    if (!supabase || !canView) { setRequests([]); return; }
    setRequestLoading(true);
    setRequestError('');
    try {
      const allRows: Row[] = [];
      for (let from = 0; ; from += 1000) {
        let query = supabase.from('attendance_correction_requests')
          .select('id,user_id,work_date,correction_type,requested_check_in,requested_check_out,reason,status,admin_note,created_at')
          .order('created_at', { ascending: false });
        if (isAdmin) query = query.eq('status', 'pending');
        else query = query.eq('user_id', profile.id);
        const { data, error } = await query.range(from, from + 999);
        if (error) throw error;
        const pageRows = (data ?? []) as unknown as Row[];
        allRows.push(...pageRows);
        if (pageRows.length < 1000) break;
      }
      if (requestId === correctionRequest.current) setRequests(allRows);
    } catch {
      if (requestId === correctionRequest.current) {
        setRequests([]);
        setRequestError('Correction requests could not be loaded. Check your attendance access and refresh.');
      }
    } finally {
      if (requestId === correctionRequest.current) setRequestLoading(false);
    }
  }, [canView, isAdmin, profile.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadAttendanceRecords(); void loadRequests(); void loadTodayRecord(); void loadEmployeeNames(); }, 0);
    return () => { window.clearTimeout(timer); attendanceRequest.current += 1; correctionRequest.current += 1; employeeNamesRequest.current += 1; };
  }, [loadAttendanceRecords, loadEmployeeNames, loadRequests, loadTodayRecord]);

  async function recordAttendance(action: 'check_in' | 'check_out') {
    if (!supabase || !canRecordAttendance || !todayRecordLoaded || busy) return;
    if (action === 'check_in' && todayRecord?.check_in) return;
    if (action === 'check_out' && (!todayRecord?.check_in || todayRecord.check_out)) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc(action === 'check_in' ? 'sagt_attendance_check_in' : 'sagt_attendance_check_out');
      if (error) throw error;
      const result = data && typeof data === 'object' ? data as Record<string, unknown> : {};
      const recordedAt = typeof result.recorded_at === 'string' ? result.recorded_at : new Date().toISOString();
      setTodayRecord((current) => ({ user_id: profile.id, work_date: todayLocal(), check_in: action === 'check_in' ? recordedAt : current?.check_in ?? null, check_out: action === 'check_out' ? recordedAt : current?.check_out ?? null, status: current?.status ?? 'present' }));
      onNotify(action === 'check_in' ? 'Check-in recorded using server time.' : 'Check-out recorded using server time.');
      await Promise.all([loadAttendanceRecords(), loadTodayRecord(), onRefresh()]);
    } catch { onNotify(cleanError()); }
    finally { setBusy(false); }
  }

  async function submitCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !canRequestCorrection || busy) return;
    setBusy(true);
    try {
      const payload = buildCorrectionPayload({ userId: profile.id, workDate, correctionType: kind, checkIn, checkOut, reason });
      const { error } = await supabase.from('attendance_correction_requests').insert(payload);
      if (error) throw error;
      setReason(''); setCheckIn(''); setCheckOut('');
      onNotify('Attendance correction request sent for administrator review.');
      await loadRequests();
    } catch (error) { onNotify(error instanceof Error && /Enter|must be|Reason|later|future/.test(error.message) ? error.message : cleanError()); }
    finally { setBusy(false); }
  }

  async function decideRequest(id: string, decision: 'approved' | 'rejected') {
    if (!supabase || !canReviewCorrections || !window.confirm(`Confirm ${decision} for this attendance correction?`)) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('sagt_decide_employee_request', {
        p_table: 'attendance_correction_requests', p_request_id: id, p_decision: decision, p_admin_note: notes[id]?.trim() || undefined,
      });
      if (error) throw error;
      onNotify(`Correction request ${decision}.`);
      await Promise.all([loadRequests(), loadAttendanceRecords(), onRefresh()]);
    } catch { onNotify(cleanError()); }
    finally { setBusy(false); }
  }

  const summary = summarizeAttendanceRecords(attendanceRows, month);
  const today = todayLocal();
  const canCheckIn = canRecordAttendance && todayRecordLoaded && !todayRecord?.check_in;
  const canCheckOut = canRecordAttendance && todayRecordLoaded && Boolean(todayRecord?.check_in) && !todayRecord?.check_out;
  const showCorrectionForm = canRequestCorrection;
  const hasOpenShift = Boolean(todayRecord?.check_in && !todayRecord.check_out);

  return <section className="workflow-stack">
    {canRecordAttendance && <section className="panel workflow-panel attendance-actions-panel">
      <div><h3>Today’s attendance</h3><p className="muted">Times are recorded by the server in Asia/Kolkata. Administrators review records and cannot use employee clock controls.</p></div>
      {todayRecordLoaded ? <div className="attendance-clock-status">{todayRecord?.check_in ? <span>Checked in at <b>{formatAttendanceTime(todayRecord.check_in)}</b></span> : <span>No check-in recorded for today.</span>}{todayRecord?.check_out && <span>Checked out at <b>{formatAttendanceTime(todayRecord.check_out)}</b></span>}</div> : <p className="small-text muted">Checking today’s attendance status…</p>}
      <div className="action-row"><button className="btn primary" type="button" disabled={busy || !canCheckIn} onClick={() => void recordAttendance('check_in')}>{todayRecord?.check_in ? 'Checked in' : 'Check in'}</button><button className="btn" type="button" disabled={busy || !canCheckOut} onClick={() => void recordAttendance('check_out')}>{todayRecord?.check_out ? 'Checked out' : 'Check out'}</button></div>
      {!todayRecordLoaded && attendanceError && <p className="alert error" role="alert">{attendanceError}</p>}
      {hasOpenShift && <p className="notice">Your check-out is still open. Complete it before leaving; payroll keeps an incomplete day pending for review.</p>}
    </section>}

    {showCorrectionForm && <section className="panel workflow-panel">
      <h3>Request an attendance correction</h3>
      <p className="muted">Submit past or today’s missed times for administrator review. Future dates and future times are rejected.</p>
      <form className="workflow-form" onSubmit={submitCorrection}>
        <label>Attendance date<input type="date" required max={today} value={workDate} onChange={(event) => setWorkDate(event.target.value)} /></label>
        <label>Correction type<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="missed_check_in">Missed check-in</option><option value="missed_check_out">Missed check-out</option><option value="both">Both check-in and check-out</option></select></label>
        {(kind === 'missed_check_in' || kind === 'both') && <label>Requested check-in<input type="time" required value={checkIn} onChange={(event) => setCheckIn(event.target.value)} /></label>}
        {(kind === 'missed_check_out' || kind === 'both') && <label>Requested check-out<input type="time" required value={checkOut} onChange={(event) => setCheckOut(event.target.value)} /></label>}
        <label className="wide-field">Reason<textarea maxLength={1000} required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <button className="btn primary" disabled={busy}>Send request</button>
      </form>
    </section>}

    <section className="panel workflow-panel">
      <div className="panel-header"><div><h3>{isAdmin ? 'Team attendance tracking' : 'My attendance tracking'}</h3><p>{isAdmin ? 'All employee records allowed by the database are shown.' : 'Only your own attendance records are shown.'} Elapsed spans do not subtract breaks.</p></div><div className="attendance-toolbar"><label className="month-label">Month<input type="month" max={monthLocal()} value={month} onChange={(event) => { if (/^\d{4}-\d{2}$/.test(event.target.value) && event.target.value <= monthLocal()) setMonth(event.target.value); }} /></label><button className="btn secondary" type="button" disabled={attendanceLoading || requestLoading} onClick={() => { void loadAttendanceRecords(); void loadRequests(); void loadTodayRecord(); }}>Refresh</button></div></div>
      <div className="attendance-summary-grid">
        <div className="stat-card"><span className="stat-top">{isAdmin ? 'Employees with records' : 'Recorded days'}</span><strong>{isAdmin ? summary.employeeCount : summary.recordedEntries}</strong><small>Selected month</small></div>
        <div className="stat-card"><span className="stat-top">Present equivalents</span><strong>{summary.presentDays.toFixed(1)}</strong><small>Includes half days as 0.5</small></div>
        <div className="stat-card"><span className="stat-top">Completed shifts</span><strong>{summary.completedShifts}</strong><small>Both times recorded</small></div>
        <div className="stat-card"><span className="stat-top">Open check-outs</span><strong>{summary.openCheckouts}</strong><small>{summary.pendingDays} day(s) pending review</small></div>
        <div className="stat-card"><span className="stat-top">Marked absent</span><strong>{summary.absentDays}</strong><small>Explicit attendance status only</small></div>
      </div>
      <p className="small-text muted">No absence is inferred from a missing attendance record here. Payroll calculates scheduled absences only after the month ends, excluding Sundays and configured company holidays.</p>
      {attendanceError && <div className="alert error" role="alert">{attendanceError}</div>}
      <div className="table-wrap"><table><thead><tr><th>Date</th>{isAdmin && <th>Employee</th>}<th>Check-in</th><th>Check-out</th><th>Elapsed span</th><th>Status</th></tr></thead><tbody>
        {attendanceLoading ? <tr><td colSpan={isAdmin ? 6 : 5}>Loading attendance…</td></tr> : attendanceRows.length === 0 ? <tr><td colSpan={isAdmin ? 6 : 5}>{isAdmin ? 'No team attendance records in this month.' : 'No attendance records for this month.'}</td></tr> : attendanceRows.map((row, index) => <tr key={`${row.user_id}-${row.work_date}-${index}`}><td>{row.work_date}</td>{isAdmin && <td>{employeeName(row.user_id)}</td>}<td>{formatAttendanceTime(row.check_in)}</td><td>{formatAttendanceTime(row.check_out)}</td><td>{formatElapsedSpan(attendanceElapsedMinutes(row.check_in, row.check_out))}</td><td>{String(row.status).replaceAll('_', ' ')}</td></tr>)}
      </tbody></table></div>
      {summary.invalidEntries > 0 && <p className="payroll-mismatch">{summary.invalidEntries} attendance entry(ies) have missing or invalid time values and need administrator review.</p>}
      {summary.duplicateDays > 0 && <p className="payroll-mismatch">{summary.duplicateDays} duplicate employee/day row(s) were omitted from the summary.</p>}
    </section>

    <section className="panel workflow-panel">
      <div className="panel-header"><div><h3>{isAdmin ? 'Pending correction approvals' : 'My correction requests'}</h3><p>{isAdmin ? 'Review pending requests. Approval updates the attendance record through the existing administrator-only RPC.' : 'Your own requests and their decision status.'}</p></div><button className="btn secondary" type="button" disabled={busy || requestLoading} onClick={() => void loadRequests()}>Refresh</button></div>
      {requestError && <div className="alert error" role="alert">{requestError}</div>}
      <div className="table-wrap"><table><thead><tr><th>Date</th>{isAdmin && <th>Employee</th>}<th>Type</th><th>Requested times</th><th>Reason</th><th>Status</th>{isAdmin && <th>Decision</th>}</tr></thead><tbody>
        {requestLoading ? <tr><td colSpan={isAdmin ? 7 : 5}>Loading correction requests…</td></tr> : requests.length === 0 ? <tr><td colSpan={isAdmin ? 7 : 5}>{isAdmin ? 'No pending correction approvals.' : 'No correction requests.'}</td></tr> : requests.map((row) => <tr key={String(row.id)}><td>{String(row.work_date)}</td>{isAdmin && <td>{employeeName(String(row.user_id))}</td>}<td>{String(row.correction_type).replaceAll('_', ' ')}</td><td>{row.requested_check_in ? formatAttendanceTime(String(row.requested_check_in)) : '—'} / {row.requested_check_out ? formatAttendanceTime(String(row.requested_check_out)) : '—'}</td><td className="wrap-cell">{String(row.reason)}</td><td>{String(row.status)}</td>{isAdmin && <td><div className="decision-stack"><input aria-label="Decision note" maxLength={1000} placeholder="Optional note" value={notes[String(row.id)] ?? ''} onChange={(event) => setNotes({ ...notes, [String(row.id)]: event.target.value })} /><div className="action-row"><button className="btn primary" type="button" disabled={busy || !canReviewCorrections} onClick={() => void decideRequest(String(row.id), 'approved')}>Approve</button><button className="btn" type="button" disabled={busy || !canReviewCorrections} onClick={() => void decideRequest(String(row.id), 'rejected')}>Reject</button></div></div></td>}</tr>)}
      </tbody></table></div>
    </section>
  </section>;
}

function LeaveWorkflow({ editable, isAdmin, profile, rows, onRefresh, onNotify }: Omit<WorkflowPanelProps, 'module'> & { editable: boolean; isAdmin: boolean }) {
  const [busy, setBusy] = useState(false);
  const [leaveType, setLeaveType] = useState('casual');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return; setBusy(true);
    try {
      const payload = buildLeavePayload({ userId: profile.id, leaveType, startDate, endDate, reason });
      const { error } = await supabase.from('leave_requests').insert(payload);
      if (error) throw error;
      setReason(''); setStartDate(''); setEndDate(''); onNotify('Leave request submitted for administrator review.'); await onRefresh();
    } catch (error) { onNotify(error instanceof Error && (error.message.includes('required') || error.message.includes('valid') || error.message.includes('date') || error.message.includes('characters')) ? error.message : cleanError()); }
    finally { setBusy(false); }
  }

  async function decide(id: string, decision: 'approved' | 'rejected') {
    if (!supabase || !window.confirm(`Confirm ${decision} for this leave request?`)) return; setBusy(true);
    try {
      const { error } = await supabase.rpc('sagt_decide_employee_request', { p_table: 'leave_requests', p_request_id: id, p_decision: decision, p_admin_note: notes[id]?.trim() || undefined });
      if (error) throw error; onNotify(`Leave request ${decision}.`); await onRefresh();
    } catch { onNotify(cleanError()); }
    finally { setBusy(false); }
  }

  return <section className="workflow-stack">
    {editable && !isAdmin && <section className="panel workflow-panel"><h3>Submit a leave request</h3><form className="workflow-form" onSubmit={submit}>
      <label>Leave type<select value={leaveType} onChange={(event) => setLeaveType(event.target.value)}><option value="casual">Casual</option><option value="sick">Sick</option><option value="unpaid">Unpaid</option><option value="other">Other</option></select></label>
      <label>From<input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>To<input type="date" required value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
      <label className="wide-field">Reason<textarea maxLength={1000} required value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="btn primary" disabled={busy}>Submit request</button>
    </form></section>}
    {isAdmin && <section className="panel workflow-panel"><h3>Pending leave decisions</h3><div className="table-wrap"><table><thead><tr><th>Employee ID</th><th>Dates</th><th>Type</th><th>Reason</th><th>Decision</th></tr></thead><tbody>
      {rows.filter((row) => row.status === 'pending').length === 0 ? <tr><td colSpan={5}>No pending leave requests.</td></tr> : rows.filter((row) => row.status === 'pending').map((row) => <tr key={String(row.id)}><td>{String(row.user_id)}</td><td>{String(row.start_date)} – {String(row.end_date)}</td><td>{String(row.leave_type)}</td><td className="wrap-cell">{String(row.reason)}</td><td><div className="decision-stack"><input aria-label="Decision note" maxLength={1000} placeholder="Optional note" value={notes[String(row.id)] ?? ''} onChange={(event) => setNotes({ ...notes, [String(row.id)]: event.target.value })} /><div className="action-row"><button className="btn primary" disabled={busy} type="button" onClick={() => void decide(String(row.id), 'approved')}>Approve</button><button className="btn" disabled={busy} type="button" onClick={() => void decide(String(row.id), 'rejected')}>Reject</button></div></div></td></tr>)}
    </tbody></table></div></section>}
  </section>;
}

function ExpenseWorkflow({ editable, isAdmin, profile, moduleKey, rows, onRefresh, onNotify }: Omit<WorkflowPanelProps, 'module'> & { editable: boolean; isAdmin: boolean; moduleKey: 'flat_expense' | 'office_expense' }) {
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayLocal());
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('unpaid');
  const [editingId, setEditingId] = useState('');
  const categories = moduleKey === 'flat_expense' ? ['Rent / EMI', 'Electricity Bill', 'Construction Repairs', 'New Equipment', 'Other'] : ['PC & PC Accessories', 'Network & Accessories', 'CCTV & Accessories', 'Office Supplies', 'Internet / Telephone', 'Repairs & Maintenance', 'Travel', 'Other'];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return; setBusy(true);
    try {
      const payload = buildExpensePayload({ userId: profile.id, module: moduleKey, category, expenseDate, amount: Number(amount), description, paymentMethod, paymentStatus });
      const result = editingId
        ? await supabase.from('expense_records').update({ ...payload, submitted_by: profile.id }).eq('id', editingId).eq('submitted_by', profile.id).eq('approval_status', 'pending').select('id').maybeSingle()
        : await supabase.from('expense_records').insert(payload).select('id').single();
      if (result.error || !result.data) throw result.error ?? new Error('No matching pending record.');
      setEditingId(''); setAmount(''); setDescription(''); onNotify(editingId ? 'Pending expense updated.' : 'Expense submitted for approval. Receipt uploads remain disabled until a private bucket is confirmed.'); await onRefresh();
    } catch (error) { onNotify(error instanceof Error && /required|valid|characters|greater than zero/.test(error.message) ? error.message : cleanError()); }
    finally { setBusy(false); }
  }

  async function review(id: string, approval: 'approved' | 'rejected') {
    if (!supabase || !window.confirm(`Confirm ${approval} for this expense?`)) return; setBusy(true);
    try {
      const note = window.prompt('Optional review note:')?.trim() || null;
      const { error } = await supabase.from('expense_records').update({ approval_status: approval, reviewer_id: profile.id, reviewed_at: new Date().toISOString(), review_note: note }).eq('id', id).eq('approval_status', 'pending');
      if (error) throw error; onNotify(`Expense ${approval}.`); await onRefresh();
    } catch { onNotify(cleanError()); }
    finally { setBusy(false); }
  }

  return <section className="workflow-stack">
    {editable && <section className="panel workflow-panel"><h3>{editingId ? 'Edit pending expense' : 'Submit an expense'}</h3><p className="muted">New entries start as pending. Receipt uploads are unavailable until the existing project has a confirmed private storage bucket and policies.</p><form className="workflow-form" onSubmit={submit}>
      <label>Category<select required value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Select a category</option>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Expense date<input type="date" required value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /></label><label>Amount (₹)<input type="number" min="0.01" max="1000000000" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="">Not specified</option><option>Cash</option><option>UPI</option><option>Bank transfer</option><option>Card</option><option>Cheque</option></select></label><label>Payment status<select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}><option value="unpaid">Unpaid</option><option value="paid">Paid</option></select></label>
      <label className="wide-field">Description<textarea maxLength={2000} required value={description} onChange={(event) => setDescription(event.target.value)} /></label><div className="action-row"><button className="btn primary" disabled={busy}>{editingId ? 'Save changes' : 'Submit expense'}</button>{editingId && <button className="btn" type="button" onClick={() => { setEditingId(''); setCategory(''); setAmount(''); setDescription(''); }}>Cancel edit</button>}</div>
    </form>{rows.filter((row) => row.submitted_by === profile.id && row.approval_status === 'pending').length > 0 && <div className="table-wrap"><h4>Your pending expenses</h4><table><thead><tr><th>Date</th><th>Category</th><th>Amount</th><th>Action</th></tr></thead><tbody>{rows.filter((row) => row.submitted_by === profile.id && row.approval_status === 'pending').map((row) => <tr key={String(row.id)}><td>{String(row.expense_date)}</td><td>{String(row.category)}</td><td>{currency(row.amount)}</td><td><button className="btn secondary" type="button" onClick={() => { setEditingId(String(row.id)); setCategory(String(row.category)); setExpenseDate(String(row.expense_date)); setAmount(String(row.amount)); setDescription(String(row.description)); setPaymentMethod(String(row.payment_method ?? '')); setPaymentStatus(String(row.payment_status)); }}>Edit pending item</button></td></tr>)}</tbody></table></div>}</section>}
    {isAdmin && <section className="panel workflow-panel"><h3>Pending expense reviews</h3><div className="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Amount</th><th>Description</th><th>Decision</th></tr></thead><tbody>
      {rows.filter((row) => row.approval_status === 'pending').length === 0 ? <tr><td colSpan={5}>No pending expenses.</td></tr> : rows.filter((row) => row.approval_status === 'pending').map((row) => <tr key={String(row.id)}><td>{String(row.expense_date)}</td><td>{String(row.category)}</td><td>{currency(row.amount)}</td><td className="wrap-cell">{String(row.description)}</td><td><div className="action-row"><button className="btn primary" disabled={busy} type="button" onClick={() => void review(String(row.id), 'approved')}>Approve</button><button className="btn" disabled={busy} type="button" onClick={() => void review(String(row.id), 'rejected')}>Reject</button></div></td></tr>)}
    </tbody></table></div></section>}
  </section>;
}

function HolidayWorkflow({ editable, isAdmin, profile, rows, onRefresh, onNotify }: Omit<WorkflowPanelProps, 'module'> & { editable: boolean; isAdmin: boolean }) {
  const [busy, setBusy] = useState(false); const [date, setDate] = useState(''); const [name, setName] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return; setBusy(true);
    try { const payload = buildHolidayPayload({ userId: profile.id, date, name }); const { error } = await supabase.from('company_holidays').insert(payload); if (error) throw error; setDate(''); setName(''); onNotify('Holiday added.'); await onRefresh(); }
    catch (error) { onNotify(error instanceof Error && /required|valid|characters/.test(error.message) ? error.message : cleanError()); }
    finally { setBusy(false); }
  }
  if (!isAdmin || !editable) return null;
  return <section className="panel workflow-panel"><h3>Add a company holiday</h3><form className="workflow-form compact-form" onSubmit={submit}><label>Date<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Holiday name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><button className="btn primary" disabled={busy}>Save holiday</button></form><p className="small-text muted">Dates are unique in the existing database. Existing holiday rows are not deleted by this interface.</p>{rows.length > 0 && <p className="small-text muted">{rows.length} current holiday record(s).</p>}</section>;
}

function PayrollWorkflow({ profile, onRefresh, onNotify }: Omit<WorkflowPanelProps, 'module' | 'rows'>) {
  const [month, setMonth] = useState(previousCompletedPayrollMonth()); const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<Row[]>([]); const [settings, setSettings] = useState<Record<string, Row>>({});
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [payrollRows, setPayrollRows] = useState<Row[]>([]); const [dailyRows, setDailyRows] = useState<Row[]>([]); const [daySummaries, setDaySummaries] = useState<Record<string, PayrollDaySummary>>({});
  const [selectedPayrollId, setSelectedPayrollId] = useState(''); const [payrollLoading, setPayrollLoading] = useState(false);
  const payrollRequest = useRef(0);
  const isAdmin = profile.role === 'admin';
  const loadSettings = useCallback(async () => {
    if (!supabase || !isAdmin) return;
    try {
      const [peopleResult, settingsResult] = await Promise.all([
        supabase.from('profiles').select('id,full_name,email,is_active').eq('role', 'employee').order('full_name'),
        supabase.from('employee_pay_settings').select('user_id,monthly_salary,monthly_fixed_deduction,monthly_additional_pay,overtime_hourly_rate,advance_repayment_this_month'),
      ]);
      if (peopleResult.error || settingsResult.error) { onNotify(cleanError()); return; }
      const peopleRows = (peopleResult.data ?? []) as Row[]; const settingRows = (settingsResult.data ?? []) as Row[];
      const byId = Object.fromEntries(settingRows.map((row) => [String(row.user_id), row]));
      setPeople(peopleRows); setSettings(byId);
      setDrafts(Object.fromEntries(peopleRows.map((person) => {
        const data = byId[String(person.id)] ?? {};
        return [String(person.id), Object.fromEntries(['monthly_salary','monthly_fixed_deduction','monthly_additional_pay','overtime_hourly_rate','advance_repayment_this_month'].map((field) => [field, String(data[field] ?? 0)]))];
      })));
    } catch { onNotify(cleanError()); }
  }, [isAdmin, onNotify]);
  useEffect(() => { const timer = window.setTimeout(() => { void loadSettings(); }, 0); return () => window.clearTimeout(timer); }, [isAdmin, loadSettings]);

  const loadPayroll = useCallback(async () => {
    if (!supabase || !isAdmin) return;
    const currentRequest = ++payrollRequest.current;
    setPayrollLoading(true);
    try {
      const payrollDate = normalizePayrollMonth(month);
      const resultRows: Row[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('payroll_months').select('id,user_id,payroll_month,monthly_salary,working_days,payable_days,absence_deduction,fixed_deduction,overtime_hours,overtime_pay,additional_pay,advance_repayment,gross_pay,net_pay,pending_attendance_days,status').eq('payroll_month', payrollDate).order('user_id').range(from, from + 999);
        if (error) throw error;
        const pageRows = (data ?? []) as Row[];
        resultRows.push(...pageRows);
        if (pageRows.length < 1000) break;
      }
      if (currentRequest !== payrollRequest.current) return;
      setPayrollRows(resultRows); setDailyRows([]); setSelectedPayrollId(''); setDaySummaries({});
      if (resultRows.length > 0) {
        const monthIds = resultRows.map((row) => String(row.id));
        const dailyData: Row[] = [];
        for (let group = 0; group < monthIds.length; group += 50) {
          const groupIds = monthIds.slice(group, group + 50);
          for (let from = 0; ; from += 1000) {
            const { data: page, error: dailyError } = await supabase.from('payroll_daily')
              .select('payroll_month_id,user_id,day_type,attendance_status,payable_fraction,work_date')
              .in('payroll_month_id', groupIds).order('work_date').order('user_id').range(from, from + 999);
            if (dailyError) throw dailyError;
            const pageRows = (page ?? []) as unknown as Row[];
            dailyData.push(...pageRows);
            if (pageRows.length < 1000) break;
          }
        }
        if (currentRequest !== payrollRequest.current) return;
        setDaySummaries(summarizePayrollDays(dailyData as unknown as Parameters<typeof summarizePayrollDays>[0]));
      }
    } catch (error) { if (currentRequest === payrollRequest.current) { setDaySummaries({}); onNotify(error instanceof Error && error.message.includes('future month') ? error.message : cleanError()); } }
    finally { if (currentRequest === payrollRequest.current) setPayrollLoading(false); }
  }, [isAdmin, month, onNotify]);
  useEffect(() => { const timer = window.setTimeout(() => { void loadPayroll(); }, 0); return () => window.clearTimeout(timer); }, [loadPayroll]);
  useEffect(() => () => { payrollRequest.current += 1; }, []);

  async function loadDaily(row: Row) {
    if (!supabase) return; setSelectedPayrollId(String(row.id));
    try {
      const { data, error } = await supabase.from('payroll_daily').select('work_date,day_type,attendance_status,payable_fraction,overtime_hours,daily_deduction,note').eq('payroll_month_id', String(row.id)).order('work_date').limit(62);
      if (error) onNotify(cleanError()); else setDailyRows((data ?? []) as Row[]);
    } catch { onNotify(cleanError()); }
  }

  async function saveSettings(userId: string) {
    if (!supabase || !isAdmin) return; setBusy(true);
    try {
      const fields = drafts[userId] ?? {};
      const amounts = Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, normalizeNonNegativeAmount(value, field.replaceAll('_', ' '))]));
      const { error } = await supabase.rpc('sagt_save_employee_pay_settings', {
        p_user_id: userId, p_monthly_salary: amounts.monthly_salary!, p_monthly_fixed_deduction: amounts.monthly_fixed_deduction!, p_monthly_additional_pay: amounts.monthly_additional_pay!, p_overtime_hourly_rate: amounts.overtime_hourly_rate!, p_advance_repayment_this_month: amounts.advance_repayment_this_month!,
      });
      if (error) throw error; onNotify('Pay settings saved. Recalculate an eligible draft month to apply the changes.'); await loadSettings();
    } catch (error) { onNotify(error instanceof Error && error.message.includes('must be') ? error.message : cleanError()); }
    finally { setBusy(false); }
  }

  async function runPayroll(action: 'generate' | 'finalize') {
    if (!supabase) return;
    if (month >= currentPayrollMonth()) { onNotify('Payroll can only be calculated or finalized after the selected month has ended. Attendance, Sundays, and configured holidays are then processed for the complete month.'); return; }
    const confirmText = action === 'finalize' ? 'Finalized payroll is locked. Finalize this month now?' : 'Calculate or recalculate draft payroll for this month?';
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const payrollDate = normalizeCompletedPayrollMonth(month);
      const { data, error } = action === 'generate'
        ? await supabase.rpc('sagt_generate_monthly_payroll', { p_month: payrollDate })
        : await supabase.rpc('sagt_finalize_monthly_payroll', { p_month: payrollDate });
      if (error) throw error;
      const result = data && typeof data === 'object' ? data as Record<string, unknown> : {};
      const detail = action === 'generate' && typeof result.employees_processed === 'number'
        ? `Draft payroll calculated for ${result.employees_processed} employee(s); ${String(result.working_days ?? '—')} working days.`
        : action === 'finalize' && typeof result.finalized_employees === 'number'
          ? `Finalized payroll for ${result.finalized_employees} employee(s).`
          : action === 'generate' ? 'Draft payroll calculation completed.' : 'Payroll finalization completed.';
      onNotify(detail); await loadPayroll(); await onRefresh();
    } catch (error) { onNotify(error instanceof Error && error.message.includes('Payroll can only') ? error.message : cleanError()); }
    finally { setBusy(false); }
  }

  return <section className="workflow-stack">
    <section className="panel workflow-panel"><div className="panel-header"><div><h3>Payroll month</h3><p>{isAdmin ? 'Draft generation and finalization use the existing administrator-only RPCs.' : 'Payroll access is limited to the administrator.'}</p></div></div>
      {isAdmin ? <><div className="action-row"><label className="month-label">Month<input type="month" max={monthLocal()} value={month} onChange={(event) => setMonth(event.target.value)} /></label><button className="btn secondary" type="button" disabled={busy || payrollLoading} onClick={() => void loadPayroll()}>Load month</button><button className="btn primary" type="button" disabled={busy || payrollLoading || month >= currentPayrollMonth()} onClick={() => void runPayroll('generate')}>Calculate drafts</button><button className="btn" type="button" disabled={busy || payrollLoading || month >= currentPayrollMonth()} onClick={() => void runPayroll('finalize')}>Finalize month</button></div><p className="small-text muted">Default month is the last completed month. Attendance is counted from saved daily payroll records; Sundays and company holidays are excluded from working days. Add company closure dates in Holidays before calculating.</p></> : <p className="muted">Use Payslips to see your own finalized pay statements.</p>}
    </section>
    {isAdmin && <section className="panel workflow-panel"><div className="panel-header"><div><h3>Monthly payroll records</h3><p>Present days come from saved daily payroll rows; holiday and Sunday rows are shown separately and are excluded from working days.</p></div><span className="count-pill">{payrollLoading ? 'Loading…' : `${payrollRows.length} employees`}</span></div><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Working days</th><th>Present</th><th>Paid leave</th><th>Absent / unpaid leave</th><th>Sundays / holidays</th><th>Payable days</th><th>Absence deduction</th><th>OT hours / pay</th><th>Gross</th><th>Net</th><th>Status</th><th>Daily</th></tr></thead><tbody>
      {payrollRows.length === 0 && !payrollLoading ? <tr><td colSpan={13}>No payroll records for this month. Calculate drafts after the month is complete to populate attendance counts.</td></tr> : payrollRows.map((row) => { const person = people.find((item) => item.id === row.user_id); const summary = daySummaries[String(row.user_id)]; return <tr key={String(row.id)}><td>{String(person?.full_name || person?.email || row.user_id)}</td><td>{String(row.working_days)}</td><td>{summary ? summary.presentDays.toFixed(1) : '—'}</td><td>{summary ? summary.paidLeaveDays.toFixed(1) : '—'}</td><td>{summary ? `${summary.absentDays} / ${summary.unpaidLeaveDays}` : '—'}</td><td>{summary ? `${summary.sundayDays} / ${summary.holidayDays}` : '—'}</td><td>{String(row.payable_days)}</td><td>{currency(row.absence_deduction)}</td><td>{String(row.overtime_hours)} / {currency(row.overtime_pay)}</td><td>{currency(row.gross_pay)}</td><td><b>{currency(row.net_pay)}</b></td><td>{String(row.status)}{Number(row.pending_attendance_days) > 0 ? ` · ${String(row.pending_attendance_days)} pending attendance day(s)` : ''}</td><td><button className="btn secondary" type="button" onClick={() => void loadDaily(row)}>View</button></td></tr>; })}
    </tbody></table></div></section>}
    {isAdmin && selectedPayrollId && <section className="panel workflow-panel"><h3>Daily payroll details</h3><div className="table-wrap"><table><thead><tr><th>Date</th><th>Day</th><th>Attendance</th><th>Payable</th><th>OT hours</th><th>Deduction</th><th>Note</th></tr></thead><tbody>{dailyRows.length === 0 ? <tr><td colSpan={7}>No daily rows returned for this payroll record.</td></tr> : dailyRows.map((row, index) => <tr key={`${String(row.work_date)}-${index}`}><td>{String(row.work_date)}</td><td>{String(row.day_type)}</td><td>{String(row.attendance_status)}</td><td>{String(row.payable_fraction)}</td><td>{String(row.overtime_hours)}</td><td>{currency(row.daily_deduction)}</td><td>{String(row.note || '—')}</td></tr>)}</tbody></table></div></section>}
    {isAdmin && <section className="panel workflow-panel"><h3>Employee pay settings</h3><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Salary</th><th>Fixed deduction</th><th>Additional pay</th><th>OT hourly rate</th><th>Advance repayment</th><th>Action</th></tr></thead><tbody>
      {people.length === 0 ? <tr><td colSpan={7}>No employee profiles found.</td></tr> : people.map((person) => { const id = String(person.id); return <tr key={id}><td>{String(person.full_name || person.email)}{person.is_active === false ? ' (inactive)' : ''}</td>{['monthly_salary','monthly_fixed_deduction','monthly_additional_pay','overtime_hourly_rate','advance_repayment_this_month'].map((field) => <td key={field}><input className="number-input" type="number" min="0" step="0.01" value={drafts[id]?.[field] ?? String(settings[id]?.[field] ?? 0)} onChange={(event) => setDrafts({ ...drafts, [id]: { ...(drafts[id] ?? {}), [field]: event.target.value } })} aria-label={`${field.replaceAll('_', ' ')} for ${String(person.full_name || person.email)}`} /></td>)}<td><button className="btn secondary" disabled={busy} type="button" onClick={() => void saveSettings(id)}>Save</button></td></tr>; })}
    </tbody></table></div></section>}
  </section>;
}

function PayslipWorkflow({ profile }: Omit<WorkflowPanelProps, 'module' | 'rows' | 'onRefresh' | 'onNotify'>) {
  const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(true);
  const [summaries, setSummaries] = useState<Record<string, PayrollDaySummary>>({});
  const [selectedPayslipId, setSelectedPayslipId] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let current = true;
    async function load() {
      if (!supabase) { setLoading(false); return; }
      setLoading(true); setRows([]); setSummaries({}); setSelectedPayslipId(''); setLoadFailed(false);
      try {
        const { data, error } = await supabase.from('payroll_months').select('id,payroll_month,monthly_salary,working_days,payable_days,absence_deduction,fixed_deduction,overtime_hours,overtime_pay,additional_pay,advance_repayment,gross_pay,net_pay,status,finalized_at').eq('user_id', profile.id).eq('status', 'finalized').order('payroll_month', { ascending: false }).limit(36);
        if (error) throw error;
        if (current) {
          const payrollRows = (data ?? []) as Row[];
          setRows(payrollRows); setSummaries({});
          if (payrollRows.length > 0) {
            const monthIds = payrollRows.map((row) => String(row.id)); const dayRows: Row[] = [];
            for (let from = 0; ; from += 1000) {
              const { data: page, error: dailyError } = await supabase.from('payroll_daily')
                .select('payroll_month_id,user_id,day_type,attendance_status,payable_fraction,work_date')
                .eq('user_id', profile.id).in('payroll_month_id', monthIds).order('work_date').range(from, from + 999);
              if (dailyError) throw dailyError;
              const pageRows = (page ?? []) as unknown as Row[]; dayRows.push(...pageRows);
              if (pageRows.length < 1000) break;
            }
            const byMonth: Record<string, PayrollDaySummary> = {};
            for (const row of payrollRows) {
              const monthId = String(row.id);
              const monthRows = dayRows.filter((day) => String(day.payroll_month_id) === monthId);
              const summary = summarizePayrollDays(monthRows as unknown as Parameters<typeof summarizePayrollDays>[0])[profile.id];
              if (summary) byMonth[monthId] = summary;
            }
            if (current) setSummaries(byMonth);
          }
        }
    } catch { if (current) { setRows([]); setSummaries({}); setLoadFailed(true); } }
      finally { if (current) setLoading(false); }
    }
    void load(); return () => { current = false; };
  }, [profile.id]);
  const selectedPayslip = rows.find((row) => String(row.id) === selectedPayslipId);
  const selectedSummary = selectedPayslip ? summaries[String(selectedPayslip.id)] : undefined;
  return <section className="panel workflow-panel"><div className="panel-header"><div><h3>Your finalized payslips</h3><p>Only finalized records for your signed-in profile are requested.</p></div><span className="count-pill">{loading ? 'Loading…' : `${rows.length} payslips`}</span></div>
    {loading ? <div className="loading-state">Loading securely…</div> : rows.length === 0 ? <div className="empty-state"><h3>{loadFailed ? 'Payslips could not be loaded' : 'No published payslips'}</h3><p>{loadFailed ? 'Confirm your account is active and has payslip access, then refresh the workspace.' : 'There are no finalized payroll records available for this account. Admins must calculate and finalize a completed month first.'}</p></div> : <div className="table-wrap"><table><thead><tr><th>Month</th><th>Working days</th><th>Present</th><th>Paid leave</th><th>Absent / unpaid leave</th><th>Sundays / holidays</th><th>Payable days</th><th>Net pay</th><th>Finalized</th><th></th></tr></thead><tbody>{rows.map((row) => { const summary = summaries[String(row.id)]; const isSelected = String(row.id) === selectedPayslipId; return <tr key={String(row.id)}><td>{String(row.payroll_month).slice(0, 7)}</td><td>{String(row.working_days)}{summary && summary.workingDays !== Number(row.working_days) ? <span className="payroll-mismatch" title="Daily records do not match the saved month total"> · Check details</span> : ''}</td><td>{summary ? summary.presentDays.toFixed(1) : '—'}</td><td>{summary ? summary.paidLeaveDays.toFixed(1) : '—'}</td><td>{summary ? `${summary.absentDays} / ${summary.unpaidLeaveDays}` : '—'}</td><td>{summary ? `${summary.sundayDays} / ${summary.holidayDays}` : '—'}</td><td>{String(row.payable_days)}</td><td><b>{currency(row.net_pay)}</b></td><td>{row.finalized_at ? new Date(String(row.finalized_at)).toLocaleDateString() : '—'}</td><td><button className="btn secondary" type="button" onClick={() => setSelectedPayslipId(isSelected ? '' : String(row.id))}>{isSelected ? 'Close' : 'View'}</button></td></tr>; })}</tbody></table></div>}
    {selectedPayslip && <article className="payslip-print-area"><header className="payslip-heading"><div><p className="eyebrow">SHREE ADITYA GEO TECH</p><h2>Salary statement</h2><p>Pay period: {String(selectedPayslip.payroll_month).slice(0, 7)}</p></div><div className="payslip-employee"><b>{profile.full_name || profile.email}</b><span>{profile.email}</span><span>Finalized {selectedPayslip.finalized_at ? new Date(String(selectedPayslip.finalized_at)).toLocaleDateString() : '—'}</span></div></header>
      <div className="payslip-attendance"><span>Working days <b>{String(selectedPayslip.working_days)}</b></span><span>Present days <b>{selectedSummary ? selectedSummary.presentDays.toFixed(1) : '—'}</b></span><span>Paid leave <b>{selectedSummary ? selectedSummary.paidLeaveDays.toFixed(1) : '—'}</b></span><span>Absent / unpaid leave <b>{selectedSummary ? `${selectedSummary.absentDays} / ${selectedSummary.unpaidLeaveDays}` : '—'}</b></span><span>Sundays / holidays <b>{selectedSummary ? `${selectedSummary.sundayDays} / ${selectedSummary.holidayDays}` : '—'}</b></span><span>Payable days <b>{String(selectedPayslip.payable_days)}</b></span></div>
      <div className="payslip-money-grid"><section><h3>Earnings</h3><div><span>Monthly salary</span><b>{currency(selectedPayslip.monthly_salary)}</b></div><div><span>Overtime pay ({String(selectedPayslip.overtime_hours)} hours)</span><b>{currency(selectedPayslip.overtime_pay)}</b></div><div><span>Additional pay</span><b>{currency(selectedPayslip.additional_pay)}</b></div><div className="payslip-total"><span>Gross pay</span><b>{currency(selectedPayslip.gross_pay)}</b></div></section><section><h3>Deductions</h3><div><span>Absence deduction</span><b>{currency(selectedPayslip.absence_deduction)}</b></div><div><span>Fixed deduction</span><b>{currency(selectedPayslip.fixed_deduction)}</b></div><div><span>Advance repayment</span><b>{currency(selectedPayslip.advance_repayment)}</b></div><div className="payslip-total"><span>Total deductions</span><b>{currency(Number(selectedPayslip.absence_deduction) + Number(selectedPayslip.fixed_deduction) + Number(selectedPayslip.advance_repayment))}</b></div></section></div>
      <div className="payslip-net"><span>Net pay</span><b>{currency(selectedPayslip.net_pay)}</b></div><p className="small-text muted">This statement reflects the finalized payroll record. Contact your administrator if you believe a recorded attendance or pay setting is incorrect.</p><button className="btn primary no-print" type="button" onClick={() => window.print()}>Print / Save as PDF</button>
    </article>}
  </section>;
}

const employeeModules = [
  { label: 'Dashboard', view: 'nav_dashboard', edit: null, navigation: null },
  { label: 'Attendance', view: 'can_view_attendance', edit: 'can_edit_attendance', navigation: 'nav_attendance' },
  { label: 'Leave', view: 'can_view_leave', edit: 'can_edit_leave', navigation: 'nav_leave' },
  { label: 'Flat expenses', view: 'can_view_flat_expense', edit: 'can_edit_flat_expense', navigation: 'nav_flat_expense' },
  { label: 'Office expenses', view: 'can_view_office_expense', edit: 'can_edit_office_expense', navigation: 'nav_office_expense' },
  { label: 'Holidays', view: 'can_view_holidays', edit: 'can_edit_holidays', navigation: 'nav_holidays' },
  { label: 'Payslips', view: 'can_view_payslip', edit: null, navigation: 'nav_payslip' },
  { label: 'Invoices and quotations', view: 'can_view_invoices', edit: 'can_edit_invoices', navigation: null },
  { label: 'Survey reports', view: 'can_view_surveys', edit: 'can_edit_surveys', navigation: null },
] as const;

function TeamWorkflow({ profile, onNotify }: Omit<WorkflowPanelProps, 'module' | 'rows' | 'onRefresh'>) {
  const [people, setPeople] = useState<Row[]>([]); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState(''); const [inviteName, setInviteName] = useState('');
  const isAdmin = profile.role === 'admin' && profile.is_active === true;

  const loadPeople = useCallback(async () => {
    if (!supabase || !isAdmin) { setLoading(false); return; }
    try {
      const { data, error } = await supabase.from('profiles').select('id,email,full_name,role,is_active,nav_dashboard,nav_attendance,nav_leave,nav_flat_expense,nav_office_expense,nav_holidays,nav_payslip,can_view_attendance,can_edit_attendance,can_view_leave,can_edit_leave,can_view_flat_expense,can_edit_flat_expense,can_view_office_expense,can_edit_office_expense,can_view_holidays,can_edit_holidays,can_view_payslip,can_view_invoices,can_edit_invoices,can_view_surveys,can_edit_surveys').eq('role', 'employee').order('full_name').limit(500);
      if (error) onNotify(cleanError()); else setPeople((data ?? []) as Row[]);
    } catch { onNotify(cleanError()); }
    finally { setLoading(false); }
  }, [isAdmin, onNotify]);
  useEffect(() => { const timer = window.setTimeout(() => { void loadPeople(); }, 0); return () => window.clearTimeout(timer); }, [loadPeople]);

  async function updatePermissions(person: Row, changes: Record<string, boolean>) {
    if (!supabase || !isAdmin) return;
    const name = String(person.full_name || person.email || 'this employee');
    if (!window.confirm(`Change module access for ${name}? This immediately changes what the employee can open or edit.`)) return;
    setBusy(true);
    try {
      const payload = changes as Database['public']['Tables']['profiles']['Update'];
      const { data, error } = await supabase.from('profiles').update(payload).eq('id', String(person.id)).eq('role', 'employee').select('id').maybeSingle();
      if (error || !data) throw error ?? new Error('No employee profile was updated.');
      onNotify('Employee access updated.'); await loadPeople();
    } catch { onNotify(cleanError()); }
    finally { setBusy(false); }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !isAdmin) return;
    const email = inviteEmail.trim().toLowerCase(); const fullName = inviteName.trim().replace(/\s+/g, ' ');
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || fullName.length > 120) { onNotify('Enter a valid email address and a name up to 120 characters.'); return; }
    if (!window.confirm(`Send a company account invitation to ${email}?`)) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-employee-management', { body: { action: 'invite', email, full_name: fullName } });
      if (error || !data?.ok) throw error ?? new Error('Invitation was not confirmed by the function.');
      setInviteEmail(''); setInviteName(''); onNotify(String(data.message || 'Invitation created.')); await loadPeople();
    } catch { onNotify('Invitation could not be completed. Confirm this app’s origin is allowlisted on the existing Edge Function and review its server logs.'); }
    finally { setBusy(false); }
  }

  async function changeState(person: Row, action: 'deactivate' | 'reactivate') {
    if (!supabase || !isAdmin) return;
    const name = String(person.full_name || person.email || 'this employee');
    const prompt = action === 'deactivate' ? `Deactivate ${name} and block future sign-ins?` : `Reactivate ${name} and restore account sign-in?`;
    if (!window.confirm(prompt)) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-employee-management', { body: { action, user_id: String(person.id) } });
      if (error || !data?.ok) throw error ?? new Error('Account change was not confirmed by the function.');
      onNotify(String(data.message || `Employee ${action === 'deactivate' ? 'deactivated' : 'reactivated'}.`)); await loadPeople();
    } catch { onNotify('The account change could not be completed. Confirm this app’s origin is allowlisted on the existing Edge Function and review its server logs.'); }
    finally { setBusy(false); }
  }

  if (!isAdmin) return null;
  return <section className="workflow-stack">
    <section className="panel workflow-panel"><h3>Invite an employee</h3><p className="muted">The existing function sends an invitation and creates a least-privilege employee profile. It does not assign document permissions.</p><form className="workflow-form compact-form" onSubmit={invite}><label>Employee name<input required maxLength={120} value={inviteName} onChange={(event) => setInviteName(event.target.value)} /></label><label>Company email<input type="email" required maxLength={254} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label><button className="btn primary" disabled={busy}>Send invitation</button></form></section>
    <section className="panel workflow-panel"><div className="panel-header"><div><h3>Employee access</h3><p>Permission changes update existing profile fields. Use your administrator’s change-record process; the current Edge Function does not audit module-permission edits.</p></div><button className="btn secondary" type="button" onClick={() => void loadPeople()} disabled={busy}>Refresh</button></div>
      {loading ? <div className="loading-state">Loading employee profiles…</div> : people.length === 0 ? <div className="empty-state"><h3>No employee profiles found</h3><p>Invited employees appear after their profiles are created.</p></div> : <div className="team-list">{people.map((person) => <article className="team-card" key={String(person.id)}><div className="team-heading"><div><b>{String(person.full_name || 'Team member')}</b><small>{String(person.email)} · {person.is_active === true ? 'Active' : 'Inactive'}</small></div><button className="btn secondary" type="button" disabled={busy} onClick={() => void changeState(person, person.is_active === true ? 'deactivate' : 'reactivate')}>{person.is_active === true ? 'Deactivate' : 'Reactivate'}</button></div><div className="permission-grid">{employeeModules.map((item) => { const canView = person[item.view] === true; const canEdit = item.edit ? person[item.edit] === true : false; return <div className="permission-row" key={item.view}><span>{item.label}</span><label><input type="checkbox" checked={canView} disabled={busy} onChange={(event) => { const enabled = event.target.checked; const changes: Record<string, boolean> = { [item.view]: enabled }; if (item.navigation) changes[item.navigation] = enabled; if (item.edit && !enabled) changes[item.edit] = false; void updatePermissions(person, changes); }} /> View</label>{item.edit && <label><input type="checkbox" checked={canEdit} disabled={busy || !canView} onChange={(event) => { const enabled = event.target.checked; void updatePermissions(person, { [item.edit!]: enabled }); }} /> Edit</label>}</div>; })}</div></article>)}</div>}
    </section>
  </section>;
}

