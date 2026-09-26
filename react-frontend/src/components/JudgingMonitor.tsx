import { useEffect, useMemo, useState } from "react";
import type { MenyuApi } from "../api";
import type { Division, JudgingMonitorStatus, Registration, Staff } from "../types";
import { Alert, Button, Input, Select } from "./ui";

type Props = { api: MenyuApi; eventId: string; division: Division; staff: Staff; registrations: Registration[]; writeDisabled: boolean; refresh: () => Promise<void> };
const isEventLead = (staff: Staff) => staff.role.trim().toLowerCase() === "event lead";

export default function JudgingMonitor({ api, eventId, division, staff, registrations, writeDisabled, refresh }: Props) {
  const [status, setStatus] = useState<JudgingMonitorStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<number, string>>({});
  const [registrationId, setRegistrationId] = useState("");
  const [judgeNumber, setJudgeNumber] = useState("");
  const [score, setScore] = useState("");
  const [reason, setReason] = useState("");
  const entries = useMemo(() => status?.entries || [], [status]);
  const canCorrect = isEventLead(staff);

  const load = async () => {
    try { const next = await api.judgingStatus(eventId, division); setStatus(next); setAssignmentDrafts((current) => Object.fromEntries(next.judges.map((judge) => [judge.judgeNumber, current[judge.judgeNumber] ?? judge.assignedStaffName]))); setError(""); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };

  useEffect(() => {
    let stopped = false;
    const poll = async () => { if (!stopped) await load(); };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 3000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [api, eventId, division]);

  const assign = async (number: number) => {
    try { setBusy(`assignment-${number}`); await api.assignJudge(eventId, division, number, assignmentDrafts[number]?.trim() || ""); await load(); await refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(""); }
  };
  const correct = async () => {
    const registration = registrations.find((item) => item.id === registrationId);
    const nextScore = Number(score);
    const number = Number(judgeNumber);
    if (!registration || !Number.isInteger(number) || !Number.isInteger(nextScore) || !reason.trim()) { setError("Choose an entry and judge, enter a whole-number score, and explain the correction."); return; }
    try { setBusy("correction"); await api.correctJudgeScore(eventId, division, registration.id, number, nextScore, reason.trim(), registration.updatedAt); setReason(""); setScore(""); await load(); await refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(""); }
  };

  const judgeHref = `/judge?event=${encodeURIComponent(eventId)}&division=${encodeURIComponent(division)}`;
  return <section className="judging-monitor" aria-labelledby="judge-status-title">
    <header><div><span>Judges</span><h2 id="judge-status-title">Submission status</h2><p>Scores stay on each judge’s device until they submit. This panel shows progress, not score values.</p></div><a className="ui-button ui-button--secondary ui-button--sm" href={judgeHref} target="_blank" rel="noreferrer">Open judge sheet</a></header>
    {error && <Alert tone="danger">{error}</Alert>}
    {!status && <p className="judging-monitor__loading">Checking judge submissions…</p>}
    {status && <div className="judging-status-table"><div className="judging-status-table__head"><span>Entry</span>{status.judges.map((judge) => <span key={judge.judgeNumber}>{judge.judgeName}</span>)}</div>{entries.map((entry) => <div className="judging-status-table__row" key={entry.registrationId}><strong>{entry.prelimOrder ? String(entry.prelimOrder).padStart(2, "0") : "—"} · {entry.title}</strong>{entry.scores.map((item) => <span className={`score-state score-state--${item.state}`} key={item.judgeNumber}>{item.state}</span>)}</div>)}</div>}
    {canCorrect && status && <details className="judging-admin"><summary>Event lead controls</summary><div className="judging-admin__content"><section><h3>Judge assignments</h3>{status.judges.map((judge) => <div className="judging-assignment" key={judge.judgeNumber}><span>{judge.judgeName}</span><Input aria-label={`${judge.judgeName} assigned staff`} value={assignmentDrafts[judge.judgeNumber] || ""} onChange={(event) => setAssignmentDrafts((current) => ({ ...current, [judge.judgeNumber]: event.target.value }))} /><Button size="sm" disabled={writeDisabled} busy={busy === `assignment-${judge.judgeNumber}`} busyLabel="Saving" onClick={() => void assign(judge.judgeNumber)}>Assign</Button></div>)}</section><section><h3>Correct a locked score</h3><div className="judging-correction"><Select aria-label="Entry to correct" value={registrationId} onChange={(event) => setRegistrationId(event.target.value)}><option value="">Choose entry</option>{entries.map((entry) => <option key={entry.registrationId} value={entry.registrationId}>{entry.title}</option>)}</Select><Select aria-label="Judge score to correct" value={judgeNumber} onChange={(event) => setJudgeNumber(event.target.value)}><option value="">Judge</option>{status.judges.map((judge) => <option key={judge.judgeNumber} value={judge.judgeNumber}>{judge.judgeName}</option>)}</Select><Input aria-label="Corrected score" type="number" inputMode="numeric" value={score} onChange={(event) => setScore(event.target.value)} placeholder="Score" /><Input aria-label="Correction reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for correction" /><Button variant="danger" size="sm" disabled={writeDisabled} busy={busy === "correction"} busyLabel="Correcting" onClick={() => void correct()}>Correct score</Button></div></section></div></details>}
  </section>;
}
