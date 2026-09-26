import { useEffect, useRef, useState } from "react";
import { fetchPublicDisplay } from "../api";
import { defaultApiBase } from "../api-base";
import { brandAssets } from "../brand";
import type { Division, PublicDisplayData, PublicDisplayMatchup, SharedTimer } from "../types";
import { defaultSharedTimer, useSharedCountdown } from "../useSharedCountdown";

type ConnectionState = "loading" | "connected" | "reconnecting" | "disconnected";

const countdownText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const scoreText = (value: number | null) => value === null ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(1);

function DisplaySide({ entry, score, active, showEntryNumbers }: { entry: PublicDisplayMatchup["sideA"]; score: number | null; active: boolean; showEntryNumbers: boolean }) {
  return <section className={`audience-match__side${active ? " audience-match__side--active" : ""}`} aria-current={active ? "true" : undefined}>
    {showEntryNumbers && entry?.number && <span>#{entry.number}</span>}
    <h1>{entry?.name || "TBA"}</h1>
    <strong aria-label={`Score ${scoreText(score)}`}>{scoreText(score)}</strong>
  </section>;
}

function Matchup({ match, onDeck, showEntryNumbers }: { match: PublicDisplayMatchup; onDeck?: boolean; showEntryNumbers: boolean }) {
  const scoreLabel = match.score.kind === "average" ? "Prelim score" : match.score.kind === "judge_votes" ? "Judge votes" : "Score";
  return <section className={`audience-match${onDeck ? " audience-match--deck" : ""}`} aria-label={onDeck ? "On deck matchup" : "Current matchup"}>
    <header>
      <div><p>{match.round}</p><strong>{match.position}</strong></div>
      {!onDeck && match.performance && <span>{match.performance.tieBreakActive ? "Replay" : `${match.performance.completed} / ${match.performance.required} rounds`}</span>}
    </header>
    <p className="audience-match__score-label">{scoreLabel}</p>
    <div className="audience-match__sides">
      <DisplaySide entry={match.sideA} score={match.score.sideA} active={match.activeSide === "A"} showEntryNumbers={showEntryNumbers} />
      <span className="audience-match__versus">vs</span>
      <DisplaySide entry={match.sideB} score={match.score.sideB} active={match.activeSide === "B"} showEntryNumbers={showEntryNumbers} />
    </div>
  </section>;
}

function DisplayHeader({ data }: { data: PublicDisplayData }) {
  return <header className="audience-display__header">
    <img src={brandAssets.lockup} alt="CHIP CHOP" width="3604" height="846" />
    <div><strong>{data.event.name}</strong><span>{data.divisionName || data.division}</span></div>
    <img className="audience-display__mascot" src={brandAssets.displayArt} alt="" />
  </header>;
}

export function AudienceDisplayView({ data, seconds, running, connection }: { data: PublicDisplayData; seconds: number; running: boolean; connection: ConnectionState }) {
  const { current, onDeck } = data.projection;
  const isComplete = data.projection.phase === "complete";
  return <main className="audience-display">
    <DisplayHeader data={data} />
    {current ? <section className="audience-display__board">
      <Matchup match={current} showEntryNumbers={data.presentation.showEntryNumbers} />
      <aside className="audience-display__stage-side">
        {data.presentation.showTimer && <div className="audience-display__timer"><span>{running ? "Time" : "Ready"}</span><strong role="timer">{countdownText(seconds)}</strong></div>}
        <img src={brandAssets.displayArt} alt="" />
        {data.presentation.showOnDeck && <section className="audience-display__on-deck"><h2>On deck</h2>{onDeck ? <Matchup match={onDeck} onDeck showEntryNumbers={data.presentation.showEntryNumbers} /> : <p>Next matchup will appear here.</p>}</section>}
      </aside>
    </section> : <section className="audience-display__empty">
      <img src={brandAssets.displayArt} alt="" />
      <div><h1>{isComplete ? "Division complete" : "Matchups coming up"}</h1><p>{isComplete ? `Top ${data.qualifierCount || "—"} results are next.` : "The next battle will appear here."}</p></div>
    </section>}
    {connection === "reconnecting" && <p className="audience-display__connection" role="status">Updating…</p>}
  </main>;
}

function AudienceState({ label }: { label: string }) {
  return <main className="audience-display audience-display--state"><img src={brandAssets.displayArt} alt="" /><p role="status">{label}</p></main>;
}

function useAudienceProjection(eventId: string, division: Division) {
  const [data, setData] = useState<PublicDisplayData | null>(null);
  const [offset, setOffset] = useState(0);
  const [connection, setConnection] = useState<ConnectionState>(eventId ? "loading" : "disconnected");
  const dataRef = useRef<PublicDisplayData | null>(null);

  useEffect(() => {
    if (!eventId) return;
    let disposed = false;
    let busy = false;
    let failures = 0;
    let request: AbortController | null = null;
    const refresh = async () => {
      if (busy || disposed) return;
      busy = true;
      request = new AbortController();
      const timeout = window.setTimeout(() => request?.abort(), 8000);
      try {
        const next = await fetchPublicDisplay(defaultApiBase(), eventId, division, request.signal);
        if (disposed) return;
        failures = 0;
        const difference = Date.parse(next.serverNow) - Date.now();
        setOffset(Number.isFinite(difference) ? difference : 0);
        dataRef.current = next; setData(next); setConnection("connected");
      } catch {
        if (!disposed) {
          failures += 1;
          setConnection(dataRef.current && failures < 4 ? "reconnecting" : "disconnected");
        }
      } finally { window.clearTimeout(timeout); busy = false; }
    };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 1500);
    return () => { disposed = true; request?.abort(); window.clearInterval(interval); };
  }, [eventId, division]);
  return { data, offset, connection };
}

export default function AudienceDisplay() {
  const search = new URLSearchParams(window.location.search);
  const eventId = search.get("event")?.trim() || "";
  const division = search.get("division")?.trim() || "2v2";
  const { data, offset, connection } = useAudienceProjection(eventId, division);
  const timer: SharedTimer = data?.projection.timer || defaultSharedTimer(90);
  const frozenTimer = connection === "connected" ? timer : { ...timer, status: "paused" as const };
  const countdown = useSharedCountdown(frozenTimer, offset);

  useEffect(() => {
    document.title = "The Menyu · Live display";
    document.body.classList.add("audience-display-page");
    return () => document.body.classList.remove("audience-display-page");
  }, []);
  if (!eventId) return <AudienceState label="Display not ready" />;
  if (connection === "loading" && !data) return <AudienceState label="Loading matchups…" />;
  if (connection === "disconnected" || !data) return <AudienceState label="Connection interrupted" />;
  return <AudienceDisplayView data={data} seconds={countdown.seconds} running={countdown.running} connection={connection} />;
}
