import { Module } from '@nestjs/common';
import { OrdersModule } from 'src/orders/orders.module';
import { PayoutsModule } from 'src/payouts/payouts.module';
import { RequestsController } from './requests.controller';
import { RequestsJobs } from './requests.jobs';
import { RequestsService } from './requests.service';

@Module({
  imports: [OrdersModule, PayoutsModule],
  controllers: [RequestsController],
  providers: [RequestsService, RequestsJobs],
  exports: [RequestsService],
})
export class RequestsModule {}
