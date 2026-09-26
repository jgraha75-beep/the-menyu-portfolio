import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { MenyuApi } from "../api";
import type { EventData, FinancialReport } from "../types";
import FinanceWorkspace from "./FinanceWorkspace";

const financialReport: FinancialReport = {
  eventId: "event", eventName: "Battle", currency: "JPY", status: "open",
  review: { reviewedAt: null, reviewedBy: null, notes: "" }, closedAt: null, closedBy: null, reopenedAt: null, reopenedBy: null, reopenReason: null,
  transactions: [{ id: "finance_1", category: "venue_expense", description: "Venue", expectedAmount: 1000, actualAmount: 1200, party: "Studio", occurredAt: "2026-09-25T00:00:00.000Z", source: "manual", sourceId: null, correctionOf: null, correctionReason: null, createdAt: "2026-09-25T00:00:00.000Z", createdBy: { name: "Lead", role: "Event lead" } }],
  expected: { categories: {} as never, baseRevenue: 0, adjustments: 0, grossRevenue: 0, expenses: 1000, payouts: 0, refunds: 0, totalOutflow: 1000, netProfit: -1000 },
  actual: { categories: {} as never, baseRevenue: 0, adjustments: 0, grossRevenue: 0, expenses: 1200, payouts: 0, refunds: 0, totalOutflow: 1200, netProfit: -1200 },
  variance: { grossRevenue: 0, totalOutflow: 200, netProfit: -200 }, generatedAt: "2026-09-25T00:00:00.000Z",
};
const event = { id: "event", name: "Battle", timeZone: "Asia/Tokyo" } as EventData;

async function renderFor(role: string) {
  const api = { finance: vi.fn().mockResolvedValue(financialReport), downloadExport: vi.fn() } as unknown as MenyuApi;
  const node = document.createElement("div"); const root = createRoot(node);
  await act(async () => { root.render(<FinanceWorkspace api={api} eventId="event" event={event} staff={{ name: "Test", role }} notify={vi.fn()} onRefresh={vi.fn().mockResolvedValue(undefined)} />); });
  return { node, root };
}

it("keeps finance management controls out of read-only staff views", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { node, root } = await renderFor("General staff");
  try {
    expect(node.textContent).toContain("Revenue and costs");
    expect(node.textContent).toContain("Venue");
    expect(node.textContent).toContain("read-only for your role");
    expect(node.textContent).not.toContain("Add revenue or cost");
    expect(node.textContent).not.toContain("Mark review complete");
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

it("shows entry, import, and close workflow controls to an Event lead", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { node, root } = await renderFor("Event lead");
  try {
    for (const label of ["Add revenue or cost", "Import costs", "Final financial review", "Mark review complete", "Close event"]) expect(node.textContent).toContain(label);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
