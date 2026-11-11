import { Global, Module } from '@nestjs/common';
import { ZapierService } from './zapier.service';

@Global()
@Module({
  providers: [ZapierService],
  exports: [ZapierService],
})
export class ZapierModule {}
