import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { env } from 'src/config/env';
import { AuditService } from 'src/audit/audit.service';
import { BCRYPT_ROUNDS } from 'src/common/constants/auth.constants';
import type { AuthTokenPayload } from 'src/common/types/authenticated-request.type';
import { isUniqueViolation } from 'src/common/utils/prisma-errors.util';
import { PrismaService } from 'src/prisma/prisma.service';
import type { LoginDto } from './dto/login.dto';
import type { SignUpDto } from './dto/sign-up.dto';

const INVALID_CREDENTIALS = 'Invalid email or password.';

export const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  isDemo: true,
  contributorProfile: {
    select: { id: true, status: true, headline: true },
  },
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Compared against when the email is unknown, so timing does not reveal which emails exist. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(dto: LoginDto) {
    const credentials = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, passwordHash: true, isActive: true },
    });
    const hash = credentials?.passwordHash ?? (await this.getDummyHash());
    const matches = await bcrypt.compare(dto.password, hash);
    if (!credentials || !matches || !credentials.isActive) {
      this.logger.warn('Failed login attempt.');
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    await this.audit.record({
      actorId: credentials.id,
      actorType: 'USER',
      action: 'auth.login',
      subjectType: 'user',
      subjectId: credentials.id,
    });
    return this.session(credentials.id);
  }

  async signUp(dto: SignUpDto) {
    if (!env.SIGNUP_ENABLED) {
      throw new ForbiddenException({
        error: 'signup_disabled',
        message: 'Sign-up is closed right now.',
      });
    }
    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          displayName: dto.displayName.trim(),
          passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
        },
        select: { id: true },
      });
      await this.audit.record({
        actorId: user.id,
        actorType: 'USER',
        action: 'auth.signup',
        subjectType: 'user',
        subjectId: user.id,
      });
      return this.session(user.id);
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Same answer as any other failure, so the message never confirms an account exists.
        throw new ConflictException({
          error: 'signup_failed',
          message:
            'We could not create an account with these details. If you already have one, sign in.',
        });
      }
      throw error;
    }
  }

  /** Revokes every session of the token owner (all devices). */
  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    try {
      const payload =
        await this.jwtService.verifyAsync<AuthTokenPayload>(token);
      await this.prisma.user.update({
        where: { id: payload.sub },
        data: { sessionsRevokedAt: new Date() },
      });
    } catch {
      // An invalid or expired token has nothing to revoke.
    }
  }

  me(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: PUBLIC_USER_SELECT,
    });
  }

  private async session(userId: string) {
    const payload: AuthTokenPayload = { sub: userId };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      expiresIn: env.JWT_TTL_SECONDS,
      user: await this.me(userId),
    };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= bcrypt.hash('enrichmint-dummy-password', BCRYPT_ROUNDS);
    return this.dummyHash;
  }
}
