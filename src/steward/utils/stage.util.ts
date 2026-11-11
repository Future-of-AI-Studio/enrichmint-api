import type { RequestState } from 'generated/prisma/client';
import { formatUsd } from 'src/common/utils/money.util';

export const STEWARD_STAGES = [
  'GOAL',
  'FINDING_GUIDANCE',
  'DECIDING_PURCHASE',
  'USING_GUIDE',
  'GAP_FOUND',
  'REQUEST_DRAFT',
  'AWAITING_ACCEPTANCE',
  'AWAITING_PAYMENT',
  'AWAITING_DELIVERY',
  'APPLYING_RESPONSE',
  'DONE',
  'ENDED',
] as const;

export type StewardStage = (typeof STEWARD_STAGES)[number];

/** Database facts the steward works from. Built by StewardStateService; never by the model. */
export interface StewardSnapshot {
  goal: {
    id: string;
    text: string;
    budgetCents: number;
    committedCents: number;
    remainingCents: number;
  };
  hasAgentTurn: boolean;
  recommendationsShown: boolean;
  gapQuestion: string | null;
  activeGuide: {
    id: string;
    slug: string;
    title: string;
    priceCents: number;
    owned: boolean;
    agentAssistAllowed: boolean;
    contributorName: string;
    questionsLeft: number | null;
  } | null;
  activeRequest: {
    id: string;
    state: RequestState;
    priceCents: number;
    contributorName: string;
    acceptBy: string | null;
    payBy: string | null;
    deliverBy: string | null;
    hasResponse: boolean;
    responseAiAllowed: boolean;
    planCount: number;
  } | null;
}

const UNPAID_STATES: RequestState[] = ['DRAFT', 'SENT', 'ACCEPTED'];
// States reachable only after a confirmed payment, apart from PAID itself.
const PAID_LATER_STATES: RequestState[] = [
  'OVERDUE',
  'DELIVERED',
  'CLOSED',
  'DISPUTED',
  'RESOLVED_UPHELD',
];

const ENDED_STATES: RequestState[] = [
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'PAYMENT_EXPIRED',
  'REFUNDED',
  'RESOLVED_REFUNDED',
];

/** Pure: where the workflow is, from facts only. */
export function deriveStage(snapshot: StewardSnapshot): StewardStage {
  const request = snapshot.activeRequest;
  if (request) {
    if (ENDED_STATES.includes(request.state)) return 'ENDED';
    switch (request.state) {
      case 'DRAFT':
        return 'REQUEST_DRAFT';
      case 'SENT':
        return 'AWAITING_ACCEPTANCE';
      case 'ACCEPTED':
        return 'AWAITING_PAYMENT';
      case 'PAID':
      case 'OVERDUE':
        return 'AWAITING_DELIVERY';
      default:
        return request.planCount > 0 || !request.responseAiAllowed
          ? 'DONE'
          : 'APPLYING_RESPONSE';
    }
  }
  if (snapshot.gapQuestion) return 'GAP_FOUND';
  if (snapshot.activeGuide?.owned) return 'USING_GUIDE';
  if (snapshot.recommendationsShown || snapshot.activeGuide) {
    return 'DECIDING_PURCHASE';
  }
  return snapshot.hasAgentTurn ? 'FINDING_GUIDANCE' : 'GOAL';
}

/** Pure: the plain-language next step for the status rail, independent of AI. */
export function nextStepFor(
  stage: StewardStage,
  snapshot: StewardSnapshot,
): string {
  const request = snapshot.activeRequest;
  const guide = snapshot.activeGuide;
  switch (stage) {
    case 'GOAL':
      return 'Tell the steward what you are trying to figure out.';
    case 'FINDING_GUIDANCE':
      return 'Ask the steward to find guidance for your goal.';
    case 'DECIDING_PURCHASE':
      return guide
        ? `Decide whether to buy “${guide.title}” for ${formatUsd(guide.priceCents)}. Nothing is bought without your approval.`
        : 'Look through the suggested guides and decide whether any fits.';
    case 'USING_GUIDE':
      return 'Ask the steward how the guide applies to your situation.';
    case 'GAP_FOUND':
      return 'The guide does not cover your question. Decide whether you want a personal answer.';
    case 'REQUEST_DRAFT':
      return `Review the drafted request to ${request!.contributorName}, choose what to share, then send it if you want to.`;
    case 'AWAITING_ACCEPTANCE':
      return `Waiting for ${request!.contributorName} to accept or decline.`;
    case 'AWAITING_PAYMENT':
      return `${request!.contributorName} accepted. Approve the ${formatUsd(request!.priceCents)} payment to confirm.`;
    case 'AWAITING_DELIVERY':
      return request!.state === 'OVERDUE'
        ? `${request!.contributorName} is late. You can wait or get a refund.`
        : `Waiting for ${request!.contributorName} to deliver.`;
    case 'APPLYING_RESPONSE':
      return 'Ask the steward to turn the answer into next steps.';
    case 'DONE':
      return 'Review your plan and leave feedback when you have tried it.';
    case 'ENDED':
      return 'This request ended without a charge or was refunded. You can ask the steward for other options.';
  }
}

export interface LastSeen {
  guideId?: string;
  guideOwned?: boolean;
  requestId?: string;
  requestState?: RequestState;
}

export type CardType =
  | 'guide_picks'
  | 'guide_checkout'
  | 'guide_answer'
  | 'human_help_offer'
  | 'people_picks'
  | 'agent_exchange'
  | 'request_draft'
  | 'request_checkout'
  | 'response_ready'
  | 'plan';

export interface StewardUpdate {
  summary: string;
  card?: { type: CardType; data: Record<string, unknown> };
}

const when = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })
    : 'soon';

/**
 * Pure: turns what changed since the last sync into update events. Backend
 * processes (capture, webhooks, deadline jobs) make the changes; this only reports them.
 */
export function diffUpdates(
  previous: LastSeen,
  snapshot: StewardSnapshot,
): { updates: StewardUpdate[]; lastSeen: LastSeen } {
  const updates: StewardUpdate[] = [];
  const guide = snapshot.activeGuide;
  const request = snapshot.activeRequest;

  // Only a change from not owned to owned on the same guide is a new purchase.
  if (
    guide &&
    guide.owned &&
    previous.guideId === guide.id &&
    previous.guideOwned === false
  ) {
    updates.push({
      summary: `PayPal confirmed your purchase of “${guide.title}”. It is in your library.${guide.agentAssistAllowed ? ' Ask me how it applies to you.' : ' Its author does not allow AI to read it, so I cannot answer questions about it, but you can read it in full.'}`,
    });
  }

  if (
    request &&
    !(
      previous.requestId === request.id &&
      previous.requestState === request.state
    )
  ) {
    const name = request.contributorName;
    const price = formatUsd(request.priceCents);
    const firstSight = previous.requestId !== request.id;
    // Payment and delivery can both land between two looks; the payment is still announced.
    if (
      !firstSight &&
      previous.requestState &&
      UNPAID_STATES.includes(previous.requestState) &&
      PAID_LATER_STATES.includes(request.state)
    ) {
      updates.push({ summary: `PayPal confirmed your ${price} payment.` });
    }
    switch (request.state) {
      case 'SENT':
        updates.push({
          summary: `Request sent to ${name}. They have until ${when(request.acceptBy)} to accept. You are not charged unless they accept and you approve payment.`,
        });
        break;
      case 'ACCEPTED':
        updates.push({
          summary: `${name} accepted your request. Approve the ${price} payment by ${when(request.payBy)} to confirm.`,
          card: {
            type: 'request_checkout',
            data: {
              requestId: request.id,
              priceCents: request.priceCents,
              payBy: request.payBy,
              contributorName: name,
            },
          },
        });
        break;
      case 'PAID':
        updates.push({
          summary: `PayPal confirmed your ${price} payment. ${name} will deliver by ${when(request.deliverBy)}.`,
        });
        break;
      case 'OVERDUE':
        updates.push({
          summary: `${name} has not delivered on time. You can keep waiting, or get a full refund from the request page.`,
        });
        break;
      case 'DELIVERED':
        updates.push({
          summary: `${name} delivered a personal answer.${request.responseAiAllowed ? ' Want me to turn it into next steps for you?' : ' They asked that AI not use it, so read it on the request page.'}`,
          card: {
            type: 'response_ready',
            data: {
              requestId: request.id,
              contributorName: name,
              aiAllowed: request.responseAiAllowed,
            },
          },
        });
        break;
      case 'DECLINED':
        updates.push({
          summary: `${name} declined the request. You were not charged.`,
        });
        break;
      case 'EXPIRED':
        updates.push({
          summary: `${name} did not answer in time. You were not charged.`,
        });
        break;
      case 'PAYMENT_EXPIRED':
        updates.push({
          summary: 'The payment window closed. You were not charged.',
        });
        break;
      case 'CANCELLED':
        updates.push({
          summary: 'You cancelled the request. You were not charged.',
        });
        break;
      case 'REFUNDED':
      case 'RESOLVED_REFUNDED':
        updates.push({
          summary: `Your ${price} payment was refunded through PayPal.`,
        });
        break;
      default:
        if (!firstSight) {
          updates.push({
            summary: `Request status: ${request.state.toLowerCase().replace('_', ' ')}.`,
          });
        }
    }
  }

  return {
    updates,
    lastSeen: {
      guideId: guide?.id,
      guideOwned: guide?.owned ?? false,
      requestId: request?.id,
      requestState: request?.state,
    },
  };
}
