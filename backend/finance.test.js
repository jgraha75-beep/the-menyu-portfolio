const test = require("node:test");
const assert = require("node:assert/strict");
const { correctionTransaction, ensureFinanceState, financeReport, importCostRecords, normalizeTransaction, previewCostImport } = require("./finance");
const { legacyEventConfiguration } = require("./event-configuration");

const staff = { name: "Mina", role: "Finance lead" };
const event = () => ({
  id: "event_finance",
  name: "Finance test",
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T01:00:00.000Z",
  registrations: [{
    id: "reg_1", bracket: "2v2", status: "Checked in", registrationSource: "early", teamName: "Floor work", members: [{}, {}],
    payment: { battlerEntry: 8_000, drink: 1_400, paidAt: "2026-09-25T01:00:00.000Z" }, createdAt: "2026-09-24T00:00:00.000Z",
  }],
  spectators: { count: 2, entryMoney: 4_000, drinkMoney: 1_400 },
  finance: { status: "open", transactions: [], review: { reviewedAt: null, reviewedBy: null, notes: "" } },
});

test("finance report keeps projected income and manual outflows in one calculation", () => {
  const current = event();
  const finance = ensureFinanceState(current);
  finance.transactions.push(normalizeTransaction({ category: "merchandise_income", description: "Shirts", expectedAmount: 5_000, actualAmount: 6_000 }, { createdBy: staff }));
  finance.transactions.push(normalizeTransaction({ category: "venue_expense", description: "Studio", expectedAmount: 10_000, actualAmount: 11_000 }, { createdBy: staff }));
  finance.transactions.push(normalizeTransaction({ category: "staff_payout", description: "DJ", expectedAmount: 3_000, actualAmount: 3_000 }, { createdBy: staff }));
  finance.transactions.push(normalizeTransaction({ category: "refund", description: "Canceled entry", expectedAmount: 0, actualAmount: 2_000 }, { createdBy: staff }));
  finance.transactions.push(normalizeTransaction({ category: "adjustment", description: "Cash-count correction", expectedAmount: 0, actualAmount: -500 }, { createdBy: staff }));

  const report = financeReport(current, legacyEventConfiguration());
  assert.equal(report.expected.grossRevenue, 8_000 + 1_400 + 4_000 + 1_400 + 5_000);
  assert.equal(report.actual.grossRevenue, 8_000 + 1_400 + 4_000 + 1_400 + 6_000 - 500);
  assert.equal(report.actual.expenses, 11_000);
  assert.equal(report.actual.payouts, 3_000);
  assert.equal(report.actual.refunds, 2_000);
  assert.equal(report.actual.netProfit, 4_300);
});

test("empty events use the financial ledger empty state instead of zero-value system rows", () => {
  const current = event();
  current.registrations = [];
  current.spectators = { count: 0, entryMoney: 0, drinkMoney: 0 };

  const report = financeReport(current, legacyEventConfiguration());

  assert.deepEqual(report.transactions, []);
  assert.equal(report.actual.netProfit, 0);
});

test("cost import previews English and Japanese headers without writing", () => {
  const preview = previewCostImport("分類,内容,予定,実績,支払先,日付\n会場費,会場レンタル,10000,12000,Studio,2026-09-25\nスタッフ,DJ,3000,3000,DJ Mina,2026-09-25\n,,,,,\n");
  assert.equal(preview.canImport, true);
  assert.equal(preview.records.length, 2);
  assert.equal(preview.records[0].category, "venue_expense");
  assert.equal(preview.records[1].category, "staff_payout");
  assert.equal(preview.warnings[0].row, 4);

  const current = event();
  const imported = importCostRecords(current, preview, staff);
  assert.equal(imported.length, 2);
  assert.equal(current.finance.transactions.length, 2);
  assert.equal(current.finance.transactions[0].source, "cost_import");
});

test("invalid import rows fail preview as a group", () => {
  const preview = previewCostImport("category,description,actual\nunknown,Something,200\nvenue,,500\n");
  assert.equal(preview.canImport, false);
  assert.equal(preview.records.length, 0);
  assert.equal(preview.errors.length, 2);
});

test("closed correction appends a signed delta and preserves the source transaction", () => {
  const current = event();
  ensureFinanceState(current).status = "closed";
  const configuration = legacyEventConfiguration();
  const before = financeReport(current, configuration);
  const source = before.transactions.find((transaction) => transaction.id === "system:registration:reg_1");
  const result = correctionTransaction(current, configuration, source.id, 7_000, "Cash was recounted", staff);
  const after = financeReport(current, configuration);

  assert.equal(result.transaction.category, "adjustment");
  assert.equal(result.transaction.actualAmount, -1_000);
  assert.equal(result.transaction.correctionOf, source.id);
  assert.equal(after.transactions.find((transaction) => transaction.id === source.id).actualAmount, 8_000);
  assert.equal(after.actual.netProfit, before.actual.netProfit - 1_000);
});

test("normal financial records reject negative yen amounts", () => {
  assert.throws(() => normalizeTransaction({ category: "venue_expense", description: "Venue", actualAmount: -1 }), /whole yen amount/);
  assert.doesNotThrow(() => normalizeTransaction({ category: "adjustment", description: "Count correction", actualAmount: -1 }));
});
