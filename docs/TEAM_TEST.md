# Team-test runbook

This is the rehearsal runbook for the staff app. Use a disposable event only; never run these steps against launch-day data.

## Before inviting the team

1. Use the committed staff release (`4e21aa3`) and its Vercel preview URL. Do not include the uncommitted audience-display work yet.
2. In the Vercel **Preview** environment, confirm these variables are present without posting their values anywhere:
   - `STAFF_ACCESS_CODE` — a fresh, team-only test code
   - `SESSION_SECRET` — at least 32 characters
   - `PERSISTENCE_DRIVER=supabase`
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
3. Confirm the staging Supabase project has applied every file in `supabase/migrations/`.
4. From a terminal, run the deployed read-only check:

   ```sh
   MENYU_TEST_URL=https://your-preview.vercel.app npm run preflight:team-test
   ```

5. Run the real staging database test with the staging-only credentials. It creates and cleans up its own test event:

   ```sh
   SUPABASE_TEST_URL=... SUPABASE_TEST_SECRET_KEY=... npm run test:supabase --workspace=the-menyu-backend
   ```

6. Confirm the preview link and test code privately with the people testing. Do not send either in a public post.

## Team scenario

Create one event called `TEAM TEST — DELETE AFTER`. Record its event ID in the test notes.

1. Sign in from two staff devices.
2. Import the supplied 2v2 and U-15 CSV fixtures.
3. Check in a team member, take payment, and undo one check-in.
4. Verify a duplicate warning and the staff resolution path.
5. Score prelims with two staff members, including a cutoff tie.
6. Create the bracket, advance a winner, run a tie/replay, and confirm the next match updates on both devices.
7. Export a CSV and PDF, create a backup, archive the disposable event, restore it, then delete it.
8. On an iPhone, confirm the PWA installs as **The Menyu** and the mascot icon renders correctly.

## Defect triage

| Priority | Meaning | Example |
| --- | --- | --- |
| P0 | Stops check-in, scoring, bracket advancement, backup, or access | Staff cannot sign in or saved results disappear |
| P1 | Wrong result, incorrect money total, missing/exported data, or cross-device desync | A bracket winner does not advance |
| P2 | A workaround exists; fix before launch if practical | A layout breaks on one staff phone |
| P3 | Polish or future work | Final audience artwork treatment |

For every report, capture: device/browser, URL, exact steps, expected result, actual result, and a screenshot. File the bug before continuing, then use the workaround if one exists.

## Known release boundary

The public audience display is intentionally excluded from this team-test release. Its work is uncommitted locally and needs its own end-to-end bracket rehearsal before it is deployed.

## Team-test sign-off

- [ ] Preview environment variables verified
- [ ] Supabase migrations confirmed
- [ ] Hosted preflight passed
- [ ] Real Supabase staging test passed
- [ ] Two-device workflow rehearsal passed
- [ ] iPhone PWA install checked
- [ ] P0 and P1 issues resolved or consciously deferred with a workaround
