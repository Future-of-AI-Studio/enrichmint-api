import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { MODEL_THROTTLE } from 'src/common/constants/rate-limit.constants';
import { CurrentUser } from 'src/common/decorators/access.decorators';
import { AuthGuard } from 'src/common/guards/auth.guard';
import type { AuthenticatedUser } from 'src/common/types/authenticated-request.type';
import { StartSessionDto, StewardMessageDto } from './dto/steward.dto';
import { StewardOrchestrator } from './orchestrator.service';
import { StewardService } from './steward.service';

@ApiTags('Steward')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('steward/sessions')
export class StewardController {
  constructor(
    private readonly steward: StewardService,
    private readonly orchestrator: StewardOrchestrator,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Learner: start (or reopen) a steward conversation for a goal',
  })
  start(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartSessionDto) {
    return this.steward.start(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Learner: my steward conversations' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.steward.list(user.id);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Learner: conversation, workflow stage, next step and cards (syncs payment and deadline changes first)',
  })
  view(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.steward.view(user.id, id);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.OK)
  @Throttle(MODEL_THROTTLE)
  @ApiOperation({
    summary:
      'Learner: send a message; the steward runs a bounded tool loop and stops at every human decision',
  })
  async message(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: StewardMessageDto,
  ) {
    await this.steward.view(user.id, id);
    await this.orchestrator.runTurn(user, id, dto.text);
    return this.steward.view(user.id, id);
  }
}
