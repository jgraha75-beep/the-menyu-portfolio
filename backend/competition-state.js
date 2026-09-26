const COMPETITION_STATES = Object.freeze([
  "registered", "checked_in", "prelim_assigned", "performing", "scored",
  "qualified", "eliminated", "seeded", "bracketed", "completed",
]);

const NEXT_STATES = Object.freeze({
  registered: new Set(["checked_in"]),
  checked_in: new Set(["registered", "prelim_assigned", "seeded"]),
  prelim_assigned: new Set(["checked_in", "performing", "scored"]),
  performing: new Set(["prelim_assigned", "scored"]),
  scored: new Set(["prelim_assigned", "qualified", "eliminated"]),
  qualified: new Set(["scored", "seeded"]),
  eliminated: new Set(["scored"]),
  seeded: new Set(["qualified", "bracketed"]),
  bracketed: new Set(["completed", "seeded"]),
  completed: new Set(["bracketed"]),
});

function inferCompetitionState(registration) {
  if (COMPETITION_STATES.includes(registration.competitionState)) return registration.competitionState;
  if (registration.status === "Checked in") return "checked_in";
  return "registered";
}

function ensureCompetitionState(registration) {
  registration.competitionState = inferCompetitionState(registration);
  return registration.competitionState;
}

function transitionCompetitionState(registration, nextState) {
  if (!COMPETITION_STATES.includes(nextState)) throw new Error(`Unknown competition state: ${nextState}`);
  const currentState = ensureCompetitionState(registration);
  if (currentState !== nextState && !NEXT_STATES[currentState].has(nextState)) throw new Error(`Cannot move an entry from ${currentState} to ${nextState}`);
  registration.competitionState = nextState;
  return nextState;
}

module.exports = { COMPETITION_STATES, ensureCompetitionState, transitionCompetitionState };
