# CLAUDE.md

EnrichMINT API: helps people earn from their real-life experience, while helping others learn from it. Read this before changing code.

This file follows the FOAIS CLAUDE.md contract from the foais-standards plugin. Blocks marked "Org standard" come from the plugin; everything else belongs to this project. Run `/foais-standards:generate-rules` to add `.claude/rules/`.

## Project Overview

- A marketplace for firsthand experience. Contributors turn an AI-assisted interview into a guide, set prices and AI permissions, and answer paid personal requests. Learners describe a need, get explained recommendations, buy guides through PayPal (sandbox), ask grounded questions, and commission personal answers when a guide runs out.
- Roles: any user can learn; a user with an approved `ContributorProfile` can sell; `ADMIN` reviews contributors and guides and handles refunds, reports and late deliveries.
- Main flow: interview, draft, admin review, publish; goal, recommendations, PayPal order, server capture, entitlement, grounded assistant; gap, request draft, send, accept, pay, deliver, apply, feedback.
- Stack: NestJS 11, Prisma 7 on Postgres 17, OpenAI Responses API (strict json_schema, `store: false`), PayPal REST (Orders v2, Payments v2, Payouts v1, webhook verification), Jest. Build plan, decisions and progress: `PLAN.md`.

## Commands

| Name | Command |
| --- | --- |
| Typecheck | `yarn typecheck` |
| Lint | `yarn lint` |
| Test | `yarn test` |
| E2E | `yarn test:e2e` (needs `yarn db:up` and the `enrichmint_test` database migrated) |
| Dev server | `yarn start:dev` |
| Build | `yarn build` |

Base branch: `main`.

## Where To Look

| File | Holds | Loaded |
| --- | --- | --- |
| `PLAN.md` | Plan, decisions, invariants, progress tracker | Read before starting a slice |
| `prisma/schema.prisma` | Every entity and state enum | Read before touching data |
| `src/requests/request-state.ts` | The only allowed request transitions | Read before changing request behaviour |
| `src/orders/orders.service.ts` | Checkout, capture, idempotent fulfilment | Read before touching payments |
| `src/assistant/grounding.service.ts` | The only path from guide content to a prompt | Read before touching AI retrieval |
| `.env.example` | Every env var, with a comment | Read when adding config |

### User-Facing Docs

| Kind | Location |
| --- | --- |
| Docs page | none (API reference is Swagger at `/docs`) |
| Guided tours | none |
| Onboarding | none |
| Landing or marketing pages | `enrichmint-frontend/app/(public)/page.tsx` |

Before changing a feature, read its doc in the feature docs folder. After changing it, update the doc.

## Docs Locations

| Kind | Folder |
| --- | --- |
| Feature docs | `docs/features/` |
| Plans | `docs/dev/` (the master plan is `PLAN.md`) |
| EOD summaries | `docs/eods/` |
| Learnings | `docs/learnings/` |
| Test cases | `docs/test-cases/` |

## General Principles

<!-- foais-standards:org:start general-principles v0.2.0 -->
> Org standard: change this in the foais-standards plugin, not here.

1. Read first: open the feature doc (feature docs folder in Docs Locations) and the files you will touch before editing.
2. Change only what the task needs. No drive-by refactors, renames, or reformatting.
3. Reuse before adding. Look for an existing helper, component, or pattern first.
4. Do not add libraries casually. Justify any new dependency in the PR description.
5. Do not add a new architectural layer (state manager, ORM, framework, service) without the developer's agreement. Use what the project already has.
6. When a rule conflicts with the task, stop and ask instead of picking one.
7. Do not edit `CLAUDE.md` or `.claude/rules/` unless the developer asks. Org standard blocks change only in the foais-standards plugin.
8. Never run `git add`, `git commit`, `git push`, or any command that creates commits or opens or merges a PR (merge, rebase, cherry-pick, revert, `gh pr create`). Developers commit; Claude prepares the messages. A plugin hook enforces this.
9. Never guess a project fact (a command, a path, a tool). When `CLAUDE.md` lacks it, say so and suggest `/foais-standards:generate-rules`.
10. Never read or change real env files (`.env`, `.env.local`, `.env.development`, and the like). Use the env example file; developers set real values. A plugin hook enforces this.
<!-- foais-standards:org:end general-principles -->

### Project Rules

- Invariants (never break these): prices come from the database; access is granted only after PayPal reports a COMPLETED capture with a matching amount; fulfilment is idempotent; every paid action needs `approved: true` from the person; budgets are checked under a row lock; guide content reaches a prompt only through `GroundingService`; the model has no tool that moves money.
- Contributor content and learner text are untrusted. Wrap them with `wrapUntrusted` and scrub contact details with `scrubPii` before any model call.
- Ledger rows are append-only. A ledger balance is never shown as a transfer; only a Payout with status SUCCESS is.
- Label anything seeded, simulated or sandboxed as such.

## Code Quality

<!-- foais-standards:org:start code-quality v0.2.0 -->
> Org standard: change this in the foais-standards plugin, not here.

1. Use the strictest type checking the language offers. Every escape hatch (an untyped value, a type-check ignore, an unchecked cast) carries a one-line `reason:` comment.
2. Follow the naming, file layout, and export conventions in Project Rules, consistently. One component or class per file.
3. Keep one import order across the codebase, as Project Rules define it.
4. One styling approach per project. Do not mix in a second one.
5. No debug logging in client code (browser or mobile), including leftover debug lines. Show problems to the user through the UI; logging belongs on the server.
6. Put pure logic in its own module with unit tests. UI tests query by role and accessible name, never snapshots.
7. When logic is mirrored between client and server, keep both copies identical; each pair has a drift test.
8. Code passes the Typecheck, Lint, and Test commands in Commands before it is called done.
<!-- foais-standards:org:end code-quality -->

### Project Rules

1. Flat feature folders under `src/` (`orders/`, `requests/`, ...). No `lib/`, `shared/` or barrel files.
2. Only `src/config/env.ts` reads `process.env` (plus `prisma.config.ts`).
3. Only `src/models/openai.adapter.ts` imports `openai`; only `src/paypal/paypal.service.ts` calls PayPal.
4. Request input uses class-validator DTOs; model and PayPal output is parsed with zod.
5. Errors use `{ statusCode, message, error }` with snake_case codes; 409 for state conflicts, 503 when a dependency is not configured, 502 for upstream failures.
6. No `console`; use Nest `Logger`. Never log tokens, message content or full emails.

## Comments

<!-- foais-standards:org:start comments v0.2.0 -->
> Org standard: change this in the foais-standards plugin, not here.

- One line, one sentence. Explain why, not what. Skip the comment when the code is already clear.
- No multi-paragraph docstrings or comment blocks.
- Prefixes when needed: `NOTE:` for context, `IMPORTANT:` for something that breaks if ignored.
<!-- foais-standards:org:end comments -->

## Writing Style

<!-- foais-standards:org:start writing-style v0.2.0 -->
> Org standard: change this in the foais-standards plugin, not here.

Applies to code, comments, docs, commit messages, and chat replies.

- No em-dashes or double-dashes as punctuation. Use commas, colons, periods, or parentheses.
- No emojis.
- Short, plain sentences.
<!-- foais-standards:org:end writing-style -->
