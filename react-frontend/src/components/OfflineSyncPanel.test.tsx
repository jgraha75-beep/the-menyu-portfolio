import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { emptyDocument } from "../offline/types";
import OfflineSyncPanel from "./OfflineSyncPanel";

it("does not promise offline saving when no snapshot is available", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div"); const root = createRoot(node);
  try {
    await act(async () => root.render(<OfflineSyncPanel document={null} eventId="event" connected={false} error="Device storage unavailable" onRetry={vi.fn()} onResolve={vi.fn()} />));
    expect(node.textContent).toContain("Offline saving is unavailable");
    expect(node.textContent).not.toContain("Offline · saved event");
    expect(node.textContent).not.toContain("Registration details can be saved");
    expect(node.querySelector('[role="alert"]')?.textContent).toBe("Device storage unavailable");
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

it("shows values, both authors/times and explicit choices without resolving automatically", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const documentData = emptyDocument();
  documentData.actions.push({ eventId: "event", command: { version: 1, id: "action", registrationId: "reg", kind: "registration_edit", createdAt: "2026-09-24T01:00:00Z", actor: { name: "Alice", role: "Door" }, patch: { notes: "Local notes" }, base: {} }, receipt: { actionId: "action", registrationId: "reg", status: "conflict", at: "2026-09-24T03:00:00Z", revision: 10, comparisons: [{ field: "notes", localValue: "Local notes", serverValue: "Server notes", serverChange: { revision: 9, staffName: "Bob", staffRole: "MC", at: "2026-09-24T02:00:00Z" } }] } });
  const onResolve = vi.fn().mockResolvedValue(undefined);
  const node = document.createElement("div"); const root = createRoot(node);
  try {
    await act(async () => root.render(<OfflineSyncPanel document={documentData} eventId="event" connected error="" onRetry={vi.fn()} onResolve={onResolve} />));
    for (const text of ["Local notes", "Server notes", "Alice", "Bob", "Door", "MC", "Keep server values", "Apply reviewed local values", "Leave unresolved", new Date("2026-09-24T01:00:00Z").toLocaleString(), new Date("2026-09-24T02:00:00Z").toLocaleString()]) expect(node.textContent).toContain(text);
    expect(onResolve).not.toHaveBeenCalled();
    const button = (text: string) => [...node.querySelectorAll("button")].find((item) => item.textContent === text)!;
    await act(async () => button("Leave unresolved").click()); expect(onResolve).not.toHaveBeenCalled();
    await act(async () => button("Apply reviewed local values").click()); expect(onResolve).toHaveBeenLastCalledWith("action", "local");
    await act(async () => button("Keep server values").click()); expect(onResolve).toHaveBeenLastCalledWith("action", "server");
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
