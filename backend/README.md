# The Menyu backend

This folder is the behind-the-scenes part of The Menyu. It stores the event, applies the battle-day rules, and keeps staff devices from stepping on each other’s changes.

For local testing, it runs as one Node process with one JSON data file. If the crew is using several phones, they should all connect to that same server.

## Start it

```sh
STAFF_ACCESS_CODE=choose-a-local-code node server.js
```

The API runs at `http://localhost:3000`.

If you leave out `STAFF_ACCESS_CODE`, the server makes a temporary one and prints it when it starts. Staff use that code to sign in. Their session token stays in memory and expires when the server restarts.

## API map

- `GET /api/health`
- `GET /api/auth/status`
- `POST /api/auth/login` — `{ "accessCode": "...", "staff": { "name": "...", "role": "..." } }`
- `POST /api/auth/logout`
- `POST /api/events`
- `PATCH /api/events/:eventId` — change event details, lifecycle, and configuration
- `POST /api/events/:eventId/archive` — `{ "action": "archive" | "restore" }`
- `DELETE /api/events/:eventId` — permanently delete an event and its local backups
- `GET /api/events/:eventId`
- `GET /api/events/:eventId/snapshot` — load the whole current event in one response
- `GET /api/events/:eventId/sync?after=<revision>` — check whether another device changed anything
- `GET /api/events/:eventId/backups`
- `GET /api/events/:eventId/backups/:backupId`
- `POST /api/events/:eventId/backups`
- `POST /api/events/:eventId/backups/:backupId/restore`
- `POST /api/events/:eventId/import/preview` — validate and preview a CSV or Enter The Stage PDF without saving it
- `POST /api/events/:eventId/import` — import a configured division's CSV/PDF after preview validation
- `GET /api/events/:eventId/imports` — list import history, snapshots, and undo state
- `POST /api/events/:eventId/imports/undo` — undo the latest import if it has not entered a prelim order or bracket
- `GET /api/events/:eventId/registrations?bracket=2v2`
- `POST /api/events/:eventId/registrations` — add a same-day entry
- `PATCH /api/events/:eventId/registrations/:registrationId`
- `POST /api/events/:eventId/registrations/:registrationId/resolve-duplicate` — `{ "action": "ignore" | "delete" }`
- `POST /api/events/:eventId/registrations/:registrationId/check-in`
- `POST /api/events/:eventId/registrations/:registrationId/undo-check-in`
- `POST /api/events/:eventId/registrations/:registrationId/cancel`
- `POST /api/events/:eventId/registrations/:registrationId/restore`
- `POST /api/events/:eventId/registrations/:registrationId/scores`
- `POST /api/events/:eventId/registrations/:registrationId/link-person`
- `POST /api/events/:eventId/spectators`
- `POST /api/events/:eventId/staff-attendance`
- `GET /api/events/:eventId/finance` — projected operational income plus the event finance ledger
- `POST /api/events/:eventId/finance/transactions` — add revenue, costs, payouts, refunds, or adjustments
- `POST /api/events/:eventId/finance/import/preview` — validate an English or Japanese cost CSV without saving it
- `POST /api/events/:eventId/finance/import` — import a reviewed cost CSV
- `POST /api/events/:eventId/finance/review` — record the final financial review
- `POST /api/events/:eventId/finance/close` — lock finances and complete the event
- `POST /api/events/:eventId/finance/reopen` — Event lead only; requires a reason
- `POST /api/events/:eventId/finance/corrections` — append a correction to a closed record
- `POST /api/events/:eventId/timers/:scope/:division` — shared `start`, `pause`, or `reset` with `expectedTimerVersion`
- `POST /api/events/:eventId/prelim-order`
- `POST /api/events/:eventId/prelim-tiebreak` — tied registration IDs in winner-to-loser order
- `POST /api/events/:eventId/rankings`
- `POST /api/events/:eventId/bracket`
- `POST /api/events/:eventId/bracket/:bracket/matches/:matchId/complete-performance-round`
- `POST /api/events/:eventId/bracket/:bracket/matches/:matchId/decision` — send the winner’s registration ID or `tie`
- `POST /api/events/:eventId/bracket/:bracket/matches/:matchId/undo-decision`
- `GET /api/events/:eventId/report`
- `GET /api/events/:eventId/exports/combined.csv`
- `GET /api/events/:eventId/exports/combined.pdf`
- `GET /api/events/:eventId/exports/finance.csv`
- `GET /api/events/:eventId/exports/finance.pdf`

Bracket seeds come from prelim rankings when prelims are needed. If a division skips prelims, the original registration order becomes the seed order and walk-ins go at the end.

Imports preserve the source entry number from the CSV/PDF. The preview maps common English and Japanese headers, reports blocking row errors and non-blocking review warnings, and shows the rows before anything is written. Enter The Stage entry-list PDFs can be uploaded directly; the server extracts their table and sends it through the same validation path as CSV. Every applied import creates an integrity-checked snapshot, and the latest import can be undone until bracket activity depends on it.

The backend links the same person across both divisions. Each division has its own entry fee, but the included ¥700 drink is charged only once per person for the event.

## Event configuration and lifecycle

Every event has a versioned `configuration` object. It defines the competition type, divisions, team sizes, entry limits, prelim and bracket rules, judges, staff roles, display settings, and fees. Older 2v2/U-15 events are normalized to the same shape automatically, so their existing registrations and links keep working.

The API accepts event states of `draft`, `active`, `paused`, `completed`, and `archived`. Draft and active events can run event-day actions. Paused, completed, and archived events keep their records readable but reject operational changes until the event is made active again. The server blocks structural configuration edits after registrations, prelim orders, or brackets depend on them; fee edits are blocked once the affected money has been recorded.

`7-to-smoke` can be configured and stored, but it deliberately does not enter the head-to-head prelim or bracket engine. Its dedicated run-of-show belongs in a later gameplay phase rather than being represented by an incorrect bracket.

The judges do not need the app during bracket battles. They point to a side, and the tournament-board operator taps the winner. If they call a tie, the app opens one replay round. Results, replays, corrections, and undo actions all go into the activity log.

## Event finance

Registration and spectator payments remain owned by event operations; the finance report projects those records into an immutable system ledger. Merchandise, drink sales, venue expenses, staff payouts, other costs, refunds, and adjustments are append-only finance transactions. Expected and actual values are stored as whole yen.

`gross revenue - event expenses - staff payouts - refunds = net profit`. Signed adjustments are included in gross revenue so a documented cash-count correction can move the final result in either direction without rewriting the source payment.

Event leads and Finance leads can enter records, preview/import costs, review, close, and append closed-record corrections. Other signed-in roles receive a read-only report. Only an Event lead can reopen a closed event, and reopening requires a reason. Closing requires a completed final review; later corrections preserve the original row and add a signed delta with staff identity, timestamp, and reason. The same actions are written to the event activity log.

Cost imports accept CSV headers such as `category`, `description`, `expected`, `actual`, `payee`, and `date`, plus their Japanese equivalents. The Supabase migration in `supabase/migrations/20260925010000_add_event_finance.sql` stores manual/imported/correction rows while the event aggregate remains the recovery source of truth.

## When several phones are connected

Every event has a revision number. The server returns it as `X-Event-Revision`, and protected changes send it back through `If-Match`. If another phone changed the event first, the server returns `409 REVISION_CONFLICT`. If the app does not know a revision at all, it returns `428 REVISION_REQUIRED`.

Registration forms and scores also carry the registration’s `updatedAt` value, so an old form cannot quietly overwrite a newer edit.

Door actions that can safely happen at the same time—imports, walk-ins, staff attendance, spectator counts, and check-ins—are handled against the newest data. If two phones check in the same person, the first one wins and the second sees `Already checked in`. No second charge or revision bump is created.

Timers belong to the server too. Timer commands have their own version number, so an unrelated check-in does not interrupt the bracket operator, while two competing timer taps cannot overwrite each other.

## Backups

Local backups live in `backups/<eventId>/` next to the data file unless `BACKUP_DIR` points somewhere else. Each backup has a SHA-256 digest. If that check fails, the app will not restore the file.

Making a backup and restoring one are both logged. Before restoring, the server saves the current state as a safety backup. It keeps the existing staff-attendance history and audit log, then records the restore as a new activity. Connected devices see a new revision and reload.

The local JSON writer saves through a temporary file and an atomic rename so an interrupted write does not leave half a file. Run only one backend process against a local event data file. The app does not queue offline changes, so a phone must reconnect before it can update the event.

## Finished events and test events

New events can be marked as `live` or `rehearsal`. Rehearsal events are separate records so staff can test imports, check-in, timers, rankings, and handoffs without mixing test activity into the live event. The mode can be changed from Event settings before the event is archived.

Archiving removes an event from the active menu and locks check-in, scoring, brackets, timers, and other event-day changes, but keeps its records, exports, and backups. Staff can restore it later.

Permanent deletion is different. It removes the event and its app-managed backup folder, so it cannot be brought back through The Menyu.
