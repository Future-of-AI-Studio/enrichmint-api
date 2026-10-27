import { INTERVIEW_QUESTIONS } from 'src/interviews/constants/interview.constants';
import {
  createTestApp,
  makeContributorWithGuide,
  resetDatabase,
  TestContext,
} from './utils/test-app';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Interviews', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.ai.reset();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('asks at most three AI follow-ups, even when the model wants one for every answer', async () => {
    const { user } = await makeContributorWithGuide(ctx);
    ctx.ai.isConfigured = true;
    ctx.ai.completions = INTERVIEW_QUESTIONS.map(() => ({
      followUp: 'Can you give one example?',
    }));
    const started = await ctx
      .http()
      .post('/api/interviews')
      .set(auth(user.token))
      .expect(201);

    let view = started.body as {
      id: string;
      answers: { followUp?: unknown }[];
    };
    for (const question of INTERVIEW_QUESTIONS) {
      const response = await ctx
        .http()
        .post(`/api/interviews/${view.id}/answers`)
        .set(auth(user.token))
        .send({ key: question.key, answer: `My answer about ${question.key}.` })
        .expect(201);
      view = response.body as typeof view;
    }

    expect(view.answers).toHaveLength(INTERVIEW_QUESTIONS.length);
    expect(view.answers.filter((answer) => answer.followUp)).toHaveLength(3);
    // The model was only consulted while follow-ups were still allowed.
    expect(ctx.ai.seenInputs).toHaveLength(3);
  });
});
