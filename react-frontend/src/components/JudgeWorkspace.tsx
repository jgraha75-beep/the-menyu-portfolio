import { useEffect, useState } from "react";
import type { MenyuApi } from "../api";
import { brandAssets } from "../brand";
import type { Division, JudgeSession } from "../types";
import { Alert, Button, Input } from "./ui";

type Props = {
  api: MenyuApi;
  eventId: string;
  division: Division;
  onExit: () => void;
};

const messageForState = (state: JudgeSession["current"] extends null ? never : NonNullable<JudgeSession["current"]>["score"]["state"]) => {
  if (state === "draft") return "Draft only — you can still adjust it.";
  if (state === "submitted") return "Submitted — waiting for the other judges.";
  if (state === "locked") return "Score locked.";
  return "Corrected by an Event lead.";
};

export default function JudgeWorkspace({ api, eventId, division, onExit }: Props) {
  const [session, setSession] = useState<JudgeSession | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"draft" | "submitted" | "">("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const next = await api.judgeSession(eventId, division);
      setSession(next);
      setDraft(next.current?.score.score?.toString() ?? "");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let stopped = false;
    const refresh = async () => { if (!stopped) await load(); };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2500);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [api, eventId, division]);

  const save = async (state: "draft" | "submitted") => {
    const current = session?.current;
    if (!current || busy) return;
    const score = Number(draft);
    if (!Number.isInteger(score) || score < session.division.scoreMinimum || score > session.division.scoreMaximum) {
      setError(`Choose a whole-number score from ${session.division.scoreMinimum} to ${session.division.scoreMaximum}.`);
      return;
    }
    try {
      setBusy(state);
      await api.saveJudgeScore(eventId, division, current.id, score, state, current.updatedAt);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy("");
    }
  };

  const current = session?.current;
  const locked = current?.score.state === "locked" || current?.score.state === "corrected";
  const options = session ? Array.from({ length: session.division.scoreMaximum - session.division.scoreMinimum + 1 }, (_, index) => session.division.scoreMinimum + index) : [];

  return <main className="judge-shell">
    <section className="judge-workspace" aria-live="polite">
      <header className="judge-topbar"><div className="judge-brand"><img src={brandAssets.egg} alt="CHIP CHOP" width="650" height="900" /><span>THE MENYU</span></div><button type="button" className="judge-exit" onClick={onExit}>Staff desk</button></header>
      {loading && !session && !error && <section className="judge-empty" role="status"><strong>Opening judge sheet…</strong></section>}
      {error && !session && <section className="judge-empty"><Alert tone="danger" title="Judge access">{error}</Alert><Button onClick={() => void load()}>Try again</Button></section>}
      {session && <section className="judge-sheet">
        <header className="judge-sheet__heading"><div><span>{session.event.name}</span><h1>{session.judge.judgeName}</h1><p>{session.division.name} · Score {session.division.scoreMinimum}–{session.division.scoreMaximum}</p></div><small>{session.event.mode === "rehearsal" ? "Rehearsal" : "Live"}</small></header>
        {!current && <section className="judge-empty"><strong>No entry is on the floor.</strong><p>Stay here—the next score sheet will appear when the prelim advances.</p></section>}
        {current && <>
          <section className="judge-current" aria-labelledby="judge-current-title"><div className="judge-current__order">{String(current.prelimOrder || 0).padStart(2, "0")}</div><div><span>On the floor</span><h2 id="judge-current-title">{current.title}</h2>{current.members && <p>{current.members}</p>}{current.style && <small>{current.style}</small>}</div></section>
          <section className="judge-score"><label htmlFor="judge-score">Your score</label><Input id="judge-score" type="number" inputMode="numeric" min={session.division.scoreMinimum} max={session.division.scoreMaximum} step="1" value={draft} disabled={locked || busy === "submitted"} onChange={(event) => setDraft(event.target.value)} />
            <div className="judge-score__choices" role="group" aria-label="Choose score">{options.map((score) => <button type="button" key={score} className={Number(draft) === score ? "selected" : ""} disabled={locked || busy === "submitted"} onClick={() => setDraft(String(score))}>{score}</button>)}</div>
          </section>
          {error && <Alert tone="danger">{error}</Alert>}
          <footer className="judge-actions"><p>{messageForState(current.score.state)}</p>{!locked && <div><Button variant="secondary" onClick={() => void save("draft")} busy={busy === "draft"} busyLabel="Saving draft">Save draft</Button><Button variant="primary" onClick={() => void save("submitted")} busy={busy === "submitted"} busyLabel="Submitting">Submit score</Button></div>}</footer>
        </>}
      </section>}
    </section>
  </main>;
}
