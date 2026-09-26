import { useEffect, useMemo, useState } from "react";
import type { MenyuApi } from "../api";
import { useI18n } from "../i18n";
import type { Division, EventData, Registration, Staff } from "../types";
import { cutoffFor, divisionConfig, divisionLabel, registrationTitle } from "../utils";
import { defaultSharedTimer, useSharedCountdown } from "../useSharedCountdown";
import PrelimBattleRun from "./PrelimBattleRun";
import JudgingMonitor from "./JudgingMonitor";
import { Alert, Button, Card, Input, Select } from "./ui";

type Props = {
  api: MenyuApi;
  eventId: string;
  event: EventData;
  division: Division;
  registrations: Registration[];
  staff: Staff;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  onOpenCheckIn: () => void;
  writeDisabled?: boolean;
  loading?: boolean;
};

const hasCompleteScores = (registration: Registration, judgeCount: number) => (registration.scores.judgeScores?.length ? registration.scores.judgeScores.slice(0, judgeCount).every(Number.isInteger) : Number.isInteger(registration.scores.judge1) && Number.isInteger(registration.scores.judge2));

export default function PrelimWorkspace({ api, eventId, event, division, registrations, staff, refresh, notify, onOpenCheckIn, writeDisabled = false, loading = false }: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState("");
  const [tieOrder, setTieOrder] = useState<string[]>([]);
  const [overrideId, setOverrideId] = useState("");
  const [overrideRank, setOverrideRank] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [lastError, setLastError] = useState("");
  const divisionSettings = divisionConfig(event, division);
  const sharedTimer = event.timers?.prelims?.[division] ?? defaultSharedTimer(divisionSettings.prelims.secondsPerSide);
  const timer = useSharedCountdown(sharedTimer, api.serverClockOffset());
  const cutoff = cutoffFor(event, division);
  const eligible = useMemo(() => registrations.filter((item) => item.bracket === division && item.status === "Checked in"), [division, registrations]);
  const needsPrelim = divisionSettings.prelims.enabled && (Boolean(event.prelimOrders?.[division]?.lockedAt) || eligible.length > cutoff);
  const orderLocked = Boolean(event.prelimOrders?.[division]?.lockedAt);
  const ordered = useMemo(() => orderLocked ? eligible.slice().sort((left, right) => (left.prelimOrder ?? 9999) - (right.prelimOrder ?? 9999)) : [], [eligible, orderLocked]);
  const ranked = useMemo(() => eligible.filter((item) => item.prelimRank).slice().sort((left, right) => (left.prelimRank ?? 9999) - (right.prelimRank ?? 9999)), [eligible]);
  const scoredCount = eligible.filter((registration) => hasCompleteScores(registration, divisionSettings.prelims.judgeCount)).length;
  const allScored = eligible.length > 0 && scoredCount === eligible.length;
  const cutoffTie = useMemo(() => {
    if (!needsPrelim || ranked.length <= cutoff) return [];
    const boundary = ranked[cutoff - 1]?.scores.average;
    if (boundary === null || boundary === undefined || ranked[cutoff]?.scores.average !== boundary) return [];
    return ranked.filter((item) => item.scores.average === boundary);
  }, [cutoff, needsPrelim, ranked]);

  useEffect(() => {
    const saved = event.prelimTieBreaks?.[division]?.registrationIds;
    setTieOrder(saved && saved.length === cutoffTie.length ? saved : cutoffTie.map((item) => item.id));
  }, [cutoffTie.map((item) => item.id).join("|"), division, event.prelimTieBreaks]);
  useEffect(() => { setLastError(""); }, [division]);

  const run = async (key: string, action: () => Promise<unknown>, success: string, afterSuccess?: () => void) => {
    if (writeDisabled) return notify(t("state.offlineWrite"), true);
    try { setBusy(key); setLastError(""); await action(); await refresh(); afterSuccess?.(); notify(success); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); setLastError(message); notify(message, true); }
    finally { setBusy(""); }
  };

  if (!divisionSettings.prelims.enabled) return <section className="empty-card"><strong>{divisionLabel(event, division)}</strong><span>Prelims are not enabled for this division. Registrations can proceed directly to the next configured event stage.</span></section>;

  const moveTie = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= tieOrder.length) return;
    const next = [...tieOrder]; [next[index], next[destination]] = [next[destination], next[index]]; setTieOrder(next);
  };
  const controlTimer = (action: "start" | "pause" | "reset") => run(`timer-${action}`, () => api.controlTimer(eventId, "prelims", division, action, sharedTimer.version, staff, action === "reset" ? divisionSettings.prelims.secondsPerSide : undefined), t(`prelims.timer${action[0].toUpperCase()}${action.slice(1)}`));

  const battleOrder = event.prelimOrders[division];
  const battleEntries = (battleOrder?.registrationIds ?? []).map((id) => registrations.find((entry) => entry.id === id));
  const battleIndex = battleOrder?.currentEntryIndex ?? 0;
  const performancesComplete = battleEntries.length > 0 && battleIndex >= battleEntries.length;
  const retryConnection = async () => { setBusy("retry"); setLastError(""); try { await refresh(); } finally { setBusy(""); } };

  if (loading) return <section className="empty-card state-empty prelim-state-card" role="status" aria-live="polite"><strong>{t("prelims.loading")}</strong><span>{t("prelims.loadingHelp")}</span></section>;

  return <div className="prelim-workspace">
    <header className="workspace-heading compact-heading prelim-heading"><div><h1>{t("prelims.title")}</h1><p>{t("prelims.description")}</p></div></header>
    <section className="prelim-run-summary" aria-label={t("prelims.runOrder")}><div><span>{t("checkin.division")}</span><strong>{divisionLabel(event, division)}</strong></div><div><span>{t("prelims.runOrder")}</span><strong>{orderLocked ? t("prelims.locked") : t("prelims.notGenerated")}</strong></div><div><span>{t("prelims.qualification")}</span><strong>{needsPrelim ? t("prelims.topQualify", { count: cutoff }) : t("prelims.direct")}</strong></div><div><span>{t("prelims.scored")}</span><strong>{scoredCount}/{eligible.length}</strong></div></section>

    {writeDisabled && <Alert tone="warn" className="prelim-state-alert" title={t("prelims.offlineTitle")}>{t("prelims.offlineHelp")} <Button size="sm" onClick={retryConnection} busy={busy === "retry"} busyLabel={t("prelims.retrying")}>{t("state.retryNow")}</Button></Alert>}
    {lastError && <Alert tone="danger" className="prelim-state-alert" title={t("prelims.errorTitle")}>{lastError} {t("prelims.errorHelp")}</Alert>}
    {!eligible.length && <Card className="state-empty prelim-state-card"><strong>{t("prelims.noEntries")}</strong><span>{t("prelims.noEntriesHelp")}</span><Button variant="primary" onClick={onOpenCheckIn}>{t("prelims.openCheckIn")}</Button></Card>}
    {eligible.length > 0 && !needsPrelim && <Card tone="success" className="prelim-state-card"><strong>{t("prelims.direct")}</strong><span>{t("prelims.directHelp", { cutoff })} {t("prelims.directNext")}</span></Card>}
    {needsPrelim && !orderLocked && <Card tone="warning" className="prelim-state-card prelim-blocked"><strong>{t("prelims.blockedTitle")}</strong><span>{t("prelims.blockedHelp")}</span><Button variant="primary" full onClick={() => run("order", () => api.generatePrelimOrder(eventId, division, staff), t("prelims.orderSaved"))} disabled={writeDisabled} busy={busy === "order"} busyLabel={t("state.saving")}>{t("prelims.lockOrder")}</Button><small>{t("prelims.orderHelp")}</small></Card>}

    {needsPrelim && orderLocked && <>
      <PrelimBattleRun entries={battleEntries} index={battleIndex} seconds={timer.seconds} running={timer.running} disabled={writeDisabled || Boolean(busy)} onTimer={controlTimer} onMove={(action) => run("progress", () => api.advancePrelim(eventId, division, action, staff), t("prelims.orderSaved"))} />
      <JudgingMonitor api={api} eventId={eventId} division={division} staff={staff} registrations={registrations} writeDisabled={writeDisabled} refresh={refresh} />
      {performancesComplete && allScored && <Alert tone="good" className="prelim-ready-alert" title={t("prelims.allScoresSaved")}><span>{t("prelims.rankHelp")}</span><Button variant="primary" size="sm" onClick={() => run("rank", () => api.rankPrelims(eventId, division, staff), t("prelims.rankingsSaved"))} disabled={writeDisabled} busy={busy === "rank"} busyLabel={t("state.saving")}>{t("prelims.calculate")}</Button></Alert>}
    </>}

    {ranked.length > 0 && <section className="prelim-support-grid"><Card className="ranking-panel"><header className="panel-heading"><div><span>{t("prelims.standings")}</span><h2>{t("prelims.top", { count: cutoff })}</h2></div><span>{t("prelims.ranked", { ranked: ranked.length, total: eligible.length })}</span></header><ol className="ranking-list">{ranked.map((registration) => <li className={(registration.prelimRank ?? 99) <= cutoff ? "qualifies" : ""} key={registration.id}><span>{registration.prelimRank}</span><strong>{registrationTitle(registration)}</strong><small>{registration.scores.average?.toFixed(1)}</small></li>)}</ol></Card><Card className="ranking-correction"><h2>{t("prelims.correction")}</h2><p>{t("prelims.correctionHelp")}</p><form onSubmit={(form) => { form.preventDefault(); const rank = Number(overrideRank); if (!overrideId || !Number.isInteger(rank) || rank < 1 || !overrideReason.trim()) return notify(t("prelims.correctionHelp"), true); void run("override", () => api.overrideRanking(eventId, division, overrideId, rank, overrideReason.trim(), staff), t("prelims.correctionSaved")); }}><Select aria-label={t("prelims.chooseEntry")} value={overrideId} onChange={(input) => setOverrideId(input.target.value)}><option value="">{t("prelims.chooseEntry")}</option>{ranked.map((registration) => <option key={registration.id} value={registration.id}>{registrationTitle(registration)}</option>)}</Select><Input aria-label={t("prelims.newRank")} type="number" min="1" value={overrideRank} onChange={(input) => setOverrideRank(input.target.value)} placeholder={t("prelims.newRank")} /><Input aria-label={t("prelims.reason")} value={overrideReason} onChange={(input) => setOverrideReason(input.target.value)} placeholder={t("prelims.reason")} /><Button size="sm" disabled={writeDisabled} busy={busy === "override"} busyLabel={t("state.saving")}>{t("prelims.saveCorrection")}</Button></form></Card></section>}
    {cutoffTie.length > 0 && <section className="tie-panel"><div><h2>{t("prelims.cutoffTie")}</h2><p>{t("prelims.tieHelp")}</p></div><div className="tie-order">{tieOrder.map((id, index) => { const registration = registrations.find((item) => item.id === id); return <div key={id}><span>{index + 1}</span><strong>{registrationTitle(registration)}</strong><Button size="sm" onClick={() => moveTie(index, -1)} disabled={index === 0}>{t("prelims.moveUp")}</Button><Button size="sm" onClick={() => moveTie(index, 1)} disabled={index === tieOrder.length - 1}>{t("prelims.moveDown")}</Button></div>; })}</div><Button variant="primary" disabled={writeDisabled} busy={busy === "tie"} busyLabel={t("state.saving")} onClick={() => run("tie", () => api.savePrelimTieBreak(eventId, division, tieOrder, staff), t("prelims.tieSaved"))}>{t("prelims.saveTie")}</Button></section>}
    {writeDisabled && <p id="offline-write-help" className="sr-only">{t("state.offlineWrite")}</p>}
  </div>;
}
