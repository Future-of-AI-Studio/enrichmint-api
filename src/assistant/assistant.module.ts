import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { GroundingService } from './grounding.service';

@Module({
  controllers: [AssistantController],
  providers: [AssistantService, GroundingService],
  exports: [AssistantService],
})
export class AssistantModule {}
