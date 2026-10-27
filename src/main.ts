import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { env } from './config/env';
import { setupSwagger } from './swagger.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // PayPal webhook verification posts the event back exactly as received.
    rawBody: true,
  });
  configureApp(app);
  setupSwagger(app);
  app.enableShutdownHooks();
  await app.listen(env.PORT, '0.0.0.0');
  new Logger('Bootstrap').log(
    `EnrichMINT API listening on :${env.PORT} (${env.ENVIRONMENT}, PayPal ${env.PAYPAL_ENV})`,
  );
}

void bootstrap();
