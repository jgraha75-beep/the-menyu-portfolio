# Battle-day rules we have settled on

These are the choices The Menyu currently follows. Keeping them here makes it easier to remember what the organizer said and spot anything that still needs an answer.

## Prelims, brackets, and the live display

- 2v2 uses a Top 16 cutoff. U15 uses Top 8. Existing brackets are never silently resized.
- U-15 only has prelims when more than 8 battlers enter. The top 8 move on.
- In prelims, two judges each give a whole-number score from 1–10. Ranking uses the average of both scores.
- A tie at the cutoff gets a right-side/left-side battle. Staff put the tied entries in winner-to-loser order before making the bracket.
- Bracket matchups are seeded, not random.
- If a division does not need prelims, the original registration order supplies the seeds. Same-day entries go at the end.
- Judges do not use the app for bracket decisions. They point right or left, and the tournament-board operator taps the winner.
- A normal match has one performance round before the result. The final has two rounds, and the winner is entered after both are finished.
- If the judges call a tie, the operator taps **Tie**. The app starts one no-score replay round, then the operator chooses the replay winner. Staff can undo a replay or result if someone taps the wrong thing.
- Prelim battles give Team A 90 seconds and Team B 90 seconds. After performances, staff enter both judges' written scores.
- Judges are editable per division: 2v2 CanDoo / D.MYST; U15 Jay-K / Kano.
- The bracket workspace can prepare a read-only qualifier list for manual transfer to Quan's board. Incomplete performances, missing scores, and unresolved cutoff ties block the list. Preparing it does not modify slides or event data.
- U-15 has one round before the final and two rounds in the final. Its exact timer setting is still controlled by staff.
- Prelim order follows the imported entry numbers and locks when prelims begin. Fully checked-in walk-ins append to the end before the bracket exists.
- The audience display follows the selected division's locked prelim order: current A/B matchup, active side's 90-second timer, and next matchup on deck. Both 2v2 and U15 use this view. After prelims it shows a completion message; the projector switches manually to Quan's Top 16 / Top 8 board. Scores, rankings, payment details, and staff information are not shown.

## How the crew uses the app

- One staff member can have several roles.
- Roles decide the first workspace and useful shortcuts, not permission levels.
- Everyone on staff can still open every area and fix event data.
- The current app has four workspaces: Event HQ, Check-in, Prelims, and Tournament Board.
- The Node backend holds the real event state. The frontend remembers the selected event and staff workspace after a refresh.
- Staff phones check the shared event revision about every 1.2 seconds and reload the whole current snapshot after a change.
- Old edits are rejected instead of overwriting newer work. Door actions that can safely stack together still merge, and a second check-in attempt shows `Already checked in`.
- Prelim and bracket timers are shared server state with their own conflict protection.
- Offline changes are not queued. Staff need to reconnect to the event backend before saving anything.
- Event HQ can create checked recovery points. Restoring one first saves the current state and keeps staff attendance and the activity log.

## Still waiting on an answer

- We still need the organizer’s exact U-15 birth-date cutoff or eligibility rule. The app saves date of birth and parent/guardian details and flags the missing policy, but it does not make up an age rule.
- A separate public/stage display can come later. Right now the priority is making the staff side dependable and fun to use.
# Launch-day prelim performance flow — 2026-09-20

- Paired performances follow locked registration IDs, A then B, with 90 seconds per side. The live position is saved in `prelimOrders[division].currentEntryIndex` and protected by the event revision.
- Advancing resets the shared timer to 90 seconds. Pause before ending a performance early; Previous side recovers an accidental advance.
- The staff score-entry UI opens after the last performance. Scores remain 1–10; judge labels are CanDoo / D.MYST for 2v2 and Jay-K / Kano for U15. Unsaved score drafts survive polling.
- An odd final entry is explicitly shown without an opponent; no existing entrant is silently repeated. A checked-in late arrival appends and reopens the remaining performance run.
- Qualification cutoffs and public audience display are unchanged in this step. Backend score endpoints retain compatibility with existing clients; score-screen sequencing is enforced in the staff UI.
- Local verification: backend suite, 14 frontend tests, production build, desktop and 390px phone rendering. Not deployed; the step-1 score-range migration still needs hosted application before launch.
# Spectator correction — 2026-09-20

- Check-in now offers Undo last spectator, with confirmation and offline/empty-state protection using existing button styles.
- Undo targets the displayed latest unreversed addition by audit ID. New additions invalidate a stale target; repeated or concurrent reversals of the same target are harmless.
- Reverse one spectator plus their recorded entry and drink amounts. Legacy additions fall back to the existing ¥2,000 + ¥700 fees. This corrects the cash record; it does not issue a refund.
- Keep the original audit record and append a linked reversal. Negative totals and unknown targets are rejected.
- Verified locally: full backend suite, frontend 15 tests, type checks, production build, desktop and 390px rendering. No deployment or live-event mutation.
