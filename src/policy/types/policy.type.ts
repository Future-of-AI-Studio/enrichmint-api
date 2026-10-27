import type { PolicyOutcome, PolicySource } from 'generated/prisma/client';

export interface PolicyResult {
  outcome: PolicyOutcome;
  /** Plain-language reasons shown to the person affected. */
  reasons: string[];
  source: PolicySource;
}

export type PaidAction = 'purchase_guide' | 'send_request' | 'pay_request';

/** Facts the calling service gathered from the database. Policy never trusts the client for these. */
export interface PaidActionInput {
  subjectRef: string;
  action: PaidAction;
  amountCents: number;
  /** Null when the purchase is not tied to a goal (direct browsing has no budget). */
  remainingBudgetCents: number | null;
  approvedByUser: boolean;
  counterpartyAvailable: boolean;
  isOwnOffering: boolean;
}

export interface GoalInput {
  subjectRef: string;
  goalText: string;
  budgetCents: number;
}

export interface ResponseInput {
  kind: 'assistant_answer' | 'contributor_response';
  text: string;
}

/**
 * The boundary an external policy service (HCAI) plugs into. Local rules
 * always run first and are final for hard rules; an external adapter may add
 * a WARN or DENY but can never allow what local rules deny.
 */
export interface PolicyPort {
  evaluateGoal(input: GoalInput): Promise<PolicyResult>;
  authorizeAction(input: PaidActionInput): Promise<PolicyResult>;
  evaluateResponse(input: ResponseInput): Promise<PolicyResult>;
}
