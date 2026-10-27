import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from 'src/common/types/authenticated-request.type';
import { AuthGuard, extractToken } from './auth.guard';

/** Like AuthGuard, but lets anonymous callers through (public pages that show "owned" when signed in). */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly authGuard: AuthGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!extractToken(request)) return true;
    try {
      await this.authGuard.canActivate(context);
    } catch {
      request.authenticatedUser = undefined;
    }
    return true;
  }
}
