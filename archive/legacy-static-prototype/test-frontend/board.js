let eventId = localStorage.getItem("menyuTestEventId") || "";
let bracket = null;
let registrations = [];
let selectedMatchId = null;
let timerSeconds = 45;
let timerHandle = null;

const $ = (id) => document.getElementById(id);
const apiBase = () => $("board-api").value.replace(/\/$/, "");
const staff = () => ({ name: $("board-staff").value.trim(), role: $("board-role").value.trim() });
const jsonPost = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
function message(text, error = false) { $("board-message").textContent = text; $("board-message").className = error ? "message error" : "message"; }
function titleFor(id) { const registration = registrations.find((item) => item.id === id); return registration ? (registration.teamName || registration.entryName || registration.memberNames || "Needs review") : "Open slot"; }
function selectedMatch() { return bracket?.rounds.flatMap((round) => round.matches).find((match) => match.id === selectedMatchId) || null; }
async function api(path, options = {}) { const response = await fetch(`${apiBase()}${path}`, { cache: "no-store", ...options }); const type = response.headers.get("content-type") || ""; const body = type.includes("application/json") ? await response.json() : await response.text(); if (!response.ok) throw new Error(body.error || body.message || body || `Request failed (${response.status})`); return body; }

function render() {
  $("bracket-title").textContent = bracket ? `${bracket.division === "under15" ? "Under-15" : "2v2"} · ${bracket.source === "prelim_seeded" ? "Prelim seeded" : "Seeded direct"}` : "No bracket loaded";
  $("bracket-board").innerHTML = bracket ? bracket.rounds.map((round, roundIndex) => `<div class="round"><h3>${round.name}</h3>${round.matches.map((match) => { const ready = match.sideA && match.sideB && !match.winnerId; const winner = match.winnerId ? titleFor(match.winnerId) : ""; return `<button class="match-card ${selectedMatchId === match.id ? "selected" : ""} ${match.winnerId ? "complete" : ""}" data-match="${match.id}"><span class="match-number">M${match.matchNumber}</span><span class="competitor ${match.winnerId === match.sideA ? "winner" : ""}">${titleFor(match.sideA)}</span><span class="competitor ${match.winnerId === match.sideB ? "winner" : ""}">${titleFor(match.sideB)}</span><span class="match-state">${match.winnerId ? `Winner: ${winner}` : ready ? "Ready" : roundIndex === 0 ? "Waiting for entries" : "Waiting for previous round"}</span></button>`; }).join("")}</div>`).join("") : '<p class="empty">Load an event and generate a bracket to see the rounds.</p>';
  document.querySelectorAll("[data-match]").forEach((button) => button.addEventListener("click", () => { selectedMatchId = button.dataset.match; renderSelected(); render(); }));
  renderSelected();
}

function renderSelected() {
  const match = selectedMatch();
  const ready = Boolean(match?.sideA && match?.sideB);
  $("selected-title").textContent = match ? `Match ${match.matchNumber}` : "Select a match";
  $("selected-state").textContent = match?.winnerId ? "Complete" : ready ? "Ready" : "Waiting";
  $("selected-match").innerHTML = match ? `<div class="selected-side"><span>LEFT</span><strong>${titleFor(match.sideA)}</strong></div><div class="versus">VS</div><div class="selected-side"><span>RIGHT</span><strong>${titleFor(match.sideB)}</strong></div>${match.winnerId ? `<p class="decision-note">Winner recorded: ${titleFor(match.winnerId)} · ${match.decisionMethod}</p>` : ""}` : "<p>Load a bracket, then choose a match from the board.</p>";
  $("live-matchup").textContent = match ? `${titleFor(match.sideA)} VS ${titleFor(match.sideB)}` : "________ VS ________";
  $("left-win").disabled = !ready || Boolean(match.winnerId); $("right-win").disabled = !ready || Boolean(match.winnerId); $("left-tiebreak").disabled = !ready || Boolean(match.winnerId); $("right-tiebreak").disabled = !ready || Boolean(match.winnerId); $("undo-decision").disabled = !match?.winnerId || match.decisionMethod === "bye";
}

async function loadBoard() { try { eventId = $("board-event").value.trim() || eventId; if (!eventId) throw new Error("Enter an event ID first."); localStorage.setItem("menyuTestEventId", eventId); registrations = await api(`/events/${eventId}/registrations`); bracket = await api(`/events/${eventId}/bracket/${$("board-division").value}`); if (!bracket.rounds) throw new Error(bracket.error || "Bracket not found. Generate it first."); selectedMatchId = bracket.rounds.flatMap((round) => round.matches).find((match) => match.sideA && match.sideB && !match.winnerId)?.id || bracket.rounds[0]?.matches[0]?.id || null; render(); message("Board loaded."); } catch (error) { bracket = null; render(); message(error.message, true); } }
async function generateBracket() { try { if (!eventId) eventId = $("board-event").value.trim(); if (!eventId) throw new Error("Enter an event ID first."); bracket = await api(`/events/${eventId}/bracket`, jsonPost({ bracket: $("board-division").value, staff: staff() })); registrations = await api(`/events/${eventId}/registrations`); selectedMatchId = bracket.rounds[0]?.matches.find((match) => match.sideA && match.sideB)?.id || bracket.rounds[0]?.matches[0]?.id || null; render(); message("Seeded bracket generated."); } catch (error) { message(error.message, true); } }
async function decide(winnerSide, decisionMethod) { try { const match = selectedMatch(); if (!match) throw new Error("Select a match first."); const winnerId = winnerSide === "left" ? match.sideA : match.sideB; const judgeVotes = [{ judgeNumber: 1, winnerId }, { judgeNumber: 2, winnerId }]; await api(`/events/${eventId}/bracket/${$("board-division").value}/matches/${match.id}/decision`, jsonPost({ winnerId, judgeVotes, decisionMethod, staff: staff() })); bracket = await api(`/events/${eventId}/bracket/${$("board-division").value}`); registrations = await api(`/events/${eventId}/registrations`); render(); message(`${titleFor(winnerId)} advances.`); } catch (error) { message(error.message, true); } }
async function undoDecision() { try { const match = selectedMatch(); await api(`/events/${eventId}/bracket/${$("board-division").value}/matches/${match.id}/undo-decision`, jsonPost({ staff: staff() })); bracket = await api(`/events/${eventId}/bracket/${$("board-division").value}`); registrations = await api(`/events/${eventId}/registrations`); render(); message("Decision undone."); } catch (error) { message(error.message, true); } }
function updateTimer() { $("timer").textContent = `00:${String(timerSeconds).padStart(2, "0")}`; }
function startTimer() { if (timerHandle) return; timerHandle = setInterval(() => { timerSeconds = Math.max(0, timerSeconds - 1); updateTimer(); if (timerSeconds === 0) { clearInterval(timerHandle); timerHandle = null; } }, 1000); }
function pauseTimer() { clearInterval(timerHandle); timerHandle = null; }
function resetTimer() { pauseTimer(); timerSeconds = 45; updateTimer(); }

$("board-event").value = eventId; $("load-board").addEventListener("click", loadBoard); $("generate-bracket").addEventListener("click", generateBracket); $("left-win").addEventListener("click", () => decide("left", "normal_vote")); $("right-win").addEventListener("click", () => decide("right", "normal_vote")); $("left-tiebreak").addEventListener("click", () => decide("left", "rematch")); $("right-tiebreak").addEventListener("click", () => decide("right", "rematch")); $("undo-decision").addEventListener("click", undoDecision); $("timer-start").addEventListener("click", startTimer); $("timer-pause").addEventListener("click", pauseTimer); $("timer-reset").addEventListener("click", resetTimer); updateTimer();
