import type { RequestState, TransitionActor } from 'generated/prisma/client';

export type RequestEvent =
  | 'send'
  | 'cancel'
  | 'accept'
  | 'decline'
  | 'expire'
  | 'payment_confirmed'
  | 'payment_expire'
  | 'deliver'
  | 'mark_overdue'
  | 'refund'
  | 'close'
  | 'dispute'
  | 'resolve_refund'
  | 'resolve_uphold';

interface Rule {
  from: RequestState[];
  to: RequestState;
  actors: TransitionActor[];
}

/**
 * Every allowed move of a personalized request. Anything not listed is
 * rejected with 409. The delivery clock starts on `payment_confirmed`.
 */
export const REQUEST_RULES: Record<RequestEvent, Rule> = {
  send: { from: ['DRAFT'], to: 'SENT', actors: ['LEARNER'] },
  cancel: { from: ['DRAFT', 'SENT'], to: 'CANCELLED', actors: ['LEARNER'] },
  accept: { from: ['SENT'], to: 'ACCEPTED', actors: ['CONTRIBUTOR'] },
  decline: { from: ['SENT'], to: 'DECLINED', actors: ['CONTRIBUTOR'] },
  expire: { from: ['SENT'], to: 'EXPIRED', actors: ['SYSTEM'] },
  payment_confirmed: { from: ['ACCEPTED'], to: 'PAID', actors: ['SYSTEM'] },
  payment_expire: {
    from: ['ACCEPTED'],
    to: 'PAYMENT_EXPIRED',
    actors: ['SYSTEM'],
  },
  deliver: {
    from: ['PAID', 'OVERDUE'],
    to: 'DELIVERED',
    actors: ['CONTRIBUTOR'],
  },
  mark_overdue: { from: ['PAID'], to: 'OVERDUE', actors: ['SYSTEM'] },
  refund: {
    from: ['PAID', 'OVERDUE'],
    to: 'REFUNDED',
    actors: ['SYSTEM', 'ADMIN'],
  },
  close: { from: ['DELIVERED'], to: 'CLOSED', actors: ['LEARNER', 'SYSTEM'] },
  dispute: { from: ['DELIVERED'], to: 'DISPUTED', actors: ['LEARNER'] },
  resolve_refund: {
    from: ['DISPUTED'],
    to: 'RESOLVED_REFUNDED',
    actors: ['ADMIN', 'SYSTEM'],
  },
  resolve_uphold: {
    from: ['DISPUTED'],
    to: 'RESOLVED_UPHELD',
    actors: ['ADMIN'],
  },
};

export type TransitionResult =
  | { ok: true; to: RequestState }
  | { ok: false; reason: 'invalid_state' | 'actor_not_allowed' };

/** Pure: decides whether `event` by `actor` may move a request out of `state`. */
export function transition(
  state: RequestState,
  event: RequestEvent,
  actor: TransitionActor,
): TransitionResult {
  const rule = REQUEST_RULES[event];
  if (!rule.actors.includes(actor))
    return { ok: false, reason: 'actor_not_allowed' };
  if (!rule.from.includes(state)) return { ok: false, reason: 'invalid_state' };
  return { ok: true, to: rule.to };
}

/** States in which money has been taken and not returned. */
export const PAID_STATES: RequestState[] = [
  'PAID',
  'OVERDUE',
  'DELIVERED',
  'CLOSED',
  'DISPUTED',
  'RESOLVED_UPHELD',
];
