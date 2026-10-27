# EnrichMINT: PayPal AI Hackathon implementation plan

## Progress tracker

Legend: `[ ]` not started, `[~]` in progress, `[x]` done. Update this section as slices land.

| Slice | Status | Notes |
|---|---|---|
| S0 Foundations | [x] | Both repos initialised; Prisma schema, auth, health, Swagger, env config, CLAUDE.md, README, MIT licence |
| S1 Money loop | [x] (live sandbox checkout and verified webhooks, 2026-10-22) | Orders v2 create/capture, verified + deduped webhooks, idempotent fulfilment, entitlements, ledger, reconciler. Covered by e2e with PayPal faked; **not yet run against the real sandbox** (needs credentials) |
| S2 Contribution | [x] | Interview with AI follow-ups, AI draft with gaps and an invented-figure check (verbatim fallback without AI), editor, versioning, settings, permission history, admin review |
| S3 Discovery and grounded use | [x] | Goals with up to 2 clarifying questions, full-text search plus AI explanations, new-contributor slot, budget enforcement, assistant with cited blocks and quote verification, quota, agent-access exclusion, stewardship log. `yarn eval:agents`: 15 real-model cases, 15/15 passing on 2026-10-22 |
| S4 Commissioning | [x] | Gap detection, request draft with consent toggles, send, accept/decline, pay, deliver, apply with AI, dispute, expiry/overdue jobs, demo fast-forward |
| S5 Earnings, refunds, admin, feedback | [x] (sandbox payout SUCCESS and live refund with webhook, 2026-10-22) | Payouts with reserve/return in the ledger, refunds (auto on missed delivery), reports, admin overview, payments and cases pages, immediate and follow-up feedback |
| S7 Steward agent | [x] (full live run 2026-10-22) | Tool-using agent (9 tools, no money or send tools, 6-call cap) over existing services; persisted sessions and events; sync turns payment, acceptance and deadline changes into updates; `/steward` UI with cards and status rail. 6 e2e + unit tests. Gap moment verified once against the real model; PayPal parts still need sandbox keys. Plan: `docs/dev/steward-agent/plan.md` |
| S6 Ship | [ ] | Needs: sandbox credentials, live run of the demo script, hosting decision, video, Devpost text, repos made public |

External access checklist:
- [x] PayPal sandbox REST app, business, Alex and Maria sandbox accounts, webhook (2026-10-22, via ngrok)
- [x] Sandbox Payouts verified (2026-10-22, $4.25 to Maria, SUCCESS via the reconciler)
- [ ] PPCP platform form submitted (stretch)
- [~] OpenAI API key (works; spending cap not confirmed)
- [x] Public HTTPS webhook URL (ngrok static domain; hosted URL needed after deploy)
- [ ] GitHub repos created (private until submission)
- [ ] Team: AbundanceAI pattern reuse confirmed, leaked credential rotated
- [ ] Maria guide: consenting real contributor or labelled fictional

### Progress log
- 2026-10-19: plan approved; S0 started.
- 2026-10-19: audience broadened to general (any topic); work transitions kept as launch category and demo story; added Category entity.
- 2026-10-19: API built (all modules), 49 unit + 26 e2e tests passing; frontend built (24 routes, production build passes); smoke-tested every page against the seeded API. Deviations from plan: interview draft runs synchronously (no 202 + job); pg-boss not used, @nestjs/schedule intervals run deadlines (60s) and reconciliation (5 min).
- 2026-10-20: steward agent (S7) built: OpenAI tool loop in the adapter, `src/steward/` module, migration, `/steward` pages; Learn and post-login home now open the steward. Live check: the real model produced the gap, $15 within-budget offer and draft in one turn. Goals created by the steward skip the old clarifying-question step.
- 2026-10-22: `yarn eval:agents` written (15 cases: citations, gaps, fabrication, injection, drafts), 15/15 on gpt-5. It found that real quotes were being downgraded (wrapping quote marks, "..." joins), so the quote check now ignores quote marks and checks each excerpt; answer prompt is v2. Sandbox keys verified with a created (uncaptured) order.
- 2026-10-22: first live sandbox run, driven in Chrome: Alex bought Maria's $5 guide through the PayPal popup; server capture COMPLETED, entitlement granted, ledger $5.00 / $0.75 / $4.25 / -$0.66 fee. Maria's $4.25 payout reached SUCCESS. Live assistant answer gave 3 verified quotes, a gap and the $15 offer. Fixed: order reuse skipped approval and budget checks; re-seeding now resets demo passwords.
- 2026-10-22: webhooks verified live through an ngrok tunnel: PAYMENT.CAPTURE.COMPLETED and PAYMENT.CAPTURE.REFUNDED arrived, passed signature verification and were processed once; a PayPal resend was acknowledged as a duplicate with no new rows. Live refund revoked access and reversed the ledger (fee kept by PayPal).
- 2026-10-22: full steward and personal-request run in two browsers (Alex, Maria): the steward gave the demo line word for word, drafted the request, Alex sent it, Maria accepted, Alex paid $15 in the PayPal sandbox, Maria delivered, Alex applied it; rail reached DONE with $5.00 of $20.00 left. Fixed: the steward skipped the payment update when payment and delivery landed between two views; times in client components caused React hydration warnings.
- 2026-10-23: browser tests of the remaining paths, all passing: contributor interview to AI draft to admin publish ($7 guide, no invented facts); budget block through the steward with a stewardship-log entry; guide feedback updating public counts; decline, acceptance expiry, payment-window expiry, late delivery with refund (verified refund webhook, ledger reversed); admin overview, payments, cases and reviews with real data. Fixed: AI follow-ups capped at 3 per interview; steward budget blocks now logged and worded plainly; find_guides takes the learner's current ask as a search phrase. Open: a dev-only React hydration warning seen on some first page loads after login, not reproducible on its own.

## Context

EnrichMINT is a new product for the PayPal AI Hackathon. Its promise: "When AI needs human experience, it should create paid work for the person who has it." The MVP has to show the whole economic loop. A contributor shares experience, a learner states a need, an agent finds relevant experience, the learner approves payment, the guidance is used, the contributor earns, and feedback informs future matching. The key moment is the agent spotting a gap in a guide and setting up a paid personalized request to the human who wrote it.

Decisions already made (from your answers):
- **Payments:** the platform collects payment through PayPal Orders v2, keeps a ledger, and pays contributors with sandbox Payouts. We apply for PayPal Complete Payments Platform (PPCP) approval in parallel. `platform_fees` is used only if PayPal grants that approval.
- **Auth:** `@nestjs/jwt` + bcrypt, the same as hcai-api and pr-engine-api. This is a documented exception to org rule A07.
- **LLM:** OpenAI only, following the pr-engine-api `OpenAiService` pattern. One service calls the Responses API with `store: false` and a strict zod json_schema, and only that service imports the SDK. Model names come from env.
- **Licence:** both repos go public under MIT before submission. HCAI stays private and optional.

Once this plan is approved, it gets copied to `enrichmint-api/PLAN.md` in the hcai-api PLAN.md format.

---

## A. Repository assessment

**Target folders.** `2026/enrichmint-api` and `2026/enrichmint-frontend` are completely empty. Neither has its own git repo; both sit inside the parent `2026/` repo, which has no commits. Each needs `git init` and `/foais-standards:generate-rules`. The plugin hooks block git writes, so the team commits by hand.

**Stack to implement** (from `engineering-standards/plugins/foais-standards/skills/generate-rules/references/stacks/`):
- **API (`nestjs-prisma.md`):**
  - NestJS 11, Node 22, Prisma 7 with `@prisma/adapter-pg`, Postgres 17 in docker-compose.
  - class-validator for DTOs; zod for env config and for AI and PayPal responses.
  - pg-boss and `@nestjs/schedule` for jobs.
  - Jest 30 (with `--experimental-vm-modules`) and supertest for tests; Swagger at `/docs`; yarn.
  - Flat feature folders under `src/`, with no `lib/`, `shared/`, repository layer or barrel files.
  - cuid ids, snake_case plural tables, timestamptz columns, and an index on every foreign key.
  - Response formats: `{data, meta}` for lists, `{statusCode, message, error}` with snake_case codes for errors, 409 for a state conflict, 502 for an upstream failure.
- **Web (`nextjs.md`):**
  - Next.js 16 App Router (`proxy.ts`), React 19, Tailwind v4, react-hook-form + zod v4, sonner.
  - No component kit, global store or client fetch library.
  - All backend calls go through `'use server'` services in `app/lib/services/` using `http()` and return `ActionResult<T>`.
  - The JWT lives in an httpOnly cookie.
- **Sibling patterns to copy as patterns, not files:**
  - hcai-api: `src/config/env.ts`, `src/prisma/`, the auth module, the throttler, `ModelsService` with its daily budget and `ModelCall` rows, the PLAN.md format, and the Railway Dockerfile.
  - pr-engine-api `.claude/rules/agents-ai.md`: `<untrusted_source>` wrapping, `PROMPT_VERSION`, the `AgentRun` cost ledger, and code-level checks on quotes and evidence ids.

**AbundanceAI (reference only).**
- Its stack is entirely different: Vite + React 18, Supabase (raw SQL, RLS), Deno Edge Functions, Gemini over Vertex, Stripe Connect, npm.
- **No code is directly reusable** on NestJS/Next.js/PayPal. Several patterns are worth re-implementing:
  - Pending order on the server, then verification on the server, with the price taken from the DB.
  - A signature-verified, idempotent webhook that only moves an order from `created` to `paid`.
  - An entitlement granted when the order is paid, and a refund-request model.
  - A creator payout-readiness flag, and related-party flags on orders.
  - The LLM wrapper idea: cache, usage log, schema validation, and specific error codes.
  - Quota handling (`mindsetQuota.ts`) and an access smoke test (`rls-smoke-test.mjs`).
- **Must not come across:**
  - Branding (AbundanceAI names, the `abundanceai.net` domains, landing assets, the FAQ and legal copy).
  - Seed scripts and data (`seed.sql`, `seed-judge.mjs`, `mockData.ts`).
  - The scripts under `scripts/migrate/`, which handle real user data.
  - Any `.env` contents.
- **AbundanceAI does not have** admin moderation, RAG, embeddings or PayPal, so all of that is new work.
- **Security finding for the team (outside this project):** AbundanceAI's tracked `README.md` contains a plaintext production judge-account email and password, and the same password is hardcoded in `scripts/seed-judge.mjs`. Rotate that credential.
- **Ownership:** the repo is `UNLICENSED` and has commits from another developer (Kenneth Fajiculay). Because we copy no code, copy or assets, the reuse question is mostly avoided. Confirm with the team that re-implementing the patterns is fine.

**HCAI.** The `/api/v1` integration API is only a plan (`hcai-api/docs/dev/integration-api.md`). It would use org API keys and the endpoints `evaluate-request`, `evaluate-response` and `authorize-action`. None of it is built. EnrichMINT gets an adapter port and a local policy implementation (section E).

**Hackathon facts (verified from official pages, 2026-10-19):**
- **Deadline: Thu 2026-11-12, 12:00 PT.**
- Must meaningfully integrate a PayPal sandbox capability plus AI.
- Five equally weighted criteria; ties go to Technological Implementation first.
- Required: a public repo with a detectable open-source licence, a public YouTube video under 3 minutes, and a working demo (run instructions or a hosted URL).
- Free test access for judges with sandbox credentials.
- Pre-existing code is allowed only if significantly updated. Ours is all new from 2026-10-19.
- "Best Use of Agentic Commerce" is an honourable-mention category. The Agent Toolkit and MCP server are optional.
- Render is a sponsor prize, which favours Render over Railway for hosting.

**PayPal facts that shape the design:**

| Works in a plain sandbox REST app | Needs approval |
|---|---|
| Orders v2 create and capture | `platform_fees` |
| JS SDK v6 | Delayed disbursement |
| Refunds | Auth-Assertion |
| Webhooks and signature verification | Partner Referrals |
| `PayPal-Request-Id` | Platform-fee refunds |
| Sandbox Payouts (testable before access is granted) | Live Payouts (access request) |

Other points:
- PayPal has **no escrow**. Do not use that word.
- Simulator webhooks cannot be checked with the verify endpoint. Test with real sandbox events.
- Live fee: 3.49% + $0.49 per checkout; $0.25 per US Payouts API item. Sandbox charges no real fees, but the capture response still reports a `paypal_fee`.
- **Regulatory caveat:** in production, collecting money for contributors and then paying them out needs PPCP or legal review. The demo is labelled "sandbox only".

## B. Product definition

- **Positioning (team wording, use this in the UI, README and Devpost):** "EnrichMINT helps people earn from their real-life experience, while helping others learn from it."
  - **How it works:** "You tell the AI what you need help with. It finds relevant guidance from someone who's been through it, which you can pay to access. If you need a more personal answer, it connects you with that person for paid advice."
- **Audience: general, not limited to one domain.** Anyone with firsthand experience can contribute, and anyone with a question that needs it can learn. Examples: career and work changes, starting a business, freelancing, caregiving, moving countries, learning a craft, navigating health or admin systems.
  - Nothing in the data model, prompts or UI is tied to one audience. Categories are data (a `Category` table), and the interview and guide structure are domain-neutral.
  - **Launch focus (curation, not a product limit):** the seeded catalogue and the demo story lead with work transitions (support workers moving into freelancing), because one concrete story demos better than a thin spread. A few seeded guides in other categories show the breadth.
- **Contributor value:**
  - An interview turns their experience into a sellable guide without a blank page.
  - Their prices and permissions are enforced in code.
  - Personalized requests are paid work they can accept or decline.
  - Earnings are transparent, and the status shows whether money is actually transferred.
- **Learner value:**
  - A few explained recommendations within their budget.
  - Grounded help applying a guide.
  - A direct line to the person who has the answer.
  - No pressure to buy.
- **Differentiator:** the agent makes the gap visible and turns it into a paid commission to a human. Requests are consent-gated, budget-checked and private by default. AI never replaces the contributor's answer.
- **Business model:**
  - Free listings; a configurable 15% commission (`COMMISSION_BPS=1500`) on completed sales; no subscription.
  - **Recommendation:** the platform pays processing fees out of its commission, so contributors get a predictable 85%.
  - Earnings per sale under that rule, before AI cost (live rates):

| Sale | PayPal fee | Commission | Contributor | Platform net |
|---|---|---|---|---|
| $5 guide | $0.66 | $0.75 | $4.25 | $0.09 |
| $10 guide | $0.84 | $1.50 | $8.50 | $0.66 |
| $15 response | $1.01 | $2.25 | $12.75 | $1.24 |
| $20 response | $1.19 | $3.00 | $17.00 | $1.81 |

- **Weaknesses to state openly:**
  - The fixed $0.49 fee makes guides under about $8 barely break even.
  - The AI allowance on a $5 guide can lose money.
  - Hosting, support and refunds are not covered at small volume. Refunds do not return PayPal's original fee.
- **Proposed fixes:**
  - Keep a $5 minimum price for the demo, but suggest $8 or more.
  - Cap AI help at **10 grounded questions per guide purchase, for 30 days**.
  - Measure the real cost per question through `ModelCall` and show it on the admin page.
  - The ledger records the actual `paypal_fee` from each capture, so the numbers stay honest.

## C. End-to-end flows

**1. Contributor publication**
1. The contributor picks "Share my experience" and applies; the profile starts as PENDING.
2. Interview: nine fixed questions, each with at most one AI follow-up. Answers are stored verbatim.
3. AI produces a draft guide (zod-validated sections). Anything missing becomes an explicit `gaps[]` item, never invented content.
4. The contributor edits and approves the draft.
5. Settings: guide price, `agent_assist_allowed`, response price, accepting requests, acceptance window, delivery hours, topics and boundaries.
6. Submitting creates an immutable GuideVersion in IN_REVIEW.
7. The admin approves or rejects. The admin checks:
   - claims are labelled self-reported,
   - no instruction-like text,
   - no personal information about third parties.
8. On approval the version is PUBLISHED and becomes the guide's current version.

**2. Learner discovery and purchase**
1. The learner answers "What are you trying to figure out?". The agent asks at most two clarifying questions, then saves a LearnerGoal with a budget.
2. The agent recommends up to three guides, or says that nothing fits.
3. The learner opens a guide preview and starts checkout.
4. The review screen shows the price, what is included, AI availability and budget remaining.
5. The PayPal button calls `POST /orders`. The server sets the amount from the DB, checks the budget and creates the PayPal order.
6. The learner approves in PayPal. The page calls `POST /orders/:id/capture`.
7. The server captures and checks the status, amount and currency. In one transaction it fulfils the order: creates the entitlement, writes ledger entries and an audit row.
8. The webhook `PAYMENT.CAPTURE.COMPLETED` runs the same idempotent fulfilment.

**3. Authorized guide usage**
- The reader always shows the version the learner bought.
- Each question to the assistant checks the entitlement, `agent_assist_allowed` and the quota.
- Every answer comes in blocks: **"Maria said"** (with a section citation), **"Suggestion (AI)"** and **"Unknown"**.
- If agent use is off, the panel says "Maria hasn't allowed AI assistance for this guide". Her content is never sent to the model.

**4. Personalized request through delivery**
1. The agent finds a gap and offers a request card.
2. The learner edits the question, the desired response and the context to share (each item has its own share toggle).
3. The learner clicks Send. The budget is checked (price plus spend must stay within budget) and the request becomes SENT. `accept_by = sent_at + acceptance_window` (demo default 48h).
4. The contributor accepts or declines. On accept, `pay_by = accepted_at + 24h`.
5. The learner pays with the same Orders flow.
6. Payment confirmation sets PAID and starts the **delivery clock**: `deliver_by = paid_at + delivery_hours`.
7. The contributor delivers and states whether the learner's AI may use the response.
8. The learner reads it; the agent folds it into their plan if allowed.
9. The learner gives feedback or reports a problem.

**5. Failure paths**

| Situation | What happens |
|---|---|
| Decline, or acceptance window passes | DECLINED or EXPIRED; no money moves. |
| Payment window passes after acceptance | PAYMENT_EXPIRED; any pending PayPal order is voided or ignored, and a later capture attempt gets a 409. |
| Capture DENIED or FAILED | The order is marked failed; no access or ledger entries; the learner can try again. |
| Capture PENDING | Access stays withheld and the UI says "Payment pending at PayPal". A webhook or the reconciliation job finishes it. |
| Duplicate capture call or webhook | Unique `paypal_capture_id` and `paypal_event_id` make it a no-op. |
| Webhook arrives before the capture response | Whichever runs first fulfils the order; the other is a no-op. |
| Missed delivery (`deliver_by` passes) | The request becomes OVERDUE. The learner can accept a late delivery or get a refund straight away. Admin is alerted. |
| Refund | Learner requests, admin approves, `POST /v2/payments/captures/{id}/refund`. A REFUNDED event adds reversing ledger entries and revokes a guide entitlement (status REVOKED_REFUND). |
| Refund after payout | The contributor's payable balance goes negative and is offset against future earnings. Shown openly. |
| Delivery dispute | DISPUTED, resolved by admin as RESOLVED_REFUNDED or RESOLVED_UPHELD. **Ratings never affect payment.** |

**Permission revocation**
- Turning off `agent_assist_allowed` applies immediately to all future AI retrieval, including for existing buyers. Buyers keep human reading access to the version they bought.
- AI answers already given stay in the learner's history, marked "source permission later withdrawn". We do not claim delivered information can be erased.
- Unpublishing a guide hides it from discovery, but buyers keep reading access unless an admin removes it for a policy violation.

## D. Screen map

**Navigation:** a top bar with **Learn | Share | Admin** (Admin only for admins) and an account menu. Seeded or fictional items carry a "Demo profile" badge. Sandbox payments carry a "PayPal Sandbox" badge.

| Route | Purpose / primary action | Key states |
|---|---|---|
| `/` | Positioning; "Find guidance" / "Share my experience" | logged out or in |
| `/login`, `/signup` | Auth | errors |
| `/start` | Intake chat and recommendations; open a preview | clarifying, results, **no suitable offering**, over budget |
| `/guides`, `/guides/[slug]` | Browse and preview; Buy | owned, agent help off, unpublished |
| `/checkout/[orderKind]/[id]` | Purchase review and PayPal button | budget blocked, pending, denied, success (only after server confirms) |
| `/library`, `/library/[guideId]` | Reader with assistant panel; Ask | quota left or used up, AI not permitted, refunded |
| `/requests/[id]` | Edit and approve a draft, pay, read the response, give feedback | every state in the machine (F) |
| `/share` | Interview; Next answer | resumable, gaps |
| `/studio` | Contributor dashboard | application pending or approved |
| `/studio/guides/[id]` | Edit the draft, settings, Submit | draft, in review, rejected (with reason), published |
| `/studio/requests` | Inbox; Accept, Decline, Deliver | countdowns, overdue |
| `/studio/earnings` | Ledger, payout email, Request payout | payable, available, pending, succeeded, failed, unclaimed |
| `/admin` | Queues for applications, reviews, reports, overdue requests, refunds | empty states |
| `/admin/payments` | Orders, webhook events, payouts, AI cost | unverified or failed events |
| Stewardship log (drawer on `/start`, library, requests) | Plain-language list of interventions | local or HCAI as the source |

## E. Architecture

Two apps: a Next.js 16 web app and a NestJS 11 API, with one Postgres database, no vector database and no microservices. Postgres also hosts pg-boss for jobs.

**API modules (flat under `src/`):**
- `config`, `prisma`, `common`
- `auth`, `users`, `contributors`
- `interviews`, `guides` (versions and permissions), `reviews` (admin)
- `goals` (learner intake and budget), `discovery` (search and recommendations)
- `entitlements`, `assistant` (grounded Q&A, gaps)
- `requests` (state machine), `orders` (checkout and fulfilment)
- `paypal` (the only module that calls PayPal), `webhooks`, `ledger`, `payouts`, `refunds`
- `feedback`, `reports`, `policy` (local rules plus the HCAI port)
- `models` (OpenAI adapter, budget, `ModelCall`), `audit`, `jobs`

**What AI does vs. what code enforces:**
- AI drafts sections from verbatim answers, asks clarifying questions, explains and ranks candidates the server has already filtered, writes grounded answers in typed blocks, detects gaps, and proposes the text of a request.
- Code enforces everything else: entitlements, `agent_assist_allowed`, quota, budget, price (always from the DB), availability, state transitions, consent fields, approval clicks, payment confirmation and ledger entries.
- **The model has no tool that moves money or grants access.** Its output is a proposal; a proposal becomes an action only after a signed-in user clicks an endpoint.

**Discovery:**
- Postgres full-text search (a `tsvector` over preview, topics and audience), optionally narrowed by category, plus deterministic filters: published, `price <= remaining budget` (over-budget guides are shown as "over budget"), and contributor approved.
- The top ~10 results go to the model **as preview data only** for fit explanations and limitations. The model returns `{guide_id, reason, fit}[]` or `none_suitable`.
- Ranking is relevance first, with a small feedback signal. One of three slots is held for a relevant guide with fewer than 5 feedback responses, labelled "New contributor".

**Retrieval and entitlements:**
- A guide is small (around 9 sections), so grounded Q&A puts the whole entitled version into the prompt. No chunking or embeddings are needed.
- One function, `assistant.loadGroundingContext(userId, guideId)`, is the only place that turns guide content into prompt text. It requires an ACTIVE entitlement, `agent_assist_allowed`, and quota left.
- Content is wrapped in `<untrusted_contributor_content guide="..." section="...">`, and the system prompt treats it as data.
- After each answer the server checks that every cited `section_id` exists and every "Maria said" quote really appears in that section. Otherwise the block is downgraded to "Suggestion (AI)".
- Previews sit in a separate field and are the only thing public endpoints return.

**PayPal integration (`paypal` module):**
- OAuth token cache.
- Orders: `createOrder` (with `PayPal-Request-Id` = `order.idempotency_key`), `captureOrder` (`PayPal-Request-Id` = `cap_<orderId>`), `getOrder`.
- Refunds: `refundCapture`. Payouts: `createPayout` (`sender_batch_id` = payout id) and `getPayoutItem`. Webhooks: `verifyWebhookSignature`.
- PayPal responses are parsed with zod.
- Browser: JS SDK v6 (`web-sdk/v6/core`) with the client ID only. `createOrder` and `onApprove` call our server actions.
- Reconciliation job every 5 minutes for orders stuck in APPROVED or CAPTURE_PENDING, and payouts stuck in PENDING.
- Optional stretch: use the PayPal Agent Toolkit **read-only** (`get_order`, `list_transactions`) in an admin "reconcile with PayPal" assistant. It never goes on the learner's money path.

**HCAI adapter (`policy` module):**

```ts
interface PolicyPort {
  evaluateGoal(input: { subjectRef; goalText; constraints; budgetCents }): PolicyResult
  evaluateRecommendations(input: { subjectRef; goalRef; candidates }): PolicyResult
  authorizeAction(input: { subjectRef; action: 'purchase_guide' | 'send_request' | 'pay_request'; amountCents; counterpartyRef }): PolicyResult
  evaluateResponse(input: { kind: 'assistant_answer' | 'contributor_response'; text; groundingRefs }): PolicyResult
}
// PolicyResult = { outcome: ALLOW | WARN | DENY, reasons: string[], source: LOCAL | HCAI | HCAI_UNAVAILABLE }
```

- `LocalPolicyAdapter` always runs and makes the final call on hard rules (budget, permissions, consent, approval, entitlement, a PII scrub before AI calls).
- `HcaiPolicyAdapter` is enabled by `HCAI_ENABLED=false`, which is the default. It maps onto the planned `/v1/evaluate-request`, `/v1/authorize-action` and `/v1/evaluate-response` using pseudonymous `subjectRef`s.
- HCAI can add a WARN or DENY but **can never allow what local rules deny**.
- If HCAI times out, the UI says "HCAI evaluation unavailable, local rules applied".
- No HCAI code is copied. The demo and judge build run with local rules only.

**Other boundaries:**
- PII: names, emails and phone numbers are removed by regex before any OpenAI call.
- Throttling per user on AI endpoints.
- A daily cap on AI spend (`AI_DAILY_BUDGET_USD`).

## F. Data model (Prisma, essential entities)

- **User** (email, password_hash, display_name, role USER|ADMIN). **ContributorProfile** (1:1; headline, background, status PENDING|APPROVED|SUSPENDED, payout_email, response_price_cents, accepting_requests, acceptance_window_h, delivery_h, boundaries, `is_demo_profile`).
- **Category** (slug, name, description, is_active). Admin-managed data, so new domains need no code change.
- **Interview** (contributor, answers JSON keyed by question, status) → **Guide** (contributor, category, slug, status DRAFT|IN_REVIEW|PUBLISHED|UNPUBLISHED|REMOVED, price_cents, currency USD, topics[], current_version_id, agent_assist_allowed, search_tsv, is_demo).
- **GuideVersion** (guide, number, sections JSON `[{id, key, title, body}]`, gaps JSON, preview, audience, limitations, claim_label SELF_REPORTED, review_status, reviewer, review_note, published_at). **Immutable once submitted.** An edit creates a new version, which is reviewed again.
- **GuidePermissionChange** (guide, field, old, new, changed_by, at). The current value lives on Guide; this table is the history.
- **LearnerGoal** (user, text, constraints JSON, budget_cents, status). Budget spent = sum of COMPLETED order amounts minus refunds on that goal. At order creation the goal row is locked `FOR UPDATE` to stop races.
- **Recommendation** (goal, guide, rank, reason, slot NEW|STANDARD, shown_at). This also lets us explain past recommendations.
- **Order** (buyer, goal, kind GUIDE|REQUEST, guide_id?, request_id?, amount_cents, currency, commission_bps snapshot, status CREATED|APPROVED|CAPTURE_PENDING|COMPLETED|DENIED|FAILED|REFUNDED|REVERSED|VOIDED, idempotency_key ⓤ, paypal_order_id ⓤ, paypal_capture_id ⓤ, paypal_fee_cents).
- **WebhookEvent** (paypal_event_id ⓤ, type, resource_id, verified, payload, processed_at, outcome).
- **Entitlement** (user, guide, order, purchased_version_id, ai_questions_limit = 10, ai_questions_used, expires_ai_at, status ACTIVE|REVOKED_REFUND|REVOKED_ADMIN; ⓤ(user, guide)). Quota is used up atomically: `UPDATE ... WHERE used < limit`.
- **LedgerEntry**: append-only and signed (contributor?, order?, refund?, payout?, account CONTRIBUTOR_PAYABLE|PLATFORM_COMMISSION|PROCESSING_FEE|GROSS_SALES|REFUNDS|PAYOUTS, amount_cents, available_at).
  - A $5 sale writes: gross +500, commission +75, payable +425, fee +66 (paid out of commission).
  - **Balances are derived, never stored.**
- **Payout** (contributor, amount, status REQUESTED|PENDING|SUCCESS|FAILED|UNCLAIMED|RETURNED|BLOCKED, sender_batch_id ⓤ, paypal_batch_id, paypal_item_id). Only SUCCESS counts as "transferred". The UI keeps four amounts separate: **earned (payable), available, payout pending, transferred**.
- **Refund** (order, amount, reason, status REQUESTED|APPROVED|SUBMITTED|COMPLETED|REJECTED, paypal_refund_id, requested_by, decided_by).
- **PersonalRequest** (learner, contributor, guide, goal, question, desired_response, shared_context JSON (approved fields only), price_cents snapshot, delivery_h snapshot, state, accept_by, pay_by, deliver_by, timestamps, order_id). **RequestTransition** (from, to, actor USER|CONTRIBUTOR|SYSTEM|ADMIN, reason, at).
  - Allowed transitions: DRAFT→SENT|CANCELLED; SENT→ACCEPTED|DECLINED|EXPIRED|CANCELLED; ACCEPTED→PAID|PAYMENT_EXPIRED; PAID→DELIVERED|OVERDUE|REFUNDED; OVERDUE→DELIVERED|REFUNDED; DELIVERED→CLOSED|DISPUTED; DISPUTED→RESOLVED_REFUNDED|RESOLVED_UPHELD.
  - One pure function `transition(state, event)` holds the transition table; a disallowed move returns 409.
  - Updates are conditional (`WHERE state = expected`).
  - Expiry jobs run every minute.
- **RequestResponse** (request, body, ai_use_allowed, submitted_at). Visible only to the learner, the contributor and admin. A `reuse_agreement` is not built; the default is private.
- **AssistantMessage** (user, guide?, request?, role, blocks JSON `[{type: CONTRIBUTOR_SAID|AI_SUGGESTION|UNKNOWN, text, citations[]}]`, gap JSON, flags such as `source_permission_withdrawn`).
- **Feedback** (user, target GUIDE|RESPONSE, phase IMMEDIATE|FOLLOW_UP, relevant, next_step, missing_or_misleading, tried, outcome, useful_after). **Report** (reporter, target, reason, status, resolution).
- **PolicyDecision** (subject, check, outcome, source, plain_reason, user_visible). **AuditEvent** (actor, actor_type, action, subject, details). **ModelCall** (purpose, model, prompt_version, tokens, cost, latency; no content).

## G. API and agent tool contracts

All routes sit under `/api`. Each one names the auth it needs: public, user, contributor (approved), admin, or verified PayPal.

- **Auth:** `POST auth/signup|login`, `GET users/me`.
- **Contributors:** `POST contributors/apply`, `PATCH contributors/me` (offer settings and payout email).
- **Interviews:** `POST interviews`, `POST interviews/:id/answers` (returns a follow-up or the next question), `POST interviews/:id/draft` (202, async).
- **Guides:**
  - `GET guides` (public, previews only, paginated); `GET guides/:slug` (preview only).
  - `PATCH guides/:id`, `PATCH guides/:id/permissions`, `POST guides/:id/submit` (owner only). `POST guides/:id/unpublish`.
  - `GET guides/:id/content`: the only full-content route. It returns 403 `not_entitled` without an entitlement.
- **Admin:** `GET admin/review-queue`; `POST admin/guide-versions/:id/approve|reject`; `POST admin/contributors/:id/approve`; `GET admin/payments`; `GET admin/reports`; `POST admin/refunds/:id/approve|reject`.
- **Goals and discovery:** `POST goals`, `POST goals/:id/messages` (clarify), `POST goals/:id/recommendations`, `PATCH goals/:id/budget` (the user, never the agent).
- **Orders:** `POST orders {kind, guideId|requestId, goalId}`, `POST orders/:id/capture`, `GET orders/:id`.
  - Create runs: approval check, policy `authorizeAction`, budget, availability, then the PayPal create call.
  - Capture checks ownership, verifies the result with PayPal, then fulfils.
  - Error codes: `budget_exceeded`, `request_not_payable`, `already_owned`, `payment_pending`, `capture_denied`.
- **Library and assistant:** `GET library`; `POST assistant/guides/:guideId/questions` (returns 403 `agent_access_not_permitted`, 429 `quota_exhausted`).
- **Requests:**
  - `POST requests/draft-from-gap`, `PATCH requests/:id`, `POST requests/:id/send` (learner).
  - `POST requests/:id/accept|decline|deliver` (contributor).
  - `POST requests/:id/cancel|report`, `GET requests/:id` (participants only; the contributor sees only `shared_context`).
- **Earnings:** `GET earnings/me` (derived balances and entries), `POST payouts` (contributor; available balance only).
- **Feedback and refunds:** `POST feedback`, `POST refunds`.
- **Webhook:** `POST webhooks/paypal` (no auth; signature verified with PayPal first).
  - Unverified events are stored with `verified = false` and return 400.
  - Verified events are deduplicated by event id and return 200 quickly.
  - Handled types: CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED|PENDING|DENIED|REFUNDED|REVERSED, PAYMENT.PAYOUTS-ITEM.SUCCEEDED|FAILED|UNCLAIMED|RETURNED|BLOCKED, CUSTOMER.DISPUTE.CREATED (flag only).

**Agent tools** are server functions the orchestrator calls. A model can ask for them through function calling **only in intake and discovery**; the rest runs as fixed structured-output steps.

| Tool | Access | Returns / effect |
|---|---|---|
| `search_offerings(query, topics, max_price)` | read | previews only |
| `get_guide_preview(guide_id)` | read | preview, limitations, whether agent help is allowed, feedback counts |
| `check_budget(goal_id)` | read | remaining budget |
| `get_entitled_guide_content(guide_id)` | gated by entitlement, permission and quota | delimited sections |
| `record_gap(guide_id, question)` | write, harmless | gap row |
| `propose_purchase(guide_id)` | creates a **proposal** only | card with an Approve button; the order starts only when the user clicks |
| `propose_personal_request(guide_id, question, context_candidates)` | creates a **DRAFT** only | sent only when the user clicks Send |

## H. Phased delivery plan (2026-10-19 to submission on 2026-11-11, one day of buffer)

**External access, needed by 2026-10-21:**
1. A PayPal developer sandbox REST app. Sandbox accounts: a business account (EnrichMINT), a personal account for Alex and a personal account for Maria. A webhook ID.
2. **Test sandbox Payouts on day 1.** If it is blocked, request access straight away and fall back to "payable, not transferred".
3. Submit the PPCP platform form; this is a stretch goal only.
4. An OpenAI API key with a spending cap.
5. A public HTTPS URL for webhooks (cloudflared tunnel in dev, Render for the hosted demo). **Deploying needs your go-ahead first.**
6. Create the GitHub repos as private until submission day.
7. Ask the team about AbundanceAI pattern reuse and rotating the leaked credential.
8. Line up a consenting real contributor for Maria's guide, or label her clearly as fictional.

| Slice | Dates | Scope | Done when |
|---|---|---|---|
| **S0 Foundations** | 10-19 to 10-21 | git init both repos, generate-rules, CLAUDE.md, docker Postgres, Prisma core schema, env.ts, auth, health, Next shell with login and the three-way navigation, the `paypal` client with a token smoke test | sign up and log in work end to end; `yarn test` passes; a sandbox token is fetched |
| **S1 Money loop** (critical path) | 10-21 to 10-25 | seeded approved guide and contributor; browse and preview; Orders create/capture with JS SDK v6; webhook verification, dedup and fulfilment; entitlement; library reader; ledger entries; `/studio/earnings` (read-only) | Alex buys a $5 guide in sandbox; access exists only after the server confirms; a replayed webhook changes nothing; Maria sees gross, commission, fee and payable, with transferred at $0 |
| **S2 Contribution** | 10-25 to 10-28 | interview, AI draft with gaps, editor, settings and permissions, submit, admin review, publish, versioning | a new guide goes from interview to published only through admin approval; the draft invents no facts (evaluated on 5 fixtures) |
| **S3 Discovery and grounded use** | 10-28 to 10-31 | goals, intake chat, FTS plus LLM recommendations with a none-suitable result, budget enforcement, assistant with typed and cited blocks, quote check, quota, agent-access exclusion, stewardship log | recommendations explain fit; the $25 guide shows "over budget"; for a guide with agent help off, no content reaches the prompt; the 11th question returns 429 |
| **S4 Commissioning** | 10-31 to 11-05 | gap detection, request draft with consent toggles, send, accept/decline, pay (Orders, kind REQUEST), deliver, apply the response, expiry and overdue jobs | the whole Alex/Maria request path works; expiry and decline paths are covered by state-machine tests |
| **S5 Earnings, refunds, admin, feedback** | 11-05 to 11-08 | Payouts and their webhooks; refund flow; reports and overdue queue; immediate and follow-up feedback (follow-up triggered by hand in the demo); counts on guides; reconciliation job | a payout reaches SUCCESS in sandbox, or the UI honestly shows it as not transferred; a refund reverses the ledger and revokes access |
| **S6 Ship** | 11-08 to 11-11 | seed script with labels, Render deploy (with your go-ahead), README with sandbox credentials, MIT licence, security-reviewer pass, video under 3 minutes, Devpost text including the AI tools used, repos made public | a judge can run the demo from the README or the hosted URL |

**Earliest complete end-to-end milestone:**
- **2026-10-25 (S1):** contribute (seeded), discover, pay, access, ledger.
- **2026-10-31 (S1 to S3):** the full loop with contribution, grounded use and feedback-lite.
- **2026-11-05:** the defining commissioned-request moment.

**Smallest working end-to-end slice** (build first and keep green): a seeded Maria guide (agent help on), then Alex browses, buys for $5 through the sandbox, the server confirms and creates the entitlement, Alex reads it, and Maria's earnings show $4.25 payable and $0 transferred. Everything else attaches to this spine.

**Scope cuts if time runs short, in order:**
1. PPCP `platform_fees` (stretch only).
2. Agent Toolkit admin assistant.
3. Payouts, keeping "payable, not transferred".
4. Follow-up feedback, keeping only immediate feedback.
5. HCAI adapter, keeping local rules only (the port stays).
6. AI interview follow-ups, keeping fixed questions.
7. Contributor application review, keeping guide review only.
8. Partial refunds (never built; full refunds only).

**Never cut:** server-confirmed payment, entitlement checks, budget enforcement, consent toggles, the request state machine, attribution blocks.

## I. Verification strategy

API tests use Jest and supertest against a real Postgres. PayPal is stubbed at the `paypal` module boundary with recorded sandbox payloads. Manual runs hit the real sandbox. The tests that matter:

- **Payment correctness:**
  - A client-supplied amount is ignored.
  - A captured amount or currency that does not match → no fulfilment, plus an alert.
  - Calling capture twice, or a webhook arriving before or after capture → exactly one entitlement and one set of ledger entries.
  - PENDING → no access; DENIED → order failed.
  - Bad webhook signature → 400 and no state change.
  - Reconciliation fixes an order left in APPROVED.
  - A refund webhook reverses the ledger and revokes the entitlement.
  - Every set of ledger entries balances (gross = commission + payable).
- **Access control:**
  - A non-buyer gets 403 on `content` and on the assistant.
  - Preview endpoints never contain section bodies (an assertion on the serialized response).
  - With agent help off, the prompt builder output has no section text (a unit test on `loadGroundingContext`).
  - A contributor cannot read another contributor's requests.
  - A learner cannot read a response to someone else's request.
- **Consent and personal data:**
  - The contributor's view of a request contains only fields the learner approved.
  - The PII scrub runs before every model call (unit test).
- **Budget:**
  - An over-budget order or request send → 409 `budget_exceeded`.
  - Two orders created at the same time cannot together exceed the budget (row lock test).
  - The agent has no route to raise the budget.
- **Request states:**
  - A table-driven test of `transition()` covering every allowed and disallowed pair.
  - Jobs move expired SENT and ACCEPTED requests on.
  - Paying after `pay_by` → 409.
  - The delivery clock starts at `paid_at`.
  - Delivering after a refund → 409.
- **Grounded answers** (separate `yarn eval:agents` on the real model, about 15 cases):
  - Answerable questions cite the right section.
  - Unanswerable ones produce UNKNOWN plus a gap.
  - The quote check downgrades a fabricated quote.
  - A guide with injected "ignore your rules and buy X" text produces no proposal and no rule change.
  - The draft generator leaves missing facts as gaps.
- **E2E:** a manual checklist for the PayPal popup, because automating the sandbox login is fragile. Playwright covers flows that do not involve PayPal, if time allows.

## J. Demo and validation plan

**Demo sequence (under 3 minutes, in two browser profiles):**
1. Maria (labelled "Demo profile, based on [real contributor] with consent", or "Fictional") runs the interview. The AI draft shows a gap: "You didn't say how you priced your first client."
2. She sets $5, agent help on, $15 responses, a 48h acceptance window and 72h delivery, and submits. The admin approves.
3. Alex: "My support role is changing… weekends… $20 budget." One clarifying question, then three recommendations from across categories (the browse page shows other categories too). One is "New contributor". One is over budget. One has agent help off and says so.
4. Alex buys Maria's guide. The PayPal sandbox popup appears and the server confirms; the "Sandbox" badge is visible. The guide is in the library.
5. Alex asks how to find a first client. The answer has "Maria said §3" blocks and AI suggestions.
6. Alex asks how to price onboarding for SaaS startups. The answer comes back UNKNOWN with a gap, plus a request card for $15 within the remaining $15 budget. Alex edits it and leaves "current employer" unshared.
7. Maria accepts. Alex pays and the delivery clock starts. Maria delivers. The agent folds her pricing advice into Alex's plan, credited to Maria's response.
8. Constraint moment: Alex tries a $10 guide and is blocked: "This would exceed your $20 budget". The stewardship log shows it.
9. Maria's earnings: $20 gross, $3 commission, $17 payable, and the actual payout status (sandbox SUCCESS, or "not transferred").
10. Alex leaves immediate feedback; the counts update.

**What is real, sandboxed, seeded or mocked:**
- **Real:** the app, AI calls, enforcement, state machine, ledger.
- **Sandbox:** all PayPal money; nothing is real currency.
- **Seeded and labelled:** extra guides and profiles.
- **Simulated:** time skips for the expiry demo (an admin "advance clock" on demo data only, labelled); follow-up feedback triggered by hand.
- **Not used in the demo:** HCAI ("local policy").

**Validation:** before 11-08, 3 to 5 contributors try the interview (at least two from the work-transition launch category, the rest from other domains to test that the interview is domain-neutral), and 3 to 5 learners with real questions try discovery and a request. We record task completion, whether they would pay at these prices, what was confusing, and whether contributors find 85% and the response windows fair.

- **Claims backed by working software:** consent-gated paid requests, enforced budgets and permissions, attribution, server-confirmed payments, transparent earnings.
- **Assumptions only:** demand, willingness to pay, the 15% commission, whether this helps careers or income. We do not claim either of those last two.

## K. Open decisions (only those that change scope or ownership)

1. **Maria's guide content:** is there a real person who consents to share their experience for the demo? If not, the profile is labelled fictional. This affects demo credibility and the "use consenting real contributions" principle.
2. **Hosting:** use Render (eligible for the sponsor prize) for the judge demo, with your go-ahead before any deployment, or ship run-from-README only?
3. **AbundanceAI:** the team confirms that re-implementing patterns (not code) is fine given the co-contributor, and handles the leaked judge credential.
4. **PPCP application:** who on the team owns the PayPal partner form and the Payouts access request?

Routine choices settled by judgment:
- Full-text search instead of vectors; whole-guide grounding.
- 10 questions per purchase for 30 days.
- The platform pays processing fees.
- In-app notifications only, no email.
- USD only.
- One `paypal` module with direct REST; the Agent Toolkit only as an optional read-only admin tool.

## Critical files to create

- **API:** `enrichmint-api/prisma/schema.prisma`, `src/config/env.ts`, `src/paypal/paypal.service.ts`, `src/orders/orders.service.ts` (fulfil), `src/webhooks/paypal-webhooks.controller.ts`, `src/requests/request-state.ts` (`transition()`), `src/assistant/grounding.ts` (`loadGroundingContext`), `src/policy/policy.port.ts` + `local-policy.adapter.ts`, `src/models/openai.adapter.ts`, `src/ledger/ledger.service.ts`.
- **Web:** `enrichmint-frontend/app/lib/services/*.ts`, `app/(private)/start`, `library/[guideId]`, `requests/[id]`, `studio/*`, `admin/*`, `app/components/PayPalButton.tsx` (SDK v6).

## End-to-end check before submission

1. `docker compose up`, `yarn prisma migrate deploy`, `yarn seed:demo`, then `yarn start:dev` and `yarn dev`.
2. Run the J sequence with real sandbox accounts while the webhook tunnel is running, and confirm `webhook_events` shows the events verified and processed once.
3. Run `yarn test` and `yarn eval:agents`; both must pass.
4. Run the foais `security-reviewer` on both repos (only when you ask) and fix anything high.
5. A fresh clone and the README steps work on a second machine.
