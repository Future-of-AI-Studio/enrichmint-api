import { Global, Module } from '@nestjs/common';
import { PaypalService } from './paypal.service';

@Global()
@Module({
  providers: [PaypalService],
  exports: [PaypalService],
})
export class PaypalModule {}
