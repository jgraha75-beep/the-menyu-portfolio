import { useEffect, useMemo, useState } from "react";
import type { MenyuApi } from "../api";
import { useI18n } from "../i18n";
import type { Bracket, Division, EventData, Match, Registration, Staff } from "../types";
import { divisionConfig, divisionLabel, registrationTitle } from "../utils";
import { defaultSharedTimer, useSharedCountdown } from "../useSharedCountdown";
import { Button } from "./ui";
import QualifierHandoff from "./QualifierHandoff";

type Props = {
  api: MenyuApi;
  eventId: string;
  event: EventData;
  division: Division;
  registrations: Registration[];
  staff: Staff;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  writeDisabled?: boolean;
};

export default function BracketWorkspace({ api, eventId, event, division, registrations, staff, refresh, notify, writeDisabled = false }: Props) {
  const { t } = useI18n();
  const [bracket, setBracket] = useState<Bracket | null>(event.brackets?.[division] ?? null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [seedOrder, setSeedOrder] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const divisionSettings = divisionConfig(event, division);
  const sharedTimer = event.timers?.bracket?.[division] ?? defaultSharedTimer(divisionSettings.bracket.secondsPerBattler);
  const timer = useSharedCountdown(sharedTimer, api.serverClockOffset());

  const titleFor = (id: string | null) => registrationTitle(registrations.find((item) => item.id === id)) || "—";
  const matches = useMemo(() => bracket?.rounds.flatMap((round) => round.matches) ?? [], [bracket]);
  const selected = matches.find((match) => match.id === selectedMatchId) ?? null;

  useEffect(() => {
    const next = event.brackets?.[division] ?? null;
    setBracket(next);
    setSelectedMatchId(next?.rounds.flatMap((round) => round.matches).find((match) => match.sideA && match.sideB && !match.winnerId)?.id ?? next?.rounds[0]?.matches[0]?.id ?? null);
  }, [division, event]);
  const seedCandidates = useMemo(() => registrations.filter((registration) => registration.bracket === division && registration.status === "Checked in" && ["qualified", "seeded"].includes(registration.competitionState || "checked_in")).sort((left, right) => (left.prelimRank ?? Number.MAX_SAFE_INTEGER) - (right.prelimRank ?? Number.MAX_SAFE_INTEGER) || Number(left.sourceNumber) - Number(right.sourceNumber)), [division, registrations]);
  useEffect(() => { const saved = event.bracketSeeds?.[division]?.registrationIds; setSeedOrder(saved && saved.length === seedCandidates.length ? saved : seedCandidates.map((registration) => registration.id)); }, [division, event.bracketSeeds, seedCandidates]);

  const reloadBracket = async () => {
    const result = await api.bracket(eventId, division);
    if ("error" in result) { setBracket(null); throw new Error(result.error); }
    setBracket(result);
    return result;
  };

  const run = async (action: () => Promise<unknown>, success: string) => {
    if (writeDisabled) return notify(t("state.offlineWrite"), true);
    try { setBusy(true); await action(); await refresh(); notify(success); }
    catch (error) { notify(error instanceof Error ? error.message : String(error), true); }
    finally { setBusy(false); }
  };

  const generate = async () => {
    if (bracket && !window.confirm(t("bracket.replaceConfirm"))) return;
    await run(async () => {
      const result = await api.generateBracket(eventId, division, staff, Boolean(bracket));
      setBracket(result);
      setSelectedMatchId(result.rounds.flatMap((round) => round.matches).find((match) => match.sideA && match.sideB && !match.winnerId)?.id ?? result.rounds[0]?.matches[0]?.id ?? null);
    }, t("bracket.generated"));
  };

  const completeRound = async () => {
    if (!selected) return;
    await run(async () => { await api.completePerformanceRound(eventId, division, selected.id, staff); await reloadBracket(); }, t("bracket.roundComplete", { round: selected.performanceRoundsCompleted + 1 }));
  };

  const recordOutcome = async (outcome: string | "tie") => {
    if (!selected) return;
    await run(async () => { await api.recordMatchOutcome(eventId, division, selected.id, outcome, staff); await reloadBracket(); }, outcome === "tie" ? t("bracket.tieRecorded") : t("bracket.advances", { name: titleFor(outcome) }));
  };

  const undo = async () => {
    if (!selected) return;
    await run(async () => { await api.undoDecision(eventId, division, selected.id, staff); await reloadBracket(); }, selected.tieBreakActive && !selected.winnerId ? t("bracket.tieUndone") : t("bracket.decisionUndone"));
  };
  const controlTimer = async (action: "start" | "pause" | "reset") => run(() => api.controlTimer(eventId, "bracket", division, action, sharedTimer.version, staff, action === "reset" ? divisionSettings.bracket.secondsPerBattler : undefined), t(`prelims.timer${action[0].toUpperCase()}${action.slice(1)}`));
  const moveSeed = (index: number, direction: -1 | 1) => { const destination = index + direction; if (destination < 0 || destination >= seedOrder.length) return; const next = [...seedOrder]; [next[index], next[destination]] = [next[destination], next[index]]; setSeedOrder(next); };

  const ready = Boolean(selected?.sideA && selected?.sideB && !selected.winnerId);
  const readyForDecision = Boolean(ready && selected && selected.performanceRoundsCompleted >= selected.requiredPerformanceRounds);
  const outcomeLabel = selected?.tieBreakActive ? t("bracket.replay") : t("bracket.operatorResult");

  if (event.configuration.competitionFormat !== "head_to_head" || !divisionSettings.bracket.enabled) return <section className="empty-card"><strong>{divisionSettings.name}</strong><span>This format does not use the head-to-head bracket engine. Its event rules are saved and ready for its dedicated gameplay workflow.</span></section>;
  return (
    <>
      <QualifierHandoff key={`${eventId}:${division}`} api={api} eventId={eventId} division={division} revision={event.revision} qualifierCount={divisionSettings.bracket.qualifierCount} divisionName={divisionSettings.name} disabled={writeDisabled} />
      <header className="workspace-heading compact-heading"><div><h1>{t("bracket.title")} · {divisionLabel(event, division)}</h1><p>{t("bracket.description")}</p></div><div className="heading-actions"><Button variant="secondary" onClick={() => reloadBracket().then(() => notify(t("bracket.reloaded"))).catch((error) => notify(error instanceof Error ? error.message : String(error), true))}>{t("common.reload")}</Button><Button variant="primary" busy={busy} busyLabel={t("state.saving")} disabled={writeDisabled} aria-describedby={writeDisabled ? "offline-write-help" : undefined} onClick={generate}>{bracket ? t("bracket.replace") : t("bracket.generate")}</Button></div></header>

      {!bracket && seedCandidates.length >= 2 && <section className="seed-editor"><header><span className="card-label">Bracket seeds</span><h2>Set the entry order</h2><p>Move qualified entries into the exact order you want before creating the bracket. Unfilled bracket slots become byes.</p></header><ol>{seedOrder.map((registrationId, index) => <li key={registrationId}><b>{index + 1}</b><strong>{titleFor(registrationId)}</strong><Button size="sm" variant="ghost" disabled={writeDisabled || index === 0} onClick={() => moveSeed(index, -1)}>Up</Button><Button size="sm" variant="ghost" disabled={writeDisabled || index === seedOrder.length - 1} onClick={() => moveSeed(index, 1)}>Down</Button></li>)}</ol><Button size="sm" variant="secondary" busy={busy} busyLabel={t("state.saving")} disabled={writeDisabled} onClick={() => run(() => api.saveBracketSeeds(eventId, division, seedOrder, staff), "Seeds saved")}>Save seeds</Button></section>}

      <section className="live-display-preview">
        <span className="display-label">{t("bracket.liveDisplay")}</span>
        <div className="live-versus"><strong>{selected ? titleFor(selected.sideA) : "________"}</strong><i>VS</i><strong>{selected ? titleFor(selected.sideB) : "________"}</strong></div>
        <div className="live-time">00:{String(timer.seconds).padStart(2, "0")}</div>
        <div className="display-controls"><Button size="sm" onClick={() => controlTimer("start")} disabled={writeDisabled || timer.running}>{t("prelims.start")}</Button><Button size="sm" onClick={() => controlTimer("pause")} disabled={writeDisabled || !timer.running}>{t("prelims.pause")}</Button><Button size="sm" onClick={() => controlTimer("reset")} disabled={writeDisabled}>{t("prelims.reset")}</Button></div>
      </section>

      <div className="bracket-control-layout">
        <section className="bracket-surface">
          <div className="panel-heading"><div><span className="card-label">{t("bracket.map")}</span><h2>{bracket ? t("bracket.seeds", { count: bracket.participantIds.length }) : t("bracket.noBracket")}</h2></div>{bracket && <span>{bracket.format.regular.secondsPerBattler ? `${bracket.format.regular.secondsPerBattler}s · ${bracket.format.regular.movesPerBattler} move` : t("bracket.oneRound")} · {t("bracket.finalRounds", { count: bracket.format.final.performanceRounds })}</span>}</div>
          {!bracket && <div className="empty-card"><strong>{t("bracket.noBracket")}</strong><span>{t("bracket.noBracketHelp")}</span></div>}
          {bracket && <div className="bracket-board">{bracket.rounds.map((round, roundIndex) => <div className="bracket-round" key={round.name}><h3>{round.name}</h3>{round.matches.map((match) => { const matchReady = Boolean(match.sideA && match.sideB && !match.winnerId); const replay = match.tieBreakActive ? ` · ${t("bracket.replayCount", { count: match.tieBreakCount || 1 })}` : ""; return <button key={match.id} onClick={() => setSelectedMatchId(match.id)} className={`bracket-match ${selectedMatchId === match.id ? "selected" : ""} ${match.winnerId ? "complete" : ""}`}><span className="match-tag">M{match.matchNumber}</span><span className={match.winnerId === match.sideA ? "winner" : ""}>{titleFor(match.sideA)}</span><span className={match.winnerId === match.sideB ? "winner" : ""}>{titleFor(match.sideB)}</span><small>{match.winnerId ? t("bracket.winner", { name: titleFor(match.winnerId) }) : matchReady ? `${t("bracket.performanceProgress", { complete: match.performanceRoundsCompleted, total: match.requiredPerformanceRounds })}${replay}` : roundIndex === 0 ? t("bracket.openSeed") : t("bracket.waitingForPrevious")}</small></button>; })}</div>)}</div>}
        </section>

        <aside className="match-control">
          <div className="panel-heading"><div><span className="card-label">{t("bracket.matchControl")}</span><h2>{selected ? t("bracket.matchNumber", { number: selected.matchNumber }) : t("bracket.selectMatch")}</h2></div><span className={`status-pill ${selected?.winnerId ? "good" : readyForDecision ? "warn" : ""}`}>{selected?.winnerId ? t("bracket.complete") : readyForDecision ? t("bracket.recordResult") : ready ? t("bracket.performance") : t("bracket.waiting")}</span></div>
          {selected ? <>
            <div className="selected-versus"><div><span>{t("bracket.left")}</span><strong>{titleFor(selected.sideA)}</strong></div><i>{t("bracket.vs")}</i><div><span>{t("bracket.right")}</span><strong>{titleFor(selected.sideB)}</strong></div></div>
            {selected.winnerId ? <div className="recorded-result"><span>{t("bracket.recordedWinner")}</span><strong>{titleFor(selected.winnerId)}</strong><small>{selected.decisionMethod === "tie_break_operator_choice" ? t("bracket.replayCount", { count: selected.tieBreakCount || 1 }) : t("bracket.operatorResult")}</small><Button variant="danger" full busy={busy} busyLabel={t("state.saving")} disabled={writeDisabled} aria-describedby={writeDisabled ? "offline-write-help" : undefined} onClick={undo}>{t("bracket.undo")}</Button></div> : <>
              {ready && !readyForDecision && <div className="performance-control"><span className="card-label">{t("bracket.performance")}</span><strong>{t("bracket.roundProgress", { complete: selected.performanceRoundsCompleted, total: selected.requiredPerformanceRounds })}</strong><small>{selected.tieBreakActive ? t("bracket.replayHelp") : selected.requiredPerformanceRounds === 2 ? t("bracket.finalHelp") : t("bracket.performanceHelp")}</small><Button variant="primary" full busy={busy} busyLabel={t("state.saving")} disabled={writeDisabled} aria-describedby={writeDisabled ? "offline-write-help" : undefined} onClick={completeRound}>{t("bracket.completeRound")} {selected.performanceRoundsCompleted + 1}</Button>{selected.tieBreakActive && <Button variant="danger" full busy={busy} busyLabel={t("state.saving")} disabled={writeDisabled} aria-describedby={writeDisabled ? "offline-write-help" : undefined} onClick={undo}>{t("bracket.undo")}</Button>}</div>}
              {readyForDecision && <div className="operator-outcome"><span className="tape">{outcomeLabel}</span><p>{t("bracket.selectOutcomeHelp")}</p><Button disabled={writeDisabled || busy} aria-describedby={writeDisabled ? "offline-write-help" : undefined} onClick={() => recordOutcome(selected.sideA!)}>{t("bracket.won", { name: titleFor(selected.sideA) })}</Button><Button disabled={writeDisabled || busy} aria-describedby={writeDisabled ? "offline-write-help" : undefined} onClick={() => recordOutcome(selected.sideB!)}>{t("bracket.won", { name: titleFor(selected.sideB) })}</Button><Button variant="danger" disabled={writeDisabled || busy} aria-describedby={writeDisabled ? "offline-write-help" : undefined} onClick={() => recordOutcome("tie")}>{t("bracket.tie")}</Button></div>}
            </>}
          </> : <p className="muted">{t("bracket.selectMatch")}</p>}
        </aside>
      </div>
      {writeDisabled && <p id="offline-write-help" className="sr-only">{t("state.offlineWrite")}</p>}
    </>
  );
}
