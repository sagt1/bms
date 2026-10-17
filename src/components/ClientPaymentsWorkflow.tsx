import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { buildClientPaymentPayload, buildClientPayload, buildMilestonePayload, buildProjectPayload } from '../lib/workflow-validation';

type Row = Record<string, unknown>;

type Props = {
  profile: { id: string; role: string; is_active: boolean };
  editable: boolean;
};

function withoutCreatedBy<T extends { created_by: string }>(payload: T): Omit<T, 'created_by'> {
  const update: Partial<T> = { ...payload };
  delete update.created_by;
  return update as Omit<T, 'created_by'>;
}

function clientSchemaMissing(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  return code === 'PGRST205' || code === '42P01';
}

function messageForError(error: unknown) {
  if (clientSchemaMissing(error)) return 'The client and payment database setup has not been installed yet. Apply the reviewed module setup to a staging project, then reload this page.';
  return 'The request could not be completed. Check your module permissions and try again.';
}

function money(value: unknown, currencyCode: unknown = 'INR') {
  const amount = Number(value);
  const code = typeof currencyCode === 'string' && /^[A-Z]{3}$/.test(currencyCode) ? currencyCode : 'INR';
  if (!Number.isFinite(amount)) return '—';
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: code }).format(amount); }
  catch { return `${code} ${amount.toFixed(2)}`; }
}

function todayInIndia() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (name: string) => parts.find((part) => part.type === name)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export default function ClientPaymentsWorkflow({ profile, editable }: Props) {
  const [clients, setClients] = useState<Row[]>([]);
  const [projects, setProjects] = useState<Row[]>([]);
  const [milestones, setMilestones] = useState<Row[]>([]);
  const [payments, setPayments] = useState<Row[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(true);
  const [notice, setNotice] = useState('');
  const requestId = useRef(0);

  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [contactName, setContactName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [taxId, setTaxId] = useState('');
  const [clientStatus, setClientStatus] = useState('active');

  const [projectId, setProjectId] = useState('');
  const [projectClientId, setProjectClientId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectCode, setProjectCode] = useState('');
  const [contractAmount, setContractAmount] = useState('');
  const [currencyCode, setCurrencyCode] = useState('INR');
  const [projectStatus, setProjectStatus] = useState('planned');
  const [projectStartDate, setProjectStartDate] = useState('');
  const [projectTargetDate, setProjectTargetDate] = useState('');
  const [projectNotes, setProjectNotes] = useState('');

  const [milestoneId, setMilestoneId] = useState('');
  const [milestoneName, setMilestoneName] = useState('');
  const [milestoneAmount, setMilestoneAmount] = useState('');
  const [milestoneDueDate, setMilestoneDueDate] = useState('');
  const [milestoneStatus, setMilestoneStatus] = useState('planned');
  const [milestoneSequence, setMilestoneSequence] = useState(1);

  const [paymentMilestoneId, setPaymentMilestoneId] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayInIndia());
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNote, setPaymentNote] = useState('');

  const loadData = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (!supabase) { setLoading(false); setReady(false); setNotice('Supabase is not configured for this workspace.'); return; }
    setLoading(true); setNotice('');
    try {
      const [clientResult, projectResult, milestoneResult] = await Promise.all([
        supabase.from('client_accounts').select('id,display_name,contact_name,email,phone,address,tax_identifier,status,created_at,updated_at').order('display_name').limit(1000),
        supabase.from('client_projects').select('id,client_id,project_name,project_code,contract_amount,currency_code,status,start_date,target_date,notes,created_at,updated_at').order('created_at', { ascending: false }).limit(2000),
        supabase.from('client_project_milestones').select('id,project_id,milestone_name,expected_amount,due_date,sequence,status,created_at,updated_at').order('sequence').limit(5000),
      ]);
      const failed = [clientResult.error, projectResult.error, milestoneResult.error].find(Boolean);
      if (failed) throw failed;

      const paymentRows: Row[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('client_project_payments')
          .select('id,project_id,milestone_id,paid_on,amount,payment_method,reference,note,recorded_by,created_at,voided_at,void_reason')
          .order('paid_on', { ascending: false }).order('id').range(from, from + 999);
        if (error) throw error;
        const page = (data ?? []) as unknown as Row[];
        paymentRows.push(...page);
        if (page.length < 1000) break;
      }

      if (currentRequest !== requestId.current) return;
      const nextClients = (clientResult.data ?? []) as unknown as Row[];
      const nextProjects = (projectResult.data ?? []) as unknown as Row[];
      const nextMilestones = (milestoneResult.data ?? []) as unknown as Row[];
      setClients(nextClients); setProjects(nextProjects); setMilestones(nextMilestones); setPayments(paymentRows); setReady(true);
      setSelectedProjectId((selected) => nextProjects.some((row) => String(row.id) === selected) ? selected : String(nextProjects[0]?.id ?? ''));
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      setClients([]); setProjects([]); setMilestones([]); setPayments([]); setReady(false); setNotice(messageForError(error));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void loadData(); }, 0); return () => { window.clearTimeout(timer); requestId.current += 1; }; }, [loadData]);

  const selectedProject = projects.find((row) => String(row.id) === selectedProjectId);
  const selectedMilestones = useMemo(() => milestones.filter((row) => String(row.project_id) === selectedProjectId), [milestones, selectedProjectId]);
  const selectedPayments = useMemo(() => payments.filter((row) => String(row.project_id) === selectedProjectId), [payments, selectedProjectId]);
  const activePayments = useMemo(() => payments.filter((row) => !row.voided_at), [payments]);
  const totals = useMemo(() => {
    const byProject: Record<string, number> = {};
    const byMilestone: Record<string, number> = {};
    for (const row of activePayments) {
      const project = String(row.project_id);
      const amount = Number(row.amount);
      if (!Number.isFinite(amount)) continue;
      byProject[project] = (byProject[project] ?? 0) + amount;
      if (row.milestone_id) {
        const milestone = String(row.milestone_id);
        byMilestone[milestone] = (byMilestone[milestone] ?? 0) + amount;
      }
    }
    return { byProject, byMilestone };
  }, [activePayments]);

  function resetClient() {
    setClientId(''); setClientName(''); setContactName(''); setClientEmail(''); setClientPhone(''); setClientAddress(''); setTaxId(''); setClientStatus('active');
  }
  function resetProject() {
    setProjectId(''); setProjectClientId(''); setProjectName(''); setProjectCode(''); setContractAmount(''); setCurrencyCode('INR'); setProjectStatus('planned'); setProjectStartDate(''); setProjectTargetDate(''); setProjectNotes('');
  }
  function resetMilestone() {
    setMilestoneId(''); setMilestoneName(''); setMilestoneAmount(''); setMilestoneDueDate(''); setMilestoneStatus('planned'); setMilestoneSequence(1);
  }

  async function saveClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !editable || busy || loading) return;
    setBusy(true); setNotice('');
    try {
      const payload = buildClientPayload({ userId: profile.id, name: clientName, contactName, email: clientEmail, phone: clientPhone, address: clientAddress, taxId, status: clientStatus });
      const result = clientId
        ? await supabase.from('client_accounts').update(withoutCreatedBy(payload)).eq('id', clientId).select('id').maybeSingle()
        : await supabase.from('client_accounts').insert(payload).select('id').single();
      if (result.error || !result.data) throw result.error ?? new Error('No client was returned after save.');
      setNotice(clientId ? 'Client details updated.' : 'Client added.'); resetClient(); await loadData();
    } catch (error) { setNotice(error instanceof Error && /required|valid|characters|Choose/.test(error.message) ? error.message : messageForError(error)); }
    finally { setBusy(false); }
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !editable || busy || loading) return;
    setBusy(true); setNotice('');
    try {
      const payload = buildProjectPayload({ userId: profile.id, clientId: projectClientId, name: projectName, code: projectCode, amount: Number(contractAmount), currency: currencyCode, status: projectStatus, startDate: projectStartDate, targetDate: projectTargetDate, notes: projectNotes });
      const result = projectId
        ? await supabase.from('client_projects').update(withoutCreatedBy(payload)).eq('id', projectId).select('id').maybeSingle()
        : await supabase.from('client_projects').insert(payload).select('id').single();
      if (result.error || !result.data) throw result.error ?? new Error('No project was returned after save.');
      const savedId = String(result.data.id); setSelectedProjectId(savedId); setNotice(projectId ? 'Project details updated.' : 'Project added.'); resetProject(); await loadData();
    } catch (error) { setNotice(error instanceof Error && /required|valid|characters|Choose|must be|greater|positive|on or after/.test(error.message) ? error.message : messageForError(error)); }
    finally { setBusy(false); }
  }

  async function saveMilestone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !editable || !selectedProjectId || busy || loading) return;
    setBusy(true); setNotice('');
    try {
      const nextSequence = selectedMilestones.reduce((highest, row) => Math.max(highest, Number(row.sequence) || 0), 0) + 1;
      const payload = buildMilestonePayload({ userId: profile.id, projectId: selectedProjectId, name: milestoneName, amount: Number(milestoneAmount), dueDate: milestoneDueDate, sequence: milestoneId ? milestoneSequence : nextSequence, status: milestoneStatus });
      const result = milestoneId
        ? await supabase.from('client_project_milestones').update(withoutCreatedBy(payload)).eq('id', milestoneId).select('id').maybeSingle()
        : await supabase.from('client_project_milestones').insert(payload).select('id').single();
      if (result.error || !result.data) throw result.error ?? new Error('No milestone was returned after save.');
      setNotice(milestoneId ? 'Milestone updated.' : 'Milestone added.'); resetMilestone(); await loadData();
    } catch (error) { setNotice(error instanceof Error && /required|valid|characters|Choose|must be|greater|positive/.test(error.message) ? error.message : messageForError(error)); }
    finally { setBusy(false); }
  }

  async function savePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !editable || !selectedProjectId || busy || loading) return;
    setBusy(true); setNotice('');
    try {
      const payload = buildClientPaymentPayload({ userId: profile.id, projectId: selectedProjectId, milestoneId: paymentMilestoneId, paidOn: paymentDate, amount: Number(paymentAmount), method: paymentMethod, reference: paymentReference, note: paymentNote });
      const { error } = await supabase.from('client_project_payments').insert(payload);
      if (error) throw error;
      setNotice('Payment received and recorded. Posted payments are kept in the audit history.'); setPaymentMilestoneId(''); setPaymentAmount(''); setPaymentReference(''); setPaymentNote(''); setPaymentDate(todayInIndia()); await loadData();
    } catch (error) { setNotice(error instanceof Error && /required|valid|characters|Choose|must be|greater/.test(error.message) ? error.message : messageForError(error)); }
    finally { setBusy(false); }
  }

  async function voidPayment(row: Row) {
    if (!supabase || profile.role !== 'admin' || busy || loading) return;
    if (!window.confirm(`Void the payment of ${money(row.amount, selectedProject?.currency_code)}? The original record will remain in the audit history.`)) return;
    const reason = window.prompt('Reason for voiding this payment (required):')?.trim() ?? '';
    if (!reason) { setNotice('A reason is required to void a payment.'); return; }
    setBusy(true); setNotice('');
    try {
      const { error } = await supabase.rpc('sagt_void_client_project_payment', { p_payment_id: String(row.id), p_reason: reason });
      if (error) throw error;
      setNotice('Payment voided. Its history is retained.'); await loadData();
    } catch (error) { setNotice(messageForError(error)); }
    finally { setBusy(false); }
  }

  if (!ready && !loading) return <section className="panel workflow-panel"><div className="empty-state"><h3>Client payments need database setup</h3><p>{notice}</p><p className="small-text muted">No client tables were created in the live project. The setup script is included in the reviewed project package and is not applied automatically.</p><button className="btn secondary" type="button" onClick={() => void loadData()}>Check again</button></div></section>;

  return <section className="workflow-stack">
    {notice && <div className="notice" role="status">{notice}</div>}
    <section className="panel workflow-panel"><div className="panel-header"><div><h3>Clients and projects</h3><p>Contract, milestone, and received-payment totals use the selected project currency. Voided payments are excluded from balances.</p></div><button className="btn secondary" type="button" disabled={loading || busy} onClick={() => void loadData()}>Refresh</button></div>
      {loading ? <div className="loading-state">Loading client records…</div> : projects.length === 0 ? <div className="empty-state"><h3>No projects recorded</h3><p>Add a client and project to start tracking milestones and receipts.</p></div> : <div className="table-wrap"><table><thead><tr><th>Client</th><th>Project</th><th>Contract</th><th>Received</th><th>Outstanding</th><th>Status</th><th></th></tr></thead><tbody>{projects.map((row) => {
        const projectIdValue = String(row.id); const client = clients.find((item) => String(item.id) === String(row.client_id));
        const contract = Number(row.contract_amount); const received = totals.byProject[projectIdValue] ?? 0;
        return <tr key={projectIdValue}><td>{String(client?.display_name ?? 'Unknown client')}</td><td><button className="link-button" type="button" onClick={() => setSelectedProjectId(projectIdValue)}>{String(row.project_name)}</button></td><td>{money(contract, row.currency_code)}</td><td>{money(received, row.currency_code)}</td><td>{money(Math.max(0, contract - received), row.currency_code)}{received > contract ? ' · credit' : ''}</td><td>{String(row.status)}</td><td><div className="action-row"><button className="btn secondary" type="button" onClick={() => setSelectedProjectId(projectIdValue)}>Open</button>{editable && <button className="btn secondary" type="button" onClick={() => { setProjectId(projectIdValue); setProjectClientId(String(row.client_id)); setProjectName(String(row.project_name)); setProjectCode(String(row.project_code ?? '')); setContractAmount(String(row.contract_amount)); setCurrencyCode(String(row.currency_code ?? 'INR')); setProjectStatus(String(row.status)); setProjectStartDate(String(row.start_date ?? '')); setProjectTargetDate(String(row.target_date ?? '')); setProjectNotes(String(row.notes ?? '')); }}>Edit</button>}</div></td></tr>;
      })}</tbody></table></div>}
      {selectedProject && <div className="project-summary-grid"><div><span>Selected project</span><b>{String(selectedProject.project_name)}</b></div><div><span>Milestones</span><b>{String(selectedMilestones.length)}</b></div><div><span>Payments received</span><b>{money(totals.byProject[selectedProjectId] ?? 0, selectedProject.currency_code)}</b></div><div><span>Outstanding</span><b>{money(Math.max(0, Number(selectedProject.contract_amount) - (totals.byProject[selectedProjectId] ?? 0)), selectedProject.currency_code)}</b></div></div>}
    </section>

    {editable && <section className="panel workflow-panel"><h3>{clientId ? 'Edit client' : 'Add a client'}</h3><form className="workflow-form" onSubmit={saveClient}>
      <label>Client or organization name<input required maxLength={160} value={clientName} onChange={(event) => setClientName(event.target.value)} /></label><label>Contact person<input maxLength={120} value={contactName} onChange={(event) => setContactName(event.target.value)} /></label><label>Email<input type="email" maxLength={254} value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} /></label><label>Phone<input maxLength={40} value={clientPhone} onChange={(event) => setClientPhone(event.target.value)} /></label><label>Tax identifier<input maxLength={40} value={taxId} onChange={(event) => setTaxId(event.target.value)} /></label><label>Status<select value={clientStatus} onChange={(event) => setClientStatus(event.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select></label><label className="wide-field">Address<textarea maxLength={1000} value={clientAddress} onChange={(event) => setClientAddress(event.target.value)} /></label><div className="action-row"><button className="btn primary" disabled={busy}>{clientId ? 'Save client' : 'Add client'}</button>{clientId && <button className="btn" type="button" onClick={resetClient}>Cancel edit</button>}</div>
    </form><div className="table-wrap"><table><thead><tr><th>Client</th><th>Contact</th><th>Email</th><th>Phone</th><th>Status</th><th></th></tr></thead><tbody>{clients.length === 0 ? <tr><td colSpan={6}>No client accounts yet.</td></tr> : clients.map((row) => <tr key={String(row.id)}><td>{String(row.display_name)}</td><td>{String(row.contact_name || '—')}</td><td>{String(row.email || '—')}</td><td>{String(row.phone || '—')}</td><td>{String(row.status)}</td><td><button className="btn secondary" type="button" onClick={() => { setClientId(String(row.id)); setClientName(String(row.display_name)); setContactName(String(row.contact_name ?? '')); setClientEmail(String(row.email ?? '')); setClientPhone(String(row.phone ?? '')); setClientAddress(String(row.address ?? '')); setTaxId(String(row.tax_identifier ?? '')); setClientStatus(String(row.status)); }}>Edit</button></td></tr>)}</tbody></table></div></section>}

    {editable && <section className="panel workflow-panel"><h3>{projectId ? 'Edit project' : 'Add a project'}</h3><form className="workflow-form" onSubmit={saveProject}>
      <label>Client<select required value={projectClientId} onChange={(event) => setProjectClientId(event.target.value)}><option value="">Choose a client</option>{clients.filter((row) => row.status === 'active' || String(row.id) === projectClientId).map((row) => <option key={String(row.id)} value={String(row.id)}>{String(row.display_name)}</option>)}</select></label><label>Project name<input required maxLength={180} value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label><label>Project code<input maxLength={60} value={projectCode} onChange={(event) => setProjectCode(event.target.value)} /></label><label>Contract amount<input type="number" required min="0" max="100000000000" step="0.01" value={contractAmount} onChange={(event) => setContractAmount(event.target.value)} /></label><label>Currency code<input required maxLength={3} minLength={3} pattern="[A-Za-z]{3}" value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())} /></label><label>Status<select value={projectStatus} onChange={(event) => setProjectStatus(event.target.value)}><option value="planned">Planned</option><option value="active">Active</option><option value="on_hold">On hold</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label><label>Start date<input type="date" value={projectStartDate} onChange={(event) => setProjectStartDate(event.target.value)} /></label><label>Target date<input type="date" value={projectTargetDate} onChange={(event) => setProjectTargetDate(event.target.value)} /></label><label className="wide-field">Notes<textarea maxLength={4000} value={projectNotes} onChange={(event) => setProjectNotes(event.target.value)} /></label><div className="action-row"><button className="btn primary" disabled={busy || clients.length === 0}>{projectId ? 'Save project' : 'Add project'}</button>{projectId && <button className="btn" type="button" onClick={resetProject}>Cancel edit</button>}</div>
    </form></section>}

    {selectedProject && <section className="panel workflow-panel"><div className="panel-header"><div><h3>{String(selectedProject.project_name)} milestones</h3><p>Received amounts are shown for payments explicitly linked to each milestone.</p></div><label className="month-label">Selected project<select value={selectedProjectId} onChange={(event) => { setSelectedProjectId(event.target.value); resetMilestone(); setPaymentMilestoneId(''); }}><option value="">Choose a project</option>{projects.map((row) => <option key={String(row.id)} value={String(row.id)}>{String(row.project_name)}</option>)}</select></label></div>
      <div className="table-wrap"><table><thead><tr><th>Milestone</th><th>Expected</th><th>Received</th><th>Due</th><th>Status</th>{editable && <th></th>}</tr></thead><tbody>{selectedMilestones.length === 0 ? <tr><td colSpan={editable ? 6 : 5}>No milestones added yet.</td></tr> : selectedMilestones.map((row) => <tr key={String(row.id)}><td>{String(row.milestone_name)}</td><td>{money(row.expected_amount, selectedProject.currency_code)}</td><td>{money(totals.byMilestone[String(row.id)] ?? 0, selectedProject.currency_code)}</td><td>{String(row.due_date || '—')}</td><td>{String(row.status)}</td>{editable && <td><button className="btn secondary" type="button" disabled={busy || loading} onClick={() => { setMilestoneId(String(row.id)); setMilestoneName(String(row.milestone_name)); setMilestoneAmount(String(row.expected_amount)); setMilestoneDueDate(String(row.due_date ?? '')); setMilestoneStatus(String(row.status)); setMilestoneSequence(Number(row.sequence) || 1); }}>Edit</button></td>}</tr>)}</tbody></table></div>
      {editable && <form className="workflow-form compact-form" onSubmit={saveMilestone}><label>{milestoneId ? 'Edit milestone name' : 'Milestone name'}<input required maxLength={180} value={milestoneName} onChange={(event) => setMilestoneName(event.target.value)} /></label><label>Expected amount<input required type="number" min="0.01" max="100000000000" step="0.01" value={milestoneAmount} onChange={(event) => setMilestoneAmount(event.target.value)} /></label><label>Due date<input type="date" value={milestoneDueDate} onChange={(event) => setMilestoneDueDate(event.target.value)} /></label>{milestoneId && <label>Status<select value={milestoneStatus} onChange={(event) => setMilestoneStatus(event.target.value)}><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="on_hold">On hold</option></select></label>}<div className="action-row"><button className="btn primary" disabled={busy}>{milestoneId ? 'Save milestone' : 'Add milestone'}</button>{milestoneId && <button className="btn" type="button" onClick={resetMilestone}>Cancel edit</button>}</div></form>}
    </section>}

    {selectedProject && <section className="panel workflow-panel"><div className="panel-header"><div><h3>Payment history</h3><p>Receipts are append-only. Administrators can void an incorrect record with a reason; the original stays visible.</p></div></div>
      {editable && <form className="workflow-form" onSubmit={savePayment}><label>Payment date<input required type="date" max={todayInIndia()} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label><label>Amount received<input required type="number" min="0.01" max="100000000000" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></label><label>Milestone (optional)<select value={paymentMilestoneId} onChange={(event) => setPaymentMilestoneId(event.target.value)}><option value="">Project level / advance</option>{selectedMilestones.map((row) => <option key={String(row.id)} value={String(row.id)}>{String(row.milestone_name)}</option>)}</select></label><label>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cash">Cash</option><option value="card">Card</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label><label>Reference number (optional)<input maxLength={120} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></label><label>Note (optional)<input maxLength={1000} value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} /></label><div className="action-row"><button className="btn primary" disabled={busy || loading}>Record payment</button></div></form>}
      <div className="table-wrap"><table><thead><tr><th>Date</th><th>Milestone</th><th>Amount</th><th>Method</th><th>Reference</th><th>State</th>{profile.role === 'admin' && <th>Action</th>}</tr></thead><tbody>{selectedPayments.length === 0 ? <tr><td colSpan={profile.role === 'admin' ? 7 : 6}>No payments recorded for this project.</td></tr> : selectedPayments.map((row) => { const voided = Boolean(row.voided_at); const milestone = selectedMilestones.find((item) => String(item.id) === String(row.milestone_id)); return <tr key={String(row.id)}><td>{String(row.paid_on)}</td><td>{String(milestone?.milestone_name || 'Project level')}</td><td>{money(row.amount, selectedProject.currency_code)}</td><td>{String(row.payment_method).replaceAll('_', ' ')}</td><td>{String(row.reference || '—')}</td><td>{voided ? `Voided${row.void_reason ? ` · ${String(row.void_reason)}` : ''}` : 'Recorded'}</td>{profile.role === 'admin' && <td>{!voided && <button className="btn secondary" type="button" disabled={busy} onClick={() => void voidPayment(row)}>Void</button>}</td>}</tr>; })}</tbody></table></div>
    </section>}
  </section>;
}
