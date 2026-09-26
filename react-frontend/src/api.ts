import type { BackupSummary, Bracket, Division, EventConfiguration, EventData, EventLifecycleState, EventReport, EventSnapshot, FinanceImportPreview, FinancialCategory, FinancialReport, ImportPreview, ImportSummary, JudgeSession, JudgingMonitorStatus, Match, PublicDisplayData, Registration, SharedTimer, Staff, SyncStatus } from "./types";

import type { ActionCommand, ActionReceipt } from "./offline/types";
type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown; trackRevision?: boolean };

export class MenyuApiError extends Error {
  constructor(message: string, public status: number, public code = "") { super(message); this.name = "MenyuApiError"; }
}

export class MenyuApi {
  private token = "";
  private revisions = new Map<string, number>();
  private conflictHandler: ((eventId: string) => void) | null = null;
  private authErrorHandler: (() => void) | null = null;
  private clockOffsetMs = 0;
  constructor(public baseUrl: string) {}

  setToken(token: string) { this.token = token; }
  setConflictHandler(handler: ((eventId: string) => void) | null) { this.conflictHandler = handler; }
  setAuthErrorHandler(handler: (() => void) | null) { this.authErrorHandler = handler; }
  revision(eventId: string) { return this.revisions.get(eventId); }
  serverClockOffset() { return this.clockOffsetMs; }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { trackRevision = true, ...fetchOptions } = options;
    const eventId = path.match(/^\/events\/([^/?]+)/)?.[1];
    const method = String(options.method || "GET").toUpperCase();
    const expectedRevision = trackRevision && eventId && ["POST", "PATCH", "DELETE"].includes(method) ? this.revisions.get(eventId) : undefined;
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
      ...fetchOptions,
      headers: { "Content-Type": "application/json", ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(expectedRevision !== undefined ? { "If-Match": `"${expectedRevision}"` } : {}), ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const type = response.headers.get("content-type") ?? "";
    const body = type.includes("application/json") ? await response.json() : await response.text();
    if (typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).serverNow === "string") this.clockOffsetMs = Date.parse(String((body as Record<string, unknown>).serverNow)) - Date.now();
    const responseRevision = Number(response.headers.get("x-event-revision"));
    if (!response.ok) {
      const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
      if (eventId && ["REVISION_CONFLICT", "REVISION_REQUIRED", "RESOURCE_CONFLICT", "RESOURCE_VERSION_REQUIRED", "TIMER_CONFLICT", "ALREADY_CHECKED_IN"].includes(String(record?.code || ""))) this.conflictHandler?.(eventId);
      if (response.status === 401 || response.status === 403) this.authErrorHandler?.();
      throw new MenyuApiError(String(record?.error ?? record?.message ?? body ?? `Request failed (${response.status})`), response.status, String(record?.code || ""));
    }
    if (trackRevision && eventId && Number.isInteger(responseRevision) && responseRevision >= 0) this.revisions.set(eventId, responseRevision);
    return body as T;
  }

  health() { return this.request<{ ok: boolean; at: string }>("/health"); }
  syncOfflineAction(eventId: string, command: ActionCommand) { return this.request<ActionReceipt>(`/events/${eventId}/offline-actions`, { method: "POST", body: { command }, trackRevision: false }); }
  authStatus() { return this.request<{ required: boolean }>("/auth/status"); }
  login(accessCode: string, staff: Staff) { return this.request<{ token: string; staff: Staff }>("/auth/login", { method: "POST", body: { accessCode, staff } }); }
  logout() { return this.request<{ loggedOut: boolean }>("/auth/logout", { method: "POST", body: {} }); }
  async events() {
    const events = await this.request<EventData[]>("/events");
    events.forEach((event) => { if (Number.isInteger(event.revision) && event.revision >= 0) this.revisions.set(event.id, event.revision); });
    return events;
  }
  createEvent(payload: { name: string; eventTime: string; prelimsStartTime: string; location: string; timeZone: string; mode?: EventData["mode"]; judges: string[]; configuration: EventConfiguration; state: EventLifecycleState }, staff: Staff) {
    return this.request<EventData>("/events", { method: "POST", body: { ...payload, staff } });
  }
  updateEvent(eventId: string, payload: { name?: string; eventTime?: string; prelimsStartTime?: string; location?: string; timeZone?: string; mode?: EventData["mode"]; judges?: string[]; judgesByDivision?: EventData["judgesByDivision"]; configuration?: EventConfiguration; state?: EventLifecycleState }, staff: Staff) {
    return this.request<EventData>(`/events/${eventId}`, { method: "PATCH", body: { ...payload, staff } });
  }
  setEventArchiveState(eventId: string, action: "archive" | "restore", staff: Staff) {
    return this.request<EventData>(`/events/${eventId}/archive`, { method: "POST", body: { action, staff } });
  }
  deleteEvent(eventId: string, staff: Staff) {
    return this.request<{ deleted: boolean; deletedEvent: { id: string; name: string; registrationCount: number; deletedAt: string; deletedBy: Staff } }>(`/events/${eventId}`, { method: "DELETE", body: { staff } });
  }
  event(eventId: string) { return this.request<EventData>(`/events/${eventId}`); }
  snapshot(eventId: string) { return this.request<EventSnapshot>(`/events/${eventId}/snapshot`); }
  syncStatus(eventId: string) { const after = this.revisions.get(eventId) ?? -1; return this.request<SyncStatus>(`/events/${eventId}/sync?after=${after}`, { trackRevision: false }); }
  backups(eventId: string) { return this.request<{ backups: BackupSummary[] }>(`/events/${eventId}/backups`); }
  createBackup(eventId: string, reason: string, staff: Staff) { return this.request<{ backup: BackupSummary }>(`/events/${eventId}/backups`, { method: "POST", body: { reason, staff } }); }
  restoreBackup(eventId: string, backupId: string, staff: Staff) { return this.request<{ event: EventData; restoredBackup: BackupSummary; safetyBackup: BackupSummary }>(`/events/${eventId}/backups/${backupId}/restore`, { method: "POST", body: { staff } }); }
  registrations(eventId: string) { return this.request<Registration[]>(`/events/${eventId}/registrations`); }
  report(eventId: string) { return this.request<EventReport & { auditLog: unknown[] }>(`/events/${eventId}/report`); }
  async downloadExport(eventId: string, kind: "combined" | "registrations" | "rankings" | "bracket" | "staff" | "finance", extension: "csv" | "pdf", language: string) {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/events/${eventId}/exports/${kind}.${extension}?lang=${encodeURIComponent(language)}`, {
      cache: "no-store",
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });
    if (!response.ok) {
      const type = response.headers.get("content-type") ?? "";
      const body: unknown = type.includes("application/json") ? await response.json() : await response.text();
      const record = typeof body === "object" && body !== null ? body as Record<string, unknown> : null;
      if (response.status === 401 || response.status === 403) this.authErrorHandler?.();
      throw new MenyuApiError(String(record?.error ?? record?.message ?? body ?? `Download failed (${response.status})`), response.status, String(record?.code || ""));
    }
    const filename = response.headers.get("content-disposition")?.match(/filename=\"?([^\";]+)\"?/i)?.[1] || `menyu-${kind}.${extension}`;
    const url = URL.createObjectURL(await response.blob());
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  finance(eventId: string) { return this.request<FinancialReport>(`/events/${eventId}/finance`); }
  addFinancialTransaction(eventId: string, transaction: { category: FinancialCategory; description: string; expectedAmount: number; actualAmount: number; party?: string; occurredAt?: string }, staff: Staff) {
    return this.request<{ report: FinancialReport }>(`/events/${eventId}/finance/transactions`, { method: "POST", body: { ...transaction, staff } });
  }
  previewFinancialImport(eventId: string, csv: string, staff: Staff) {
    return this.request<FinanceImportPreview>(`/events/${eventId}/finance/import/preview`, { method: "POST", body: { csv, staff } });
  }
  importFinancialRecords(eventId: string, csv: string, staff: Staff) {
    return this.request<{ imported: number; warnings: FinanceImportPreview["warnings"]; report: FinancialReport }>(`/events/${eventId}/finance/import`, { method: "POST", body: { csv, staff } });
  }
  reviewFinances(eventId: string, notes: string, staff: Staff) {
    return this.request<FinancialReport>(`/events/${eventId}/finance/review`, { method: "POST", body: { notes, staff } });
  }
  closeEventFinances(eventId: string, staff: Staff) {
    return this.request<FinancialReport>(`/events/${eventId}/finance/close`, { method: "POST", body: { staff } });
  }
  reopenEventFinances(eventId: string, reason: string, staff: Staff) {
    return this.request<FinancialReport>(`/events/${eventId}/finance/reopen`, { method: "POST", body: { reason, staff } });
  }
  correctFinancialTransaction(eventId: string, transactionId: string, correctedActualAmount: number, reason: string, staff: Staff) {
    return this.request<{ report: FinancialReport }>(`/events/${eventId}/finance/corrections`, { method: "POST", body: { transactionId, correctedActualAmount, reason, staff } });
  }

  importCsv(eventId: string, division: Division, csv: string, staff: Staff) {
    return this.request<{ imported: number; needsReview: number; duplicateWarnings: number; warnings: ImportPreview["warnings"]; importId: string; backup: BackupSummary; registrations: Registration[] }>(`/events/${eventId}/import`, { method: "POST", body: { bracket: division, csv, staff } });
  }
  previewImport(eventId: string, division: Division, source: { type: "csv"; content: string } | { type: "pdf"; content: string }, staff: Staff) {
    const body = source.type === "pdf" ? { bracket: division, source: "pdf", fileBase64: source.content, staff } : { bracket: division, csv: source.content, staff };
    return this.request<ImportPreview>(`/events/${eventId}/import/preview`, { method: "POST", body, trackRevision: false });
  }
  importFile(eventId: string, division: Division, source: { type: "csv"; content: string } | { type: "pdf"; content: string }, staff: Staff) {
    const body = source.type === "pdf" ? { bracket: division, source: "pdf", fileBase64: source.content, staff } : { bracket: division, csv: source.content, staff };
    return this.request<{ imported: number; needsReview: number; duplicateWarnings: number; warnings: ImportPreview["warnings"]; importId: string; backup: BackupSummary; registrations: Registration[] }>(`/events/${eventId}/import`, { method: "POST", body });
  }
  importHistory(eventId: string) {
    return this.request<{ imports: ImportSummary[] }>(`/events/${eventId}/imports`);
  }
  undoLastImport(eventId: string, staff: Staff) {
    return this.request<{ importId: string; removed: number; imports: ImportSummary[] }>(`/events/${eventId}/imports/undo`, { method: "POST", body: { staff } });
  }
  createRegistration(eventId: string, payload: Record<string, unknown>, staff: Staff) {
    return this.request<Registration>(`/events/${eventId}/registrations`, { method: "POST", body: { ...payload, staff } });
  }
  updateRegistration(eventId: string, registrationId: string, payload: Record<string, unknown>, staff: Staff) {
    return this.request<Registration>(`/events/${eventId}/registrations/${registrationId}`, { method: "PATCH", body: { ...payload, staff } });
  }
  cancelRegistration(eventId: string, registrationId: string, staff: Staff) {
    return this.request<Registration>(`/events/${eventId}/registrations/${registrationId}/cancel`, { method: "POST", body: { staff } });
  }
  restoreRegistration(eventId: string, registrationId: string, staff: Staff) {
    return this.request<Registration>(`/events/${eventId}/registrations/${registrationId}/restore`, { method: "POST", body: { staff } });
  }
  linkPerson(eventId: string, registrationId: string, memberIndex: number, personId: string, staff: Staff) {
    return this.request<Registration>(`/events/${eventId}/registrations/${registrationId}/link-person`, { method: "POST", body: { memberIndex, personId, staff } });
  }
  checkIn(eventId: string, registrationId: string, memberIndex: number, staff: Staff) {
    return this.request<{ message: string; registration: Registration }>(`/events/${eventId}/registrations/${registrationId}/check-in`, { method: "POST", body: { memberIndex, staff } });
  }
  undoCheckIn(eventId: string, registrationId: string, memberIndex: number, staff: Staff) {
    return this.request<Registration>(`/events/${eventId}/registrations/${registrationId}/undo-check-in`, { method: "POST", body: { memberIndex, staff } });
  }
  resolveDuplicate(eventId: string, registrationId: string, action: "ignore" | "delete", staff: Staff) {
    return this.request<{ deleted: boolean; registration?: Registration }>(`/events/${eventId}/registrations/${registrationId}/resolve-duplicate`, { method: "POST", body: { action, staff } });
  }
  addSpectator(eventId: string, staff: Staff) {
    return this.request<EventData["spectators"]>(`/events/${eventId}/spectators`, { method: "POST", body: { staff } });
  }
  undoSpectator(eventId: string, auditId: string, staff: Staff) {
    return this.request<EventData["spectators"]>(`/events/${eventId}/spectators/undo`, { method: "POST", body: { auditId, staff } });
  }
  controlTimer(eventId: string, scope: "prelims" | "bracket", division: Division, action: "start" | "pause" | "reset", expectedTimerVersion: number, staff: Staff, durationSeconds?: number) {
    return this.request<SharedTimer>(`/events/${eventId}/timers/${scope}/${division}`, { method: "POST", body: { action, expectedTimerVersion, ...(durationSeconds === undefined ? {} : { durationSeconds }), staff } });
  }
  markStaffPresent(eventId: string, staff: Staff) {
    return this.request<{ staffAttendance: EventData["staffAttendance"] }>(`/events/${eventId}/staff-attendance`, { method: "POST", body: { staff } });
  }
  generatePrelimOrder(eventId: string, division: Division, staff: Staff) {
    return this.request<Registration[]>(`/events/${eventId}/prelim-order`, { method: "POST", body: { bracket: division, staff } });
  }
  qualifierHandoff(eventId: string, division: Division) {
    return this.request<{ division: Division; cutoff: number; revision: number; entries: { seed: number; number: string; name: string; average: number | null }[] }>(`/events/${eventId}/handoff/${division}`);
  }
  advancePrelim(eventId: string, division: Division, action: "next" | "previous", staff: Staff) {
    return this.request<EventData["prelimOrders"][Division]>(`/events/${eventId}/prelim-progress`, { method: "POST", body: { bracket: division, action, staff } });
  }
  saveScore(eventId: string, registrationId: string, judgeNumber: number, score: number, judgeName: string, expectedUpdatedAt: string, staff: Staff) {
    return this.request<Registration>(`/events/${eventId}/registrations/${registrationId}/scores`, { method: "POST", body: { judgeNumber, score, judgeName, expectedUpdatedAt, staff } });
  }
  judgeSession(eventId: string, division: Division) {
    return this.request<JudgeSession>(`/events/${eventId}/judging/${division}/session`);
  }
  judgingStatus(eventId: string, division: Division) {
    return this.request<JudgingMonitorStatus>(`/events/${eventId}/judging/${division}/status`);
  }
  assignJudge(eventId: string, division: Division, judgeNumber: number, staffName: string) {
    return this.request<{ id: string; judgeNumber: number; judgeName: string; staffName: string; assignedAt: string }>(`/events/${eventId}/judging/${division}/assignments`, { method: "POST", body: { judgeNumber, staffName } });
  }
  saveJudgeScore(eventId: string, division: Division, registrationId: string, score: number, state: "draft" | "submitted", expectedUpdatedAt: string) {
    return this.request<{ registration: Registration; score: { judgeNumber: number; state: "draft" | "submitted" | "locked" | "corrected"; score: number | null }; locked: boolean }>(`/events/${eventId}/judging/${division}/score`, { method: "POST", body: { registrationId, score, state, expectedUpdatedAt } });
  }
  correctJudgeScore(eventId: string, division: Division, registrationId: string, judgeNumber: number, score: number, reason: string, expectedUpdatedAt: string) {
    return this.request<{ registration: Registration }>(`/events/${eventId}/judging/${division}/corrections`, { method: "POST", body: { registrationId, judgeNumber, score, reason, expectedUpdatedAt } });
  }
  rankPrelims(eventId: string, division: Division, staff: Staff) {
    return this.request<Registration[]>(`/events/${eventId}/rankings`, { method: "POST", body: { bracket: division, staff } });
  }
  savePrelimTieBreak(eventId: string, division: Division, registrationIds: string[], staff: Staff) {
    return this.request<{ rankings: Registration[] }>(`/events/${eventId}/prelim-tiebreak`, { method: "POST", body: { bracket: division, registrationIds, staff } });
  }
  overrideRanking(eventId: string, division: Division, registrationId: string, rank: number, reason: string, staff: Staff) {
    return this.request<Registration>(`/events/${eventId}/rankings/override`, { method: "POST", body: { bracket: division, registrationId, rank, reason, staff } });
  }
  bracket(eventId: string, division: Division) {
    return this.request<Bracket | { error: string }>(`/events/${eventId}/bracket/${division}`);
  }
  generateBracket(eventId: string, division: Division, staff: Staff, replace = false) {
    return this.request<Bracket>(`/events/${eventId}/bracket`, { method: "POST", body: { bracket: division, replace, staff } });
  }
  saveBracketSeeds(eventId: string, division: Division, registrationIds: string[], staff: Staff) {
    return this.request<{ registrationIds: string[]; at: string; staffName: string; staffRole: string }>(`/events/${eventId}/bracket-seeds`, { method: "POST", body: { bracket: division, registrationIds, staff } });
  }
  completePerformanceRound(eventId: string, division: Division, matchId: string, staff: Staff) {
    return this.request<Match>(`/events/${eventId}/bracket/${division}/matches/${matchId}/complete-performance-round`, { method: "POST", body: { staff } });
  }
  recordMatchOutcome(eventId: string, division: Division, matchId: string, outcome: string | "tie", staff: Staff) {
    return this.request<Match>(`/events/${eventId}/bracket/${division}/matches/${matchId}/decision`, { method: "POST", body: { outcome, staff } });
  }
  undoDecision(eventId: string, division: Division, matchId: string, staff: Staff) {
    return this.request(`/events/${eventId}/bracket/${division}/matches/${matchId}/undo-decision`, { method: "POST", body: { staff } });
  }
}

export async function fetchPublicDisplay(baseUrl: string, eventId: string, division: Division, signal?: AbortSignal): Promise<PublicDisplayData> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/public/events/${encodeURIComponent(eventId)}/display?division=${encodeURIComponent(division)}`, { cache: "no-store", signal });
  const body: unknown = await response.json();
  if (!response.ok) {
    const record = typeof body === "object" && body !== null ? body as Record<string, unknown> : null;
    throw new MenyuApiError(String(record?.error || `Display request failed (${response.status})`), response.status);
  }
  return body as PublicDisplayData;
}
