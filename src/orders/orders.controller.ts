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
import { CurrentUser } from 'src/common/decorators/access.decorators';
import { AuthGuard } from 'src/common/guards/auth.guard';
import type { AuthenticatedUser } from 'src/common/types/authenticated-request.type';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @ApiOperation({
    summary:
      'Buyer: start a PayPal checkout for a guide or an accepted request (price comes from the server)',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user, dto);
  }

  @Post(':id/capture')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Buyer: capture after PayPal approval. Access is granted only when PayPal confirms the capture.',
  })
  capture(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orders.capture(user, id);
  }

  @Get()
  @ApiOperation({ summary: 'Buyer: my orders' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.findMine(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buyer: one order and its payment status' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orders.findOneForBuyer(user.id, id);
  }
}
