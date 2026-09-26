import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { MenyuApi } from "../api";
import { LanguageProvider } from "../i18n";
import QualifierHandoff from "./QualifierHandoff";

afterEach(() => vi.unstubAllGlobals());
it("shows verified qualifiers, invalidates stale lists, and prevents offline preparation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const qualifierHandoff = vi.fn().mockResolvedValue({ division: "2v2", cutoff: 16, revision: 5, entries: [{ seed: 1, number: "020", name: "Test team", average: 10 }] });
  const node = document.createElement("div");
  const root = createRoot(node);
  const render = async (revision = 5, disabled = false) => { await act(async () => root.render(<LanguageProvider><QualifierHandoff api={{ qualifierHandoff } as unknown as MenyuApi} eventId="event" division="2v2" revision={revision} disabled={disabled} /></LanguageProvider>)); };
  try {
    await render();
    await act(async () => node.querySelector("button")!.click());
    expect(qualifierHandoff).toHaveBeenCalledExactlyOnceWith("event", "2v2");
    expect(node.querySelector("textarea")!.value).toBe("1. #020 Test team");
    await render(6);
    expect(node.querySelector("textarea")).toBeNull();
    expect(node.querySelector('[role="status"]')).not.toBeNull();
    await render(6, true);
    expect(node.querySelector("button")!.disabled).toBe(true);
    qualifierHandoff.mockRejectedValue(new Error("Resolve the cutoff tie"));
    await render(6);
    await act(async () => node.querySelector("button")!.click());
    expect(node.querySelector('[role="alert"]')!.textContent).toBe("Resolve the cutoff tie");
  } finally { await act(async () => root.unmount()); }
});
