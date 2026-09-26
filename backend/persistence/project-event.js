const crypto = require("node:crypto");

const canonical = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const stableId = (prefix, ...parts) => `${prefix}_${crypto.createHash("sha256").update(parts.map((part) => String(part ?? "")).join("\u001f")).digest("hex").slice(0, 20)}`;

function projectEvent(event) {
  const eventId = event.id;
  const peopleIds = new Set((event.people || []).map((person) => person.id));
  const staff = new Map();
  const eventStaff = new Map();

  const registerStaff = (name, role, attendance = {}) => {
    const nameKey = canonical(name) || "unknown";
    const normalizedRole = String(role || "Unknown").trim() || "Unknown";
    const staffId = stableId("staff", nameKey);
    const eventStaffId = stableId("event_staff", eventId, nameKey, canonical(normalizedRole));
    if (!staff.has(staffId)) staff.set(staffId, { id: staffId, display_name: String(name || "Unknown").trim() || "Unknown", name_key: nameKey, created_at: attendance.signedInAt || event.createdAt });
    const current = eventStaff.get(eventStaffId);
    eventStaff.set(eventStaffId, {
      id: eventStaffId,
      event_id: eventId,
      staff_id: staffId,
      role: normalizedRole,
      signed_in_at: current?.signed_in_at || attendance.signedInAt || event.createdAt,
      last_active_at: attendance.lastActiveAt || current?.last_active_at || event.updatedAt,
    });
    return eventStaffId;
  };

  for (const attendance of event.staffAttendance || []) registerStaff(attendance.name, attendance.role, attendance);
  for (const entry of event.auditLog || []) registerStaff(entry.staffName, entry.staffRole, { signedInAt: entry.at, lastActiveAt: entry.at });

  const registrationMembers = [];
  const checkIns = [];
  const charges = [];
  const prelimScores = [];
  const rankings = [];

  for (const registration of event.registrations || []) {
    const checkedMembers = (registration.members || []).filter((member) => member.checkedIn);
    const drinkMembers = checkedMembers.filter((member) => member.drinkCharged);
    const entryAmount = checkedMembers.length ? Math.round(Number(registration.payment?.battlerEntry || 0) / checkedMembers.length) : 0;
    const drinkAmount = drinkMembers.length ? Math.round(Number(registration.payment?.drink || 0) / drinkMembers.length) : 0;

    for (const [index, member] of (registration.members || []).entries()) {
      const memberId = stableId("member", eventId, registration.id, index);
      registrationMembers.push({
        id: memberId,
        event_id: eventId,
        registration_id: registration.id,
        person_id: member.personId && peopleIds.has(member.personId) ? member.personId : null,
        member_position: index + 1,
        name: member.name || "",
        instagram: member.instagram || registration.instagramMembers?.[index] || "",
        created_at: registration.createdAt,
        updated_at: registration.updatedAt,
      });

      if (!member.checkedIn) continue;
      const checkInId = stableId("checkin", eventId, registration.id, index, member.arrivedAt);
      const auditEntry = (event.auditLog || []).findLast?.((entry) => entry.action === "check_in" && entry.targetId === registration.id && Number(entry.details?.memberIndex) === index && (!member.arrivedAt || entry.at === member.arrivedAt));
      const actorEventStaffId = auditEntry ? registerStaff(auditEntry.staffName, auditEntry.staffRole, { signedInAt: auditEntry.at, lastActiveAt: auditEntry.at }) : null;
      checkIns.push({ id: checkInId, event_id: eventId, registration_member_id: memberId, checked_in_at: member.arrivedAt || registration.updatedAt, actor_event_staff_id: actorEventStaffId, reversed_at: null, reversed_by_audit_id: null, metadata: {} });
      charges.push({
        id: stableId("charge", "entry", checkInId), event_id: eventId, charge_type: "entry", amount_yen: entryAmount,
        registration_id: registration.id, registration_member_id: memberId, person_id: member.personId && peopleIds.has(member.personId) ? member.personId : null,
        charge_subject_key: memberId, charged_at: member.arrivedAt || registration.updatedAt, reversed_at: null, reversed_by_audit_id: null, metadata: {},
      });
      if (member.drinkCharged) {
        charges.push({
          id: stableId("charge", "drink", checkInId), event_id: eventId, charge_type: "drink", amount_yen: drinkAmount,
          registration_id: registration.id, registration_member_id: memberId, person_id: member.personId && peopleIds.has(member.personId) ? member.personId : null,
          charge_subject_key: member.personId && peopleIds.has(member.personId) ? `person:${member.personId}` : `member:${memberId}`,
          charged_at: member.arrivedAt || registration.updatedAt, reversed_at: null, reversed_by_audit_id: null, metadata: {},
        });
      }
    }

    for (const judgeNumber of [1, 2]) {
      const score = registration.scores?.[`judge${judgeNumber}`];
      if (!Number.isInteger(score)) continue;
      const scoreAudit = (event.auditLog || []).findLast?.((entry) => entry.action === "enter_score" && entry.targetId === registration.id && Number(entry.details?.judgeNumber) === judgeNumber);
      prelimScores.push({
        id: stableId("score", eventId, registration.id, judgeNumber), event_id: eventId, registration_id: registration.id,
        judge_number: judgeNumber, judge_name: scoreAudit?.details?.judgeName || event.judgesByDivision?.[registration.bracket]?.[judgeNumber - 1] || event.judges?.[judgeNumber - 1] || "", score,
        entered_by_event_staff_id: scoreAudit ? registerStaff(scoreAudit.staffName, scoreAudit.staffRole, { signedInAt: scoreAudit.at, lastActiveAt: scoreAudit.at }) : null,
        created_at: scoreAudit?.at || registration.updatedAt, updated_at: registration.updatedAt,
      });
    }

    if (registration.prelimOrder != null || registration.prelimRank != null || registration.rankOverride || registration.scores?.average != null) {
      const tieBreakIds = event.prelimTieBreaks?.[registration.bracket]?.registrationIds || [];
      rankings.push({
        id: stableId("ranking", eventId, registration.bracket, registration.id), event_id: eventId, registration_id: registration.id,
        division: registration.bracket, prelim_order: registration.prelimOrder, rank: registration.prelimRank,
        average_score: registration.scores?.average, tie_break_position: tieBreakIds.includes(registration.id) ? tieBreakIds.indexOf(registration.id) + 1 : null,
        override_rank: registration.rankOverride?.rank ?? null, override_reason: registration.rankOverride?.reason || null,
        override_at: registration.rankOverride?.at || null, override_staff_name: registration.rankOverride?.staffName || null,
        updated_at: registration.updatedAt,
      });
    }
  }

  const spectatorCount = Number(event.spectators?.count || 0);
  const spectatorEntryAmount = spectatorCount ? Math.round(Number(event.spectators?.entryMoney || 0) / spectatorCount) : 0;
  const spectatorDrinkAmount = spectatorCount ? Math.round(Number(event.spectators?.drinkMoney || 0) / spectatorCount) : 0;
  for (let index = 0; index < spectatorCount; index += 1) {
    charges.push({ id: stableId("charge", "spectator-entry", eventId, index), event_id: eventId, charge_type: "spectator_entry", amount_yen: spectatorEntryAmount, registration_id: null, registration_member_id: null, person_id: null, charge_subject_key: `spectator:${index + 1}:entry`, charged_at: event.updatedAt, reversed_at: null, reversed_by_audit_id: null, metadata: { spectatorNumber: index + 1 } });
    charges.push({ id: stableId("charge", "spectator-drink", eventId, index), event_id: eventId, charge_type: "spectator_drink", amount_yen: spectatorDrinkAmount, registration_id: null, registration_member_id: null, person_id: null, charge_subject_key: `spectator:${index + 1}:drink`, charged_at: event.updatedAt, reversed_at: null, reversed_by_audit_id: null, metadata: { spectatorNumber: index + 1 } });
  }

  const brackets = [];
  const matches = [];
  const matchRounds = [];
  for (const bracket of Object.values(event.brackets || {})) {
    brackets.push({ id: bracket.id, event_id: eventId, division: bracket.division, source: bracket.source, participant_ids: bracket.participantIds || [], format: bracket.format || {}, created_at: bracket.createdAt, updated_at: event.updatedAt });
    for (const [roundIndex, round] of (bracket.rounds || []).entries()) {
      for (const match of round.matches || []) {
        matches.push({
          id: match.id, event_id: eventId, bracket_id: bracket.id, round_index: roundIndex, round_name: match.roundName || round.name,
          match_number: match.matchNumber, side_a_registration_id: match.sideA, side_b_registration_id: match.sideB, winner_registration_id: match.winnerId,
          decision_method: match.decisionMethod, judge_votes: match.judgeVotes || [], required_performance_rounds: match.requiredPerformanceRounds,
          performance_rounds_completed: match.performanceRoundsCompleted, tie_break_count: match.tieBreakCount || 0, tie_break_active: Boolean(match.tieBreakActive), completed_at: match.completedAt, updated_at: event.updatedAt,
        });
        for (const [historyIndex, history] of (match.tieBreakHistory || []).entries()) {
          for (const [performanceIndex, completedAt] of (history.previousPerformanceRoundCompletedAt || []).entries()) {
            matchRounds.push({ id: stableId("match_round", match.id, "history", historyIndex, performanceIndex, completedAt), event_id: eventId, match_id: match.id, phase: historyIndex === 0 ? "regulation" : "tie_break", round_number: performanceIndex + 1, completed_at: completedAt, reversed_at: null, metadata: { tieBreakHistoryIndex: historyIndex } });
          }
        }
        for (const [performanceIndex, completedAt] of (match.performanceRoundCompletedAt || []).entries()) {
          matchRounds.push({ id: stableId("match_round", match.id, "active", performanceIndex, completedAt), event_id: eventId, match_id: match.id, phase: match.tieBreakCount ? "tie_break" : "regulation", round_number: performanceIndex + 1, completed_at: completedAt, reversed_at: null, metadata: {} });
        }
      }
    }
  }

  const timers = [];
  for (const scope of ["prelims", "bracket"]) for (const [division, timer] of Object.entries(event.timers?.[scope] || {})) timers.push({ id: stableId("timer", eventId, scope, division), event_id: eventId, scope, division, version: timer.version, duration_seconds: timer.durationSeconds, remaining_seconds: timer.remainingSeconds, status: timer.status, started_at: timer.startedAt, updated_at: timer.updatedAt || event.updatedAt });

  const auditLog = (event.auditLog || []).map((entry) => ({
    id: entry.id, event_id: eventId,
    actor_event_staff_id: registerStaff(entry.staffName, entry.staffRole, { signedInAt: entry.at, lastActiveAt: entry.at }),
    staff_name: entry.staffName || "Unknown", staff_role: entry.staffRole || "Unknown", action: entry.action,
    target_type: entry.targetType, target_id: entry.targetId, details: entry.details || {}, reversal_of_audit_id: entry.details?.reversalOfAuditId || null, created_at: entry.at,
  }));

  const financialTransactions = (event.finance?.transactions || []).map((transaction) => ({
    id: transaction.id,
    event_id: eventId,
    category: transaction.category,
    description: transaction.description,
    expected_amount: transaction.expectedAmount,
    actual_amount: transaction.actualAmount,
    party: transaction.party || "",
    occurred_at: transaction.occurredAt,
    source: transaction.source,
    source_id: transaction.sourceId || null,
    correction_of: transaction.correctionOf || null,
    correction_reason: transaction.correctionReason || null,
    created_by_name: transaction.createdBy?.name || "Unknown",
    created_by_role: transaction.createdBy?.role || "Unknown",
    created_at: transaction.createdAt,
  }));

  return {
    events: [{
      id: eventId, name: event.name, event_time: event.eventTime || null, prelims_start_time: event.prelimsStartTime || null,
      location: event.location, time_zone: event.timeZone, judge_names: event.judges || [], next_registration_number: event.nextRegistrationNumber,
      lifecycle_status: event.lifecycle?.status || "active", archived_at: event.lifecycle?.archivedAt || null,
      archived_by_name: event.lifecycle?.archivedBy?.name || null, archived_by_role: event.lifecycle?.archivedBy?.role || null,
      revision: event.revision, domain_snapshot: event, created_at: event.createdAt, updated_at: event.updatedAt,
    }],
    staff: [...staff.values()], event_staff: [...eventStaff.values()],
    people: (event.people || []).map((person) => ({ id: person.id, event_id: eventId, name: person.name, name_key: person.nameKey || canonical(person.name), created_at: person.createdAt, updated_at: event.updatedAt })),
    registrations: (event.registrations || []).map((registration) => ({
      id: registration.id, event_id: eventId, display_code: registration.displayCode, division: registration.bracket,
      registration_source: registration.registrationSource, source_number: registration.sourceNumber || "", team_name: registration.teamName || "", member_names: registration.memberNames || "", entry_name: registration.entryName || "",
      dob: registration.dob || "", parent_name: registration.parentName || "", genre: registration.genre || "", region: registration.region || "", email: registration.email || "", phone: registration.phone || "",
      instagram_team: registration.instagramTeam || "", instagram_members: registration.instagramMembers || [], status: registration.status,
      needs_review: Boolean(registration.needsReview), review_reasons: registration.reviewReasons || [], notes: registration.notes || "", duplicate_of: registration.duplicateOf || [], duplicate_ignored: Boolean(registration.duplicateIgnored),
      payment_summary: registration.payment || {}, created_at: registration.createdAt, updated_at: registration.updatedAt,
    })),
    registration_members: registrationMembers, check_ins: checkIns, charges, prelim_scores: prelimScores, rankings,
    brackets, matches, match_rounds: matchRounds, timers, audit_log: auditLog, financial_transactions: financialTransactions,
  };
}

module.exports = { projectEvent, stableId };
