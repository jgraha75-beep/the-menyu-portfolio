# Contributing

Keep each commit focused on one verified change. Use a Conventional Commit subject that says what changed in the product or codebase:

```text
feat(display): show the next prelim matchup
fix(import): preserve entry numbers from CSV
test(api): cover concurrent check-in updates
```

Use `feat`, `fix`, `docs`, `test`, `refactor`, `build`, `ci`, `chore`, or `perf`. Keep the subject under 72 characters. Describe the product or code change itself, not temporary work or internal process notes.

Before committing application changes, run:

```sh
npm run check
npm test
npm run build
```

Commit messages are checked automatically on GitHub.
