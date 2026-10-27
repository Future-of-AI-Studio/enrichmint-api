import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from 'generated/prisma/client';
import { ROLES_KEY } from 'src/common/decorators/access.decorators';
import type { AuthenticatedRequest } from 'src/common/types/authenticated-request.type';

/** Enforces `@Roles(...)`. Runs after AuthGuard; no metadata means no restriction. */
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles || roles.length === 0) return true;

    const user = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().authenticatedUser;
    if (!user) throw new UnauthorizedException('Unauthorized');
    if (!roles.includes(user.role)) {
      throw new ForbiddenException({
        error: 'role_required',
        message: 'You do not have permission to do this.',
      });
    }
    return true;
  }
}
