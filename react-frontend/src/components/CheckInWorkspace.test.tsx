import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MenyuApi } from "../api";
import { LanguageProvider } from "../i18n";
import CheckInWorkspace from "./CheckInWorkspace";

afterEach(() => vi.unstubAllGlobals());
describe("spectator undo", () => {
  it("requires confirmation, targets the displayed addition, and disables empty/offline undo", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const undoSpectator = vi.fn().mockResolvedValue({ count: 0 });
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirm);
    const node = document.createElement("div");
    const root = createRoot(node);
    const props = { api: { undoSpectator } as unknown as MenyuApi, eventId: "event", event: { configuration: { divisions: [] } } as never, division: "2v2" as const, registrations: [], people: [], spectatorCount: 1, spectatorUndoAuditId: "audit-1", staff: { name: "QA", role: "Door" }, refresh: vi.fn().mockResolvedValue(undefined), notify: vi.fn() };
    const render = async (extra = {}) => { await act(async () => root.render(<LanguageProvider><CheckInWorkspace {...props} {...extra} /></LanguageProvider>)); };
    const button = () => [...node.querySelectorAll("button")].find((item) => item.textContent?.includes("Undo last spectator"))!;
    try {
      await render();
      await act(async () => button().click());
      expect(undoSpectator).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      await act(async () => button().click());
      expect(undoSpectator).toHaveBeenCalledExactlyOnceWith("event", "audit-1", props.staff);
      expect(props.refresh).toHaveBeenCalledOnce();
      await render({ spectatorCount: 0, spectatorUndoAuditId: null });
      expect(button().disabled).toBe(true);
      await render({ writeDisabled: true });
      expect(button().disabled).toBe(true);
    } finally { await act(async () => root.unmount()); }
  });
});
