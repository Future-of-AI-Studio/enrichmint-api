import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Global per-IP rate limit. Only changes the 429 body to the API error contract. */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected throwThrottlingException(): Promise<void> {
    throw new HttpException(
      {
        error: 'rate_limited',
        message: 'Too many requests. Wait a minute and try again.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
