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
import { CurrentUser, Roles } from 'src/common/decorators/access.decorators';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import type { AuthenticatedUser } from 'src/common/types/authenticated-request.type';
import { DecideRefundDto, RequestRefundDto } from './dto/refund.dto';
import { RefundsService } from './refunds.service';

@ApiTags('Refunds')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard, RoleGuard)
@Controller()
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Post('refunds')
  @ApiOperation({
    summary:
      'Buyer: ask for a refund (approved automatically when a paid response was not delivered on time)',
  })
  request(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestRefundDto,
  ) {
    return this.refunds.request(user.id, dto.orderId, dto.reason);
  }

  @Get('refunds')
  @ApiOperation({ summary: 'Buyer: my refunds' })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.refunds.listMine(user.id);
  }

  @Get('admin/refunds')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Admin: all refunds' })
  all() {
    return this.refunds.listForAdmin();
  }

  @Post('admin/refunds/:id/decision')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin: approve (sends to PayPal) or reject a refund',
  })
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DecideRefundDto,
  ) {
    return this.refunds.decide(user.id, id, dto.approve, dto.note);
  }
}
