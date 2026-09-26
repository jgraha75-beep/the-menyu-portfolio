import { useEffect, useMemo, useRef, useState } from "react";
import type { MenyuApi } from "../api";
import { useI18n } from "../i18n";
import type { Division, EventData, ImportPreview, ImportSummary, Registration, Staff } from "../types";
import { divisionConfig, formatEventTime, registrationTitle, yen } from "../utils";
import { CsvDialog, RegistrationDialog, WalkInDialog, type WalkInDraft } from "./arrival/ArrivalDialogs";
import { Alert, Badge, Button, Card, Icon, Input, Select, SelectableRow, Table, Tabs } from "./ui";

type Props = {
  api: MenyuApi;
  eventId: string;
  event: EventData;
  division: Division;
  registrations: Registration[];
  people: Array<{ id: string; name: string }>;
  spectatorCount: number;
  spectatorUndoAuditId?: string | null;
  staff: Staff;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  writeDisabled?: boolean;
  loading?: boolean;
  onSaveLocally?: (original: Registration, edited: Registration) => Promise<void>;
  blockedEdits?: string[];
};

type Filter = "all" | "waiting" | "partial" | "checked" | "review";
type Dialog = "walkin" | "import" | null;
type BadgeTone = "neutral" | "good" | "warn" | "danger";
type ArrivalFeedback = {
  registrationId: string;
  memberName: string;
  action: "checkin" | "undo";
  amountRecorded: number;
  checkedInCount: number;
  memberCount: number;
  nextMemberName: string | null;
};

const initialWalkIn: WalkInDraft = { name: "", members: "", email: "", instagram: "", dob: "", parentName: "" };

const statusTone = (status: Registration["status"]): BadgeTone => status === "Checked in" ? "good" : status === "Partial" ? "warn" : status === "Canceled" ? "danger" : "neutral";
const statusClass = (status: Registration["status"]) => status === "Checked in" ? "present" : status === "Partial" ? "partial" : status === "Canceled" ? "canceled" : "waiting";

export default function CheckInWorkspace({ api, eventId, event, division, registrations, people, spectatorCount, spectatorUndoAuditId, staff, refresh, notify, writeDisabled = false, loading = false, onSaveLocally, blockedEdits = [] }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState("");
  const [walkIn, setWalkIn] = useState(initialWalkIn);
  const [busy, setBusy] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importSource, setImportSource] = useState<{ type: "csv" | "pdf"; content: string } | null>(null);
  const [importHistory, setImportHistory] = useState<ImportSummary[]>([]);
  const [editor, setEditor] = useState<Registration | null>(null);
  const editorBase = useRef<Registration | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [arrivalFeedback, setArrivalFeedback] = useState<ArrivalFeedback | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const nextMemberActionRef = useRef<HTMLButtonElement>(null);
  const divisionSettings = divisionConfig(event, division);

  const divisionRecords = useMemo(() => registrations.filter((item) => item.bracket === division), [division, registrations]);
  const counts = useMemo(() => ({
    all: divisionRecords.length,
    waiting: divisionRecords.filter((item) => item.status === "Registered").length,
    partial: divisionRecords.filter((item) => item.status === "Partial").length,
    checked: divisionRecords.filter((item) => item.status === "Checked in").length,
    review: divisionRecords.filter((item) => item.needsReview || Boolean(item.duplicateOf?.length && !item.duplicateIgnored)).length,
  }), [divisionRecords]);
  const visible = useMemo(() => divisionRecords.filter((item) => {
    if (filter === "waiting" && item.status !== "Registered") return false;
    if (filter === "partial" && item.status !== "Partial") return false;
    if (filter === "checked" && item.status !== "Checked in") return false;
    if (filter === "review" && !item.needsReview && (!item.duplicateOf?.length || item.duplicateIgnored)) return false;
    const haystack = [item.sourceNumber, item.displayCode, item.teamName, item.entryName, item.memberNames, item.email, item.phone, item.instagramTeam, ...(item.instagramMembers || [])].join(" ").toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [divisionRecords, filter, query]);
  const selected = registrations.find((item) => item.id === selectedId) || null;
  const nextArrival = selected?.members.find((member) => !member.checkedIn);
  const arrivalLabel = (member: Registration["members"][number], next = false) => {
    if (!member.checkInQuote) return t(next ? "checkin.recordNextArrival" : "checkin.recordArrivalPayment", { amount: t("status.paymentPending") });
    return t(next ? "checkin.recordNextArrival" : "checkin.recordArrivalPayment", { amount: yen(member.checkInQuote.total) });
  };

  useEffect(() => {
    if (!visible.some((item) => item.id === selectedId)) setSelectedId(visible[0]?.id || "");
  }, [selectedId, visible]);
  useEffect(() => { setArrivalFeedback(null); }, [selectedId]);
  useEffect(() => {
    if (typeof api.importHistory !== "function") return;
    let active = true;
    void api.importHistory(eventId).then((result) => { if (active) setImportHistory(result.imports.filter((item) => item.division === division)); }).catch(() => { if (active) setImportHistory([]); });
    return () => { active = false; };
  }, [api, division, eventId]);
  useEffect(() => {
    if (!arrivalFeedback || arrivalFeedback.registrationId !== selectedId) return;
    const frame = window.requestAnimationFrame(() => {
      if (arrivalFeedback.action === "checkin" && arrivalFeedback.nextMemberName) nextMemberActionRef.current?.focus();
      if (arrivalFeedback.action === "checkin" && !arrivalFeedback.nextMemberName) searchRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [arrivalFeedback, selectedId]);

  const run = async <Result,>(key: string, action: () => Promise<Result>, success: string, onSuccess?: (result: Result) => void) => {
    if (writeDisabled) return notify(t("state.offlineWrite"), true);
    if (blockedEdits.some((id) => key.includes(id))) return notify("Sync or resolve this registration's saved edit first.", true);
    try {
      setBusy(key);
      const result = await action();
      onSuccess?.(result);
      try { await refresh(); notify(success); }
      catch { notify(t("state.savedRefreshFailed"), true); }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy("");
    }
  };
  const duplicateWarning = (registration: Registration) => Boolean(registration.duplicateOf?.length && !registration.duplicateIgnored);
  const editRegistration = (registration: Registration) => {
    if (blockedEdits.includes(registration.id)) return notify("Sync or resolve this registration's saved edit first.", true);
    editorBase.current = structuredClone(registration);
    setEditor(structuredClone(registration));
  };
  const handleMemberArrival = (registration: Registration, member: Registration["members"][number], index: number) => {
    const actionKey = `${registration.id}-${index}`;
    const memberName = member.name || `${t("checkin.member")} ${index + 1}`;
    if (member.checkedIn) {
      return run(actionKey, () => api.undoCheckIn(eventId, registration.id, index, staff), t("toast.checkInUndone"), () => {
        setArrivalFeedback({ registrationId: registration.id, memberName, action: "undo", amountRecorded: 0, checkedInCount: 0, memberCount: 0, nextMemberName: null });
      });
    }
    return run(actionKey, () => api.checkIn(eventId, registration.id, index, staff), t("toast.checkedIn"), ({ registration: updated }) => {
      const nextMember = updated.members.find((candidate) => !candidate.checkedIn);
      setArrivalFeedback({
        registrationId: registration.id,
        memberName,
        action: "checkin",
        amountRecorded: Math.max(0, updated.payment.total - registration.payment.total),
        checkedInCount: updated.members.filter((candidate) => candidate.checkedIn).length,
        memberCount: updated.members.length,
        nextMemberName: nextMember?.name || null,
      });
    });
  };

  const readImportSource = async (selectedFile: File) => {
    const type = selectedFile.name.toLowerCase().endsWith(".pdf") || selectedFile.type === "application/pdf" ? "pdf" : "csv";
    if (type === "csv") return { type, content: await selectedFile.text() } as const;
    const bytes = new Uint8Array(await selectedFile.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return { type, content: btoa(binary) } as const;
  };
  const handleFileChange = (selectedFile: File | null) => { setFile(selectedFile); setPreview(null); setImportSource(null); };
  const reviewImport = async () => {
    if (writeDisabled) return notify(t("state.offlineWrite"), true);
    if (!file) return notify(t("checkin.chooseCsv"), true);
    try { setBusy("import-preview"); const source = await readImportSource(file); setImportSource(source); setPreview(await api.previewImport(eventId, division, source, staff)); }
    catch (error) { notify(error instanceof Error ? error.message : String(error), true); }
    finally { setBusy(""); }
  };
  const handleImport = async () => {
    if (writeDisabled) return notify(t("state.offlineWrite"), true);
    if (!importSource || !preview?.canImport) return notify(t("checkin.importErrors"), true);
    try {
      setBusy("import");
      const result = await api.importFile(eventId, division, importSource, staff);
      setDialog(null);
      setFile(null); setPreview(null); setImportSource(null);
      try { await refresh(); notify(`${t("checkin.importSaved")} ${result.imported} · ${result.needsReview} ${t("checkin.needsReview")}`); }
      catch { notify(t("checkin.importRefreshFailed"), true); }
      try { setImportHistory((await api.importHistory(eventId)).imports.filter((item) => item.division === division)); } catch { /* The saved result remains truthful even if history refresh is unavailable. */ }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy("");
    }
  };
  const latestImport = importHistory.find((item) => !item.undone) || null;
  const undoImport = async () => {
    if (!latestImport || writeDisabled || !window.confirm(t("checkin.undoImportConfirm"))) return;
    try { setBusy("import-undo"); const result = await api.undoLastImport(eventId, staff); try { await refresh(); notify(`${t("checkin.importUndone")} ${result.removed}`); } catch { notify(t("state.savedRefreshFailed"), true); } setImportHistory(result.imports.filter((item) => item.division === division)); }
    catch (error) { notify(error instanceof Error ? error.message : String(error), true); }
    finally { setBusy(""); }
  };

  const addWalkIn = async () => {
    if (writeDisabled) return notify(t("state.offlineWrite"), true);
    if (!walkIn.name.trim()) return notify(divisionSettings.teamSize > 1 ? t("checkin.teamName") : t("checkin.battlerName"), true);
    if (divisionSettings.teamSize > 1 && !walkIn.members.trim()) return notify(t("checkin.memberNames"), true);
    await run("walkin", async () => {
      const created = await api.createRegistration(eventId, {
        bracket: division,
        teamName: divisionSettings.teamSize > 1 ? walkIn.name : "",
        entryName: divisionSettings.teamSize === 1 ? walkIn.name : "",
        memberNames: divisionSettings.teamSize > 1 ? walkIn.members : "",
        email: walkIn.email,
        instagramTeam: divisionSettings.teamSize > 1 ? walkIn.instagram : "",
        instagramMembers: divisionSettings.teamSize === 1 && walkIn.instagram ? [walkIn.instagram] : [],
        dob: divisionSettings.teamSize === 1 ? walkIn.dob : "",
        parentName: divisionSettings.teamSize === 1 ? walkIn.parentName : "",
      }, staff);
      setSelectedId(created.id);
      setWalkIn(initialWalkIn);
      setDialog(null);
    }, t("toast.walkInCreated"));
  };

  const saveEditor = async () => {
    if (!editor) return;
    if (onSaveLocally && editorBase.current) {
      setBusy(`edit-${editor.id}`);
      try { await onSaveLocally(editorBase.current, editor); setEditor(null); }
      catch (error) { notify(error instanceof Error ? error.message : String(error), true); }
      finally { setBusy(""); }
      return;
    }
    await run(`edit-${editor.id}`, async () => {
      await api.updateRegistration(eventId, editor.id, {
        teamName: editor.teamName,
        memberNames: editor.memberNames,
        entryName: editor.entryName,
        dob: editor.dob,
        parentName: editor.parentName,
        genre: editor.genre,
        region: editor.region,
        email: editor.email,
        phone: editor.phone,
        instagramTeam: editor.instagramTeam,
        instagramMembers: editor.instagramMembers,
        notes: editor.notes,
        needsReview: editor.needsReview,
        reviewReasons: editor.reviewReasons,
        expectedUpdatedAt: editor.updatedAt,
      }, staff);
      setEditor(null);
    }, t("toast.registrationUpdated"));
  };

  const filterItems = (["all", "waiting", "partial", "checked", "review"] as Filter[]).map((item) => ({
    id: item,
    label: item === "all" ? t("common.all") : item === "checked" ? t("checkin.present") : t(`checkin.${item}`),
    count: counts[item],
  }));

  if (loading) return <section className="arrival-desk arrival-desk--loading" aria-busy="true" aria-live="polite">
    <div className="arrival-loading-state"><span aria-hidden="true" /><strong>{t("checkin.loading")}</strong><p>{t("checkin.loadingHelp")}</p></div>
  </section>;

  return <div className="arrival-desk">
    <header className="arrival-heading">
      <div>
        <h1>{t("checkin.title")}</h1>
        <p>{t("checkin.flowHelp")}</p>
      </div>
      <div className="arrival-heading__actions">
        <Button variant="ghost" disabled={writeDisabled} aria-describedby={writeDisabled ? "offline-write-help" : undefined} onClick={() => setDialog("import")}><Icon name="plus" size={16} />{t("checkin.import")}</Button>
        <Button variant="secondary" disabled={writeDisabled} aria-describedby={writeDisabled ? "offline-write-help" : undefined} onClick={() => setDialog("walkin")}><Icon name="plus" size={16} />{t("checkin.add")}</Button>
      </div>
    </header>

    <section className="arrival-toolbar" aria-label={t("checkin.controls")}>
      <label className="arrival-search">
        <Icon name="search" size={20} />
        <Input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("checkin.search")} aria-label={t("checkin.search")} />
      </label>
      <div className="arrival-spectator-actions">
      <Button variant="secondary" className="arrival-spectator" disabled={writeDisabled || Boolean(busy)} aria-describedby={writeDisabled ? "offline-write-help" : undefined} onClick={() => run("spectator", () => api.addSpectator(eventId, staff), t("toast.spectatorAdded"))}>
        <span><Icon name="plus" size={16} />{t("checkin.spectator")}</span><b>{spectatorCount}</b>
      </Button>
      <Button variant="secondary" disabled={writeDisabled || Boolean(busy) || !spectatorUndoAuditId || spectatorCount < 1} busy={busy === "spectator-undo"} onClick={() => {
        if (spectatorUndoAuditId && window.confirm(t("checkin.undoSpectatorConfirm"))) void run("spectator-undo", () => api.undoSpectator(eventId, spectatorUndoAuditId, staff), t("toast.spectatorUndone"));
      }}>{t("checkin.undoSpectator")}</Button>
      </div>
    </section>

    {latestImport && <section className="arrival-import-history" aria-label={t("checkin.importHistory")}>
      <div><span className="ui-eyebrow">{t("checkin.latestImport")}</span><strong>{latestImport.count} · {latestImport.sourceType.toUpperCase()}</strong><small>{formatEventTime(latestImport.createdAt, "Asia/Tokyo")}</small></div>
      <Button size="sm" variant="secondary" busy={busy === "import-undo"} disabled={writeDisabled || Boolean(busy)} onClick={undoImport}>{t("checkin.undoImport")}</Button>
    </section>}

    <Tabs items={filterItems} active={filter} onChange={(id) => setFilter(id as Filter)} className="arrival-tabs" ariaLabel={t("checkin.status")} />

    <div className="arrival-workbench">
      <Table className="arrival-ledger">
        <div className="arrival-ledger__head ui-table__head">
          <span>{t("checkin.registration")}</span><span>{t("checkin.status")}</span><span>{t("checkin.payment")}</span>
        </div>
        <div className="arrival-ledger__body">
          {visible.map((registration) => <SelectableRow
            className={`arrival-record arrival-record--${statusClass(registration.status)}${selectedId === registration.id ? " selected" : ""}`}
            key={registration.id}
            onClick={() => setSelectedId(registration.id)}
            selected={selectedId === registration.id}
          >
            <span className="arrival-record__avatar">{registrationTitle(registration).slice(0, 2).toUpperCase()}</span>
            <span className="arrival-record__main">
              <code>{registration.sourceNumber ? `#${registration.sourceNumber}` : registration.displayCode}</code>
              <strong>{registrationTitle(registration)}</strong>
              <small>{registration.memberNames || registration.genre || (registration.registrationSource === "same_day" ? t("checkin.sameDay") : t("checkin.early"))}</small>
            </span>
            <Badge tone={statusTone(registration.status)}>{t(`status.${registration.status}`)}</Badge>
            <span className={`arrival-record__payment${registration.payment.total > 0 ? " paid" : ""}`}>{registration.payment.total > 0 ? yen(registration.payment.total) : t("status.paymentPending")}</span>
          </SelectableRow>)}
          {!visible.length && <div className="arrival-ledger__empty">
            <Icon name="search" size={22} /><strong>{divisionRecords.length ? t("checkin.noMatches") : t("checkin.noDivision", { division: divisionSettings.name })}</strong><p>{divisionRecords.length ? t("checkin.clearSearchHelp") : t("checkin.noDivisionHelp")}</p>{divisionRecords.length ? <Button size="sm" onClick={() => { setQuery(""); setFilter("all"); }}>{t("checkin.clearSearch")}</Button> : <div className="arrival-empty-actions"><Button size="sm" variant="primary" disabled={writeDisabled} onClick={() => setDialog("import")}>{t("checkin.import")}</Button><Button size="sm" variant="secondary" disabled={writeDisabled} onClick={() => setDialog("walkin")}>{t("checkin.add")}</Button></div>}
          </div>}
        </div>
        <footer>{t("common.shown", { count: visible.length })}</footer>
      </Table>

      <section className="arrival-detail">
        {selected ? <>
          <header className="arrival-ticket">
            <div className="arrival-ticket__stub"><span>CHIP<br />CHOP</span><b>{selected.sourceNumber ? `#${selected.sourceNumber}` : selected.displayCode}</b><small>{divisionConfig(event, selected.bracket).name.toUpperCase()}</small></div>
            <div className="arrival-ticket__body">
              <span className="ui-eyebrow">{t("checkin.registration")}</span>
              <h2>{registrationTitle(selected)}</h2>
              <div className="arrival-ticket__meta">
                <span>{t("checkin.status")}<Badge tone={statusTone(selected.status)}>{t(`status.${selected.status}`)}</Badge></span>
                <span>{t("checkin.payment")}<b>{selected.payment.total > 0 ? yen(selected.payment.total) : t("status.paymentPending")}</b></span>
                <span>SOURCE<b>{selected.registrationSource === "same_day" ? t("checkin.sameDay") : t("checkin.early")}</b></span>
              </div>
            </div>
          </header>

          {(selected.needsReview || duplicateWarning(selected)) && <div className="arrival-alerts">
            {selected.needsReview && <Alert tone="warn" title={t("checkin.needsReview")}>{selected.reviewReasons.join(" · ") || t("attention.reviewHelp")}</Alert>}
            {duplicateWarning(selected) && <Card tone="danger" className="arrival-duplicate">
              <div><span className="ui-eyebrow">{t("checkin.duplicate")}</span><p>{t("attention.duplicatesHelp")}</p></div>
              <div>
                <Button size="sm" disabled={busy === `duplicate-${selected.id}`} onClick={() => run(`duplicate-${selected.id}`, () => api.resolveDuplicate(eventId, selected.id, "ignore", staff), t("toast.duplicateIgnored"))}>{t("checkin.ignoreDuplicate")}</Button>
                <Button size="sm" variant="danger" disabled={busy === `duplicate-${selected.id}`} onClick={() => run(`duplicate-${selected.id}`, () => api.resolveDuplicate(eventId, selected.id, "delete", staff), t("toast.duplicateRemoved"))}>{t("checkin.removeDuplicate")}</Button>
              </div>
            </Card>}
          </div>}

          {writeDisabled && <Alert tone="warn" className="arrival-flow-feedback" title={t("checkin.offlineTitle")}>{t("checkin.offlineHelp")} <Button size="sm" variant="secondary" onClick={() => { void refresh().catch(() => undefined); }}>{t("state.retryNow")}</Button></Alert>}
          {selected.status === "Canceled" && <Alert tone="danger" className="arrival-flow-feedback" title={t("checkin.blockedTitle")}>{t("checkin.canceledHelp")}</Alert>}
          {arrivalFeedback?.registrationId === selected.id && <Alert tone="good" className="arrival-flow-feedback" title={arrivalFeedback.action === "checkin" ? t("toast.checkedIn") : t("toast.checkInUndone")}>
            {arrivalFeedback.action === "checkin" ? <>
              <strong>{arrivalFeedback.memberName}</strong> · {t("checkin.cashRecorded", { amount: yen(arrivalFeedback.amountRecorded) })} · {t("checkin.teamProgress", { present: arrivalFeedback.checkedInCount, total: arrivalFeedback.memberCount })} · {arrivalFeedback.nextMemberName ? `${t("prelims.next")}: ${arrivalFeedback.nextMemberName}` : t("checkin.nextSearch")}
            </> : t("checkin.flowHelp")}
          </Alert>}

          <div className="arrival-section-heading">
            <div><span className="ui-eyebrow">{t("checkin.teamMembers")}</span><h3>{t("checkin.teamArrival", { present: selected.members.filter((member) => member.checkedIn).length, total: selected.members.length })}</h3></div>
            <Badge tone={nextArrival ? "warn" : "good"}>{nextArrival ? t("checkin.incomplete") : t("checkin.allPresent")}</Badge>
          </div>

          <div className="arrival-members">
            {selected.members.map((member, index) => {
              const actionKey = `${selected.id}-${index}`;
              const linkKey = `link-${selected.id}-${index}`;
              const isNextArrival = !member.checkedIn && nextArrival === member;
              return <Card tone={member.checkedIn ? "success" : "warning"} className={`arrival-member${member.checkedIn ? " checked" : ""}${isNextArrival ? " next" : ""}`} key={actionKey}>
                <div className="arrival-member__number">{index + 1}</div>
                <div className="arrival-member__name"><strong>{member.name || `${t("checkin.member")} ${index + 1}`}</strong><small>{selected.instagramMembers[index] || member.instagram || "—"}</small></div>
                <Badge tone={member.checkedIn ? "good" : "warn"}>{member.checkedIn ? t("checkin.present") : t("checkin.memberMissing")}</Badge>
                <Button ref={isNextArrival ? nextMemberActionRef : undefined} full variant={member.checkedIn ? "ghost" : isNextArrival ? "primary" : "secondary"} busy={busy === actionKey} busyLabel={member.checkedIn ? t("checkin.undoing") : t("checkin.recordingArrival")} disabled={writeDisabled || blockedEdits.includes(selected.id) || selected.status === "Canceled"} aria-describedby={writeDisabled ? "offline-write-help" : undefined} onClick={() => handleMemberArrival(selected, member, index)}>
                  {member.checkedIn ? t("checkin.undo") : arrivalLabel(member, isNextArrival)}
                </Button>
                {!member.checkedIn && member.checkInQuote && <small className="arrival-member__quote">{t("checkin.entry")}: {yen(member.checkInQuote.entryMoney)} · {t("checkin.drink")}: {yen(member.checkInQuote.drinkMoney)}</small>}
                {member.checkedIn && <small className="arrival-member__time">{t("checkin.checkedAt", { time: formatEventTime(member.arrivedAt, "Asia/Tokyo") })}</small>}
                {people.some((person) => person.id !== member.personId) && <details className="arrival-member__link">
                  <summary>{t("checkin.linkPerson")}</summary>
                  <Select aria-label={t("checkin.linkPerson")} disabled={busy === linkKey} defaultValue="" onChange={(event) => { if (event.target.value) run(linkKey, () => api.linkPerson(eventId, selected.id, index, event.target.value, staff), t("toast.personLinked")); }}>
                    <option value="">{t("checkin.noChange")}</option>
                    {people.filter((person) => person.id !== member.personId).map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}
                  </Select>
                </details>}
              </Card>;
            })}
          </div>

          {blockedEdits.includes(selected.id) && <p role="status">This registration has a saved local edit. Review device sync above before recording further changes or arrivals for this entry.</p>}
          {selected.notes && <Card className="arrival-notes">
            <div><span className="ui-eyebrow">{t("checkin.notes")}</span><Button variant="ghost" size="sm" onClick={() => editRegistration(selected)}>{t("common.edit")}</Button></div>
            <p>{selected.notes}</p>
          </Card>}

          <footer className="arrival-detail__footer">
            <Button onClick={() => editRegistration(selected)}>{t("checkin.editRegistration")}</Button>
            {selected.status === "Canceled" ? <Button variant="primary" disabled={busy === `restore-${selected.id}`} onClick={() => run(`restore-${selected.id}`, () => api.restoreRegistration(eventId, selected.id, staff), t("toast.registrationRestored"))}>{t("common.restore")}</Button> : <details className="arrival-record-actions"><summary>{t("checkin.moreActions")}</summary><Button variant="danger" disabled={busy === `cancel-${selected.id}`} onClick={() => { if (window.confirm(`${t("common.cancel")}: ${registrationTitle(selected)}?`)) run(`cancel-${selected.id}`, () => api.cancelRegistration(eventId, selected.id, staff), t("toast.registrationCanceled")); }}>{t("common.cancel")}</Button></details>}
          </footer>
        </> : <div className="arrival-detail__empty">
          <Icon name="search" size={28} /><h2>{t("checkin.select")}</h2><p>{t("checkin.selectHelp")}</p>
        </div>}
      </section>
    </div>

    {writeDisabled && <p id="offline-write-help" className="sr-only">{t("state.offlineWrite")}</p>}
    {dialog === "walkin" && <WalkInDialog division={division} divisionSettings={divisionSettings} draft={walkIn} busy={busy === "walkin"} onChange={setWalkIn} onSubmit={addWalkIn} onClose={() => setDialog(null)} />}
    {dialog === "import" && <CsvDialog division={division} divisionSettings={divisionSettings} file={file} preview={preview} previewBusy={busy === "import-preview"} applyBusy={busy === "import"} onFileChange={handleFileChange} onPreview={reviewImport} onApply={handleImport} onClose={() => { setDialog(null); setFile(null); setPreview(null); setImportSource(null); }} />}
    {editor && <RegistrationDialog registration={editor} busy={busy === `edit-${editor.id}`} saveLabel={onSaveLocally ? "Save on this device" : undefined} onChange={setEditor} onSubmit={saveEditor} onClose={() => setEditor(null)} />}
  </div>;
}
