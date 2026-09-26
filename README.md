# The Menyu

The Menyu is an event-operations app I’m building around dance battles. It brings registration, check-in, prelims, brackets, staff coordination, and the audience display into one workflow.

I started it after running into the friction of spreadsheets, paper, and disconnected tools on battle day. The app is shaped around the way our crew actually works, including English and Japanese staff workflows.

## What it does

- Imports registration lists from CSV and PDF, with a review step before entries are saved
- Preserves entrant numbers and supports walk-ins
- Tracks team check-in, attendance, and event payments
- Configures divisions, team sizes, prelims, judging, and bracket settings per event
- Runs timed prelims and staff score entry, then hands qualifiers into a seeded bracket
- Provides a read-only audience display for the live matchup and on-deck teams
- Queues a limited set of registration edits offline and presents conflicts for staff resolution
- Records event income and costs for a post-event summary

## Current status

This is an active prototype and portfolio project. I’m hardening database compatibility, staff authorization, import recovery, and competition edge cases before treating it as ready for a live event. Offline operation currently covers a limited registration-edit workflow; it does not make the whole event usable without a network. Do not connect this prototype to real participant data or use it as a production service.

## Stack and structure

- React, TypeScript, and Vite for the staff and audience interfaces
- Node.js API for event rules, validation, persistence, and exports
- Local JSON persistence for isolated development
- Supabase persistence and migrations for a future hosted setup

```text
react-frontend/     Staff app, audience display, and offline edit queue
backend/            API, event rules, persistence adapters, and tests
supabase/           Database migrations
docs/               Finance and offline workflow design notes
test-data/          Fictional import examples only
```

## Run locally

Requires Node.js 20.16 or newer.

```sh
npm install
STAFF_ACCESS_CODE=local-review-code npm run dev
```

Open [http://localhost:4175](http://localhost:4175) and use `local-review-code` to sign in. The development launcher starts the API and frontend and stores local event data in the ignored `backend/data.json` file. Use fictional data while exploring the app.

Sample imports are in [`test-data/`](test-data/).

## Project checks

```sh
npm run check
npm test
npm run build
```

The optional Supabase integration tests require a dedicated disposable test project. Never point them at production data.

## Design notes

- [Event finance model](docs/event-finance-model.md)
- [Offline-first data flow and failure modes](docs/offline-first-architecture.md)
- [Tournament rules and product decisions](DECISIONS.md)
