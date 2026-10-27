import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { MODEL_THROTTLE } from 'src/common/constants/rate-limit.constants';
import { CurrentUser } from 'src/common/decorators/access.decorators';
import { AuthGuard } from 'src/common/guards/auth.guard';
import type { AuthenticatedUser } from 'src/common/types/authenticated-request.type';
import { DiscoveryService } from './discovery.service';
import { CreateGoalDto, GoalMessageDto, UpdateBudgetDto } from './dto/goal.dto';
import { GoalsService } from './goals.service';

@ApiTags('Goals')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('goals')
export class GoalsController {
  constructor(
    private readonly goals: GoalsService,
    private readonly discovery: DiscoveryService,
  ) {}

  @Post()
  @Throttle(MODEL_THROTTLE)
  @ApiOperation({
    summary: 'Learner: "What are you trying to figure out?" plus a budget',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateGoalDto) {
    return this.goals.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Learner: my goals' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.goals.list(user.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Learner: one goal with budget committed and remaining',
  })
  view(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.goals.view(user.id, id);
  }

  @Post(':id/messages')
  @Throttle(MODEL_THROTTLE)
  @ApiOperation({ summary: 'Learner: answer a clarifying question' })
  message(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: GoalMessageDto,
  ) {
    return this.goals.addMessage(user.id, id, dto.text);
  }

  @Patch(':id/budget')
  @ApiOperation({ summary: 'Learner: change my budget (only I can)' })
  budget(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.goals.updateBudget(user.id, id, dto.budgetCents);
  }

  @Post(':id/recommendations')
  @Throttle(MODEL_THROTTLE)
  @ApiOperation({
    summary:
      'Learner: up to three explained recommendations, or an honest "nothing fits"',
  })
  recommend(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.discovery.recommend(user.id, id);
  }
}
