import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from 'src/common/types/authenticated-request.type';

/** Requires a contributor profile. Runs after AuthGuard. Approval is checked where it matters (publishing, selling). */
@Injectable()
export class ContributorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().authenticatedUser;
    if (!user?.contributorId) {
      throw new ForbiddenException({
        error: 'contributor_required',
        message: 'Set up your contributor profile first.',
      });
    }
    return true;
  }
}
