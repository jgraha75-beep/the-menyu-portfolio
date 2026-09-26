export type Division = string;
export type EventLifecycleState = "draft" | "active" | "paused" | "completed" | "archived";
export type CompetitionFormat = "head_to_head" | "seven_to_smoke";
export type EventDivisionConfiguration = {
  id: Division;
  name: string;
  ageGroup: string;
  teamSize: number;
  registrationLimit: number | null;
  prelims: { enabled: boolean; qualifierCount: number; entryThreshold: number; maxQualificationSpots: number; judgeCount: number; tieBreakRule: "manual_order" | "prelim_order"; secondsPerSide: number; scoreMinimum: number; scoreMaximum: number };
  bracket: { enabled: boolean; type: string; qualifierCount: number; size: 2 | 4 | 8 | 16 | 32; seedMode: "prelim_rank" | "source_number" | "manual"; regularPerformanceRounds: number; finalPerformanceRounds: number; secondsPerBattler: number; movesPerBattler: number };
  judges: string[];
  financial: { earlyEntryFee: number; sameDayEntryFee: number; drinkFee: number };
};
export type EventConfiguration = {
  schemaVersion: number;
  competitionFormat: CompetitionFormat;
  divisions: EventDivisionConfiguration[];
  staffRoles: string[];
  display: { showEntryNumbers: boolean; showOnDeck: boolean; showTimer: boolean; theme: string };
  financial: { currency: string; spectatorEntryFee: number; spectatorDrinkFee: number };
};
export type Workspace = "now" | "checkin" | "prelims" | "bracket" | "display" | "records" | "settings";

export type Staff = {
  name: string;
  role: string;
};

export type FinancialCategory = "registration_income" | "spectator_income" | "merchandise_income" | "drink_income" | "venue_expense" | "staff_payout" | "other_cost" | "refund" | "adjustment";

export type FinancialTransaction = {
  id: string;
  category: FinancialCategory;
  description: string;
  expectedAmount: number;
  actualAmount: number;
  party: string;
  occurredAt: string;
  source: "registration" | "spectators" | "manual" | "cost_import" | "correction";
  sourceId: string | null;
  correctionOf: string | null;
  correctionReason: string | null;
  createdAt: string;
  createdBy: Staff | null;
};

export type FinancialTotals = {
  categories: Record<FinancialCategory, number>;
  baseRevenue: number;
  adjustments: number;
  grossRevenue: number;
  expenses: number;
  payouts: number;
  refunds: number;
  totalOutflow: number;
  netProfit: number;
};

export type FinancialReport = {
  eventId: string;
  eventName: string;
  currency: string;
  status: "open" | "review" | "closed";
  review: { reviewedAt: string | null; reviewedBy: Staff | null; notes: string };
  closedAt: string | null;
  closedBy: Staff | null;
  reopenedAt: string | null;
  reopenedBy: Staff | null;
  reopenReason: string | null;
  transactions: FinancialTransaction[];
  expected: FinancialTotals;
  actual: FinancialTotals;
  variance: { grossRevenue: number; totalOutflow: number; netProfit: number };
  generatedAt: string;
};

export type FinanceImportPreview = {
  canImport: boolean;
  records: FinancialTransaction[];
  warnings: Array<{ row: number | null; message: string }>;
  errors: Array<{ row: number | null; field?: string; message: string }>;
};

export type CheckInQuote = {
  entryMoney: number;
  drinkMoney: number;
  total: number;
  currency: "JPY";
};

export type Member = {
  name: string;
  personId: string | null;
  instagram: string;
  checkedIn: boolean;
  arrivedAt: string | null;
  drinkCharged: boolean;
  checkInQuote: CheckInQuote | null;
};

export type Scores = {
  judge1: number | null;
  judge2: number | null;
  judgeScores?: Array<number | null>;
  average: number | null;
};

export type JudgeScoreState = "draft" | "submitted" | "locked" | "corrected";

export type JudgeSession = {
  event: { id: string; name: string; mode: "live" | "rehearsal" };
  division: { id: Division; name: string; scoreMinimum: number; scoreMaximum: number; secondsPerSide: number };
  judge: { judgeNumber: number; judgeName: string; assignedStaffName: string };
  current: null | {
    id: string;
    title: string;
    members: string;
    style: string;
    number: string;
    prelimOrder: number | null;
    updatedAt: string;
    score: { judgeNumber: number; state: JudgeScoreState; score: number | null; draftedAt: string | null; submittedAt: string | null; lockedAt: string | null; correctedAt: string | null };
  };
  onDeck: null | { title: string; number: string; prelimOrder: number | null };
};

export type JudgingMonitorStatus = {
  division: Division;
  judges: Array<{ judgeNumber: number; judgeName: string; assignedStaffName: string }>;
  entries: Array<{ registrationId: string; title: string; prelimOrder: number | null; scores: Array<{ judgeNumber: number; judgeName: string; state: JudgeScoreState; submittedAt: string | null; lockedAt: string | null; correctedAt: string | null }> }>;
};

export type Registration = {
  fieldChanges?: Record<string, import("./offline/types").FieldChange>;
  id: string;
  displayCode: string;
  eventId: string;
  bracket: Division;
  registrationSource: "early" | "same_day";
  sourceNumber: string;
  teamName: string;
  memberNames: string;
  entryName: string;
  dob: string;
  parentName: string;
  genre: string;
  region: string;
  email: string;
  phone: string;
  instagramTeam: string;
  instagramMembers: string[];
  status: "Registered" | "Partial" | "Checked in" | "Canceled";
  competitionState?: "registered" | "checked_in" | "prelim_assigned" | "performing" | "scored" | "qualified" | "eliminated" | "seeded" | "bracketed" | "completed";
  needsReview: boolean;
  reviewReasons: string[];
  members: Member[];
  payment: {
    battlerEntry: number;
    drink: number;
    total: number;
    paidAt: string | null;
  };
  notes: string;
  duplicateOf: string[];
  duplicateIgnored: boolean;
  prelimOrder: number | null;
  prelimRank: number | null;
  rankOverride: { rank: number; reason: string; at: string; staffName: string } | null;
  scores: Scores;
  createdAt: string;
  updatedAt: string;
};

export type Match = {
  id: string;
  matchNumber: number;
  roundName?: string;
  sideA: string | null;
  sideB: string | null;
  judgeVotes: Array<{ judgeNumber: number; winnerId: string }>;
  winnerId: string | null;
  decisionMethod: "operator_choice" | "tie_break_operator_choice" | "normal_vote" | "rematch" | "judge_agreement" | "bye" | null;
  completedAt: string | null;
  requiredPerformanceRounds: number;
  performanceRoundsCompleted: number;
  performanceRoundCompletedAt: string[];
  tieBreakCount?: number;
  tieBreakActive?: boolean;
  tieBreakHistory?: Array<{ at: string; staffName: string; staffRole: string; previousRequiredPerformanceRounds: number; previousPerformanceRoundsCompleted: number; previousPerformanceRoundCompletedAt: string[] }>;
};

export type BracketRound = {
  name: string;
  matches: Match[];
};

export type Bracket = {
  id: string;
  division: Division;
  createdAt: string;
  source: "prelim_seeded" | "seeded_direct";
  participantIds: string[];
  format: {
    decision: string;
    regular: { performanceRounds: number; secondsPerBattler: number | null; movesPerBattler: number | null };
    final: { performanceRounds: number; secondsPerBattler: number | null; movesPerBattler: number | null };
  };
  rounds: BracketRound[];
};

export type PrelimOrder = {
  currentEntryIndex?: number;
  lockedAt: string;
  registrationIds: string[];
};

export type SharedTimer = {
  version: number;
  durationSeconds: number;
  remainingSeconds: number;
  status: "idle" | "running" | "paused";
  startedAt: string | null;
  updatedAt: string;
};

export type EventData = {
  id: string;
  name: string;
  eventTime: string;
  prelimsStartTime: string;
  location: string;
  timeZone: string;
  mode: "live" | "rehearsal";
  nextRegistrationNumber: number;
  revision: number;
  updatedAt: string;
  judges: string[];
  judgesByDivision?: Partial<Record<Division, string[]>>;
  configuration: EventConfiguration;
  lifecycle: {
    status: EventLifecycleState;
    archivedAt: string | null;
    archivedBy: Staff | null;
  };
  people: Array<{ id: string; name: string; nameKey: string; createdAt: string }>;
  registrations: Registration[];
  spectators: { count: number; entryMoney: number; drinkMoney: number; undoAuditId?: string | null };
  prelimOrders: Partial<Record<Division, PrelimOrder>>;
  prelimTieBreaks: Partial<Record<Division, { registrationIds: string[]; at: string; staffName: string; staffRole: string }>>;
  bracketSeeds?: Partial<Record<Division, { registrationIds: string[]; at: string; staffName: string; staffRole: string }>>;
  brackets: Partial<Record<Division, Bracket>>;
  timers: Record<"prelims" | "bracket", Partial<Record<Division, SharedTimer>>>;
  staffAttendance: Array<{ id: string; key: string; name: string; role: string; signedInAt: string; lastActiveAt: string }>;
  finance?: {
    schemaVersion: number;
    status: "open" | "review" | "closed";
    transactions: FinancialTransaction[];
    review: FinancialReport["review"];
    closedAt: string | null;
    closedBy: Staff | null;
    reopenedAt: string | null;
    reopenedBy: Staff | null;
    reopenReason: string | null;
  };
  createdAt: string;
};

export type EventReport = {
  eventId: string;
  eventName: string;
  eventTime: string;
  exportedAt: string;
  divisions: {
    twoVTwo: DivisionSummary;
    under15: DivisionSummary;
  };
  divisionSummaries: Record<Division, DivisionSummary>;
  cashByDivision: Record<Division, CashCategory>;
  cashByCategory: {
    twoVTwo: CashCategory;
    under15: CashCategory;
    spectator: CashCategory;
  };
  staffAttendance: EventData["staffAttendance"];
  auditLog?: AuditEntry[];
  totals: {
    teams: number;
    battlers: number;
    totalTeams: number;
    checkedInTeams: number;
    totalBattlers: number;
    checkedInBattlers: number;
    spectators: number;
    canceled: number;
    battlerEntryMoney: number;
    spectatorEntryMoney: number;
    drinkMoney: number;
    totalCash: number;
  };
};

export type AuditEntry = {
  id: string;
  at: string;
  staffName: string;
  staffRole: string;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
};

export type EventSnapshot = {
  revision: number;
  serverNow: string;
  event: EventData;
  registrations: Registration[];
  report: EventReport & { auditLog: AuditEntry[] };
};

export type SyncStatus = {
  eventId: string;
  revision: number;
  changed: boolean;
  updatedAt: string;
  serverNow: string;
};

export type PublicDisplayMatch = {
  id: string;
  matchNumber: number;
  sideA: string | null;
  sideB: string | null;
  winnerId: string | null;
  requiredPerformanceRounds: number;
  performanceRoundsCompleted: number;
  tieBreakActive: boolean;
};

export type PublicPrelimEntry = { id: string; number: string; name: string };
export type PublicPrelimMatch = { sideA: PublicPrelimEntry | null; sideB: PublicPrelimEntry | null };
export type PublicDisplayScore = { sideA: number | null; sideB: number | null; kind: "average" | "judge_votes" | "pending" };
export type PublicDisplayMatchup = {
  id: string;
  phase: "prelims" | "bracket";
  round: string;
  position: string;
  state: "ready" | "waiting" | "complete";
  activeSide: "A" | "B" | null;
  sideA: PublicPrelimEntry | null;
  sideB: PublicPrelimEntry | null;
  winner?: PublicPrelimEntry | null;
  score: PublicDisplayScore;
  performance?: { completed: number; required: number; tieBreakActive: boolean };
};
export type PublicDisplayData = {
  prelim: {
    status: "waiting" | "active" | "complete";
    battleNumber: number | null;
    totalBattles: number;
    activeSide: "A" | "B" | null;
    current: PublicPrelimMatch | null;
    onDeck: PublicPrelimMatch | null;
    timer: SharedTimer | null;
  };
  serverNow: string;
  updatedAt: string;
  event: Pick<EventData, "id" | "name" | "location" | "eventTime" | "timeZone">;
  division: Division;
  divisionName?: string;
  qualifierCount?: number;
  presentation: { showEntryNumbers: boolean; showOnDeck: boolean; showTimer: boolean };
  projection: {
    phase: "waiting" | "prelims" | "bracket" | "complete";
    current: PublicDisplayMatchup | null;
    onDeck: PublicDisplayMatchup | null;
    timer: SharedTimer | null;
  };
  entries: Array<{ id: string; name: string }>;
  timer: SharedTimer | null;
  bracket: {
    id: string;
    createdAt: string;
    source: "prelim_seeded" | "seeded_direct";
    rounds: Array<{ name: string; matches: PublicDisplayMatch[] }>;
  } | null;
};

export type BackupSummary = {
  backupId: string;
  eventId: string;
  eventName: string;
  createdAt: string;
  reason: string;
  kind: "manual" | "pre_restore" | "import";
  createdBy: Staff;
  revision: number | null;
  registrationCount: number;
};

export type ImportWarning = { code: string; row: number | null; field?: string; message: string };
export type ImportPreviewRecord = {
  sourceNumber: string;
  teamName: string;
  memberNames: string;
  entryName: string;
  genre: string;
  region: string;
  email: string;
  phone: string;
  notes: string;
  sourceRow?: number;
  needsReview: boolean;
  reviewReasons: string[];
};
export type ImportPreview = {
  canImport: boolean;
  sourceType?: "csv" | "pdf";
  headers: string[];
  mapping: Record<string, string | null>;
  records: ImportPreviewRecord[];
  warnings: ImportWarning[];
  errors: ImportWarning[];
  skippedRows: number;
  recordCount: number;
};
export type ImportSummary = {
  importId: string | null;
  auditId: string;
  division: Division;
  createdAt: string;
  count: number;
  registrationIds: string[];
  sourceType: "csv" | "pdf";
  undone: boolean;
  backup: BackupSummary | null;
};

export type DivisionSummary = {
  registrations: number;
  fullyCheckedIn: number;
  partial: number;
  battlers: number;
  checkedInBattlers: number;
  entryMoney: number;
  drinkMoney: number;
};

export type CashCategory = {
  entryMoney: number;
  drinkMoney: number;
  total: number;
};
