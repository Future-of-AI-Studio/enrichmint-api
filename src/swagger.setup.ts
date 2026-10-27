import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { env, isProduction } from 'src/config/env';

export const DOCS_PATH = 'docs';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Basic auth in front of /docs in production; 503 when no password is configured. */
function swaggerBasicAuth(req: Request, res: Response, next: NextFunction) {
  const isDocs =
    req.path === `/${DOCS_PATH}` || req.path.startsWith(`/${DOCS_PATH}`);
  if (!isProduction || !isDocs) return next();
  if (!env.SWAGGER_PASSWORD) {
    res.status(503).send('Swagger is disabled: SWAGGER_PASSWORD is not set.');
    return;
  }
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Basic ')) {
    const [user, ...rest] = Buffer.from(header.slice(6), 'base64')
      .toString('utf8')
      .split(':');
    if (
      safeEqual(user, env.SWAGGER_USERNAME) &&
      safeEqual(rest.join(':'), env.SWAGGER_PASSWORD)
    ) {
      return next();
    }
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Swagger"');
  res.status(401).send('Authentication required');
}

export function setupSwagger(app: NestExpressApplication): void {
  app.use(swaggerBasicAuth);
  const config = new DocumentBuilder()
    .setTitle('EnrichMINT API')
    .setDescription(
      'Helps people earn from their real-life experience, while helping others learn from it.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .build();
  SwaggerModule.setup(DOCS_PATH, app, () =>
    SwaggerModule.createDocument(app, config),
  );
}
