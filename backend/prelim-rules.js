function hasCompleteScores(registration, judgeCount) {
  const scores = registration.scores?.judgeScores;
  if (Array.isArray(scores)) return scores.length >= judgeCount && scores.slice(0, judgeCount).every(Number.isInteger);
  return judgeCount === 2 && Number.isInteger(registration.scores?.judge1) && Number.isInteger(registration.scores?.judge2);
}

function scoreAverage(registration, judgeCount) {
  if (!hasCompleteScores(registration, judgeCount)) return null;
  const values = Array.isArray(registration.scores?.judgeScores)
    ? registration.scores.judgeScores.slice(0, judgeCount)
    : [registration.scores.judge1, registration.scores.judge2];
  return values.reduce((total, score) => total + score, 0) / judgeCount;
}

function shouldRunPrelims(entryCount, prelims) {
  return Boolean(prelims.enabled) && entryCount > prelims.entryThreshold;
}

function fallbackTieOrder(group) {
  return group.slice().sort((left, right) => (left.prelimOrder || Number.MAX_SAFE_INTEGER) - (right.prelimOrder || Number.MAX_SAFE_INTEGER) || String(left.createdAt).localeCompare(String(right.createdAt)));
}

function rankEntries(entries, { judgeCount, tieBreakRule, savedTieBreak } = {}) {
  const scoreGroups = [...entries.filter((entry) => scoreAverage(entry, judgeCount) !== null).reduce((groups, entry) => {
    const average = scoreAverage(entry, judgeCount);
    const group = groups.get(average) || [];
    group.push(entry);
    groups.set(average, group);
    return groups;
  }, new Map()).entries()].sort(([left], [right]) => right - left).map(([, group]) => {
    if (tieBreakRule === "manual_order" && savedTieBreak && sameIds(savedTieBreak.registrationIds || [], group.map((entry) => entry.id))) {
      return group.slice().sort((left, right) => savedTieBreak.registrationIds.indexOf(left.id) - savedTieBreak.registrationIds.indexOf(right.id));
    }
    return fallbackTieOrder(group);
  });
  return scoreGroups.flat();
}

function sameIds(left, right) { return left.length === right.length && left.every((id) => right.includes(id)); }

function cutoffTie(entries, cutoff, judgeCount) {
  if (entries.length <= cutoff) return [];
  const boundary = scoreAverage(entries[cutoff - 1], judgeCount);
  return boundary === null || scoreAverage(entries[cutoff], judgeCount) !== boundary
    ? []
    : entries.filter((entry) => scoreAverage(entry, judgeCount) === boundary);
}

module.exports = { cutoffTie, hasCompleteScores, rankEntries, scoreAverage, shouldRunPrelims, sameIds };
