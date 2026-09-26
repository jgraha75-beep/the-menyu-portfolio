import { useState } from "react";
import { eventActions } from "../offline/client";
import { unresolved, type FieldValue, type OfflineDocument } from "../offline/types";
import { Button } from "./ui";

const displayValue = (value: FieldValue) => Array.isArray(value) ? value.join(", ") || "(empty)" : typeof value === "boolean" ? (value ? "Yes" : "No") : value || "(empty)";
const time = (value: string | null) => value ? new Date(value).toLocaleString() : "Time unknown";
const fieldLabel = (value: string) => value.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

export default function OfflineSyncPanel({ document, eventId, connected, error, onRetry, onResolve }: {
  document: OfflineDocument | null; eventId: string; connected: boolean; error: string;
  onRetry: () => Promise<void>; onResolve: (id: string, choice: "local" | "server") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [leave, setLeave] = useState("");
  const cached = document?.snapshots[eventId];
  const actions = document ? eventActions(document, eventId) : [];
  const pending = actions.filter((action) => !action.receipt && !action.supersededBy).length;
  const decisions = actions.filter((action) => unresolved(action) && action.receipt);
  const registrationName = (id: string) => { const entry = document?.snapshots[eventId]?.snapshot.registrations.find((registration) => registration.id === id); return entry?.teamName || entry?.entryName || entry?.displayCode || id; };
  const run = async (action: () => Promise<void>) => { setBusy(true); setFailure(""); try { await action(); } catch (cause) { setFailure(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };
  if (!eventId) return null;
  return <section className="offline-sync" aria-label="Device sync">
    <div className="offline-sync__status" role="status">
      <span>{connected ? "Connected" : cached ? "Offline · saved event" : "Offline"} · {pending} waiting to sync · {decisions.length} need review</span>
      <Button size="sm" variant="secondary" busy={busy} onClick={() => void run(onRetry)}>Retry sync</Button>
    </div>
    {!connected && <p>{cached && !error ? "Registration details can be saved on this device. Other changes need a connection." : "Offline saving is unavailable. Reconnect before making changes."}</p>}
    {document?.snapshots[eventId] && <small>Event saved on this device: {time(document.snapshots[eventId].cachedAt)}</small>}
    {(error || failure) && <p role="alert">{failure || error}</p>}
    {decisions.map((action) => <details key={action.command.id} open={leave !== action.command.id} className="offline-sync__review">
      <summary>{action.receipt?.status === "conflict" ? "Compare conflicting edit" : "Edit not accepted"} · {registrationName(action.command.registrationId)}</summary>
      <p>{action.receipt?.message}</p>
      {action.receipt?.comparisons?.map((comparison) => <div className="offline-sync__comparison" key={comparison.field}>
        <h3>{fieldLabel(comparison.field)}</h3>
        <div><strong>Your saved value</strong><p>{displayValue(comparison.localValue)}</p><small>{action.command.actor.name} · {action.command.actor.role}<br />{time(action.command.createdAt)}</small></div>
        <div><strong>Server value</strong><p>{displayValue(comparison.serverValue)}</p><small>{comparison.serverChange.staffName} · {comparison.serverChange.staffRole}<br />{time(comparison.serverChange.at)}</small></div>
      </div>)}
      <div className="offline-sync__choices">
        <Button size="sm" busy={busy} onClick={() => void run(() => onResolve(action.command.id, "server"))}>Keep server values</Button>
        {action.receipt?.status === "conflict" && <Button size="sm" variant="primary" busy={busy} onClick={() => void run(() => onResolve(action.command.id, "local"))}>Apply reviewed local values</Button>}
        <Button size="sm" variant="ghost" onClick={() => setLeave(action.command.id)}>Leave unresolved</Button>
      </div>
      <small>Applying your values checks the server again. A newer change will need another review.</small>
    </details>)}
    {actions.length > 0 && <details className="offline-sync__history"><summary>Device edit history ({actions.length})</summary><ul>{[...actions].reverse().map((action) => <li key={action.command.id}>
      <strong>{action.supersededBy ? "Resolution recorded separately" : action.receipt?.status || "Waiting to sync"}</strong> · {registrationName(action.command.registrationId)} · {action.command.actor.name} · {time(action.command.createdAt)}
      <div>{Object.keys(action.command.patch).map(fieldLabel).join(", ") || "Keep server values"} · {action.receipt?.message}</div>
      <small>Action {action.command.id}{action.receipt && ` · ${action.receipt.serverRecorded === false ? "Device" : "Server"}: ${time(action.receipt.at)}`}</small>
    </li>)}</ul></details>}
  </section>;
}
