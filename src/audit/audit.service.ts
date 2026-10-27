import { Injectable } from '@nestjs/common';
import type { ActorType, Prisma } from 'generated/prisma/client';
import { PrismaService, TransactionClient } from 'src/prisma/prisma.service';

export interface AuditInput {
  actorId?: string | null;
  actorType: ActorType;
  action: string;
  subjectType: string;
  subjectId?: string | null;
  details?: Prisma.InputJsonValue;
}

/** Append-only audit trail. Never put message content, tokens or full emails in details. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput, tx?: TransactionClient): Promise<void> {
    await (tx ?? this.prisma).auditEvent.create({
      data: {
        actorId: input.actorId ?? null,
        actorType: input.actorType,
        action: input.action,
        subjectType: input.subjectType,
        subjectId: input.subjectId ?? null,
        details: input.details ?? {},
      },
    });
  }
}
