import { Module } from '@nestjs/common';
import { OrdersModule } from 'src/orders/orders.module';
import { PayoutsModule } from 'src/payouts/payouts.module';
import { RefundsModule } from 'src/refunds/refunds.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [OrdersModule, RefundsModule, PayoutsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
