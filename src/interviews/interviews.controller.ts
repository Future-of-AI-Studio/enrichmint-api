import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { MODEL_THROTTLE } from 'src/common/constants/rate-limit.constants';
import { CurrentUser } from 'src/common/decorators/access.decorators';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { ContributorGuard } from 'src/common/guards/contributor.guard';
import type { AuthenticatedUser } from 'src/common/types/authenticated-request.type';
import { AnswerDto, DraftGuideDto } from './dto/interview.dto';
import { InterviewsService } from './interviews.service';

@ApiTags('Interviews')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard, ContributorGuard)
@Controller('interviews')
export class InterviewsController {
  constructor(private readonly interviews: InterviewsService) {}

  @Get('questions')
  @ApiOperation({ summary: 'Contributor: the interview questions' })
  questions() {
    return this.interviews.questions();
  }

  @Get()
  @ApiOperation({ summary: 'Contributor: my interviews' })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.interviews.mine(user.contributorId!);
  }

  @Post()
  @ApiOperation({ summary: 'Contributor: start "Share my experience"' })
  start(@CurrentUser() user: AuthenticatedUser) {
    return this.interviews.start(user.contributorId!);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Contributor: one interview with the next question',
  })
  view(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.interviews.view(id, user.contributorId!);
  }

  @Post(':id/answers')
  @Throttle(MODEL_THROTTLE)
  @ApiOperation({
    summary: 'Contributor: answer a question (AI may ask one follow-up)',
  })
  answer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AnswerDto,
  ) {
    return this.interviews.answer(user, id, dto);
  }

  @Post(':id/draft')
  @Throttle(MODEL_THROTTLE)
  @ApiOperation({
    summary:
      'Contributor: turn the answers into a draft guide. Missing information becomes gap questions, never invented text.',
  })
  draft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DraftGuideDto,
  ) {
    return this.interviews.draft(user, id, dto);
  }
}
