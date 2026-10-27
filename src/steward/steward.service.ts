import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GoalsService } from 'src/goals/goals.service';
import { PrismaService } from 'src/prisma/prisma.service';
import type { StartSessionDto } from './dto/steward.dto';
import { StewardStateService } from './steward-state.service';

const EVENT_SELECT = {
  id: true,
  kind: true,
  tool: true,
  summary: true,
  payload: true,
  createdAt: true,
} as const;

@Injectable()
export class StewardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly goals: GoalsService,
    private readonly state: StewardStateService,
  ) {}

  /** One session per goal: starting again on the same goal reopens it. */
  async start(userId: string, dto: StartSessionDto) {
    let goalId = dto.goalId;
    if (!goalId) {
      if (!dto.text || dto.budgetCents === undefined) {
        throw new BadRequestException(
          'Send a goalId, or a goal text and a budget.',
        );
      }
      goalId = (
        await this.goals.create(
          userId,
          { text: dto.text, budgetCents: dto.budgetCents },
          { clarify: false },
        )
      ).id;
    } else {
      await this.goals.own(userId, goalId);
    }
    const existing = await this.prisma.stewardSession.findFirst({
      where: { userId, goalId },
    });
    const session =
      existing ??
      (await this.prisma.stewardSession.create({
        data: { userId, goalId },
      }));
    return this.view(userId, session.id);
  }

  list(userId: string) {
    return this.prisma.stewardSession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        stage: true,
        updatedAt: true,
        goal: { select: { id: true, text: true, budgetCents: true } },
      },
    });
  }

  /** Syncs first, so changes made by payments, webhooks and deadlines appear. */
  async view(userId: string, sessionId: string) {
    const session = await this.prisma.stewardSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) throw new NotFoundException('Conversation not found.');
    const status = await this.state.sync(session.id);
    const [events, fresh] = await Promise.all([
      this.prisma.stewardEvent.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
        take: 300,
        select: EVENT_SELECT,
      }),
      this.prisma.stewardSession.findUniqueOrThrow({
        where: { id: sessionId },
      }),
    ]);
    return {
      id: session.id,
      goalId: session.goalId,
      stage: status.stage,
      nextStep: status.nextStep,
      snapshot: status.snapshot,
      busy: Boolean(fresh.turnStartedAt),
      events,
    };
  }
}
