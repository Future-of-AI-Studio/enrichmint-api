import type { RequestState, TransitionActor } from 'generated/prisma/client';
import { REQUEST_RULES, RequestEvent, transition } from './request-state';

const ALL_STATES: RequestState[] = [
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'PAYMENT_EXPIRED',
  'PAID',
  'OVERDUE',
  'DELIVERED',
  'CLOSED',
  'DISPUTED',
  'REFUNDED',
  'RESOLVED_REFUNDED',
  'RESOLVED_UPHELD',
];

describe('request state machine', () => {
  it.each(Object.entries(REQUEST_RULES))(
    '%s is allowed only from its listed states',
    (event, rule) => {
      for (const state of ALL_STATES) {
        const result = transition(state, event as RequestEvent, rule.actors[0]);
        if (rule.from.includes(state)) {
          expect(result).toEqual({ ok: true, to: rule.to });
        } else {
          expect(result).toEqual({ ok: false, reason: 'invalid_state' });
        }
      }
    },
  );

  it.each<[RequestEvent, TransitionActor]>([
    ['accept', 'LEARNER'],
    ['deliver', 'LEARNER'],
    ['send', 'CONTRIBUTOR'],
    ['payment_confirmed', 'LEARNER'],
    ['refund', 'CONTRIBUTOR'],
    ['resolve_uphold', 'CONTRIBUTOR'],
  ])('%s by %s is refused', (event, actor) => {
    const state = REQUEST_RULES[event].from[0];
    expect(transition(state, event, actor)).toEqual({
      ok: false,
      reason: 'actor_not_allowed',
    });
  });

  it('never leaves a terminal state', () => {
    const terminal: RequestState[] = [
      'DECLINED',
      'EXPIRED',
      'CANCELLED',
      'PAYMENT_EXPIRED',
      'CLOSED',
      'REFUNDED',
      'RESOLVED_REFUNDED',
      'RESOLVED_UPHELD',
    ];
    for (const state of terminal) {
      for (const [event, rule] of Object.entries(REQUEST_RULES)) {
        expect(
          transition(state, event as RequestEvent, rule.actors[0]).ok,
        ).toBe(false);
      }
    }
  });

  it('only takes payment for an accepted request', () => {
    expect(REQUEST_RULES.payment_confirmed.from).toEqual(['ACCEPTED']);
  });
});
