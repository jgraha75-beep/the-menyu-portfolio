# Moving The Menyu to Supabase

The local version saves event data in a JSON file. Supabase is the next step when we want the same event to stay available in the cloud for the whole crew.

The React app will keep calling the Node API. It will not make database queries on its own.

```text
React -> MenyuApi -> Node battle rules -> JSON or Supabase
```

## Rules we do not want to break

- JSON stays as the default while we are testing locally.
- Supabase only turns on when `PERSISTENCE_DRIVER=supabase` is set.
- `SUPABASE_SECRET_KEY` belongs on the backend and must never use the `VITE_` prefix.
- Production needs an intentional staff code and a stable session secret at least 32 characters long.
- Every event-owned database row includes `event_id`, and cross-event links use composite foreign keys.
- Event saves compare revision numbers through the `commit_event_aggregate` database transaction, so one staff device cannot quietly overwrite another.
- Intentional or raced stale saves return a non-retrying `409` right away and let the app reload the newest event.
- Check-ins, charges, and completed match rounds are reversed and logged instead of silently erased.
- Archiving an event is not the same as permanently deleting it.
- Backup digests use a consistent JSON format, so PostgreSQL changing key order does not make a good backup look broken. Older local JSON backups still work.

## Migration files

Apply the SQL files in `supabase/migrations` in filename order:

1. `20260825010000_create_the_menyu_schema.sql` creates the event tables, constraints, row-level security, and database functions.
2. `20260825020000_grant_backend_data_api_access.sql` gives Data API access only to the backend service role.
3. `20260825030000_prioritize_revision_conflicts.sql` checks stale revisions before validating the rest of an event save.
4. `20260825040000_use_nonretrying_conflict_status.sql` makes intentional revision conflicts return `409` without an unnecessary retry.

Running the SQL by hand in the Supabase dashboard creates the schema, but it does not add those files to Supabase’s migration history. The committed migration folder should stay the source for future environments and automated setup.

## Test it

### Score-range migration applied — 2026-09-20

Applied `20260920010000_expand_prelim_score_range.sql` to the explicitly approved
`the-menyu-staging` project (`emsqtdevptodxciprgsj`). Supabase recorded the migration
as `20260920020611`, name `expand_prelim_score_range` (management API assigned version).
Do not mistake the different recorded timestamp for an unapplied migration.

Read-only verification confirmed both score constraints are validated and allow
1–10; `rankings.average_score` is now `numeric(4,2)`. Before/after counts were
unchanged: 1 event, 6 prelim scores, 42 rankings. No event rows were edited and no
app deployment was performed. The Vercel-to-database connection remains unverified
because its sensitive `SUPABASE_URL` value was not returned by Vercel.

```sh
npm test
npm run build
SUPABASE_TEST_URL=... SUPABASE_TEST_SECRET_KEY=... npm run test:supabase --workspace=the-menyu-backend
```

The Supabase test makes temporary event data with unique names and cleans it up afterward. It checks the database contract plus a full API run with two staff sessions, exports, backups, recovery, archive protection, and cleanup.
