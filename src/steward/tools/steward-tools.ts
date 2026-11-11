import { HttpException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { StewardSession } from 'generated/prisma/client';
import { AssistantService } from 'src/assistant/assistant.service';
import type { AuthenticatedUser } from 'src/common/types/authenticated-request.type';
import { formatUsd } from 'src/common/utils/money.util';
import { wrapUntrusted } from 'src/common/utils/prompt.util';
import { DiscoveryService } from 'src/goals/discovery.service';
import { PeopleService } from 'src/goals/people.service';
import { GuidesService, PUBLIC_GUIDE_SELECT } from 'src/guides/guides.service';
import type { ToolSpec } from 'src/models/openai.adapter';
import { PolicyService } from 'src/policy/policy.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { RequestsService } from 'src/requests/requests.service';
import type { CardType } from '../utils/stage.util';
import { StewardStateService } from '../steward-state.service';

export interface ToolContext {
  user: AuthenticatedUser;
  session: StewardSession;
}

export interface ToolResult {
  /** JSON-serialisable result sent back to the model. */
  output: unknown;
  /** Plain-language line shown to the learner for this step. */
  summary: string;
  card?: { type: CardType; data: Record<string, unknown> };
  sessionPatch?: { activeGuideId?: string; activeRequestId?: string };
}

const idArg = z.string().min(1).max(40);
const questionArg = z.string().min(3).max(1000);

const ARGS = {
  get_status: z.object({}),
  // An empty string means "search by the goal alone".
  find_guides: z.object({
    query: z
      .string()
      .max(300)
      .nullish()
      .transform((value) => value ?? ''),
  }),
  get_guide_preview: z.object({ guideId: idArg }),
  ask_guide: z.object({ guideId: idArg, question: questionArg }),
  check_contributor: z.object({ guideId: idArg, question: questionArg }),
  find_people: z.object({
    query: z
      .string()
      .max(300)
      .nullish()
      .transform((value) => value ?? ''),
  }),
  // Exactly one target; a missing one becomes '' so every tool's args stay plain strings.
  draft_request: z
    .object({
      guideId: z
        .string()
        .max(40)
        .nullish()
        .transform((value) => value ?? ''),
      contributorId: z
        .string()
        .max(40)
        .nullish()
        .transform((value) => value ?? ''),
      question: questionArg,
    })
    .refine((args) => Boolean(args.guideId) !== Boolean(args.contributorId)),
  prepare_guide_checkout: z.object({ guideId: idArg }),
  prepare_request_checkout: z.object({ requestId: idArg }),
  apply_response: z.object({ requestId: idArg }),
} as const;

export type ToolName = keyof typeof ARGS;

const strictObject = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const guideIdProp = {
  type: 'string',
  description: 'A guide id from a previous tool result.',
};
const questionProp = {
  type: 'string',
  description:
    'The learner question, in their words, without names or contact details.',
};

/**
 * What the model may call. None of these sends a request, pays, captures,
 * changes a budget or grants access: those stay with the learner and the backend.
 */
export const STEWARD_TOOL_SPECS: ToolSpec[] = [
  {
    name: 'get_status',
    description:
      'Current workflow facts: budget left, active guide and whether it is owned, active request and its deadlines.',
    parameters: strictObject({}),
  },
  {
    name: 'find_guides',
    description:
      'Search published guides for the learner goal. Returns up to 3 explained picks, or none if nothing fits. Previews only.',
    parameters: strictObject({
      query: {
        type: ['string', 'null'],
        description:
          'What the learner is looking for right now, in a few words (e.g. a guide title or topic they named). Null to search by the goal alone.',
      },
    }),
  },
  {
    name: 'get_guide_preview',
    description:
      'Free preview, audience, limitations, price and whether AI assistance is allowed for one guide.',
    parameters: strictObject({ guideId: guideIdProp }),
  },
  {
    name: 'ask_guide',
    description:
      'Ask a question grounded in a guide the learner already bought. Uses one of their included AI questions. Returns attributed blocks and whether there is a gap the guide cannot answer.',
    parameters: strictObject({ guideId: guideIdProp, question: questionProp }),
  },
  {
    name: 'check_contributor',
    description:
      'For a gap the guide cannot answer: is its author taking personal requests, at what price and deadlines, and does it fit the remaining budget.',
    parameters: strictObject({ guideId: guideIdProp, question: questionProp }),
  },
  {
    name: 'find_people',
    description:
      'Ask the network: find up to 3 real people whose own lived experience fits the learner goal and who take paid personal requests, with price and budget fit. Use when no guide fits or a guide cannot answer. Read-only.',
    parameters: strictObject({
      query: {
        type: ['string', 'null'],
        description:
          'What the learner needs help with right now, in a few words. Null to search by the goal alone.',
      },
    }),
  },
  {
    name: 'draft_request',
    description:
      'Draft a personal request to a guide author (pass guideId) or to a person from find_people (pass contributorId). Exactly one of the two. Creates a DRAFT only; the learner reviews, chooses what to share and sends it themselves.',
    parameters: strictObject({
      guideId: {
        type: ['string', 'null'],
        description: 'A guide id from a previous tool result, or null.',
      },
      contributorId: {
        type: ['string', 'null'],
        description: 'A person id from find_people, or null.',
      },
      question: questionProp,
    }),
  },
  {
    name: 'prepare_guide_checkout',
    description:
      'Show the learner a purchase card for a guide. Does not create an order or charge anything; the learner approves payment in PayPal.',
    parameters: strictObject({ guideId: guideIdProp }),
  },
  {
    name: 'prepare_request_checkout',
    description:
      'Show the learner a payment card for an accepted request. Does not charge anything.',
    parameters: strictObject({
      requestId: { type: 'string', description: 'The active request id.' },
    }),
  },
  {
    name: 'apply_response',
    description:
      'Turn a delivered personal answer into suggested next steps, if the contributor allowed AI use.',
    parameters: strictObject({
      requestId: { type: 'string', description: 'The active request id.' },
    }),
  },
];

const fail = (error: string, message: string): ToolResult => ({
  output: { ok: false, error, message },
  summary: message,
});

@Injectable()
export class StewardTools {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: StewardStateService,
    private readonly discovery: DiscoveryService,
    private readonly people: PeopleService,
    private readonly guides: GuidesService,
    private readonly assistant: AssistantService,
    private readonly requests: RequestsService,
    private readonly policy: PolicyService,
  ) {}

  /** Runs one tool call. Never throws: errors go back to the model as data. */
  async run(
    context: ToolContext,
    name: string,
    rawArgs: string,
  ): Promise<ToolResult> {
    if (!(name in ARGS)) {
      return fail(
        'unknown_tool',
        `There is no "${name}" action. I cannot send, pay or change budgets; the learner does that.`,
      );
    }
    const parsed = ARGS[name as ToolName].safeParse(safeJson(rawArgs));
    if (!parsed.success)
      return fail(
        'invalid_arguments',
        'That action was called with invalid arguments.',
      );
    try {
      return await this.dispatch(context, name as ToolName, parsed.data);
    } catch (error) {
      if (error instanceof HttpException) {
        const body = error.getResponse() as
          { error?: string; message?: string } | string;
        const code =
          typeof body === 'string' ? 'error' : (body.error ?? 'error');
        const message =
          typeof body === 'string' ? body : (body.message ?? error.message);
        return fail(code, message);
      }
      throw error;
    }
  }

  private async dispatch(
    context: ToolContext,
    name: ToolName,
    args: Record<string, string>,
  ): Promise<ToolResult> {
    const { user, session } = context;
    switch (name) {
      case 'get_status': {
        const snapshot = await this.state.snapshot(session);
        return {
          output: { ok: true, ...snapshot },
          summary: `Checked your status: ${formatUsd(snapshot.goal.remainingCents)} of budget left.`,
        };
      }

      case 'find_guides': {
        const result = await this.discovery.recommend(
          user.id,
          session.goalId,
          args.query,
        );
        const picks = result.recommendations.map((rec) => ({
          guideId: rec.guide.id,
          slug: rec.guide.slug,
          title: rec.guide.title,
          priceCents: rec.guide.priceCents,
          price: formatUsd(rec.guide.priceCents),
          contributorName: rec.guide.contributor.user.displayName,
          reason: rec.reason,
          caution: rec.caution,
          overBudget: rec.overBudget,
          owned: rec.owned,
          agentAssistAllowed: rec.guide.agentAssistAllowed,
          newContributor: rec.slot === 'NEW_CONTRIBUTOR',
        }));
        return {
          output: {
            ok: true,
            noneSuitable: result.noneSuitable,
            remainingBudget: formatUsd(result.remainingBudgetCents),
            picks,
          },
          summary: result.noneSuitable
            ? 'Searched guides: nothing fits well yet.'
            : `Searched guides: found ${picks.length} that may fit.`,
          card: {
            type: 'guide_picks',
            data: {
              message: result.message,
              aiUsed: result.aiUsed,
              remainingBudgetCents: result.remainingBudgetCents,
              picks,
            },
          },
        };
      }

      case 'get_guide_preview': {
        const guide = await this.publicGuide(args.guideId);
        if (!guide) return fail('not_found', 'That guide is not available.');
        return {
          output: {
            ok: true,
            guideId: guide.id,
            title: guide.title,
            price: formatUsd(guide.priceCents),
            contributor: guide.contributor.user.displayName,
            agentAssistAllowed: guide.agentAssistAllowed,
            untrusted_content: wrapUntrusted(
              'guide_preview',
              [
                guide.currentVersion?.preview,
                `For: ${guide.currentVersion?.audience}`,
                `Limitations: ${guide.currentVersion?.limitations}`,
              ].join('\n'),
            ),
          },
          summary: `Read the free preview of “${guide.title}”.`,
          sessionPatch: { activeGuideId: guide.id },
        };
      }

      case 'ask_guide': {
        const result = await this.assistant.ask(
          user.id,
          args.guideId,
          args.question,
          session.goalId,
        );
        const content = result.message.content as {
          blocks: {
            type: string;
            text: string;
            sourceIds: string[];
            quote: string | null;
          }[];
          gap: { question: string; reason: string | null } | null;
        };
        return {
          output: {
            ok: true,
            contributor: result.contributorName,
            questionsLeft: result.quota.limit - result.quota.used,
            gap: content.gap,
            untrusted_content: wrapUntrusted(
              'grounded_answer',
              content.blocks
                .map(
                  (block) =>
                    `[${block.type}${block.sourceIds.length ? ` ${block.sourceIds.join(',')}` : ''}] ${block.text}`,
                )
                .join('\n'),
            ),
          },
          summary: `Asked the guide (${result.quota.limit - result.quota.used} AI questions left).${content.gap ? ' It does not cover this.' : ''}`,
          card: {
            type: 'guide_answer',
            data: {
              guideId: args.guideId,
              contributorName: result.contributorName,
              blocks: content.blocks,
              gap: content.gap,
            },
          },
          sessionPatch: { activeGuideId: args.guideId },
        };
      }

      case 'check_contributor': {
        const guide = await this.publicGuide(args.guideId);
        if (!guide) return fail('not_found', 'That guide is not available.');
        const offer = await this.assistant.requestOffer(
          user.id,
          guide.contributor.id,
          session.goalId,
        );
        if (!offer.available) {
          return {
            output: {
              ok: true,
              available: false,
              contributor: offer.contributorName,
            },
            summary: `${offer.contributorName} is not taking personal requests right now.`,
          };
        }
        return {
          output: {
            ok: true,
            ...offer,
            price: formatUsd(offer.priceCents),
            remainingBudget:
              offer.remainingBudgetCents === null
                ? null
                : formatUsd(offer.remainingBudgetCents),
            question: args.question,
          },
          summary: `${offer.contributorName} takes personal requests for ${formatUsd(offer.priceCents)}; ${offer.withinBudget ? 'that fits your remaining budget' : 'that is over your remaining budget'}.`,
          card: {
            type: 'human_help_offer',
            data: { guideId: guide.id, question: args.question, ...offer },
          },
          sessionPatch: { activeGuideId: guide.id },
        };
      }

      case 'find_people': {
        const result = await this.people.find(
          user.id,
          session.goalId,
          args.query,
        );
        const people = result.people.map((person) => ({
          ...person,
          price: formatUsd(person.priceCents),
        }));
        return {
          output: {
            ok: true,
            remainingBudget: result.remainingBudget,
            noneFound: people.length === 0,
            people: people.map((person) => ({
              contributorId: person.contributorId,
              name: person.name,
              price: person.price,
              withinBudget: person.withinBudget,
              untrusted_content: wrapUntrusted(
                'person_match',
                `${person.headline}\nWhy: ${person.reason}`,
              ),
            })),
          },
          summary: people.length
            ? `Asked the network: found ${people.length} ${people.length === 1 ? 'person who has' : 'people who have'} lived this.`
            : 'Asked the network: no one with this experience yet.',
          card: {
            type: 'people_picks',
            data: {
              aiUsed: result.aiUsed,
              remainingBudgetCents: result.remainingBudgetCents,
              people,
            },
          },
        };
      }

      case 'draft_request': {
        const active = session.activeRequestId
          ? await this.prisma.personalRequest.findFirst({
              where: { id: session.activeRequestId, learnerId: user.id },
            })
          : null;
        if (
          active &&
          ![
            'DECLINED',
            'EXPIRED',
            'CANCELLED',
            'PAYMENT_EXPIRED',
            'REFUNDED',
            'RESOLVED_REFUNDED',
            'CLOSED',
            'RESOLVED_UPHELD',
          ].includes(active.state)
        ) {
          return fail(
            'request_in_progress',
            'There is already an open request in this conversation.',
          );
        }
        const draft = args.guideId
          ? await this.requests.draftFromGap(
              user,
              args.guideId,
              args.question,
              session.goalId,
            )
          : await this.requests.draftToPerson(
              user,
              args.contributorId,
              args.question,
              session.goalId,
            );
        const name = draft.contributor.user.displayName;
        return {
          output: {
            ok: true,
            requestId: draft.id,
            state: draft.state,
            price: formatUsd(draft.priceCents),
            contributor: name,
            sent: false,
          },
          summary: `Drafted a request to ${name}. Nothing has been sent.`,
          card: {
            type: 'request_draft',
            data: {
              requestId: draft.id,
              question: draft.question,
              desiredResponse: draft.desiredResponse,
              priceCents: draft.priceCents,
              contributorName: name,
              sharedCount: (
                draft.contextItems as unknown as { share: boolean }[]
              ).filter((item) => item.share).length,
            },
          },
          sessionPatch: { activeRequestId: draft.id },
        };
      }

      case 'prepare_guide_checkout': {
        const guide = await this.publicGuide(args.guideId);
        if (!guide) return fail('not_found', 'That guide is not available.');
        const snapshot = await this.state.snapshot(session);
        const owned = await this.prisma.entitlement.count({
          where: { userId: user.id, guideId: guide.id, status: 'ACTIVE' },
        });
        if (owned)
          return fail('already_owned', 'The learner already owns this guide.');
        const overBudget = guide.priceCents > snapshot.goal.remainingCents;
        if (overBudget) {
          // The budget rule stopped the agent, so the learner sees it in the stewardship log.
          await this.policy.note(
            {
              userId: user.id,
              check: 'checkout',
              subjectType: 'guide',
              subjectId: guide.id,
            },
            'DENY',
            `“${guide.title}” costs ${formatUsd(guide.priceCents)}, more than the ${formatUsd(snapshot.goal.remainingCents)} left in your budget, so the steward did not set up a payment. Only you can change the budget.`,
          );
        }
        return {
          output: {
            ok: true,
            prepared: !overBudget,
            charged: false,
            price: formatUsd(guide.priceCents),
            remainingBudget: formatUsd(snapshot.goal.remainingCents),
            overBudget,
          },
          summary: overBudget
            ? `“${guide.title}” (${formatUsd(guide.priceCents)}) is over your remaining budget of ${formatUsd(snapshot.goal.remainingCents)}. No payment was set up.`
            : `Prepared a purchase card for “${guide.title}” (${formatUsd(guide.priceCents)}). Nothing is charged until you approve.`,
          card: {
            type: 'guide_checkout',
            data: {
              guideId: guide.id,
              slug: guide.slug,
              title: guide.title,
              priceCents: guide.priceCents,
              remainingBudgetCents: snapshot.goal.remainingCents,
              overBudget,
              agentAssistAllowed: guide.agentAssistAllowed,
              contributorName: guide.contributor.user.displayName,
            },
          },
          sessionPatch: { activeGuideId: guide.id },
        };
      }

      case 'prepare_request_checkout': {
        const request = await this.prisma.personalRequest.findFirst({
          where: { id: args.requestId, learnerId: user.id },
          include: {
            contributor: {
              select: { user: { select: { displayName: true } } },
            },
          },
        });
        if (!request)
          return fail('not_found', 'That request is not available.');
        if (request.state !== 'ACCEPTED')
          return fail(
            'request_not_payable',
            `The request is ${request.state.toLowerCase()}, not waiting for payment.`,
          );
        return {
          output: {
            ok: true,
            prepared: true,
            charged: false,
            price: formatUsd(request.priceCents),
            payBy: request.payBy,
          },
          summary: `Prepared the ${formatUsd(request.priceCents)} payment card. Nothing is charged until you approve.`,
          card: {
            type: 'request_checkout',
            data: {
              requestId: request.id,
              priceCents: request.priceCents,
              payBy: request.payBy,
              contributorName: request.contributor.user.displayName,
            },
          },
        };
      }

      case 'apply_response': {
        const result = await this.assistant.applyResponse(
          user.id,
          args.requestId,
        );
        const blocks = (result.message.content as { blocks: unknown[] }).blocks;
        return {
          output: {
            ok: true,
            contributor: result.contributorName,
            untrusted_content: wrapUntrusted(
              'plan',
              (blocks as { type: string; text: string }[])
                .map((block) => `[${block.type}] ${block.text}`)
                .join('\n'),
            ),
          },
          summary: `Turned ${result.contributorName}’s answer into suggested steps for you to review.`,
          card: {
            type: 'plan',
            data: {
              requestId: args.requestId,
              contributorName: result.contributorName,
              blocks,
            },
          },
        };
      }
    }
  }

  private async publicGuide(guideId: string) {
    const row = await this.prisma.guide.findFirst({
      where: {
        id: guideId,
        status: 'PUBLISHED',
        currentVersionId: { not: null },
      },
      select: PUBLIC_GUIDE_SELECT,
    });
    if (!row) return null;
    const [view] = await this.guides.toPublic([row]);
    return view;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text || '{}') as unknown;
  } catch {
    return undefined;
  }
}
