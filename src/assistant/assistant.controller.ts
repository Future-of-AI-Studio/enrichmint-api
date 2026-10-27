import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { MODEL_THROTTLE } from 'src/common/constants/rate-limit.constants';
import { CurrentUser } from 'src/common/decorators/access.decorators';
import { AuthGuard } from 'src/common/guards/auth.guard';
import type { AuthenticatedUser } from 'src/common/types/authenticated-request.type';
import { AssistantService } from './assistant.service';

class AskDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  question: string;

  @ApiPropertyOptional({
    description:
      'Goal for situation context and the budget shown with any request offer.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  goalId?: string;
}

@ApiTags('Assistant')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('guides/:guideId/questions')
  @Throttle(MODEL_THROTTLE)
  @ApiOperation({
    summary:
      'Buyer: ask about a purchased guide. 403 not_entitled / agent_access_not_permitted, 429 quota_exhausted.',
  })
  ask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('guideId') guideId: string,
    @Body() dto: AskDto,
  ) {
    return this.assistant.ask(user.id, guideId, dto.question, dto.goalId);
  }

  @Get('guides/:guideId/messages')
  @ApiOperation({ summary: 'Buyer: my assistant conversation for a guide' })
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('guideId') guideId: string,
  ) {
    return this.assistant.history(user.id, guideId);
  }

  @Post('requests/:requestId/apply')
  @Throttle(MODEL_THROTTLE)
  @ApiOperation({
    summary:
      'Learner: turn a delivered personal response into next steps (only if the contributor allowed AI use)',
  })
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
  ) {
    return this.assistant.applyResponse(user.id, requestId);
  }

  @Get('requests/:requestId/messages')
  @ApiOperation({
    summary: 'Learner: plans generated from a personal response',
  })
  plans(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
  ) {
    return this.assistant.planHistory(user.id, requestId);
  }
}
