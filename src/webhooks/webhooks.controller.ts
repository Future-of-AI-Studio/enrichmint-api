import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  /** PayPal only. No session auth: the signature is checked with PayPal before anything happens. */
  @Post('paypal')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  @ApiExcludeEndpoint()
  paypal(
    @Req() req: RawBodyRequest<Request>,
    @Headers('paypal-transmission-id') transmissionId?: string,
    @Headers('paypal-transmission-time') transmissionTime?: string,
    @Headers('paypal-transmission-sig') transmissionSig?: string,
    @Headers('paypal-cert-url') certUrl?: string,
    @Headers('paypal-auth-algo') authAlgo?: string,
  ) {
    if (
      !req.rawBody ||
      !transmissionId ||
      !transmissionTime ||
      !transmissionSig ||
      !certUrl ||
      !authAlgo
    ) {
      throw new BadRequestException({
        error: 'invalid_event',
        message: 'Missing PayPal signature headers.',
      });
    }
    return this.webhooks.handle(
      { transmissionId, transmissionTime, transmissionSig, certUrl, authAlgo },
      req.rawBody.toString('utf8'),
    );
  }
}
