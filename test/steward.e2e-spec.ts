import { MAX_TOOL_CALLS } from 'src/steward/orchestrator.service';
import {
  buy,
  createTestApp,
  makeContributorWithGuide,
  makeGoal,
  resetDatabase,
  signUp,
  TestContext,
} from './utils/test-app';

// The full-loop spec walks every stage with real database writes.
jest.setTimeout(60_000);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

type Event = {
  kind: string;
  tool: string | null;
  summary: string;
  payload: { type?: string; data?: Record<string, unknown> };
};

const GAP_QUESTION = 'How should I price onboarding for SaaS startups?';

/** What AssistantService.ask's model call returns: one verified quote, plus a gap. */
const groundedAnswerWithGap = {
  blocks: [
    {
      type: 'CONTRIBUTOR_SAID',
      text: 'Maria messaged former colleagues first.',
      sourceIds: ['s3'],
      quote: 'sent twelve messages to former colleagues',
    },
    {
      type: 'UNKNOWN',
      text: 'The guide does not cover pricing for SaaS startups.',
      sourceIds: [],
      quote: null,
    },
  ],
  gap: {
    detected: true,
    question: GAP_QUESTION,
    reason: 'The guide does not describe pricing.',
  },
};

describe('Steward agent (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.paypal.reset();
    ctx.ai.reset();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  async function setup(
    options: Parameters<typeof makeContributorWithGuide>[1] = {},
  ) {
    const maria = await makeContributorWithGuide(ctx, options);
    const alex = await signUp(ctx, 'Alex');
    const goalId = await makeGoal(ctx, alex.token, 2000);
    const session = await ctx
      .http()
      .post('/api/steward/sessions')
      .set(auth(alex.token))
      .send({ goalId })
      .expect(201);
    return { maria, alex, goalId, sessionId: session.body.id as string };
  }

  const say = (sessionId: string, token: string, text: string) =>
    ctx
      .http()
      .post(`/api/steward/sessions/${sessionId}/messages`)
      .set(auth(token))
      .send({ text });

  const view = async (sessionId: string, token: string) =>
    (
      await ctx
        .http()
        .get(`/api/steward/sessions/${sessionId}`)
        .set(auth(token))
        .expect(200)
    ).body as {
      stage: string;
      nextStep: string;
      events: Event[];
      snapshot: { goal: { remainingCents: number } };
    };

  const count = (events: Event[], predicate: (event: Event) => boolean) =>
    events.filter(predicate).length;

  it('runs the whole loop and stops at every human decision', async () => {
    const { maria, alex, goalId, sessionId } = await setup();
    const guideId = maria.guide.id;
    ctx.ai.isConfigured = true;

    // Turn 1: find guidance and prepare a checkout card. Nothing is bought.
    ctx.ai.steps = [
      { call: 'find_guides', args: {} },
      { call: 'prepare_guide_checkout', args: { guideId } },
      {
        final: {
          say: 'Maria’s guide fits. Want to review the purchase?',
          suggestedReplies: ['Yes'],
        },
      },
    ];
    await say(
      sessionId,
      alex.token,
      'My support role is changing. Where do I start with freelancing?',
    ).expect(200);
    let state = await view(sessionId, alex.token);
    expect(state.stage).toBe('DECIDING_PURCHASE');
    expect(state.events.map((e) => e.payload.type).filter(Boolean)).toEqual([
      'guide_picks',
      'guide_checkout',
    ]);
    expect(await ctx.prisma.order.count()).toBe(0);

    // The learner buys through the normal checkout; the steward only sees the result.
    await buy(ctx, alex.token, { kind: 'GUIDE', guideId, goalId });
    state = await view(sessionId, alex.token);
    state = await view(sessionId, alex.token);
    expect(
      count(state.events, (e) =>
        e.summary.includes('PayPal confirmed your purchase'),
      ),
    ).toBe(1);
    expect(state.stage).toBe('USING_GUIDE');

    // Turn 2: the defining moment. Gap, available contributor within budget, draft only.
    ctx.ai.completions = [groundedAnswerWithGap];
    ctx.ai.steps = [
      { call: 'ask_guide', args: { guideId, question: GAP_QUESTION } },
      { call: 'check_contributor', args: { guideId, question: GAP_QUESTION } },
      { call: 'draft_request', args: { guideId, question: GAP_QUESTION } },
      {
        final: {
          say: 'This guide doesn’t cover pricing for SaaS startups. Maria accepts questions on this topic for $15, which fits your remaining budget. I’ve drafted a request. Would you like to review it?',
          suggestedReplies: ['Review it'],
        },
      },
    ];
    await say(sessionId, alex.token, GAP_QUESTION).expect(200);
    state = await view(sessionId, alex.token);
    const offer = state.events.find(
      (e) => e.payload.type === 'human_help_offer',
    )!;
    expect(offer.payload.data).toMatchObject({
      priceCents: 1500,
      remainingBudgetCents: 1500,
      withinBudget: true,
    });
    expect(state.events.at(-1)!.summary).toContain(
      'Maria accepts questions on this topic for $15',
    );
    const request = await ctx.prisma.personalRequest.findFirstOrThrow({
      where: { learnerId: alex.id },
    });
    expect(request.state).toBe('DRAFT');
    expect(state.stage).toBe('REQUEST_DRAFT');
    // The price and budget the model saw came from tools, not from its own memory.
    expect(
      ctx.ai.seenInputs.some(
        (input) =>
          input.includes('"priceCents":1500') &&
          input.includes('"remainingBudgetCents":1500'),
      ),
    ).toBe(true);

    // Turn 3: the model tries to send the request itself. It cannot.
    ctx.ai.steps = [
      { call: 'send_request', args: { requestId: request.id } },
      {
        final: {
          say: 'You can send it from the review page.',
          suggestedReplies: [],
        },
      },
    ];
    await say(sessionId, alex.token, 'Just send it for me').expect(200);
    state = await view(sessionId, alex.token);
    expect(
      state.events.some(
        (e) =>
          e.kind === 'TOOL_STEP' &&
          e.summary.includes('There is no "send_request" action'),
      ),
    ).toBe(true);
    expect(
      (
        await ctx.prisma.personalRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).state,
    ).toBe('DRAFT');
    expect(await ctx.prisma.order.count()).toBe(1);

    // The learner sends, Maria accepts and the learner pays; each shows up once.
    await ctx
      .http()
      .post(`/api/requests/${request.id}/send`)
      .set(auth(alex.token))
      .send({ approved: true })
      .expect(200);
    await ctx
      .http()
      .post(`/api/studio/requests/${request.id}/accept`)
      .set(auth(maria.user.token))
      .expect(200);
    state = await view(sessionId, alex.token);
    state = await view(sessionId, alex.token);
    expect(state.stage).toBe('AWAITING_PAYMENT');
    expect(
      count(
        state.events,
        (e) =>
          e.kind === 'SYSTEM_UPDATE' &&
          e.summary.includes('accepted your request'),
      ),
    ).toBe(1);
    expect(
      count(state.events, (e) => e.payload.type === 'request_checkout'),
    ).toBe(1);

    await buy(ctx, alex.token, { kind: 'REQUEST', requestId: request.id });
    state = await view(sessionId, alex.token);
    expect(state.stage).toBe('AWAITING_DELIVERY');
    expect(
      count(state.events, (e) =>
        e.summary.includes('PayPal confirmed your $15.00 payment'),
      ),
    ).toBe(1);

    await ctx
      .http()
      .post(`/api/studio/requests/${request.id}/deliver`)
      .set(auth(maria.user.token))
      .send({
        body: 'I would charge a flat setup fee, then a monthly retainer.',
        aiUseAllowed: true,
      })
      .expect(200);
    state = await view(sessionId, alex.token);
    expect(state.stage).toBe('APPLYING_RESPONSE');
    expect(
      count(state.events, (e) => e.payload.type === 'response_ready'),
    ).toBe(1);

    // Turn 4: apply the delivered answer as suggested steps.
    ctx.ai.completions = [
      {
        blocks: [
          {
            type: 'CONTRIBUTOR_SAID',
            text: 'Maria would start with a setup fee.',
            sourceIds: ['response'],
            quote: 'charge a flat setup fee',
          },
          {
            type: 'AI_SUGGESTION',
            text: 'Draft a one-page offer with a setup fee this weekend.',
            sourceIds: [],
            quote: null,
          },
        ],
        gap: { detected: false, question: null, reason: null },
      },
    ];
    ctx.ai.steps = [
      { call: 'apply_response', args: { requestId: request.id } },
      {
        final: {
          say: 'Here are suggested steps. Please review them.',
          suggestedReplies: [],
        },
      },
    ];
    await say(sessionId, alex.token, 'Help me apply Maria’s answer').expect(
      200,
    );
    state = await view(sessionId, alex.token);
    expect(state.stage).toBe('DONE');
    expect(state.events.some((e) => e.payload.type === 'plan')).toBe(true);
  });

  it('logs a budget block and sets up no payment for a guide over budget', async () => {
    const { maria, alex, sessionId } = await setup({ priceCents: 2500 });
    ctx.ai.isConfigured = true;
    ctx.ai.steps = [
      { call: 'prepare_guide_checkout', args: { guideId: maria.guide.id } },
      {
        final: {
          say: 'That guide costs more than your remaining budget.',
          suggestedReplies: [],
        },
      },
    ];
    await say(sessionId, alex.token, 'Buy that guide for me.').expect(200);

    const { events } = await view(sessionId, alex.token);
    const step = events.find(
      (event) => event.tool === 'prepare_guide_checkout',
    );
    expect(step?.summary).toContain('No payment was set up');
    const blocks = await ctx.prisma.policyDecision.findMany({
      where: { userId: alex.id, check: 'checkout', outcome: 'DENY' },
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].plainReason).toContain('more than the $20.00 left');
    expect(await ctx.prisma.order.count()).toBe(0);
  });

  it('keeps guide content away from the model when the author forbids AI', async () => {
    const { maria, alex, goalId, sessionId } = await setup({
      agentAssistAllowed: false,
    });
    await buy(ctx, alex.token, {
      kind: 'GUIDE',
      guideId: maria.guide.id,
      goalId,
    });
    ctx.ai.isConfigured = true;
    ctx.ai.steps = [
      {
        call: 'ask_guide',
        args: { guideId: maria.guide.id, question: 'Summarize the guide' },
      },
      {
        final: {
          say: 'Maria does not allow AI to read this guide, but you can read it yourself.',
          suggestedReplies: [],
        },
      },
    ];
    await say(sessionId, alex.token, 'Summarize the guide for me').expect(200);
    const state = await view(sessionId, alex.token);
    expect(
      state.events.some(
        (e) =>
          e.kind === 'TOOL_STEP' &&
          e.summary.includes('has not allowed AI assistance'),
      ),
    ).toBe(true);
    expect(ctx.ai.seenInputs.join('\n')).not.toContain('SECRET-BODY');
  });

  it('refuses ids that belong to someone else', async () => {
    const { maria, alex, sessionId } = await setup();
    const other = await signUp(ctx, 'Other');
    const otherGoal = await makeGoal(ctx, other.token, 5000);
    const otherDraft = await ctx
      .http()
      .post('/api/requests/draft-from-gap')
      .set(auth(other.token))
      .send({
        guideId: maria.guide.id,
        question: 'Pricing?',
        goalId: otherGoal,
      })
      .expect(201);

    ctx.ai.isConfigured = true;
    ctx.ai.steps = [
      {
        call: 'prepare_request_checkout',
        args: { requestId: otherDraft.body.id },
      },
      {
        call: 'ask_guide',
        args: { guideId: maria.guide.id, question: 'What did you do first?' },
      },
      { final: { say: 'I cannot do that.', suggestedReplies: [] } },
    ];
    await say(sessionId, alex.token, 'Pay that request').expect(200);
    const state = await view(sessionId, alex.token);
    const steps = state.events
      .filter((e) => e.kind === 'TOOL_STEP')
      .map((e) => e.summary);
    expect(steps[0]).toContain('not available');
    expect(steps[1]).toContain('Buy this guide');
    expect(await ctx.prisma.order.count()).toBe(0);
  });

  it('ends a turn cleanly at the step limit', async () => {
    const { alex, sessionId } = await setup();
    ctx.ai.isConfigured = true;
    ctx.ai.steps = Array.from({ length: MAX_TOOL_CALLS + 3 }, () => ({
      call: 'get_status',
      args: {},
    }));
    await say(sessionId, alex.token, 'Check my status').expect(200);
    const state = await view(sessionId, alex.token);
    expect(count(state.events, (e) => e.kind === 'TOOL_STEP')).toBe(
      MAX_TOOL_CALLS,
    );
    expect(state.events.at(-1)!.summary).toContain('I have done what I can');
  });

  it('keeps the status working without AI', async () => {
    const { alex, sessionId } = await setup();
    const turn = await say(sessionId, alex.token, 'Hello').expect(503);
    expect(turn.body.error).toBe('ai_not_configured');
    const state = await view(sessionId, alex.token);
    expect(state.stage).toBe('GOAL');
    expect(state.nextStep).toContain('what you are trying to figure out');
    expect(state.snapshot.goal.remainingCents).toBe(2000);
  });

  it('only shows a conversation to its owner', async () => {
    const { sessionId } = await setup();
    const stranger = await signUp(ctx, 'Stranger');
    await ctx
      .http()
      .get(`/api/steward/sessions/${sessionId}`)
      .set(auth(stranger.token))
      .expect(404);
    await say(sessionId, stranger.token, 'hi').expect(404);
  });
});
