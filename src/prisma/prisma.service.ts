import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { env, isProduction } from 'src/config/env';
import { PrismaClient } from '../../generated/prisma/client';

/** Client type for interactive transactions: `$transaction(async (tx: TransactionClient) => ...)`. */
export type TransactionClient = Parameters<
  Parameters<PrismaService['$transaction']>[0]
>[0];

type PrismaLogEvent = { duration?: number; query?: string; message?: string };

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor() {
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    super({
      adapter: new PrismaPg(pool),
      log: [
        { level: 'query', emit: 'event' },
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
    });

    const on = this.$on.bind(this) as unknown as (
      event: 'query' | 'warn' | 'error',
      handler: (event: PrismaLogEvent) => void,
    ) => void;
    this.pool = pool;

    // Query text only outside production; params are never logged (they carry personal data).
    if (!isProduction) {
      on('query', (event) =>
        this.logger.verbose(`DB ${event.duration ?? 0}ms ${event.query ?? ''}`),
      );
    }
    on('warn', (event) =>
      this.logger.warn(`DB warning: ${event.message ?? ''}`),
    );
    on('error', (event) =>
      this.logger.error(`DB error: ${event.message ?? ''}`),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    await this.pool.end().catch(() => undefined);
  }
}
