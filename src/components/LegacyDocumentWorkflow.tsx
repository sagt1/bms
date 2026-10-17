import { useCallback, useEffect, useRef, useState } from 'react';
import type { Json } from '../lib/database.types';
import { canOpenDraft, documentFields, editorIdentity, isRecord, matchesEditor } from '../lib/document-editor';
import type { EditorModule } from '../lib/document-editor';
import { supabase } from '../lib/supabase';

type Row = Record<string, unknown>;
type Profile = { id: string };

type LegacyDocumentWorkflowProps = {
  moduleKey: EditorModule;
  editable: boolean;
  profile: Profile;
  rows: Row[];
  onRefresh: () => Promise<void>;
};

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

function newEditorId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `sagt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function displayText(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

export default function LegacyDocumentWorkflow({ moduleKey, editable, profile, rows, onRefresh }: LegacyDocumentWorkflowProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const rowsRef = useRef(rows);
  const pendingPayloadRef = useRef<Record<string, unknown> | null>(null);
  const currentRecordIdRef = useRef<string | null>(null);
  const currentEditorIdRef = useRef<string | null>(null);
  const currentRecordRef = useRef<Row | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const savingPromiseRef = useRef<Promise<void> | null>(null);
  const pendingLoadRef = useRef<Record<string, unknown> | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  const [editorLoaded, setEditorLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState(moduleKey === 'surveys'
    ? 'Survey changes sync to your secure workspace.'
    : 'Press Save in the invoice editor to sync this draft.');
  const [activeRecordId, setActiveRecordId] = useState('');
  const [editorDirty, setEditorDirty] = useState(false);
  const [savedRecordsOpen, setSavedRecordsOpen] = useState(!editable);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const persistPayload = useCallback(async (payload: Record<string, unknown>) => {
    if (!supabase || !editable || !matchesEditor(moduleKey, payload)) {
      setSaveStatus('This editor payload is unavailable or invalid.');
      return;
    }

    const editorId = editorIdentity(moduleKey, payload);
    if (!editorId) {
      setSaveStatus('The editor could not identify this draft. Reload the editor and try again.');
      return;
    }

    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch {
      setSaveStatus('This draft could not be prepared for saving.');
      return;
    }
    if (new Blob([serialized]).size > MAX_DOCUMENT_BYTES) {
      setSaveStatus('This draft is too large to save. Reduce embedded image sizes and try again.');
      return;
    }

    const fields = documentFields(moduleKey, payload);
    const content = { ...payload, __sagtEditorId: editorId } as unknown as Json;
    const values = {
      ...fields,
      status: 'draft',
      content,
      updated_by: profile.id,
    };

    try {
      const selectedRecord = currentRecordIdRef.current
        && currentEditorIdRef.current === editorId
        ? (currentRecordRef.current?.id === currentRecordIdRef.current
            ? currentRecordRef.current
            : rowsRef.current.find((row) => row.id === currentRecordIdRef.current))
        : undefined;
      let existingRecord = selectedRecord && selectedRecord.created_by === profile.id && selectedRecord.status === 'draft' && selectedRecord.module === fields.module
        ? selectedRecord
        : rowsRef.current.find((row) => {
            if (row.created_by !== profile.id || row.status !== 'draft' || row.module !== fields.module) return false;
            return isRecord(row.content) && row.content.__sagtEditorId === editorId;
          });

      if (!existingRecord) {
        const { data, error } = await supabase.from('documents')
          .select('id')
          .eq('created_by', profile.id)
          .eq('module', fields.module)
          .eq('status', 'draft')
          .contains('content', { __sagtEditorId: editorId })
          .limit(2);
        if (error) throw error;
        if ((data ?? []).length > 1) throw new Error('Duplicate draft identities need administrator review.');
        existingRecord = data?.[0] as Row | undefined;
      }

      setSaveStatus('Saving draft…');
      const result = existingRecord
        ? await supabase.from('documents').update(values)
            .eq('id', String(existingRecord.id))
            .eq('created_by', profile.id)
            .eq('module', fields.module)
            .eq('status', 'draft')
            .select('id')
            .maybeSingle()
        : await supabase.from('documents').insert({ ...values, created_by: profile.id }).select('id').single();

      if (result.error || !result.data) throw result.error ?? new Error('Draft not available for update.');
      currentRecordIdRef.current = String(result.data.id);
      currentEditorIdRef.current = editorId;
      currentRecordRef.current = { ...(existingRecord ?? {}), ...values, id: String(result.data.id), created_by: profile.id };
      setActiveRecordId(String(result.data.id));
      setEditorDirty(Boolean(pendingPayloadRef.current));
      setSaveStatus(pendingPayloadRef.current ? 'Changes detected…' : 'Draft saved to your secure workspace.');
      await onRefresh();
    } catch {
      setSaveStatus('Cloud save failed. Check your access or connection, then try again.');
    }
  }, [editable, moduleKey, onRefresh, profile.id]);

  const flushPending = useCallback(async () => {
    if (savingRef.current) {
      await savingPromiseRef.current;
      if (pendingPayloadRef.current) {
        if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        await flushRef.current();
      }
      return;
    }
    const payload = pendingPayloadRef.current;
    if (!payload) return;
    pendingPayloadRef.current = null;
    savingRef.current = true;
    const savingPromise = persistPayload(payload);
    savingPromiseRef.current = savingPromise;
    try {
      await savingPromise;
    } finally {
      savingRef.current = false;
      savingPromiseRef.current = null;
      if (pendingPayloadRef.current) {
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = null;
          void flushRef.current();
        }, 250);
      }
    }
  }, [persistPayload]);

  useEffect(() => {
    flushRef.current = flushPending;
  }, [flushPending]);

  useEffect(() => {
    function receiveEditorMessage(event: MessageEvent<unknown>) {
      const frame = frameRef.current;
      if (event.origin !== window.location.origin || event.source !== frame?.contentWindow || !isRecord(event.data)) return;
      const expectedModule = moduleKey === 'surveys' ? 'survey' : 'invoice';
      if (event.data.module !== expectedModule) return;

      if (event.data.type === 'SAGT_EDITOR_CONTEXT_REQUEST') {
        frame?.contentWindow?.postMessage({ type: 'SAGT_EDITOR_CONTEXT', module: expectedModule, userId: profile.id }, window.location.origin);
        return;
      }

      if (event.data.type === 'SAGT_EDITOR_NEW') {
        const clearCurrentDraft = () => {
          currentRecordIdRef.current = null;
          currentEditorIdRef.current = null;
          currentRecordRef.current = null;
          setActiveRecordId('');
          setEditorDirty(false);
          setSaveStatus('New draft ready.');
        };
        if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        if (savingRef.current || pendingPayloadRef.current) void flushRef.current().finally(clearCurrentDraft);
        else clearCurrentDraft();
        return;
      }
      if (event.data.type === 'SAGT_EDITOR_DIRTY') {
        setEditorDirty(true);
        setSaveStatus('Unsaved editor changes.');
        return;
      }
      if (event.data.type !== 'SAGT_EDITOR_SAVE' || !editable || !isRecord(event.data.payload)) return;

      pendingPayloadRef.current = event.data.payload;
      setEditorDirty(true);
      setSaveStatus('Changes detected…');
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void flushRef.current();
      }, 800);
    }

    window.addEventListener('message', receiveEditorMessage);
    return () => {
      window.removeEventListener('message', receiveEditorMessage);
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      if (pendingPayloadRef.current) void flushRef.current();
    };
  }, [editable, moduleKey, profile.id]);

  function openDraft(row: Row) {
    if (!canOpenDraft(moduleKey, row, profile.id) || !isRecord(row.content)) return;
    currentRecordIdRef.current = String(row.id);
    currentRecordRef.current = row;
    const payload = { ...row.content };
    const editorId = editorIdentity(moduleKey, payload) || newEditorId();
    if (moduleKey === 'surveys') payload.editorId = editorId;
    else payload.documentId = editorId;
    currentEditorIdRef.current = editorId;
    setActiveRecordId(String(row.id));
    pendingLoadRef.current = payload;
    setSaveStatus('Opening your draft…');
    if (editorLoaded) {
      const frame = frameRef.current;
      if (frame?.contentWindow) {
        pendingLoadRef.current = null;
        frame.contentWindow.postMessage({
          type: 'SAGT_EDITOR_LOAD',
          module: moduleKey === 'surveys' ? 'survey' : 'invoice',
          payload,
        }, window.location.origin);
      }
    }
  }

  const title = moduleKey === 'surveys' ? 'Survey Report Studio' : 'Invoice & Quotation Studio';
  const source = moduleKey === 'surveys' ? '/legacy/survey-editor.html' : '/legacy/invoice-editor.html';
  const savedRows = rows.filter((row) => moduleKey === 'surveys'
    ? row.module === 'survey'
    : row.module === 'invoice' || row.module === 'quotation');

  return <div className={`workflow-stack document-editor-workspace${editable ? '' : ' document-editor-workspace--readonly'}`}>
    {editable ? <section className="panel legacy-document-panel">
      <div className="legacy-document-toolbar">
        <div><h3>{title}</h3><p className="small-text muted" role="status" aria-live="polite">{saveStatus}</p></div>
        <div className="legacy-document-toolbar-actions">
          {activeRecordId && <span className="count-pill">Editing saved draft</span>}
          <button className="btn secondary" type="button" aria-expanded={savedRecordsOpen} onClick={() => setSavedRecordsOpen((open) => !open)}>
            {savedRecordsOpen ? 'Hide saved records' : `Saved records (${savedRows.length})`}
          </button>
          <button className="btn secondary" type="button" onClick={() => void onRefresh()}>Refresh list</button>
        </div>
      </div>
      <iframe
        ref={frameRef}
        className="legacy-document-frame"
        src={source}
        title={title}
        onLoad={() => {
          setEditorLoaded(true);
          const frame = frameRef.current;
          if (frame?.contentWindow) {
            frame.contentWindow.postMessage({ type: 'SAGT_EDITOR_CONTEXT', module: moduleKey === 'surveys' ? 'survey' : 'invoice', userId: profile.id }, window.location.origin);
          }
          const payload = pendingLoadRef.current;
          if (frame?.contentWindow && payload) {
            pendingLoadRef.current = null;
            frame.contentWindow.postMessage({ type: 'SAGT_EDITOR_LOAD', module: moduleKey === 'surveys' ? 'survey' : 'invoice', payload }, window.location.origin);
          }
        }}
      />
    </section> : <section className="panel legacy-document-panel legacy-document-readonly">
      <div className="legacy-document-toolbar">
        <div><h3>{title}</h3><p className="small-text muted">View only · Your account can read saved records but cannot edit them.</p></div>
        <div className="legacy-document-toolbar-actions">
          <button className="btn secondary" type="button" aria-expanded={savedRecordsOpen} onClick={() => setSavedRecordsOpen((open) => !open)}>
            {savedRecordsOpen ? 'Hide saved records' : `Saved records (${savedRows.length})`}
          </button>
          <button className="btn secondary" type="button" onClick={() => void onRefresh()}>Refresh list</button>
        </div>
      </div>
    </section>}

    {savedRecordsOpen && <section className="panel workflow-panel legacy-saved-records">
      <div className="panel-header"><div><h3>Saved {moduleKey === 'surveys' ? 'survey reports' : 'invoices and quotations'}</h3><p>Records are read through the existing Supabase access policies. Only your own drafts can be reopened here.</p></div><span className="count-pill">{savedRows.length} records</span></div>
      <div className="table-wrap"><table><thead><tr><th>Title</th><th>Number</th><th>Client</th><th>Status</th><th>Last updated</th><th>Action</th></tr></thead><tbody>
        {savedRows.length === 0 ? <tr><td colSpan={6}>No saved records returned by the existing access policies.</td></tr> : savedRows.map((row, index) => {
          const rowId = String(row.id ?? index);
          const canReopen = editable && !editorDirty && canOpenDraft(moduleKey, row, profile.id);
          return <tr key={rowId}>
            <td>{displayText(row.title, 240) || 'Untitled'}</td>
            <td>{displayText(row.document_number, 100) || '—'}</td>
            <td>{displayText(row.client_name, 240) || '—'}</td>
            <td>{displayText(row.status, 32) || '—'}</td>
            <td>{row.updated_at ? new Date(String(row.updated_at)).toLocaleDateString() : '—'}</td>
            <td>{editable && editorDirty ? <span className="small-text muted">Save current changes first</span> : canReopen ? <button className="btn secondary" type="button" onClick={() => openDraft(row)}>Open draft</button> : '—'}</td>
          </tr>;
        })}
      </tbody></table></div>
    </section>}
  </div>;
}
