import { useEffect, useMemo, useRef, useState } from "react";
import { MenyuApi, MenyuApiError } from "./api";
import { defaultApiBase } from "./api-base";
import BracketWorkspace from "./components/BracketWorkspace";
import AudienceDisplayWorkspace from "./components/AudienceDisplayWorkspace";
import CheckInWorkspace from "./components/CheckInWorkspace";
import OverviewWorkspace from "./components/OverviewWorkspace";
import PrelimWorkspace from "./components/PrelimWorkspace";
import JudgeWorkspace from "./components/JudgeWorkspace";
import ReportsWorkspace from "./components/ReportsWorkspace";
import Shell from "./components/Shell";
import StaffAccessScreen from "./components/StaffAccessScreen";
import OfflineSyncPanel from "./components/OfflineSyncPanel";
import { OfflineClient, snapshotView, eventActions } from "./offline/client";
import { IndexedDbStore } from "./offline/store";
import "./offline.css";
import { unresolved, type OfflineDocument } from "./offline/types";
import { Button, Toast } from "./components/ui";
import { useI18n } from "./i18n";
import type { Division, EventConfiguration, EventData, EventLifecycleState, EventReport, EventSnapshot, Registration, Staff, Workspace } from "./types";

const read = (key: string, fallback: string) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Device storage may be unavailable. */ } };
const readSession = (key: string) => { try { return sessionStorage.getItem(key) || ""; } catch { return ""; } };
const writeSession = (key: string, value: string) => { try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); } catch { /* Session storage may be unavailable. */ } };
const judgePortal = window.location.pathname.replace(/\/+$/, "") === "/judge";
const judgeQuery = new URLSearchParams(window.location.search);
const validWorkspace = (value: string): Workspace => {
  if (value === "overview") return "now";
  if (value === "reports") return "records";
  return ["now", "checkin", "prelims", "bracket", "display", "records", "settings"].includes(value) ? value as Workspace : "now";
};

export default function App() {
  const { t } = useI18n();
  const [apiBase] = useState(defaultApiBase);
  const [eventId, setEventId] = useState(() => judgePortal ? judgeQuery.get("event") || read("menyuEventId", "") : read("menyuEventId", ""));
  const [events, setEvents] = useState<EventData[]>([]);
  const [event, setEvent] = useState<EventData | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [report, setReport] = useState<EventReport | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>(() => validWorkspace(read("menyuWorkspace", "now")));
  const [division, setDivision] = useState<Division>(() => judgePortal ? judgeQuery.get("division") || read("menyuDivision", "2v2") : read("menyuDivision", "2v2"));
  const [staffName, setStaffName] = useState(() => read("menyuStaffName", "Test Staff"));
  const [loginRole, setLoginRole] = useState(() => read("menyuLoginRole", "General staff"));
  const [connected, setConnected] = useState(false);
  const [syncState, setSyncState] = useState<"idle" | "live" | "updating" | "offline">("idle");
  const syncStateRef = useRef(syncState);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState("");
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const api = useMemo(() => new MenyuApi(apiBase), [apiBase]);
  const staff: Staff = useMemo(() => ({ name: staffName.trim() || "Unnamed staff", role: loginRole.trim() || "General staff" }), [loginRole, staffName]);
  const store = useMemo(() => new IndexedDbStore(), []);
  const offline = useMemo(() => new OfflineClient(store, apiBase, staff, (id, command) => api.syncOfflineAction(id, command)), [store, apiBase, staff, api]);
  const [deviceData, setDeviceData] = useState<OfflineDocument | null>(null);
  const [storageError, setStorageError] = useState("");
  const lastSnapshot = useRef<{ scope: string; snapshot: EventSnapshot } | null>(null);
  const currentView = useRef({ eventId, scope: offline.scope });
  currentView.current = { eventId, scope: offline.scope };
  const applySnapshot = (snapshot: EventSnapshot) => {
    if (snapshot.event.id !== currentView.current.eventId || offline.scope !== currentView.current.scope) return;
    setEvent(snapshot.event); setRegistrations(snapshot.registrations); setReport(snapshot.report);
    setDivision((current) => snapshot.event.configuration.divisions.some((item) => item.id === current) ? current : snapshot.event.configuration.divisions[0]?.id || current);
  };
  const applyDeviceData = (document: OfflineDocument, id = eventId) => {
    if (offline.scope !== currentView.current.scope) return;
    setDeviceData(document);
    // A failed disk cache write must not hide the queue or roll the on-screen
    // server snapshot backward. The durable document remains unmodified.
    const live = lastSnapshot.current?.scope === offline.scope ? lastSnapshot.current.snapshot : null;
    const base = live?.event.id === id && live.revision > (document.snapshots[id]?.snapshot.revision ?? -1)
      ? { ...document, snapshots: { ...document.snapshots, [id]: { snapshot: live, cachedAt: document.snapshots[id]?.cachedAt || "" } } } : document;
    const view = snapshotView(base, id); if (view) applySnapshot(view);
  };
  const saveRegistrationLocally = async (original: Registration, edited: Registration) => {
    const document = await offline.enqueue(eventId, original, edited);
    applyDeviceData(document);
    notify("Saved on this device. Waiting to sync.");
  };
  const syncDevice = async () => {
    try { await offline.sync(eventId); } finally { applyDeviceData(await offline.read()); }
    await loadEvent(eventId);
  };
  const resolveEdit = async (id: string, choice: "local" | "server") => {
    applyDeviceData(await offline.resolve(id, choice));
    notify("Resolution saved on this device. Waiting to sync.");
  };
  const notify = (message: string, error = false) => setToast({ message, error });
  const notifyError = (error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    const prefix = error instanceof MenyuApiError && [409, 412].includes(error.status) ? t("state.refreshed") : t("state.requestFailed");
    notify(`${prefix} ${detail}`, true);
  };
  const markOffline = (error: unknown) => { setConnected(false); setSyncState("offline"); if (error instanceof MenyuApiError && error.status < 500) notifyError(error); };

  useEffect(() => { syncStateRef.current = syncState; }, [syncState]);
  const markLive = () => {
    if (syncStateRef.current === "offline" && !judgePortal) notify(t("state.reconnected"));
    syncStateRef.current = "live";
    setConnected(true); setSyncState("live");
  };
  const loadEvent = async (id: string) => {
    if (!id) { setEvent(null); setRegistrations([]); setReport(null); return; }
    try {
      const snapshot = await api.snapshot(id);
      if (id === currentView.current.eventId && offline.scope === currentView.current.scope && (!lastSnapshot.current || lastSnapshot.current.scope !== offline.scope || lastSnapshot.current.snapshot.event.id !== id || snapshot.revision >= lastSnapshot.current.snapshot.revision)) lastSnapshot.current = { scope: offline.scope, snapshot };
      try { applyDeviceData(await offline.cache(snapshot), id); setStorageError(""); }
      catch (error) {
        try { applyDeviceData(await offline.read(), id); } catch { if (!deviceData?.actions.length) applySnapshot(snapshot); }
        setStorageError(`Offline saving unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
      markLive();
    } catch (error) {
      try { applyDeviceData(await offline.read(), id); } catch { /* Keep the last visible data when device storage also fails. */ }
      throw error;
    } finally { setLoading(false); }
  };
  const loadEvents = async (preferredEventId?: string) => {
    try {
      await api.health(); const result = await api.events(); setEvents(result); markLive(); setBootError("");
      const activeEvents = result.filter((item) => item.lifecycle?.status !== "archived"); const candidate = preferredEventId === undefined ? eventId : preferredEventId;
      const nextId = activeEvents.some((item) => item.id === candidate) ? candidate : activeEvents.at(-1)?.id || "";
      if (nextId !== eventId) setEventId(nextId); else await loadEvent(nextId);
    } catch (error) { markOffline(error); throw error; }
  };
  const refresh = async (throwOnError = false) => { try { await loadEvent(eventId); } catch (error) { markOffline(error); if (throwOnError) throw error; } };
  const login = async () => {
    try { setAuthBusy(true); setAuthError(""); const result = await api.login(accessCode.trim(), staff); api.setToken(result.token); setStaffName(result.staff.name); setLoginRole(result.staff.role); writeSession("menyuSessionToken", result.token); setAuthenticated(true); setAccessCode(""); await loadEvents(); }
    catch (error) { setAuthError(`${t("state.requestFailed")} ${error instanceof Error ? error.message : String(error)}`); setAuthenticated(false); }
    finally { setAuthBusy(false); setAuthReady(true); }
  };
  const logout = async () => {
    try { if (authenticated) await api.logout(); } catch { /* Session may already be expired. */ }
    api.setToken(""); writeSession("menyuSessionToken", ""); setAuthenticated(false); setDeviceData(null); setEvent(null); setRegistrations([]); setReport(null); setEvents([]); setConnected(false); setSyncState("idle");
  };
  const createEvent = async (payload: { name: string; eventTime: string; prelimsStartTime: string; location: string; timeZone: string; mode?: EventData["mode"]; judges: string[]; configuration: EventConfiguration; state: EventLifecycleState }) => {
    try { const created = await api.createEvent(payload, staff); setEvents((current) => [...current, created]); setEventId(created.id); notify(t("toast.eventCreated", { name: created.name })); }
    catch (error) { notifyError(error); }
  };
  const renameEvent = async (id: string, name: string) => { try { await api.updateEvent(id, { name }, staff); await loadEvents(id); notify(t("toast.eventUpdated")); } catch (error) { notifyError(error); } };
  const setEventArchiveState = async (id: string, action: "archive" | "restore") => { try { await api.setEventArchiveState(id, action, staff); await loadEvents(action === "archive" && id === eventId ? "" : id); notify(t(action === "archive" ? "toast.eventArchived" : "toast.eventRestored")); } catch (error) { notifyError(error); } };
  const deleteEvent = async (id: string) => { try { const result = await api.deleteEvent(id, staff); await loadEvents(id === eventId ? "" : eventId); notify(t("toast.eventDeleted", { name: result.deletedEvent.name })); } catch (error) { notifyError(error); } };
  const markStaffPresent = async () => { if (!eventId) return; try { await api.markStaffPresent(eventId, staff); await refresh(); notify(t("toast.staffPresent")); } catch (error) { notifyError(error); } };

  const bootstrap = async () => {
    setLoading(true); setBootError("");
    try {
      const token = readSession("menyuSessionToken"); if (token) api.setToken(token);
      const status = await api.authStatus();
      if (token) { api.setToken(token); await api.health(); setAuthenticated(true); await loadEvents(); }
      else if (!status.required) { setAuthenticated(true); await loadEvents(); }
    } catch (error) {
      if (error instanceof MenyuApiError && [401, 403].includes(error.status)) {
        api.setToken(""); writeSession("menyuSessionToken", ""); setAuthenticated(false); setAuthError(t("app.sessionExpired"));
      }
      try {
        const cached = await offline.read();
        if (!readSession("menyuSessionToken") || !cached.snapshots[eventId]) throw error;
        applyDeviceData(cached); setEvents(Object.values(cached.snapshots).map((entry) => entry.snapshot.event)); setAuthenticated(true); setConnected(false); setSyncState("offline");
      } catch { setBootError(error instanceof Error ? error.message : String(error)); }
    } finally { setAuthReady(true); setLoading(false); }
  };

  useEffect(() => {
    bootstrap();
    // First boot is intentionally tied to the configured API endpoint only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  useEffect(() => { api.setAuthErrorHandler(() => { api.setToken(""); writeSession("menyuSessionToken", ""); setAuthenticated(false); setAuthError(t("app.sessionExpired")); setEvent(null); setRegistrations([]); setReport(null); setEvents([]); }); return () => api.setAuthErrorHandler(null); }, [api, t]);
  useEffect(() => { api.setConflictHandler((conflictEventId) => { if (conflictEventId !== eventId) return; setSyncState("updating"); loadEvent(conflictEventId).catch(() => { setConnected(false); setSyncState("offline"); }); }); return () => api.setConflictHandler(null); }, [api, eventId]);
  useEffect(() => {
    if (!authenticated || !eventId) { setSyncState("idle"); return; }
    let stopped = false; let running = false; let failures = 0; let retryAt = 0;
    const poll = async (force = false) => { if (stopped || running || (!force && Date.now() < retryAt)) return; running = true; try {
      let queued = false;
      try { const document = await offline.read(); queued = eventActions(document, eventId).some((action) => !action.receipt && !action.supersededBy); applyDeviceData(document); }
      catch (error) { setStorageError(String(error)); }
      const status = await api.syncStatus(eventId);
      if (queued) { try { await offline.sync(eventId); } finally { applyDeviceData(await offline.read()); } }
      if (status.changed || queued) { setSyncState("updating"); await loadEvent(eventId); } else { markLive(); }
      failures = 0; retryAt = 0;
    } catch { if (!stopped) { failures += 1; retryAt = Date.now() + Math.min(30000, 1200 * 2 ** Math.min(failures - 1, 5)) * (0.8 + Math.random() * 0.2); setConnected(false); setSyncState("offline"); } } finally { running = false; } };
    const timer = window.setInterval(poll, 1200); const onVisibility = () => { if (document.visibilityState === "visible") void poll(true); }; document.addEventListener("visibilitychange", onVisibility); void poll();
    const onOnline = () => { void poll(true); };
    window.addEventListener("online", onOnline);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("online", onOnline); };
  }, [api, offline, authenticated, eventId]);
  useEffect(() => {
    write("menyuEventId", eventId);
    if (eventId && authenticated) {
      if (event?.id !== eventId) { setEvent(null); setRegistrations([]); setReport(null); setLoading(true); }
      offline.read().then((document) => { applyDeviceData(document); if (document.snapshots[eventId]) setLoading(false); }).catch(() => undefined);
      loadEvent(eventId).catch(markOffline);
    }
  }, [eventId, authenticated]);
  useEffect(() => { write("menyuWorkspace", workspace); }, [workspace]);
  useEffect(() => { write("menyuDivision", division); }, [division]);
  useEffect(() => { write("menyuStaffName", staffName); }, [staffName]);
  useEffect(() => { write("menyuLoginRole", loginRole); }, [loginRole]);
  useEffect(() => { if (!toast) return; const handle = window.setTimeout(() => setToast(null), 5200); return () => window.clearTimeout(handle); }, [toast]);

  let content: React.ReactNode;
  if (!authReady || (loading && !event && authenticated)) content = <div className="loading-state" role="status" aria-live="polite"><span aria-hidden="true" /><strong>{t("app.connecting")}</strong><p>{t("app.connectingHelp")}</p></div>;
  else if (bootError) content = <div className="loading-state loading-state--error" role="alert"><strong>{t("app.connectionFailed")}</strong><p>{bootError}</p><Button variant="primary" onClick={bootstrap}>{t("app.retry")}</Button></div>;
  else if (!authenticated) content = <StaffAccessScreen accessCode={accessCode} setAccessCode={setAccessCode} staffName={staffName} setStaffName={setStaffName} role={loginRole} setRole={setLoginRole} onLogin={login} busy={authBusy} error={authError} />;
  else if (judgePortal && eventId) content = <JudgeWorkspace api={api} eventId={eventId} division={division} onExit={() => { window.location.assign("/"); }} />;
  else if (workspace === "now" || workspace === "settings") content = <OverviewWorkspace api={api} event={event} eventId={eventId} report={report} staff={staff} events={events} onSelectEvent={setEventId} onRenameEvent={renameEvent} onSetArchiveState={setEventArchiveState} onDeleteEvent={deleteEvent} onWorkspace={setWorkspace} onCreateEvent={createEvent} onMarkPresent={markStaffPresent} refresh={refresh} notify={notify} writeDisabled={!connected} />;
  else if (!event || !eventId) content = <section className="empty-state"><span className="tape">NO EVENT</span><h1>{t("app.chooseEventFirst")}</h1></section>;
  else if (workspace === "checkin") content = <CheckInWorkspace api={api} eventId={eventId} event={event} division={division} registrations={registrations} people={event.people || []} spectatorCount={event.spectators.count} spectatorUndoAuditId={event.spectators.undoAuditId} staff={staff} refresh={() => refresh(true)} notify={notify} writeDisabled={!connected} loading={loading} onSaveLocally={deviceData?.snapshots[eventId] && !storageError ? saveRegistrationLocally : undefined} blockedEdits={deviceData ? eventActions(deviceData, eventId).filter(unresolved).map((action) => action.command.registrationId) : []} />;
  else if (workspace === "prelims") content = <PrelimWorkspace api={api} eventId={eventId} event={event} division={division} registrations={registrations} staff={staff} refresh={refresh} notify={notify} onOpenCheckIn={() => setWorkspace("checkin")} writeDisabled={!connected} loading={loading} />;
  else if (workspace === "bracket") content = <BracketWorkspace api={api} eventId={eventId} event={event} division={division} registrations={registrations} staff={staff} refresh={refresh} notify={notify} writeDisabled={!connected} />;
  else if (workspace === "display") content = <AudienceDisplayWorkspace event={event} eventId={eventId} division={division} />;
  else content = <ReportsWorkspace api={api} eventId={eventId} event={event} report={report} staff={staff} notify={notify} onRefresh={refresh} />;

  const toastView = toast && <Toast tone={toast.error ? "danger" : "good"} onDismiss={() => setToast(null)} dismissLabel={t("common.close")}>{toast.message}</Toast>;
  if (!authReady || !authenticated || judgePortal) return <>{content}{toastView}</>;
  const unsettled = deviceData && eventActions(deviceData, eventId).some(unresolved);
  const needsReview = deviceData && eventActions(deviceData, eventId).some((action) => unresolved(action) && action.receipt);
  return <><Shell workspace={workspace} onWorkspace={setWorkspace} division={division} onDivision={setDivision} events={events.filter((item) => item.lifecycle?.status !== "archived")} eventId={eventId} onEvent={setEventId} onReloadEvents={() => loadEvents(eventId).catch(() => undefined)} event={event} registrations={registrations} report={report} connected={connected} syncState={needsReview ? "review" : connected && unsettled ? "updating" : syncState} staffName={staffName} roles={loginRole.split(",").map((item) => item.trim()).filter(Boolean)} customRole={loginRole} onLogout={logout}><OfflineSyncPanel document={deviceData} eventId={eventId} connected={connected} error={storageError} onRetry={syncDevice} onResolve={resolveEdit} />{content}</Shell>{toastView}</>;
}
