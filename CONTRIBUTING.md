# Contributing to FieldPoint

Thanks for helping improve FieldPoint. This guide captures the conventions the
repository already follows so you don't have to reverse-engineer them from the
commit history.

## Local setup

Requires Node.js 22.13+ (the app uses the built-in `node:sqlite`, so there are no
native modules to compile).

bash
git clone https://github.com/egeyigit/fieldpoint.git
cd fieldpoint
npm install
npm start         # http://localhost:4100; demo data seeded on boot


Copy `.env.example` to `.env` if you want to override any configuration; all
values are optional in development.

## Development workflow

bash
npm run dev             # restart on change
npm test                # node:test + supertest, in-memory SQLite
npm run test:coverage   # with V8 coverage report
npm run lint            # syntax check + forbidden-statement scan


Run `npm run lint` and `npm test` before opening a pull request; CI runs both on
Node 22 and 24 and must be green to merge.

## Tests

New behaviour ships with tests. Add or update a test under `test/` that exercises
the change (not just that code renders), and keep existing tests passing.

## Branches

`main` is the only long-lived branch. Work on a short-lived branch and open a
pull request against `main`. Use a descriptive branch name such as
`fix/csv-export-injection` or `feat/site-filters`.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):


<type>: <summary>


Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`. Keep the
summary in the imperative mood and under ~72 characters.

## Code style

Formatting is enforced by [`.editorconfig`](.editorconfig): 2-space indentation,
LF line endings, and a final newline. Match the surrounding style of the file you
are editing.

## Pull requests

Fill in the pull-request template: a short summary, the issue it closes, and a
completed test-plan checklist. Link the issue with `Closes #<number>` so it
closes automatically on merge.
