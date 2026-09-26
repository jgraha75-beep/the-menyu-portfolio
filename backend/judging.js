const SCORE_STATES = new Set(["draft", "submitted", "locked", "corrected"]);

const canonical = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const judgeId = (division, judgeNumber) => `${division}:judge:${judgeNumber}`;

function judgingError(message, statusCode = 400, code = "JUDGING_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function isEventLead(staff) {
  return canonical(staff?.role) === "event lead";
}

function assignmentsFor(event, divisionConfig) {
  event.judgeAssignments ||= {};
  const division = divisionConfig.id;
  const configuredNames = Array.from({ length: divisionConfig.prelims.judgeCount }, (_, index) => divisionConfig.judges[index] || `Judge ${index + 1}`);
  const existing = new Map((event.judgeAssignments[division] || []).map((assignment) => [assignment.judgeNumber, assignment]));
  const assignments = configuredNames.map((judgeName, index) => {
    const judgeNumber = index + 1;
    const saved = existing.get(judgeNumber);
    return {
      id: judgeId(division, judgeNumber),
      judgeNumber,
      judgeName,
      // A configured judge rename follows the configured name until an Event
      // lead has deliberately assigned a different signed-in staff identity.
      staffName: saved && canonical(saved.staffName) !== canonical(saved.judgeName) ? saved.staffName : judgeName,
      assignedAt: saved?.assignedAt || event.createdAt || event.updatedAt || new Date().toISOString(),
    };
  });
  event.judgeAssignments[division] = assignments;
  return assignments;
}

function assignmentForStaff(event, divisionConfig, staff) {
  const assignment = assignmentsFor(event, divisionConfig).find((candidate) => canonical(candidate.staffName) === canonical(staff?.name));
  if (!assignment) throw judgingError("This staff account is not assigned as a judge for this division", 403, "JUDGE_NOT_ASSIGNED");
  return assignment;
}

function assertEventLead(staff) {
  if (!isEventLead(staff)) throw judgingError("Only an Event lead can change judge assignments or correct a locked score", 403, "JUDGING_NOT_AUTHORIZED");
}

function normalizeScore(score, prelims) {
  if (!Number.isInteger(score) || score < prelims.scoreMinimum || score > prelims.scoreMaximum) {
    throw judgingError(`Score must be a whole number from ${prelims.scoreMinimum} to ${prelims.scoreMaximum}`, 400, "INVALID_SCORE");
  }
  return score;
}

function scoreStore(registration) {
  registration.judging ||= { scores: {} };
  registration.judging.scores ||= {};
  return registration.judging.scores;
}

function migrateLegacyScore(registration, assignment) {
  const scores = scoreStore(registration);
  if (scores[assignment.id]) return scores[assignment.id];
  const legacyScore = registration.scores?.judgeScores?.[assignment.judgeNumber - 1]
    ?? (assignment.judgeNumber === 1 ? registration.scores?.judge1 : assignment.judgeNumber === 2 ? registration.scores?.judge2 : null);
  scores[assignment.id] = {
    judgeId: assignment.id,
    judgeNumber: assignment.judgeNumber,
    state: Number.isInteger(legacyScore) ? "locked" : "draft",
    score: Number.isInteger(legacyScore) ? legacyScore : null,
    draftedAt: null,
    submittedAt: Number.isInteger(legacyScore) ? registration.updatedAt || null : null,
    lockedAt: Number.isInteger(legacyScore) ? registration.updatedAt || null : null,
    correctedAt: null,
    correctionReason: null,
    correctedBy: null,
  };
  return scores[assignment.id];
}

function scoreRecords(event, registration, divisionConfig) {
  return assignmentsFor(event, divisionConfig).map((assignment) => ({ assignment, record: migrateLegacyScore(registration, assignment) }));
}

function applyLockedScores(registration, records, scoreAverage) {
  const values = records.map(({ record }) => record.score);
  registration.scores ||= { judge1: null, judge2: null, judgeScores: [], average: null };
  registration.scores.judgeScores = values;
  registration.scores.judge1 = values[0] ?? null;
  registration.scores.judge2 = values[1] ?? null;
  registration.scores.average = scoreAverage(registration, values.length);
}

function lockWhenReady(event, registration, divisionConfig, at, scoreAverage) {
  const records = scoreRecords(event, registration, divisionConfig);
  if (!records.every(({ record }) => record.state === "submitted" || record.state === "locked" || record.state === "corrected")) return { locked: false, records };
  let changed = false;
  for (const { record } of records) {
    if (record.state === "submitted") {
      record.state = "locked";
      record.lockedAt = at;
      changed = true;
    }
  }
  applyLockedScores(registration, records, scoreAverage);
  return { locked: changed, records };
}

function publicScoreRecord(record) {
  return {
    judgeNumber: record.judgeNumber,
    state: SCORE_STATES.has(record.state) ? record.state : "draft",
    score: record.score,
    draftedAt: record.draftedAt,
    submittedAt: record.submittedAt,
    lockedAt: record.lockedAt,
    correctedAt: record.correctedAt,
  };
}

function monitorStatus(event, divisionConfig, registrations) {
  const assignments = assignmentsFor(event, divisionConfig);
  return {
    division: divisionConfig.id,
    judges: assignments.map((assignment) => ({ judgeNumber: assignment.judgeNumber, judgeName: assignment.judgeName, assignedStaffName: assignment.staffName })),
    entries: registrations.map((registration) => ({
      registrationId: registration.id,
      title: registration.teamName || registration.entryName || registration.memberNames || registration.displayCode,
      prelimOrder: registration.prelimOrder,
      scores: scoreRecords(event, registration, divisionConfig).map(({ assignment, record }) => ({
        judgeNumber: assignment.judgeNumber,
        judgeName: assignment.judgeName,
        state: publicScoreRecord(record).state,
        submittedAt: record.submittedAt,
        lockedAt: record.lockedAt,
        correctedAt: record.correctedAt,
      })),
    })),
  };
}

module.exports = {
  assignmentForStaff,
  applyLockedScores,
  assignmentsFor,
  assertEventLead,
  isEventLead,
  judgeId,
  judgingError,
  lockWhenReady,
  migrateLegacyScore,
  monitorStatus,
  normalizeScore,
  publicScoreRecord,
  scoreRecords,
};
