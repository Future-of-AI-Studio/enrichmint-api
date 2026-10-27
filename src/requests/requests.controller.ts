import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { env, isProduction } from 'src/config/env';
import { MODEL_THROTTLE } from 'src/common/constants/rate-limit.constants';
import { CurrentUser, Roles } from 'src/common/decorators/access.decorators';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { ContributorGuard } from 'src/common/guards/contributor.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import type { AuthenticatedUser } from 'src/common/types/authenticated-request.type';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  ApproveDto,
  DeliverDto,
  DraftRequestDto,
  ReasonDto,
  UpdateRequestDto,
} from './dto/request.dto';
import { RequestsJobs } from './requests.jobs';
import { RequestsService } from './requests.service';

@ApiTags('Personal requests')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard, RoleGuard)
@Controller()
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly jobs: RequestsJobs,
    private readonly prisma: PrismaService,
  ) {}

  @Post('requests/draft-from-gap')
  @Throttle(MODEL_THROTTLE)
  @ApiOperation({
    summary:
      'Learner: the agent prepares a request draft. Nothing is sent yet.',
  })
  draft(@CurrentUser() user: AuthenticatedUser, @Body() dto: DraftRequestDto) {
    return this.requests.draftFromGap(
      user,
      dto.guideId,
      dto.question,
      dto.goalId,
    );
  }

  @Get('requests')
  @ApiOperation({ summary: 'Learner: my requests' })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.requests.listForLearner(user.id);
  }

  @Get('requests/:id')
  @ApiOperation({
    summary: 'Learner: one request, its history and any response',
  })
  view(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.requests.learnerView(user.id, id);
  }

  @Patch('requests/:id')
  @ApiOperation({
    summary: 'Learner: edit the draft and choose which details to share',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRequestDto,
  ) {
    return this.requests.update(user.id, id, dto);
  }

  @Post('requests/:id/send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Learner: approve and send (checked against budget; the acceptance window starts)',
  })
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveDto,
  ) {
    return this.requests.send(user, id, dto.approved);
  }

  @Post('requests/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Learner: cancel before it is accepted' })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.requests.cancel(user.id, id);
  }

  @Post('requests/:id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Learner: mark a delivered response as received' })
  close(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.requests.close(user.id, id);
  }

  @Post('requests/:id/dispute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Learner: report a delivery problem to an admin' })
  dispute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.requests.dispute(user.id, id, dto.reason);
  }

  @Get('studio/requests')
  @UseGuards(ContributorGuard)
  @ApiOperation({
    summary:
      'Contributor: my request inbox (only details the learner chose to share)',
  })
  inbox(@CurrentUser() user: AuthenticatedUser) {
    return this.requests.inbox(user.contributorId!);
  }

  @Get('studio/requests/:id')
  @UseGuards(ContributorGuard)
  @ApiOperation({ summary: 'Contributor: one request' })
  contributorView(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.requests.contributorView(user.contributorId!, id);
  }

  @Post('studio/requests/:id/accept')
  @UseGuards(ContributorGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Contributor: accept (the learner then has a window to pay)',
  })
  accept(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.requests.accept(user, id);
  }

  @Post('studio/requests/:id/decline')
  @UseGuards(ContributorGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Contributor: decline (no money moves)' })
  decline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.requests.decline(user, id, dto.reason);
  }

  @Post('studio/requests/:id/deliver')
  @UseGuards(ContributorGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Contributor: deliver the paid response' })
  deliver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DeliverDto,
  ) {
    return this.requests.deliver(user, id, dto.body, dto.aiUseAllowed);
  }

  @Get('admin/requests')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Admin: requests that need attention (overdue or disputed)',
  })
  attention() {
    return this.prisma.personalRequest.findMany({
      where: { state: { in: ['OVERDUE', 'DISPUTED'] } },
      orderBy: { updatedAt: 'desc' },
      include: {
        orders: { select: { id: true, status: true, amountCents: true } },
        transitions: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  @Post('admin/requests/:id/uphold')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin: close a dispute in the contributor’s favour',
  })
  uphold(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.requests.resolveDispute(user.id, id, true, dto.reason);
  }

  /** Demo only: makes the current deadline pass now, then runs the deadline job. Labelled in the UI. */
  @Post('admin/demo/requests/:id/fast-forward')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin (demo builds only): simulate the current deadline passing',
  })
  async fastForward(@Param('id') id: string) {
    if (!env.DEMO_TOOLS_ENABLED || isProduction) {
      throw new ForbiddenException({
        error: 'demo_tools_disabled',
        message: 'Demo tools are off.',
      });
    }
    const past = new Date(Date.now() - 1000);
    const request = await this.prisma.personalRequest.findUniqueOrThrow({
      where: { id },
    });
    const field =
      request.state === 'SENT'
        ? 'acceptBy'
        : request.state === 'ACCEPTED'
          ? 'payBy'
          : request.state === 'PAID'
            ? 'deliverBy'
            : null;
    if (!field) return { moved: 0, simulated: true, state: request.state };
    await this.prisma.personalRequest.update({
      where: { id },
      data: { [field]: past },
    });
    await this.prisma.requestTransition.create({
      data: {
        requestId: id,
        fromState: request.state,
        toState: request.state,
        actor: 'ADMIN',
        reason: `SIMULATED: ${field} moved to now for the demo`,
      },
    });
    const moved = await this.jobs.runDeadlines();
    return { moved, simulated: true };
  }
}
