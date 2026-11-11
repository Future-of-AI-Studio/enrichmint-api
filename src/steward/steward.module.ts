import { Module } from '@nestjs/common';
import { AssistantModule } from 'src/assistant/assistant.module';
import { GoalsModule } from 'src/goals/goals.module';
import { GuidesModule } from 'src/guides/guides.module';
import { RequestsModule } from 'src/requests/requests.module';
import { ContributorAgentService } from './contributor-agent.service';
import { StewardOrchestrator } from './orchestrator.service';
import { StewardStateService } from './steward-state.service';
import { StewardController } from './steward.controller';
import { StewardService } from './steward.service';
import { StewardTools } from './tools/steward-tools';

@Module({
  imports: [GoalsModule, GuidesModule, AssistantModule, RequestsModule],
  controllers: [StewardController],
  providers: [
    StewardService,
    StewardStateService,
    StewardTools,
    ContributorAgentService,
    StewardOrchestrator,
  ],
})
export class StewardModule {}
