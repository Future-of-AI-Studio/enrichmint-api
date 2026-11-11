import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { env } from 'src/config/env';
import { DEFAULT_THROTTLE } from 'src/common/constants/rate-limit.constants';
import { RateLimitGuard } from 'src/common/guards/rate-limit.guard';
import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AssistantModule } from './assistant/assistant.module';
import { FeedbackModule } from './feedback/feedback.module';
import { FieldNotesModule } from './field-notes/field-notes.module';
import { GoalsModule } from './goals/goals.module';
import { InterviewsModule } from './interviews/interviews.module';
import { RequestsModule } from './requests/requests.module';
import { StewardModule } from './steward/steward.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { ContributorsModule } from './contributors/contributors.module';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { GuidesModule } from './guides/guides.module';
import { LedgerModule } from './ledger/ledger.module';
import { ModelsModule } from './models/models.module';
import { OrdersModule } from './orders/orders.module';
import { PaypalModule } from './paypal/paypal.module';
import { PayoutsModule } from './payouts/payouts.module';
import { PolicyModule } from './policy/policy.module';
import { PrismaModule } from './prisma/prisma.module';
import { RefundsModule } from './refunds/refunds.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ZapierModule } from './zapier/zapier.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [DEFAULT_THROTTLE],
      skipIf: () => !env.RATE_LIMIT_ENABLED,
    }),
    PrismaModule,
    AuditModule,
    AuthModule,
    ModelsModule,
    PolicyModule,
    PaypalModule,
    LedgerModule,
    EntitlementsModule,
    CategoriesModule,
    ContributorsModule,
    GuidesModule,
    OrdersModule,
    RefundsModule,
    PayoutsModule,
    WebhooksModule,
    InterviewsModule,
    GoalsModule,
    AssistantModule,
    RequestsModule,
    FeedbackModule,
    AdminModule,
    StewardModule,
    FieldNotesModule,
    ZapierModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class AppModule {}
