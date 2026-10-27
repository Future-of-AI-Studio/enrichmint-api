import { Module } from '@nestjs/common';
import { EarningsController } from './earnings.controller';
import { PayoutsService } from './payouts.service';

@Module({
  controllers: [EarningsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
