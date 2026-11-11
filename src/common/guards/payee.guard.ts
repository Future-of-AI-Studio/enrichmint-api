import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from 'src/common/types/authenticated-request.type';

/** Requires any profile that can be paid, including a field note author (EARNER). Runs after AuthGuard. */
@Injectable()
export class PayeeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().authenticatedUser;
    if (!user?.contributorId) {
      throw new ForbiddenException({
        error: 'payee_required',
        message: 'You have no earnings yet.',
      });
    }
    return true;
  }
}
