/* Runs the grounded-answer and guide-draft prompts against the real model and scores them. Usage: yarn eval:agents [--verbose] [case-id ...] */
import { Logger } from '@nestjs/common';
import {
  ANSWER_SYSTEM,
  PROMPT_VERSION as ANSWER_PROMPT_VERSION,
} from 'src/assistant/constants/assistant.constants';
import { sourcesPrompt } from 'src/assistant/grounding.service';
import { answerSchema } from 'src/assistant/schemas/answer.schema';
import { buildAnswerInput } from 'src/assistant/utils/answer-input.util';
import {
  DRAFT_SYSTEM,
  PROMPT_VERSION as DRAFT_PROMPT_VERSION,
} from 'src/interviews/constants/interview.constants';
import { draftSchema } from 'src/interviews/schemas/interview-ai.schema';
import {
  buildDraftInput,
  normalizeDraft,
} from 'src/interviews/utils/draft.util';
import {
  ModelTier,
  ModelUnavailableError,
  OpenAiAdapter,
} from 'src/models/openai.adapter';
import { ANSWER_CASES, AnswerCase } from './cases/answer.cases';
import { DRAFT_CASES, DraftCase } from './cases/draft.cases';
import { CheckResult, checkAnswer, checkDraft } from './utils/eval-checks.util';

const logger = new Logger('AgentEval');
const CONCURRENCY = 3;
// Prints the quotes the server rejected, to tune the prompt. Fixture text only, never user data.
const VERBOSE = process.argv.includes('--verbose');

interface Outcome extends CheckResult {
  id: string;
  kind: string;
  costUsd: number;
}

async function main(): Promise<void> {
  const adapter = OpenAiAdapter.fromEnv();
  if (!adapter.isConfigured) {
    logger.error('Set OPENAI_API_KEY to run the agent evals.');
    process.exitCode = 2;
    return;
  }
  const only = new Set(
    process.argv.slice(2).filter((arg) => !arg.startsWith('--')),
  );
  const pick = <T extends { id: string }>(cases: T[]) =>
    only.size ? cases.filter((item) => only.has(item.id)) : cases;

  const jobs = [
    ...pick(ANSWER_CASES).map((item) => () => runAnswer(adapter, item)),
    ...pick(DRAFT_CASES).map((item) => () => runDraft(adapter, item)),
  ];
  logger.log(
    `Running ${jobs.length} cases (${ANSWER_PROMPT_VERSION.answer}, ${DRAFT_PROMPT_VERSION.draft}) on ${adapter.modelFor('generate')}.`,
  );

  const outcomes = await runPool(jobs, CONCURRENCY);
  for (const outcome of outcomes) {
    const line = `${outcome.pass ? 'PASS' : 'FAIL'}  ${outcome.kind.padEnd(11)} ${outcome.id}${outcome.notes.length ? `: ${outcome.notes.join('; ')}` : ''}`;
    if (outcome.pass) logger.log(line);
    else logger.error(line);
  }
  const passed = outcomes.filter((outcome) => outcome.pass).length;
  const cost = outcomes.reduce((sum, outcome) => sum + outcome.costUsd, 0);
  logger.log(
    `${passed}/${outcomes.length} passed. Cost about $${cost.toFixed(3)}.`,
  );
  if (passed < outcomes.length) process.exitCode = 1;
}

async function runAnswer(
  adapter: OpenAiAdapter,
  item: AnswerCase,
): Promise<Outcome> {
  return withModel(item.id, item.kind, adapter, 'generate', async () => {
    const result = await adapter.complete({
      tier: 'generate',
      system: ANSWER_SYSTEM,
      input: buildAnswerInput({
        guideTitle: item.guide.title,
        contributorName: item.guide.contributorName,
        sourcesPrompt: sourcesPrompt(item.guide.sources),
        situation: item.situation,
        question: item.question,
      }),
      schema: answerSchema,
      schemaName: 'grounded_answer',
      maxOutputTokens: 3000,
    });
    const check = checkAnswer(result.parsed, item.guide.sources, item.expect);
    if (VERBOSE) {
      check.blocks.forEach((block, index) => {
        if (block.unverified) {
          const raw = result.parsed.blocks[index];
          logger.warn(
            `${item.id} rejected [${raw.sourceIds.join(',')}]: "${raw.quote ?? ''}"`,
          );
        }
      });
      if (!check.pass) {
        for (const block of check.blocks) {
          logger.warn(`${item.id} ${block.type}: ${block.text}`);
        }
        logger.warn(`${item.id} gap: ${result.parsed.gap.question ?? 'none'}`);
      }
    }
    return { result, check };
  });
}

async function runDraft(
  adapter: OpenAiAdapter,
  item: DraftCase,
): Promise<Outcome> {
  return withModel(item.id, 'draft', adapter, 'generate', async () => {
    const result = await adapter.complete({
      tier: 'generate',
      system: DRAFT_SYSTEM,
      input: buildDraftInput(item.background, item.answers),
      schema: draftSchema,
      schemaName: 'guide_draft',
      maxOutputTokens: 6000,
    });
    const draft = normalizeDraft(result.parsed, item.answers, item.background);
    const sourceText = `${item.answers.map((answer) => answer.answer).join(' ')} ${item.background}`;
    const check = checkDraft(draft, sourceText, item.expect);
    if (VERBOSE && !check.pass) {
      for (const section of draft.sections) {
        logger.warn(`${item.id} ${section.key}: ${section.body || '(empty)'}`);
      }
    }
    return { result, check };
  });
}

async function withModel(
  id: string,
  kind: string,
  adapter: OpenAiAdapter,
  tier: ModelTier,
  run: () => Promise<{
    result: { inputTokens: number; outputTokens: number };
    check: CheckResult;
  }>,
): Promise<Outcome> {
  try {
    const { result, check } = await run();
    return {
      id,
      kind,
      ...check,
      costUsd: adapter.costUsd(tier, result.inputTokens, result.outputTokens),
    };
  } catch (error) {
    if (!(error instanceof ModelUnavailableError)) throw error;
    return {
      id,
      kind,
      pass: false,
      notes: [`model unavailable (${error.reason})`],
      costUsd: 0,
    };
  }
}

async function runPool<T>(
  jobs: (() => Promise<T>)[],
  size: number,
): Promise<T[]> {
  const results: T[] = new Array<T>(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++;
      results[index] = await jobs[index]();
    }
  };
  await Promise.all(Array.from({ length: size }, worker));
  return results;
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : 'Eval run failed.');
  process.exitCode = 1;
});
