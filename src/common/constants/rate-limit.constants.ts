import { env } from 'src/config/env';

const MINUTE_MS = 60_000;

export const DEFAULT_THROTTLE = {
  name: 'default',
  ttl: MINUTE_MS,
  limit: env.RATE_LIMIT_PER_MINUTE,
};

/** `@Throttle(AUTH_THROTTLE)` on sign-in and sign-up: slows password guessing. */
export const AUTH_THROTTLE = {
  default: { ttl: MINUTE_MS, limit: env.AUTH_RATE_LIMIT_PER_MINUTE },
};

/** `@Throttle(MODEL_THROTTLE)` on routes that start model work: caps cost abuse. */
export const MODEL_THROTTLE = {
  default: { ttl: MINUTE_MS, limit: env.MODEL_RATE_LIMIT_PER_MINUTE },
};
