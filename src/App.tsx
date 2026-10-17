import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Activity,
  ArrowUpRight,
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Receipt,
  Search,
  ShieldCheck,
  Sun,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { supabase, configError } from './lib/supabase';
import { canViewModule, type PermissionProfile } from './lib/permissions';
import WorkflowPanel from './components/WorkflowPanel';
import { formatCell } from './lib/presentation';
import { niceDate } from './lib/utils';

type DataTable =
  | 'attendance_records'
  | 'leave_requests'
  | 'expense_records'
  | 'payroll_months'
  | 'company_holidays'
  | 'documents';

type Profile = PermissionProfile & {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
};

type QueryResult<T> = {
  data: T;
  error: { message: string } | null;
};

type ModuleDef = {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  permission?: string;
  navigation?: string;
  table?: DataTable;
};

const profileColumns = [
  'id',
  'email',
  'full_name',
  'role',
  'is_active',
  'nav_dashboard',
  'nav_attendance',
  'nav_leave',
  'nav_holidays',
  'nav_flat_expense',
  'nav_office_expense',
  'nav_payroll',
  'nav_payslip',
  'nav_client_project_payments',
  'can_view_invoices',
  'can_edit_invoices',
  'can_view_surveys',
  'can_edit_surveys',
  'can_view_client_project_payments',
  'can_edit_client_project_payments',
  'can_view_attendance',
  'can_edit_attendance',
  'can_view_leave',
  'can_edit_leave',
  'can_view_holidays',
  'can_edit_holidays',
  'can_view_flat_expense',
  'can_edit_flat_expense',
  'can_view_office_expense',
  'can_edit_office_expense',
  'can_view_payroll',
  'can_edit_payroll',
  'can_view_payslip',
  'can_edit_payslip',
].join(',');

const modules: ModuleDef[] = [
  {
    key: 'dashboard',
    title: 'Overview',
    description: 'Your business at a glance',
    icon: LayoutDashboard,
  },
  {
    key: 'clients',
    title: 'Clients & Payments',
    description: 'Client payment tracking and milestones',
    icon: Building2,
    permission: 'client_project_payments',
    navigation: 'nav_client_project_payments',
  },
  {
    key: 'attendance',
    title: 'Attendance',
    description: 'Attendance records and corrections',
    icon: CalendarDays,
    table: 'attendance_records',
    permission: 'attendance',
    navigation: 'nav_attendance',
  },
  {
    key: 'leave',
    title: 'Leave',
    description: 'Leave requests and decisions',
    icon: ClipboardList,
    table: 'leave_requests',
    permission: 'leave',
    navigation: 'nav_leave',
  },
  {
    key: 'flat_expense',
    title: 'Flat Expenses',
    description: 'Property, rent, electricity and repairs',
    icon: Wallet,
    table: 'expense_records',
    permission: 'flat_expense',
    navigation: 'nav_flat_expense',
  },
  {
    key: 'office_expense',
    title: 'Office Expenses',
    description: 'Office operations and bills',
    icon: Receipt,
    table: 'expense_records',
    permission: 'office_expense',
    navigation: 'nav_office_expense',
  },
  {
    key: 'payroll',
    title: 'Payroll Reports',
    description: 'Daily and monthly payroll summaries',
    icon: Activity,
    table: 'payroll_months',
    permission: 'payroll',
    navigation: 'nav_payroll',
  },
  {
    key: 'payslip',
    title: 'Payslips',
    description: 'Private payslip access and publishing',
    icon: FileText,
    permission: 'payslip',
    navigation: 'nav_payslip',
  },
  {
    key: 'holidays',
    title: 'Holidays',
    description: 'Company holiday calendar',
    icon: CalendarDays,
    table: 'company_holidays',
    permission: 'holidays',
    navigation: 'nav_holidays',
  },
  {
    key: 'documents',
    title: 'Invoices & Quotations',
    description: 'Commercial documents and invoices',
    icon: FileText,
    table: 'documents',
    permission: 'invoice',
  },
  {
    key: 'surveys',
    title: 'Survey Reports',
    description: 'Survey documentation and reports',
    icon: FolderKanban,
    table: 'documents',
    permission: 'survey',
  },
  {
    key: 'team',
    title: 'Employee Management',
    description: 'Team accounts and permissions',
    icon: Users,
    permission: 'team',
  },
];

const dataViews: Record<DataTable, { columns: string; orderBy: string; ascending: boolean }> = {
  attendance_records: {
    columns: 'user_id,work_date,check_in,check_out,status',
    orderBy: 'work_date',
    ascending: false,
  },
  leave_requests: {
    columns: 'id,user_id,leave_type,start_date,end_date,reason,status,admin_note,created_at',
    orderBy: 'start_date',
    ascending: false,
  },
  expense_records: {
    columns: 'id,submitted_by,expense_module,expense_date,category,description,amount,payment_method,payment_status,approval_status,review_note',
    orderBy: 'expense_date',
    ascending: false,
  },
  payroll_months: {
    columns: 'id,user_id,payroll_month,working_days,payable_days,absence_deduction,overtime_hours,overtime_pay,gross_pay,net_pay,pending_attendance_days,status',
    orderBy: 'payroll_month',
    ascending: false,
  },
  company_holidays: {
    columns: 'id,holiday_date,name',
    orderBy: 'holiday_date',
    ascending: true,
  },
  documents: {
    columns: 'id,module,title,document_number,status,client_name,created_by,content,updated_at',
    orderBy: 'updated_at',
    ascending: false,
  },
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [active, setActive] = useState('dashboard');
  const [dark, setDark] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const profileRequest = useRef(0);
  const rowsRequest = useRef(0);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const loadProfile = useCallback(async (nextSession: Session | null) => {
    const requestId = ++profileRequest.current;
    if (!supabase || !nextSession?.user) {
      setProfile(null);
      setAuthLoading(false);
      return;
    }

    setAuthLoading(true);
    try {
      const profileQuery = supabase
        .from('profiles')
        .select(profileColumns)
        .eq('id', nextSession.user.id)
        .maybeSingle();
      const { data, error } = await (profileQuery as unknown as PromiseLike<QueryResult<Record<string, unknown> | null>>);

      if (requestId !== profileRequest.current) return;
      if (error) {
        setNotice('Could not load your profile. Contact the administrator if this continues.');
        setProfile(null);
      } else if (!data) {
        setNotice('Your account profile is not configured. Ask the administrator to check your profile.');
        setProfile(null);
      } else if ((data as unknown as Profile).is_active !== true) {
        setNotice('This account is inactive or not activated. Contact the administrator.');
        setProfile(null);
        void supabase.auth.signOut();
      } else {
        setProfile(data as unknown as Profile);
        setNotice('');
      }
    } catch {
      if (requestId === profileRequest.current) {
        setProfile(null);
        setNotice('Could not load your profile. Contact the administrator if this continues.');
      }
    } finally {
      if (requestId === profileRequest.current) setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;

    let activeSubscription = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setProfile(null);
      setRows([]);
      rowsRequest.current += 1;
      if (!nextSession) {
        profileRequest.current += 1;
        setAuthLoading(false);
        return;
      }

      setAuthLoading(true);
      // Defer the profile query until the synchronous auth callback has returned.
      window.setTimeout(() => {
        if (activeSubscription) void loadProfile(nextSession);
      }, 0);
    });

    return () => {
      activeSubscription = false;
      profileRequest.current += 1;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const allowed = useMemo(
    () => modules.filter((module) => canViewModule(profile, module)),
    [profile],
  );
  const activeKey = allowed.some((module) => module.key === active) ? active : allowed[0]?.key ?? '';
  const current = allowed.find((module) => module.key === activeKey) ?? modules[0];
  const isDocumentWorkspace = current.key === 'documents' || current.key === 'surveys';
  const workspaceModuleCount = allowed.filter((module) => module.key !== 'dashboard').length;

  function selectModule(key: string) {
    rowsRequest.current += 1;
    setRows([]);
    setLoading(false);
    setNotice('');
    setActive(key);
  }

  const loadRows = useCallback(async () => {
    const requestId = ++rowsRequest.current;
    if (current.key === 'attendance') {
      setRows([]);
      setLoading(false);
      setNotice('');
      return;
    }
    if (!supabase || !profile || !current.table) {
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setNotice('');
    const view = dataViews[current.table];

    try {
      const query = current.table === 'attendance_records'
        ? supabase.from('attendance_records').select(view.columns).order(view.orderBy, { ascending: view.ascending }).limit(100)
        : current.table === 'leave_requests'
          ? supabase.from('leave_requests').select(view.columns).order(view.orderBy, { ascending: view.ascending }).limit(100)
          : current.table === 'expense_records'
            ? supabase.from('expense_records').select(view.columns).eq('expense_module', current.key).order(view.orderBy, { ascending: view.ascending }).limit(100)
            : current.table === 'payroll_months'
              ? supabase.from('payroll_months').select(view.columns).order(view.orderBy, { ascending: view.ascending }).limit(100)
              : current.table === 'company_holidays'
                ? supabase.from('company_holidays').select(view.columns).order(view.orderBy, { ascending: view.ascending }).limit(100)
                : supabase.from('documents').select(view.columns).in('module', current.key === 'surveys' ? ['survey'] : ['invoice', 'quotation']).order(view.orderBy, { ascending: view.ascending }).limit(100);

      const { data, error } = await (query as unknown as PromiseLike<QueryResult<Record<string, unknown>[] | null>>);
      if (requestId !== rowsRequest.current) return;
      if (error) {
        setRows([]);
        setNotice('Data could not be loaded. Check your access or try again later.');
      } else {
        setRows(data ?? []);
      }
    } catch {
      if (requestId === rowsRequest.current) {
        setRows([]);
        setNotice('Data could not be loaded. Check your access or try again later.');
      }
    } finally {
      if (requestId === rowsRequest.current) setLoading(false);
    }
  }, [current, profile]);

  useEffect(() => {
    rowsRequest.current += 1;
    const timeout = window.setTimeout(() => void loadRows(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadRows]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setLoginError(configError);
      return;
    }

    setLoginBusy(true);
    setLoginError('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setLoginError('Sign-in failed. Check your email and password, then try again.');
      } else {
        setPassword('');
      }
    } catch {
      setLoginError('Sign-in failed. Check your connection and try again.');
    } finally {
      setLoginBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    try {
      const { error } = await supabase.auth.signOut();
      if (error) setNotice('Could not complete sign out. Please try again.');
    } catch {
      setNotice('Could not complete sign out. Please try again.');
    } finally {
      profileRequest.current += 1;
      rowsRequest.current += 1;
      setSession(null);
      setProfile(null);
      setRows([]);
      setLoading(false);
      setPassword('');
      setActive('dashboard');
    }
  }

  const filtered = allowed.filter((module) =>
    `${module.title} ${module.description}`.toLowerCase().includes(search.toLowerCase()),
  );

  if (session && authLoading) {
    return (
      <main className="login-screen">
        <section className="login-card" aria-live="polite">
          <div className="login-symbol"><ShieldCheck size={23} /></div>
          <p className="eyebrow">SECURE ACCESS</p>
          <h2>Loading your workspace</h2>
          <p className="muted">Checking your account and permissions…</p>
        </section>
      </main>
    );
  }

  if (!session || !profile) {
    return (
      <main className="login-screen">
        <div className="login-hero">
          <img className="brand-mark" src="/assets/sagt-logo.png" alt="Shree Aditya Geo Tech logo" />
          <div>
            <p className="eyebrow">SHREE ADITYA GEO TECH</p>
            <h1>One workspace.<br /><span>Every project.</span></h1>
            <p className="hero-copy">A secure business suite for your team, documents and day-to-day operations.</p>
          </div>
          <div className="hero-foot"><ShieldCheck size={18} /> Protected workspace · Supabase authentication</div>
        </div>
        <form className="login-card" onSubmit={signIn}>
          <div className="login-symbol"><ShieldCheck size={23} /></div>
          <p className="eyebrow">SECURE ACCESS</p>
          <h2>Welcome back</h2>
          <p className="muted">Sign in with your company account.</p>
          {(configError || loginError || notice) && (
            <div className="alert error" role="alert">{loginError || notice || configError}</div>
          )}
          <label>Email address
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
            />
          </label>
          <label>Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
            />
          </label>
          <button className="btn primary wide" disabled={loginBusy || !supabase}>
            {loginBusy ? 'Signing in…' : 'Sign in securely'}
          </button>
          <p className="login-help">Access is managed by your administrator. Never share your password.</p>
        </form>
      </main>
    );
  }

  return (
    <div className={`app-shell${isDocumentWorkspace ? ' document-workspace-mode' : ''}`}>
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <div className="brand-row">
          <img className="brand-mark small" src="/assets/sagt-logo.png" alt="" />
          <div><b>Shree Aditya</b><small>Geo Tech · Verify</small></div>
          <button className="icon-btn mobile-close" onClick={() => setMobileNav(false)} aria-label="Close menu"><X /></button>
        </div>
        <div className="nav-section">WORKSPACE</div>
        <nav>
          {allowed.map((module) => {
            const Icon = module.icon;
            return (
              <button
                key={module.key}
                className={`nav-item ${activeKey === module.key ? 'active' : ''}`}
                onClick={() => {
                  selectModule(module.key);
                  setMobileNav(false);
                  setSearch('');
                }}
              >
                <Icon size={17} />
                <span>{module.title}</span>
                {module.key === 'dashboard' && <span className="nav-dot" />}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-note">
            <ShieldCheck size={17} />
            <div><b>Protected by RLS</b><small>Access checked by Supabase</small></div>
          </div>
          <button className="nav-item" onClick={() => void signOut()}><LogOut size={17} /><span>Sign out</span></button>
        </div>
      </aside>
      {mobileNav && <button className="nav-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-btn mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu /></button>
            <div><div className="breadcrumb">Workspace <span>/</span> {current.title}</div><h2>{current.title}</h2></div>
          </div>
          <div className="top-actions">
            <label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a module…" aria-label="Search modules" /></label>
            <button className="icon-btn" onClick={() => setDark((value) => !value)} aria-label="Toggle theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
            <div className="profile-chip">
              <div className="avatar">{(profile.full_name || profile.email || 'U').slice(0, 1).toUpperCase()}</div>
              <div className="profile-meta"><b>{profile.full_name || 'Team member'}</b><small>{profile.role === 'admin' ? 'Administrator' : 'Employee'}</small></div>
            </div>
          </div>
        </header>
        <section className={`page-content${isDocumentWorkspace ? ' page-content--document' : ''}`}>
          {notice && <div className="alert" role="status">{notice}<button className="icon-btn" onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
          {activeKey === 'dashboard' ? (
            <>
              <div className="page-heading">
                <div><p className="eyebrow">BUSINESS OVERVIEW</p><h1>Good to see you, {(profile.full_name || 'there').split(' ')[0]}.</h1><p className="muted">Here’s your workspace, with access based on your role.</p></div>
                <span className="date-pill"><CalendarDays size={15} />{niceDate(new Date().toISOString())}</span>
              </div>
              <div className="stat-grid">
                <Stat icon={FolderKanban} label="Workspace modules" value={String(workspaceModuleCount)} detail="Available to your role" />
                <Stat icon={ShieldCheck} label="Access protection" value="Active" detail="Authenticated + RLS" />
                <Stat icon={Activity} label="Data connection" value={supabase ? 'Connected' : 'Offline'} detail="Existing Supabase project" />
              </div>
              <div className="section-heading"><div><h3>Your workspace</h3><p>Open a module to continue your work.</p></div><span className="muted small-text">{workspaceModuleCount} modules</span></div>
              <div className="module-grid">
                {filtered.filter((module) => module.key !== 'dashboard').map((module) => {
                  const Icon = module.icon;
                  return (
                    <button className="module-card" key={module.key} onClick={() => selectModule(module.key)}>
                      <span className="module-icon"><Icon size={21} /></span>
                      <span className="module-copy"><b>{module.title}</b><small>{module.description}</small></span>
                      <ArrowUpRight size={17} className="module-arrow" />
                    </button>
                  );
                })}
              </div>
            </>
          ) : !current || activeKey === '' ? (
            <section className="panel"><div className="empty-state"><ShieldCheck size={26} /><h3>No workspace modules are assigned</h3><p>Your account is active but has no dashboard or module access. Contact an administrator.</p></div></section>
          ) : (
            <>
              {!isDocumentWorkspace && <div className="page-heading">
                <div><p className="eyebrow">MODULE WORKSPACE</p><h1>{current.title}</h1><p className="muted">{current.description}</p></div>
                {current.table && <button className="btn secondary" onClick={() => void loadRows()}><Activity size={15} /> Refresh</button>}
              </div>}
              <WorkflowPanel module={current} profile={profile} rows={rows} onRefresh={loadRows} onNotify={setNotice} />
              {!['payroll', 'payslip', 'documents', 'surveys', 'team', 'clients'].includes(current.key) && <DataPanel module={current} rows={rows} loading={loading} profile={profile} />}
            </>
          )}
        </section>
        <footer className="footer"><span>Shree Aditya Geo Tech</span><span><ShieldCheck size={13} /> Secure workspace · Existing data model preserved</span></footer>
      </main>
    </div>
  );
}

function Stat({ icon: Icon, label, value, detail }: { icon: LucideIcon; label: string; value: string; detail: string }) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><Icon size={17} /></div><strong>{value}</strong><small>{detail}</small></div>;
}

function DataPanel({ module, rows, loading, profile }: { module: ModuleDef; rows: Record<string, unknown>[]; loading: boolean; profile: Profile }) {
  const columns = rows[0] ? Object.keys(rows[0]).filter((column) => !['id', 'created_by'].includes(column) && (profile.role === 'admin' || !['user_id', 'submitted_by'].includes(column))) : [];
  return (
    <section className="panel">
      <div className="panel-header">
        <div><h3>{module.title} records</h3><p>Showing up to 100 records returned by the existing Supabase access policies.</p></div>
        <span className="count-pill">{loading ? 'Loading…' : `${rows.length} records`}</span>
      </div>
      {loading ? <div className="loading-state">Loading records securely…</div> : rows.length === 0 ? (
        <div className="empty-state"><ClipboardList size={26} /><h3>No records to display</h3><p>There are no accessible records for this module yet, or the current profile does not have permission to read them.</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr>{columns.map((column) => <th key={column}>{column.replaceAll('_', ' ')}</th>)}</tr></thead>
            <tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{formatCell(column, row[column], profile.role)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
