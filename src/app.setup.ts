import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { env } from 'src/config/env';
import { HttpExceptionFilter } from 'src/common/filters/http-exception.filter';

export const API_PREFIX = 'api';

/** Global app configuration shared by main.ts and the e2e harness, so tests boot like production. */
export function configureApp(app: NestExpressApplication): void {
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.setGlobalPrefix(API_PREFIX);
  app.use(cookieParser());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith(`/${API_PREFIX}/`)) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });
}
