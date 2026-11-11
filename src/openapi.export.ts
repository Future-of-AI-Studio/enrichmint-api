import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { buildOpenApiDocument } from './swagger.setup';

const OUTPUT = resolve(process.cwd(), 'postman/openapi.json');

/** Writes the OpenAPI document to a file Postman can import. Preview mode, so no database is needed. */
async function main(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    preview: true,
    logger: false,
  });
  configureApp(app);
  const document = buildOpenApiDocument(app);
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(document, null, 2)}\n`);
  new Logger('OpenAPI').log(
    `Wrote ${Object.keys(document.paths).length} paths to postman/openapi.json`,
  );
  await app.close();
}

void main();
