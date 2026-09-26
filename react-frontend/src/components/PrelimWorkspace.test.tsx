import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MenyuApi } from "../api";
import { LanguageProvider } from "../i18n";
import type { EventData, Registration } from "../types";
import PrelimWorkspace from "./PrelimWorkspace";

describe("prelim judge monitoring", () => {
  it("keeps the staff surface read-only and exposes the dedicated judge sheet", () => {
    const entry = {
      id: "entry", bracket: "under15", status: "Checked in", sourceNumber: "020",
      entryName: "Test dancer", prelimOrder: 1, scores: { judge1: 10, judge2: 10, average: 10 },
    } as Registration;
    const event = {
      judges: ["Jay-K", "Kano"], prelimOrders: { under15: { lockedAt: "2026-09-20T00:00:00Z", registrationIds: ["entry"], currentEntryIndex: 1 } },
      prelimTieBreaks: {}, timers: { prelims: {}, bracket: {} },
    } as unknown as EventData;
    const html = renderToStaticMarkup(<LanguageProvider><PrelimWorkspace
      api={new MenyuApi("/api")} eventId="test" event={event} division="under15"
      registrations={[entry]} staff={{ name: "Test", role: "Test" }}
      refresh={async () => {}} notify={() => {}} onOpenCheckIn={() => {}}
    /></LanguageProvider>);
    expect(html).toContain("Submission status");
    expect(html).toContain("Open judge sheet");
    expect(html).toContain("/judge?event=test&amp;division=under15");
    expect(html).not.toContain("Save and next");
    expect(html).not.toContain('type="number"');
  });
});
