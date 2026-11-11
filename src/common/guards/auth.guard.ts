import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AUTH_COOKIE_NAME } from 'src/common/constants/auth.constants';
import type {
  AuthenticatedRequest,
  AuthTokenPayload,
} from 'src/common/types/authenticated-request.type';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Verifies the session JWT (Bearer header first, then the httpOnly cookie) and
 * re-reads the user, so deactivation and role changes apply immediately.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractToken(request);
    if (!token) throw new UnauthorizedException('Unauthorized');

    let payload: AuthTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AuthTokenPayload>(token);
    } catch {
      return this.deny(request, 'invalid_token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        sessionsRevokedAt: true,
        contributorProfile: { select: { id: true, status: true } },
      },
    });
    if (!user || !user.isActive) return this.deny(request, 'inactive_user');
    if (
      user.sessionsRevokedAt &&
      (payload.iat ?? 0) < Math.floor(user.sessionsRevokedAt.getTime() / 1000)
    ) {
      return this.deny(request, 'revoked_session');
    }

    request.authenticatedUser = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      contributorId: user.contributorProfile?.id ?? null,
      contributorApproved: user.contributorProfile?.status === 'APPROVED',
      contributorStatus: user.contributorProfile?.status ?? null,
    };
    return true;
  }

  /** Failed token checks log method, path and reason only, never the token. */
  private deny(request: AuthenticatedRequest, reason: string): never {
    this.logger.warn(`Denied ${request.method} ${request.path}: ${reason}.`);
    throw new UnauthorizedException('Unauthorized');
  }
}

export function extractToken(
  request: AuthenticatedRequest,
): string | undefined {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const cookie = cookies?.[AUTH_COOKIE_NAME];
  return typeof cookie === 'string' && cookie ? cookie : undefined;
}
