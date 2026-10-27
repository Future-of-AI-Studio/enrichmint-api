import { formatUsd } from 'src/common/utils/money.util';
import type {
  GoalInput,
  PaidActionInput,
  PolicyPort,
  PolicyResult,
  ResponseInput,
} from './types/policy.type';

const allow = (): PolicyResult => ({
  outcome: 'ALLOW',
  reasons: [],
  source: 'LOCAL',
});

const deny = (...reasons: string[]): PolicyResult => ({
  outcome: 'DENY',
  reasons,
  source: 'LOCAL',
});

/** Phrases that suggest a guarantee of outcomes the platform cannot promise. */
const GUARANTEE_PATTERN =
  /\b(guarantee[ds]?|100% (success|results)|risk[- ]free income|you will definitely)\b/i;

/** Deterministic rules that make EnrichMINT safe to run without any external policy service. */
export class LocalPolicyAdapter implements PolicyPort {
  evaluateGoal(input: GoalInput): Promise<PolicyResult> {
    if (input.budgetCents < 0) {
      return Promise.resolve(deny('A budget cannot be negative.'));
    }
    return Promise.resolve(allow());
  }

  authorizeAction(input: PaidActionInput): Promise<PolicyResult> {
    const reasons: string[] = [];
    if (!input.approvedByUser) {
      reasons.push('Every payment and request needs your explicit approval.');
    }
    if (input.isOwnOffering) {
      reasons.push('You cannot buy your own guide or request your own advice.');
    }
    if (!input.counterpartyAvailable) {
      reasons.push(
        'This contributor is not taking this kind of request right now.',
      );
    }
    if (
      input.remainingBudgetCents !== null &&
      input.amountCents > input.remainingBudgetCents
    ) {
      reasons.push(
        `This would exceed your budget: it costs ${formatUsd(input.amountCents)} and you have ${formatUsd(Math.max(0, input.remainingBudgetCents))} left.`,
      );
    }
    return Promise.resolve(reasons.length ? deny(...reasons) : allow());
  }

  evaluateResponse(input: ResponseInput): Promise<PolicyResult> {
    if (GUARANTEE_PATTERN.test(input.text)) {
      return Promise.resolve({
        outcome: 'WARN',
        reasons: [
          'This text sounds like a guarantee. Experience shared here is not a promise of results.',
        ],
        source: 'LOCAL',
      });
    }
    return Promise.resolve(allow());
  }
}
