import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { Prisma, TransitionActor } from 'generated/prisma/client';
import type { TransactionClient } from 'src/prisma/prisma.service';
import { RequestEvent, transition } from '../request-state';

/**
 * Applies one state-machine event inside a transaction. The update is
 * conditional on the state we read, so a concurrent move (say, an expiry job
 * racing an accept) makes one of them fail with 409 instead of both winning.
 */
export async function applyTransition(
  tx: TransactionClient,
  input: {
    requestId: string;
    event: RequestEvent;
    actor: TransitionActor;
    actorId?: string | null;
    reason?: string;
    data?: Prisma.PersonalRequestUpdateManyMutationInput;
  },
) {
  const request = await tx.personalRequest.findUniqueOrThrow({
    where: { id: input.requestId },
  });
  const result = transition(request.state, input.event, input.actor);
  if (!result.ok) {
    if (result.reason === 'actor_not_allowed') {
      throw new ForbiddenException({
        error: 'transition_not_allowed',
        message: 'You cannot make this change to the request.',
      });
    }
    throw new ConflictException({
      error: 'invalid_request_state',
      message: `This request is ${request.state.toLowerCase().replace('_', ' ')} and cannot be changed this way.`,
      state: request.state,
    });
  }

  const updated = await tx.personalRequest.updateMany({
    where: { id: request.id, state: request.state },
    data: { ...input.data, state: result.to },
  });
  if (updated.count === 0) {
    throw new ConflictException({
      error: 'request_changed',
      message: 'This request just changed. Refresh and try again.',
    });
  }
  await tx.requestTransition.create({
    data: {
      requestId: request.id,
      fromState: request.state,
      toState: result.to,
      actor: input.actor,
      actorId: input.actorId ?? null,
      reason: input.reason ?? null,
    },
  });
  return { ...request, state: result.to };
}
