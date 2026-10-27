import type { Request } from 'express';
import type { UserRole } from 'generated/prisma/client';

/** Claims inside the session JWT. Never add roles or secrets. */
export interface AuthTokenPayload {
  sub: string;
  iat?: number;
  exp?: number;
}

/** The caller, re-read from the database by AuthGuard on every request. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  /** Set when the user has a contributor profile (any status). */
  contributorId: string | null;
  contributorApproved: boolean;
}

export interface AuthenticatedRequest extends Request {
  authenticatedUser?: AuthenticatedUser;
}
