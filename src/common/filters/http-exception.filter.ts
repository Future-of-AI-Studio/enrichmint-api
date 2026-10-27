import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

export interface ErrorBody {
  statusCode: number;
  message: string;
  error: string;
  [key: string]: unknown;
}

/** Machine-readable error codes are snake_case, e.g. `budget_exceeded`. */
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * The error body contract `{ statusCode, message, error }`:
 * - `throw new NotFoundException('Guide not found.')` puts the sentence in both fields.
 * - `throw new ConflictException({ error: 'budget_exceeded', message })` passes the code through.
 * - Anything else is a logged 500 whose text never leaks.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    response.status(body.statusCode).json(body);
  }

  toBody(exception: unknown): ErrorBody {
    if (!(exception instanceof HttpException)) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error.',
        error: 'Internal server error.',
      };
    }

    const statusCode = exception.getStatus();
    const raw = exception.getResponse();
    if (typeof raw === 'string') {
      return { statusCode, message: raw, error: raw };
    }

    const payload = raw as Record<string, unknown>;
    const message = Array.isArray(payload.message)
      ? payload.message.join('; ')
      : typeof payload.message === 'string'
        ? payload.message
        : undefined;
    const code =
      typeof payload.error === 'string' &&
      ERROR_CODE_PATTERN.test(payload.error)
        ? payload.error
        : undefined;

    if (code) {
      return { ...payload, statusCode, error: code, message: message ?? code };
    }
    const sentence = message ?? exception.message;
    return { ...payload, statusCode, message: sentence, error: sentence };
  }
}
