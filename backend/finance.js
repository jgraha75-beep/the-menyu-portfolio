const crypto = require("node:crypto");

const FINANCE_CATEGORIES = [
  "registration_income",
  "spectator_income",
  "merchandise_income",
  "drink_income",
  "venue_expense",
  "staff_payout",
  "other_cost",
  "refund",
  "adjustment",
];

const REVENUE_CATEGORIES = new Set(["registration_income", "spectator_income", "merchandise_income", "drink_income"]);
const EXPENSE_CATEGORIES = new Set(["venue_expense", "other_cost"]);
const CATEGORY_ALIASES = new Map([
  ["registration", "registration_income"], ["registration income", "registration_income"], ["entry income", "registration_income"], ["entry fee", "registration_income"], ["参加費", "registration_income"], ["エントリー", "registration_income"],
  ["spectator", "spectator_income"], ["spectator income", "spectator_income"], ["admission", "spectator_income"], ["観戦", "spectator_income"], ["観客", "spectator_income"],
  ["merchandise", "merchandise_income"], ["merch", "merchandise_income"], ["merchandise income", "merchandise_income"], ["物販", "merchandise_income"],
  ["drink", "drink_income"], ["drink income", "drink_income"], ["beverage", "drink_income"], ["ドリンク", "drink_income"],
  ["venue", "venue_expense"], ["venue expense", "venue_expense"], ["venue cost", "venue_expense"], ["会場費", "venue_expense"], ["会場", "venue_expense"],
  ["staff", "staff_payout"], ["staff payout", "staff_payout"], ["staff pay", "staff_payout"], ["人件費", "staff_payout"], ["スタッフ", "staff_payout"],
  ["other", "other_cost"], ["other cost", "other_cost"], ["expense", "other_cost"], ["その他経費", "other_cost"], ["経費", "other_cost"],
  ["refund", "refund"], ["refunds", "refund"], ["返金", "refund"],
  ["adjustment", "adjustment"], ["correction", "adjustment"], ["調整", "adjustment"], ["修正", "adjustment"],
  ...FINANCE_CATEGORIES.map((category) => [category, category]),
]);

const HEADERS = {
  category: ["category", "type", "分類", "カテゴリ", "種別"],
  description: ["description", "item", "memo", "details", "内容", "項目", "摘要", "メモ"],
  expectedAmount: ["expected", "expected amount", "budget", "estimate", "予定", "予算", "見込"],
  actualAmount: ["actual", "actual amount", "amount", "paid", "実績", "金額", "支払額"],
  party: ["party", "payee", "payer", "vendor", "recipient", "支払先", "取引先"],
  occurredAt: ["date", "occurred at", "transaction date", "日付", "取引日"],
};

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
const canonical = (value) => String(value ?? "").trim().toLowerCase().replace(/[＿_\-]+/g, " ").replace(/\s+/g, " ");
const wholeYen = (value, label, { signed = false } = {}) => {
  if (value === "" || value === null || value === undefined) return 0;
  const cleaned = typeof value === "number" ? value : Number(String(value).replace(/[¥￥,\s]/g, ""));
  if (!Number.isSafeInteger(cleaned) || (!signed && cleaned < 0) || Math.abs(cleaned) > 1_000_000_000) {
    throw new Error(`${label} must be a whole yen amount${signed ? " between -1,000,000,000 and 1,000,000,000" : " from 0 to 1,000,000,000"}`);
  }
  return cleaned;
};

function normalizeCategory(value) {
  const category = CATEGORY_ALIASES.get(canonical(value));
  if (!category) throw new Error(`Unknown financial category: ${String(value || "blank")}`);
  return category;
}

function ensureFinanceState(event) {
  event.finance ||= {};
  event.finance.schemaVersion = 1;
  event.finance.status = ["open", "review", "closed"].includes(event.finance.status) ? event.finance.status : "open";
  event.finance.transactions = Array.isArray(event.finance.transactions) ? event.finance.transactions : [];
  event.finance.review ||= { reviewedAt: null, reviewedBy: null, notes: "" };
  event.finance.review.reviewedAt ||= null;
  event.finance.review.reviewedBy ||= null;
  event.finance.review.notes ||= "";
  event.finance.closedAt ||= null;
  event.finance.closedBy ||= null;
  event.finance.reopenedAt ||= null;
  event.finance.reopenedBy ||= null;
  event.finance.reopenReason ||= null;
  return event.finance;
}

function normalizeTransaction(input, { source = "manual", createdBy, id = makeId("finance") } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Financial transaction must be an object");
  const category = normalizeCategory(input.category);
  const expectedAmount = wholeYen(input.expectedAmount, "Expected amount", { signed: category === "adjustment" });
  const actualAmount = wholeYen(input.actualAmount, "Actual amount", { signed: category === "adjustment" });
  const description = String(input.description || "").trim();
  if (!description || description.length > 180) throw new Error("Description is required and must be 180 characters or fewer");
  if (expectedAmount === 0 && actualAmount === 0) throw new Error("Enter an expected or actual amount");
  const party = String(input.party || "").trim();
  if (party.length > 120) throw new Error("Payee or payer must be 120 characters or fewer");
  const occurredAtDate = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (Number.isNaN(occurredAtDate.getTime())) throw new Error("Transaction date is invalid");
  const occurredAt = occurredAtDate.toISOString();
  const at = now();
  return {
    id,
    category,
    description,
    expectedAmount,
    actualAmount,
    party,
    occurredAt,
    source,
    sourceId: input.sourceId || null,
    correctionOf: input.correctionOf || null,
    correctionReason: input.correctionReason || null,
    createdAt: at,
    createdBy: createdBy ? { name: createdBy.name, role: createdBy.role } : null,
  };
}

function registrationExpected(event, registration, configuration) {
  const division = configuration.divisions.find((candidate) => candidate.id === registration.bracket);
  if (!division) return { entry: 0, drink: 0 };
  const participantCount = Math.max(registration.members?.length || 0, division.teamSize || 1);
  const fee = registration.registrationSource === "same_day" ? division.financial.sameDayEntryFee : division.financial.earlyEntryFee;
  return { entry: participantCount * fee, drink: participantCount * division.financial.drinkFee };
}

function systemTransactions(event, configuration) {
  const transactions = [];
  for (const registration of event.registrations || []) {
    if (registration.status === "Canceled") continue;
    const expected = registrationExpected(event, registration, configuration);
    const label = registration.teamName || registration.entryName || registration.memberNames || registration.displayCode;
    transactions.push({
      id: `system:registration:${registration.id}`,
      category: "registration_income",
      description: `Registration · ${label}`,
      expectedAmount: expected.entry,
      actualAmount: wholeYen(registration.payment?.battlerEntry || 0, "Registration payment"),
      party: label,
      occurredAt: registration.payment?.paidAt || registration.createdAt || event.createdAt,
      source: "registration",
      sourceId: registration.id,
      correctionOf: null,
      correctionReason: null,
      createdAt: registration.createdAt || event.createdAt,
      createdBy: null,
    });
    transactions.push({
      id: `system:registration-drink:${registration.id}`,
      category: "drink_income",
      description: `Included drinks · ${label}`,
      expectedAmount: expected.drink,
      actualAmount: wholeYen(registration.payment?.drink || 0, "Drink payment"),
      party: label,
      occurredAt: registration.payment?.paidAt || registration.createdAt || event.createdAt,
      source: "registration",
      sourceId: registration.id,
      correctionOf: null,
      correctionReason: null,
      createdAt: registration.createdAt || event.createdAt,
      createdBy: null,
    });
  }
  const spectators = event.spectators || {};
  transactions.push({
    id: `system:spectators:${event.id}`,
    category: "spectator_income",
    description: "Spectator admission",
    expectedAmount: wholeYen(spectators.entryMoney || 0, "Spectator income"),
    actualAmount: wholeYen(spectators.entryMoney || 0, "Spectator income"),
    party: `${Number(spectators.count || 0)} spectators`,
    occurredAt: event.updatedAt || event.createdAt,
    source: "spectators",
    sourceId: event.id,
    correctionOf: null,
    correctionReason: null,
    createdAt: event.createdAt,
    createdBy: null,
  });
  transactions.push({
    id: `system:spectator-drinks:${event.id}`,
    category: "drink_income",
    description: "Spectator drinks",
    expectedAmount: wholeYen(spectators.drinkMoney || 0, "Spectator drink income"),
    actualAmount: wholeYen(spectators.drinkMoney || 0, "Spectator drink income"),
    party: `${Number(spectators.count || 0)} spectators`,
    occurredAt: event.updatedAt || event.createdAt,
    source: "spectators",
    sourceId: event.id,
    correctionOf: null,
    correctionReason: null,
    createdAt: event.createdAt,
    createdBy: null,
  });
  return transactions.filter((transaction) => transaction.expectedAmount !== 0 || transaction.actualAmount !== 0);
}

function amountImpact(category, amount) {
  if (REVENUE_CATEGORIES.has(category) || category === "adjustment") return amount;
  return -amount;
}

function totalsFor(transactions, field) {
  const categoryTotals = Object.fromEntries(FINANCE_CATEGORIES.map((category) => [category, 0]));
  for (const transaction of transactions) categoryTotals[transaction.category] += Number(transaction[field] || 0);
  const baseRevenue = [...REVENUE_CATEGORIES].reduce((sum, category) => sum + categoryTotals[category], 0);
  const adjustments = categoryTotals.adjustment;
  const grossRevenue = baseRevenue + adjustments;
  const expenses = [...EXPENSE_CATEGORIES].reduce((sum, category) => sum + categoryTotals[category], 0);
  const payouts = categoryTotals.staff_payout;
  const refunds = categoryTotals.refund;
  return {
    categories: categoryTotals,
    baseRevenue,
    adjustments,
    grossRevenue,
    expenses,
    payouts,
    refunds,
    totalOutflow: expenses + payouts + refunds,
    netProfit: grossRevenue - expenses - payouts - refunds,
  };
}

function financeReport(event, configuration) {
  const finance = ensureFinanceState(event);
  const transactions = [...systemTransactions(event, configuration), ...finance.transactions].sort((left, right) => String(left.occurredAt).localeCompare(String(right.occurredAt)) || left.id.localeCompare(right.id));
  const expected = totalsFor(transactions, "expectedAmount");
  const actual = totalsFor(transactions, "actualAmount");
  return {
    eventId: event.id,
    eventName: event.name,
    currency: configuration.financial.currency,
    status: finance.status,
    review: finance.review,
    closedAt: finance.closedAt,
    closedBy: finance.closedBy,
    reopenedAt: finance.reopenedAt,
    reopenedBy: finance.reopenedBy,
    reopenReason: finance.reopenReason,
    transactions,
    expected,
    actual,
    variance: {
      grossRevenue: actual.grossRevenue - expected.grossRevenue,
      totalOutflow: actual.totalOutflow - expected.totalOutflow,
      netProfit: actual.netProfit - expected.netProfit,
    },
    generatedAt: now(),
  };
}

function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (character !== "\r") cell += character;
  }
  if (quoted) throw new Error("CSV contains an unclosed quote");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function headerMap(headers) {
  const mapped = {};
  for (const [field, aliases] of Object.entries(HEADERS)) {
    const index = headers.findIndex((header) => aliases.includes(canonical(header)));
    if (index >= 0) mapped[field] = index;
  }
  return mapped;
}

function previewCostImport(csv) {
  const warnings = []; const errors = []; const records = [];
  let rows;
  try { rows = parseCsv(csv); } catch (error) { return { canImport: false, records, warnings, errors: [{ row: null, message: error.message }] }; }
  if (!rows.length) return { canImport: false, records, warnings, errors: [{ row: null, message: "CSV is empty" }] };
  const mapping = headerMap(rows[0]);
  for (const required of ["category", "description"]) if (mapping[required] === undefined) errors.push({ row: 1, field: required, message: `Missing ${required} column` });
  if (mapping.expectedAmount === undefined && mapping.actualAmount === undefined) errors.push({ row: 1, field: "amount", message: "Add an expected, actual, or amount column" });
  if (errors.length) return { canImport: false, records, warnings, errors };
  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.every((value) => !String(value).trim())) { warnings.push({ row: rowNumber, message: "Blank row ignored" }); return; }
    try {
      const get = (field) => mapping[field] === undefined ? "" : row[mapping[field]];
      records.push(normalizeTransaction({
        category: get("category"), description: get("description"), expectedAmount: get("expectedAmount"), actualAmount: get("actualAmount"), party: get("party"), occurredAt: get("occurredAt"),
      }, { source: "cost_import", createdBy: null, id: `preview:${rowNumber}` }));
    } catch (error) { errors.push({ row: rowNumber, message: error.message }); }
  });
  if (!records.length && !errors.length) errors.push({ row: null, message: "CSV has no financial records" });
  return { canImport: records.length > 0 && errors.length === 0, records, warnings, errors };
}

function importCostRecords(event, preview, staff) {
  const finance = ensureFinanceState(event);
  if (finance.status === "closed") throw Object.assign(new Error("Reopen the event before importing costs"), { statusCode: 409, code: "FINANCE_CLOSED" });
  const records = preview.records.map((record) => normalizeTransaction(record, { source: "cost_import", createdBy: staff }));
  finance.transactions.push(...records);
  finance.status = "open";
  finance.review = { reviewedAt: null, reviewedBy: null, notes: "" };
  return records;
}

function correctionTransaction(event, configuration, transactionId, correctedActualAmount, reason, staff) {
  const finance = ensureFinanceState(event);
  if (finance.status !== "closed") throw Object.assign(new Error("Corrections are available after the event is closed"), { statusCode: 409, code: "FINANCE_NOT_CLOSED" });
  const report = financeReport(event, configuration);
  const original = report.transactions.find((transaction) => transaction.id === transactionId);
  if (!original) throw Object.assign(new Error("Financial transaction not found"), { statusCode: 404 });
  const normalizedReason = String(reason || "").trim();
  if (normalizedReason.length < 3 || normalizedReason.length > 240) throw new Error("Correction reason must be between 3 and 240 characters");
  const corrected = wholeYen(correctedActualAmount, "Corrected actual amount", { signed: original.category === "adjustment" });
  const delta = amountImpact(original.category, corrected) - amountImpact(original.category, original.actualAmount);
  if (delta === 0) throw new Error("Corrected amount must change the financial result");
  const transaction = normalizeTransaction({
    category: "adjustment",
    description: `Correction · ${original.description}`,
    expectedAmount: 0,
    actualAmount: delta,
    party: original.party,
    occurredAt: now(),
    sourceId: original.id,
    correctionOf: original.id,
    correctionReason: normalizedReason,
  }, { source: "correction", createdBy: staff });
  finance.transactions.push(transaction);
  return { transaction, original, correctedActualAmount: corrected };
}

module.exports = {
  FINANCE_CATEGORIES,
  correctionTransaction,
  ensureFinanceState,
  financeReport,
  importCostRecords,
  normalizeCategory,
  normalizeTransaction,
  previewCostImport,
  totalsFor,
};
