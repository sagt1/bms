export type EditorModule = 'documents' | 'surveys';
export type LegacyEditorPayload = Record<string, unknown>;
export type DocumentRow = Record<string, unknown>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

export function editorIdentity(moduleKey: EditorModule, payload: LegacyEditorPayload): string {
  const value = moduleKey === 'surveys' ? payload.editorId : payload.documentId;
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128 ? value : '';
}

export function matchesEditor(moduleKey: EditorModule, payload: LegacyEditorPayload): boolean {
  if (moduleKey === 'surveys') return payload.app === 'SAGT_A4_SURVEY_REPORT' && isRecord(payload.data);
  return typeof payload.schema === 'string'
    && /^SAGT-DOC-STUDIO-V\d+(?:\.\d+)?$/.test(payload.schema)
    && ['invoice', 'quotation'].includes(String(payload.type))
    && Array.isArray(payload.items);
}

export function canOpenDraft(moduleKey: EditorModule, row: DocumentRow, profileId: string): boolean {
  if (row.status !== 'draft' || row.created_by !== profileId || !isRecord(row.content)) return false;
  return matchesEditor(moduleKey, row.content);
}

export function databaseModule(moduleKey: EditorModule, payload: LegacyEditorPayload): 'invoice' | 'quotation' | 'survey' {
  if (moduleKey === 'surveys') return 'survey';
  return payload.type === 'quotation' ? 'quotation' : 'invoice';
}

export function documentFields(moduleKey: EditorModule, payload: LegacyEditorPayload) {
  const data = isRecord(payload.data) ? payload.data : {};
  const applicant = text(data.applicant, 240);
  const invoiceTitle = text(payload.title, 240) || (payload.type === 'quotation' ? 'Quotation' : 'Invoice');
  const number = moduleKey === 'surveys'
    ? text(data.documentNo, 100) || text(data.reportNo, 100)
    : text(payload.number, 100);

  return {
    module: databaseModule(moduleKey, payload),
    title: moduleKey === 'surveys' ? (applicant ? `Survey Report · ${applicant}`.slice(0, 240) : 'Survey Report') : invoiceTitle,
    document_number: number || null,
    client_name: moduleKey === 'surveys' ? applicant : text(payload.client, 240) || text(payload.customer, 240),
  };
}
