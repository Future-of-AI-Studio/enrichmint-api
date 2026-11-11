# EnrichMINT API

EnrichMINT helps people earn from their real-life experience, while helping others learn from it.

A network of people helping each other, with AI as the matchmaker. You tell the AI what you need help with. It finds guidance from someone who has been through it, which you can pay to access. If you need a more personal answer, it finds the right person and sets up paid advice. Once you have tried the advice, you can publish a field note on what happened and earn a share of later sales. Every payment, refund and payout runs on PayPal (sandbox).

Built for the PayPal AI Hackathon. The web app lives in `enrichmint-frontend`. The plan, decisions and progress live in [`PLAN.md`](./PLAN.md).

## What is real, sandboxed, seeded or simulated

| Part | Status |
| --- | --- |
| App, AI calls, budget and permission enforcement, request state machine, ledger | Real, running code |
| Payments, refunds, payouts | **PayPal sandbox only.** No real money moves. |
| Maria, Alex, Sam, Priya, Tomas and their guides | **Seeded, fictional**, shown with a "Demo profile" label |
| Deadline expiry in the demo | **Simulated** with an admin-only "fast-forward" tool, written to history as SIMULATED, disabled in production |
| HCAI policy layer | Optional and off by default. Local rules always run and are enough. |

Payment model: the EnrichMINT sandbox merchant collects each payment through Orders v2. A ledger records the 15% commission and the contributor's 85%, and the contributor withdraws through PayPal Payouts. EnrichMINT pays the PayPal processing fee out of its commission. PayPal's marketplace features (`platform_fees`, delayed disbursement) need partner approval, so they are not used. In production, collecting on behalf of contributors needs PayPal partner approval or legal review. A ledger balance is money owed. Only a payout with status SUCCESS counts as transferred.

## Stack

NestJS 11, Prisma 7 on Postgres 17, OpenAI Responses API (strict JSON schema, `store: false`), PayPal REST (Orders v2, Payments v2 refunds, Payouts v1, webhook signature verification), Jest and supertest.

## Run it locally

Prerequisites: Node 22, Yarn 1, Docker.

```bash
yarn install
yarn db:up                       # Postgres 17 on localhost:5435
cp .env.example .env             # then fill in the values below
yarn migrate:deploy
yarn build && yarn seed:demo     # labelled demo data; needs SEED_DEMO_PASSWORD
yarn start:dev                   # http://localhost:4100/api, Swagger at /docs
```

Required in `.env`:
- `JWT_SECRET`: at least 32 characters.
- `SEED_DEMO_PASSWORD`: the password for every demo account.

Optional, but needed for the full demo:
- `OPENAI_API_KEY`: without it, the interview, recommendations and drafts fall back to deterministic behaviour, and the assistant answers 503 `ai_not_configured`.
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` (sandbox): without them, checkout answers 503 `payments_not_configured`.

### PayPal sandbox setup

1. At developer.paypal.com, open **Apps & Credentials** and choose **Sandbox**. Create a REST app and copy its client ID and secret.
2. Under **Sandbox accounts**, use the default business account (EnrichMINT, the merchant) and create two personal accounts: one for Alex (buyer) and one for Maria (payout receiver). Put Maria's email in `SEED_MARIA_PAYOUT_EMAIL` and run `yarn seed:demo` again.
3. Webhooks need a public HTTPS URL. PayPal has no local forwarder like `stripe listen`, so run a tunnel to port 4100. A free ngrok static domain keeps the same URL across restarts: `ngrok http --url=<your-domain>.ngrok-free.app 4100`. Then add the webhook `https://<your-domain>/api/webhooks/paypal` to the app with these events:
   - `CHECKOUT.ORDER.APPROVED`
   - `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`
   - `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `FAILED`, `UNCLAIMED`, `RETURNED`, `BLOCKED`, `DENIED`, `REFUNDED`
   - `CUSTOMER.DISPUTE.CREATED`

   Copy the webhook ID into `PAYPAL_WEBHOOK_ID`.
4. PayPal's webhook simulator cannot be verified, so it is rejected. Test with real sandbox payments instead.

The capture call and the reconciler (every 5 minutes) confirm payments even without webhooks. Payout status needs the webhook or the reconciler.

## Deploy (Railway, with the web app on Vercel)

The API runs as one long-lived Railway service next to a Railway Postgres. It must stay running: the deadline and payment-check jobs run inside it. `railway.json` sets the build, runs `yarn migrate:deploy` before each release, starts `yarn start:prod` and checks `/api/health`.

1. In Railway, create a project with a **PostgreSQL** database and a service from this repository.
2. Set the service variables:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway reference) |
   | `ENVIRONMENT` | `staging`. Keeps the labelled demo tools and seeding available. `production` turns them off. |
   | `JWT_SECRET` | a new random value, at least 32 characters |
   | `WEB_ORIGIN` | the Vercel URL, e.g. `https://enrichmint.vercel.app` |
   | `SEED_DEMO_PASSWORD` | the demo account password you will give judges |
   | `SEED_MARIA_PAYOUT_EMAIL` | Maria's PayPal sandbox personal account email |
   | `OPENAI_API_KEY` | your key (set a spending cap on it) |
   | `AI_DAILY_BUDGET_USD` | a daily cap, e.g. `5` |
   | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | the sandbox REST app |
   | `PAYPAL_WEBHOOK_ID` | from step 4 |

   Railway sets `PORT` itself. Leave `PAYPAL_ENV` at `sandbox`.
3. Generate a public domain for the service, then seed once from a shell on the service: `railway ssh`, then `yarn seed:demo`. Seeding is idempotent and resets the demo passwords to `SEED_DEMO_PASSWORD`.
4. In the PayPal developer dashboard (Sandbox), add a webhook to the same app with the URL `https://<railway-domain>/api/webhooks/paypal` and the events listed above. Put its id in `PAYPAL_WEBHOOK_ID`; the service redeploys.
5. Check `https://<railway-domain>/api/health`: `database` is `up` and `paypal.webhookConfigured` and `ai.configured` are `true`.

Keep the service running until judging ends (Dec 15, 2026).

## Demo accounts (after `yarn seed:demo`)

All accounts use `SEED_DEMO_PASSWORD`. Running `yarn seed:demo` again resets them to its current value. Every one is fictional and labelled "Demo profile".

| Account | Role |
| --- | --- |
| `admin@enrichmint.demo` | Admin |
| `maria@enrichmint.demo` | Contributor: support lead turned onboarding consultant. $5 guide, $15 personal answers. |
| `alex@enrichmint.demo` | Learner |
| `sam@`, `priya@`, `tomas@enrichmint.demo` | Other contributors. Sam's guide has AI assistance off; Priya's costs $25, which is over Alex's budget. |

## Judge testing

Everything runs on the PayPal **sandbox**: no real money moves.

1. Open the web app and sign in as `alex@enrichmint.demo` with the demo password: `<DEMO PASSWORD>`.
2. Pay with either of these at checkout:
   - **Test card (no PayPal account needed):** press "Debit or Credit Card" and enter Visa `4012 0000 3333 0026`, any future expiry date (for example `12/30`), any 3-digit CVV, country United States, and any name, ZIP code, phone and email. This is one of PayPal's published sandbox test cards; more are on developer.paypal.com under Tools, Sandbox, Card testing.
   - **PayPal sandbox buyer (optional):** press "Pay with PayPal" and sign in with email `<SANDBOX BUYER EMAIL>`, password `<SANDBOX BUYER PASSWORD>`. It has a fake balance.
   - Buyers in the United States also see "Pay with Venmo" and "Pay Later". PayPal decides which buttons to offer from the buyer's location.
3. A short path through the whole product (about 5 minutes):
   - **Learn:** describe a goal in one of the catalogue's areas (caregiving, freelancing, learning a craft, moving abroad, starting a business, work transitions). Buy the guide the steward suggests. The library then shows the PayPal order and capture IDs.
   - **Ask the person:** ask the guide something it does not cover. The steward drafts a paid question to the author. Send it, then sign in as `maria@enrichmint.demo`, accept and answer it. Back as Alex, pay for it and press "Help me apply this".
   - **Give back:** leave the "Later: did you try it?" feedback with what happened, then draft and publish a field note.
   - **See the money move:** sign in as `tomas@enrichmint.demo` and buy the same guide. Alex now earns a field note share (Share, then Earnings), and Maria earns her 85%. Either of them can pay out to PayPal and see the Payouts batch ID.
   - **Admin:** `admin@enrichmint.demo` sees every PayPal order, capture, webhook event and payout ID under Admin, then Payments.

Alex may already own some guides from earlier test runs. Running `yarn seed:demo` resets the demo passwords and data, or pick another guide.

## PayPal APIs used

| PayPal API | What EnrichMINT uses it for | Where |
| --- | --- | --- |
| JS SDK v6 (PayPal, Venmo, Pay Later, guest card buttons) | Checkout. Each button shows only when PayPal reports the buyer eligible. | `enrichmint-frontend/app/components/PayPalCheckout.tsx` |
| Orders v2: create, capture, get | Guide purchases and paid personal answers. The price comes from our database; access is granted only after a COMPLETED capture for the exact amount. | `src/paypal/paypal.service.ts`, `src/orders/orders.service.ts` |
| Payments v2: refund capture | Buyer refunds and automatic refunds for missed deliveries. Every ledger share is reversed. | `src/refunds/refunds.service.ts` |
| Payouts v1: create, get batch | Contributors and field note authors withdraw their balance to their own PayPal account. | `src/payouts/payouts.service.ts` |
| Webhooks: verify signature | Capture, refund and payout events, verified with PayPal and processed once. | `src/webhooks/webhooks.service.ts` |
| `PayPal-Request-Id` | Idempotent create, capture and refund calls. | `src/paypal/paypal.service.ts` |

## Partner integrations

- **Postman.** `yarn openapi:export` writes `postman/openapi.json` from the same document as Swagger. In Postman, choose Import and pick that file to get a collection of every endpoint, then import `postman/enrichmint.postman_environment.json` and set `baseUrl` and `bearerToken` (the `accessToken` from `POST /api/auth/login`).
- **Zapier.** Set `ZAPIER_WEBHOOK_URL` to a Zapier "Catch Hook" URL. The API then posts `order.completed`, `request.sent`, `request.accepted`, `request.delivered`, `payout.succeeded`, `refund.completed` and `field_note.published`, after the change is committed. Payloads carry ids, amounts and states only, never emails or message content. A slow or failing Zapier never affects a payment.

## Field notes (the enrichment loop)

After trying a guide or a personal answer, a learner can turn their follow-up feedback into a short field note. The AI drafts it from their own words only. They edit it, and it is published only with `approved: true`.
- Published notes appear on the guide page and in the reader, marked as self-reported. The guide's assistant may mention them as "Another learner reported", never as the author's words.
- Each later sale of that guide pays the note authors 5% (`ENRICHMENT_SHARE_BPS`), split evenly and **taken from the platform's 15% commission**. The guide author's 85% is unchanged. A refund reverses every share.
- A learner with no contributor profile gets a lightweight `EARNER` profile. It can receive shares and pay out through PayPal Payouts, but it cannot sell until it applies and is approved.
- Known trade-off: on a $5 sale the platform nets 75¢ commission minus the 66¢ sandbox PayPal fee minus 25¢ in note shares, so slightly negative. This is acceptable for the demo; production pricing would need a minimum price or a lower share.

## Steward agent

`/api/steward/sessions` runs one agent per goal: an OpenAI tool loop of at most 6 calls per message, built on existing services.
- **Its tools can:** find guides, read previews, ask a purchased guide, find people in the network who have lived the learner's situation (`find_people`), check whether the author takes personal requests (with budget fit), draft a request to a guide author or a matched person, prepare checkout cards, and turn a delivered answer into steps.
- **It does not give its own advice.** When nothing in the catalogue fits, it says so and offers people from the network instead of writing a free playbook.
- **No tool can:** send a request, pay, capture, accept or change a budget. The learner does those, and the existing backend enforces them.
- **Workflow status** is derived from database facts, never set by the model. Each view syncs changes made by payments, webhooks and deadline jobs into one update per change.
- Plan and design: `docs/dev/steward-agent/plan.md`.

## Tests

```bash
yarn test        # unit: state machine, attribution check, fee split, draft figure check, policy rules
yarn test:e2e    # needs the enrichmint_test database (see below)
yarn eval:agents # real model, needs OPENAI_API_KEY; about $0.20 per run
```

`yarn eval:agents` runs 15 cases against the real model, using the same prompts as the app (`src/evals/`):
- **Citations:** answerable questions must cite the right guide section with a quote the server can verify.
- **Gaps:** questions the guide does not answer must raise a gap for the contributor.
- **Fabrication:** asked for a figure or credential the guide never states, nothing false may be attributed to the contributor.
- **Injection:** instructions planted in a guide or a question must have no effect.
- **Drafts:** interview drafts must not invent figures or claims, and must leave unanswered sections empty.

`yarn eval:agents --verbose <case-id>` prints rejected quotes and failing output. A single case can fail now and then because the model is not deterministic; rerun it before changing a prompt.

Create the e2e database once:

```bash
docker exec enrichmint-db psql -U enrichmint -c "CREATE DATABASE enrichmint_test"
DATABASE_URL=postgresql://enrichmint:enrichmint@localhost:5435/enrichmint_test yarn migrate:deploy
```

The e2e suites run against real Postgres, with PayPal faked at the module boundary. They cover:
- Access granted only after a confirmed capture, with the ledger split checked.
- A client-sent amount is rejected.
- Repeated captures and webhook replays change nothing.
- A webhook that arrives before the capture.
- PENDING and declined captures.
- An amount mismatch.
- A forged webhook.
- A budget blocked both sequentially and under parallel captures.
- Refunds and payouts (success and "not enabled").
- Field notes: consent required, the 5% share paid from commission to the note author, reversed on refund, and not paid for earlier sales.
- Content and AI access control, including permission withdrawn after purchase.
- Consent-limited request context.
- Out-of-order and wrong-actor transitions.
- Expiry, a lapsed payment window, and an automatic refund for a missed delivery.

## Licence

MIT. See [LICENSE](./LICENSE).
