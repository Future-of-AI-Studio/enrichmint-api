import { Module } from '@nestjs/common';
import { GuidesModule } from 'src/guides/guides.module';
import { DiscoveryService } from './discovery.service';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';

@Module({
  imports: [GuidesModule],
  controllers: [GoalsController],
  providers: [GoalsService, DiscoveryService],
  exports: [GoalsService, DiscoveryService],
})
export class GoalsModule {}
