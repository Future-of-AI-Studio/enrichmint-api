import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { env } from 'src/config/env';
import { PrismaService } from 'src/prisma/prisma.service';

@ApiTags('Health')
@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  @ApiOperation({
    summary:
      'Public: health check, plus which optional services are configured',
  })
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.error(`Health ping failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Database unavailable.');
    }
    return {
      status: 'ok',
      database: 'up',
      paypal: {
        environment: env.PAYPAL_ENV,
        configured: Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET),
        webhookConfigured: Boolean(env.PAYPAL_WEBHOOK_ID),
      },
      ai: { configured: Boolean(env.OPENAI_API_KEY) },
      hcai: { enabled: env.HCAI_ENABLED },
      timestamp: new Date().toISOString(),
    };
  }
}
