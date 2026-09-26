// This is the only model exposed to the unauthenticated audience route. Keep it
// deliberately small: a display must never become an alternate staff API.
function displayEntry(registration, registrationTitle) {
  if (!registration) return null;
  return { id: registration.id, number: String(registration.sourceNumber || ""), name: registrationTitle(registration) || "TBA" };
}

function scoreForPrelim(registration) {
  const value = registration?.scores?.average;
  return Number.isFinite(value) ? value : null;
}

function scoreForBracket(match) {
  const votes = match.judgeVotes || [];
  if (!votes.length) return { sideA: null, sideB: null, kind: "pending" };
  return {
    sideA: votes.filter((vote) => vote.winnerId === match.sideA).length,
    sideB: votes.filter((vote) => vote.winnerId === match.sideB).length,
    kind: "judge_votes",
  };
}

function displayTimer(timer) {
  return timer ? { version: timer.version, durationSeconds: timer.durationSeconds, remainingSeconds: timer.remainingSeconds, status: timer.status, startedAt: timer.startedAt, updatedAt: timer.updatedAt } : null;
}

function buildDisplayProjection(event, division, { divisionSettings, registrationTitle, at }) {
  const registrations = new Map(event.registrations.filter((entry) => entry.bracket === division).map((entry) => [entry.id, entry]));
  const entry = (id) => displayEntry(registrations.get(id), registrationTitle);
  const order = event.prelimOrders?.[division];
  const orderedIds = order?.lockedAt ? order.registrationIds : [];
  const index = Math.min(Math.max(0, order?.currentEntryIndex || 0), orderedIds.length);
  const prelimFinished = orderedIds.length > 0 && index >= orderedIds.length;
  const prelimStart = Math.floor(index / 2) * 2;
  const prelimMatch = (offset) => {
    if (offset >= orderedIds.length) return null;
    const sideA = entry(orderedIds[offset]); const sideB = entry(orderedIds[offset + 1]);
    return {
      id: `prelim-${Math.floor(offset / 2) + 1}`,
      phase: "prelims",
      round: "Prelims",
      position: `Battle ${Math.floor(offset / 2) + 1} of ${Math.ceil(orderedIds.length / 2)}`,
      state: "ready",
      activeSide: offset === prelimStart ? (index % 2 === 0 ? "A" : "B") : null,
      sideA,
      sideB,
      score: { sideA: scoreForPrelim(registrations.get(orderedIds[offset])), sideB: scoreForPrelim(registrations.get(orderedIds[offset + 1])), kind: "average" },
    };
  };
  const publicBracketMatches = (event.brackets?.[division]?.rounds || []).flatMap((round) => round.matches.map((match) => {
    const state = match.winnerId ? "complete" : match.sideA && match.sideB ? "ready" : "waiting";
    return {
      id: match.id,
      phase: "bracket",
      round: round.name,
      position: `${round.name} · Battle ${match.matchNumber}`,
      state,
      activeSide: null,
      sideA: entry(match.sideA),
      sideB: entry(match.sideB),
      winner: entry(match.winnerId),
      score: scoreForBracket(match),
      performance: { completed: match.performanceRoundsCompleted, required: match.requiredPerformanceRounds, tieBreakActive: Boolean(match.tieBreakActive) },
    };
  }));
  const readyBracketMatches = publicBracketMatches.filter((match) => match.state === "ready");
  const bracket = event.brackets?.[division] || null;
  const prelimActive = orderedIds.length > 0 && !prelimFinished && !bracket;
  const bracketActive = Boolean(bracket && readyBracketMatches.length);
  const phase = prelimActive ? "prelims" : bracketActive ? "bracket" : bracket || prelimFinished ? "complete" : "waiting";
  const current = phase === "prelims" ? prelimMatch(prelimStart) : phase === "bracket" ? readyBracketMatches[0] : null;
  const onDeck = phase === "prelims" ? prelimMatch(prelimStart + 2) : phase === "bracket" ? readyBracketMatches[1] || null : null;
  const prelimTimer = displayTimer(event.timers?.prelims?.[division]);
  const bracketTimer = displayTimer(event.timers?.bracket?.[division]);
  const publicBracket = bracket ? {
    id: bracket.id,
    createdAt: bracket.createdAt,
    source: bracket.source,
    rounds: bracket.rounds.map((round) => ({
      name: round.name,
      matches: round.matches.map((match) => ({
        id: match.id,
        matchNumber: match.matchNumber,
        sideA: match.sideA,
        sideB: match.sideB,
        winnerId: match.winnerId,
        requiredPerformanceRounds: match.requiredPerformanceRounds,
        performanceRoundsCompleted: match.performanceRoundsCompleted,
        tieBreakActive: Boolean(match.tieBreakActive),
      })),
    })),
  } : null;
  const participantIds = new Set(bracket?.participantIds || []);
  for (const round of bracket?.rounds || []) for (const match of round.matches || []) for (const registrationId of [match.sideA, match.sideB, match.winnerId]) if (registrationId) participantIds.add(registrationId);

  return {
    serverNow: at(),
    updatedAt: event.updatedAt,
    event: { id: event.id, name: event.name, location: event.location, eventTime: event.eventTime, timeZone: event.timeZone },
    division,
    divisionName: divisionSettings.name,
    qualifierCount: divisionSettings.prelims.qualifierCount,
    presentation: {
      showEntryNumbers: event.configuration.display.showEntryNumbers,
      showOnDeck: event.configuration.display.showOnDeck,
      showTimer: event.configuration.display.showTimer,
    },
    projection: { phase, current, onDeck, timer: phase === "prelims" ? prelimTimer : phase === "bracket" ? bracketTimer : null },
    // Keep the original prelim/bracket shapes while consumers move to projection.
    prelim: {
      status: prelimFinished ? "complete" : orderedIds.length ? "active" : "waiting",
      battleNumber: prelimFinished || !orderedIds.length ? null : Math.floor(index / 2) + 1,
      totalBattles: Math.ceil(orderedIds.length / 2),
      activeSide: prelimFinished || !orderedIds.length ? null : index % 2 === 0 ? "A" : "B",
      current: prelimFinished ? null : prelimMatch(prelimStart),
      onDeck: prelimFinished ? null : prelimMatch(prelimStart + 2),
      timer: prelimTimer,
    },
    entries: [...registrations.values()].filter((registration) => participantIds.has(registration.id)).map((registration) => ({ id: registration.id, name: registrationTitle(registration) })),
    timer: bracketTimer,
    bracket: publicBracket,
  };
}

module.exports = { buildDisplayProjection };
