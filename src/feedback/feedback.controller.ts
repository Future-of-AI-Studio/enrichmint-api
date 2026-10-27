import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from 'src/common/decorators/access.decorators';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import type { AuthenticatedUser } from 'src/common/types/authenticated-request.type';
import { PrismaService } from 'src/prisma/prisma.service';
import { FeedbackDto, ReportDto, ResolveReportDto } from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

@ApiTags('Feedback and reports')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard, RoleGuard)
@Controller()
export class FeedbackController {
  constructor(
    private readonly feedback: FeedbackService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('feedback')
  @ApiOperation({
    summary: 'Recipient: immediate or follow-up usefulness feedback',
  })
  submit(@CurrentUser() user: AuthenticatedUser, @Body() dto: FeedbackDto) {
    return this.feedback.submit(user.id, dto);
  }

  @Get('feedback/mine')
  @ApiOperation({ summary: 'Recipient: my feedback for one guide or response' })
  mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query('targetType') targetType: 'GUIDE' | 'RESPONSE',
    @Query('targetId') targetId: string,
  ) {
    return this.feedback.mine(user.id, targetType, targetId);
  }

  @Post('reports')
  @ApiOperation({
    summary: 'Signed-in user: report a guide, request or response to an admin',
  })
  report(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReportDto) {
    return this.prisma.report.create({
      data: {
        reporterId: user.id,
        targetType: dto.targetType,
        targetId: dto.targetId,
        reason: dto.reason,
      },
    });
  }

  @Get('admin/reports')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Admin: reports' })
  reports() {
    return this.prisma.report.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
      include: { reporter: { select: { displayName: true } } },
    });
  }

  @Post('admin/reports/:id/resolve')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: resolve a report' })
  resolve(@Param('id') id: string, @Body() dto: ResolveReportDto) {
    return this.prisma.report.update({
      where: { id },
      data: { status: 'RESOLVED', resolution: dto.resolution },
    });
  }
}
