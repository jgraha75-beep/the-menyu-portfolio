# The Menyu frontend

This is the part of The Menyu that CHIP CHOP staff use during the event. It is still a working prototype, but the important battle-day tools are connected to the real Node backend. Older browser-only prototypes are retained outside the deployable app under `../archive/legacy-static-prototype/`.

## Run it locally

Start the backend from `../backend`:

```sh
STAFF_ACCESS_CODE=choose-a-local-code node server.js
```

Then start this frontend in a second terminal:

```sh
npm install
npm run dev
```

Open `http://localhost:4175/`.

## What is in the app now

- **Event HQ:** event setup, attendance and cash totals, staff sign-ins, backups, and CSV/PDF exports
- **Check-in:** search, filters, member-by-member team check-in, payment, undo, duplicate review, walk-ins, spectators, CSV import, and cross-division person linking
- **Prelims:** entry thresholds, imported entry order, late arrivals, current/on-deck cues, timer, two judge scores, rankings, corrections, and cutoff tie-breaks
- **Tournament Board:** seeded brackets, round tracking, winner selection, tie replays, undo, and a simple live-display preview

When staff first open the app, they enter the backend access code, their name, and their role or roles. The sign-in lasts for that browser session.

Judges do not need to sign in. They point to the winner, and whoever is running the board records the result.

Roles help each person land in the right workspace, but they do not lock anyone out. The crew can still jump in and fix something wherever needed.

## Keeping the event menu clean

The **Manage event records** area in Event HQ lets staff rename, archive, restore, or delete events.

Archive finished tests when you want them out of the active event menu but might need them later. Permanent Delete requires typing `DELETE` and removes the event along with its app-managed backups.

## Using several staff phones

- Each phone checks for event changes about every 1.2 seconds.
- When something changes, the app reloads one complete snapshot instead of mixing old and new pieces.
- The top bar shows `Live`, `Syncing`, or `Offline · retrying`, along with the event revision.
- If someone tries to save an old edit, the backend rejects it and the app loads the current version for review.
- Check-ins, walk-ins, imports, staff attendance, and spectator counts can safely arrive from different phones.
- If two people check in the same member, only the first check-in counts. The other phone shows `Already checked in`.
- Prelim and bracket timers are shared, so every connected device sees the same countdown.

Every phone needs to reach the same backend over the event network. Offline changes are not saved for later.

## Recovery points

Event HQ can create a named recovery point before a risky change. Restoring one automatically saves the current state first, so there is still a way back if the wrong backup was chosen. Staff attendance and the activity log stay intact.
