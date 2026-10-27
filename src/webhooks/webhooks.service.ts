import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from 'generated/prisma/client';
import { isUniqueViolation } from 'src/common/utils/prisma-errors.util';
import { OrdersService } from 'src/orders/orders.service';
import { PayoutsService } from 'src/payouts/payouts.service';
import { PaypalService, WebhookHeaders } from 'src/paypal/paypal.service';
import { captureSchema, refundSchema } from 'src/paypal/schemas/paypal.schema';
import { PrismaService } from 'src/prisma/prisma.service';
import { RefundsService } from 'src/refunds/refunds.service';

const eventSchema = z.object({
  id: z.string(),
  event_type: z.string(),
  resource: z.record(z.string(), z.unknown()),
});

const payoutItemSchema = z.object({
  payout_item_id: z.string().optional(),
  payout_batch_id: z.string(),
  transaction_status: z.string(),
});

/**
 * PayPal webhooks. An event is acted on only after PayPal confirms its
 * signature, and only once: the event id is unique, so redeliveries
 * (PayPal retries up to 25 times over 3 days) are no-ops.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paypal: PaypalService,
    private readonly orders: OrdersService,
    private readonly refunds: RefundsService,
    private readonly payouts: PayoutsService,
  ) {}

  async handle(headers: WebhookHeaders, rawBody: string) {
    const parsed = eventSchema.safeParse(safeJson(rawBody));
    if (!parsed.success) {
      throw new BadRequestException({
        error: 'invalid_event',
        message: 'Not a PayPal event.',
      });
    }
    const event = parsed.data;
    const resourceId =
      typeof event.resource.id === 'string' ? event.resource.id : null;

    const verified = await this.paypal.verifyWebhook(headers, rawBody);
    if (!verified) {
      this.logger.warn(
        `Unverified webhook ${event.event_type} ${event.id} ignored.`,
      );
      // Kept for inspection, never acted on. A later genuine delivery of the same id is still processed.
      await this.prisma.webhookEvent
        .create({
          data: {
            paypalEventId: `unverified:${event.id}:${Date.now()}`,
            type: event.event_type,
            resourceId,
            verified: false,
            payload: event as unknown as Prisma.InputJsonValue,
            outcome: 'signature not verified',
          },
        })
        .catch(() => undefined);
      throw new BadRequestException({
        error: 'invalid_signature',
        message: 'Webhook signature not verified.',
      });
    }

    try {
      await this.prisma.webhookEvent.create({
        data: {
          paypalEventId: event.id,
          type: event.event_type,
          resourceId,
          verified: true,
          payload: event as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.prisma.webhookEvent.findUnique({
          where: { paypalEventId: event.id },
        });
        // Already processed: acknowledge. Stored but unprocessed (crash mid-way): process again.
        if (existing?.processedAt) return { received: true, duplicate: true };
      } else {
        throw error;
      }
    }

    // Errors bubble up as 500 so PayPal redelivers; every handler below is idempotent.
    const outcome = await this.dispatch(event.event_type, event.resource);
    await this.prisma.webhookEvent.update({
      where: { paypalEventId: event.id },
      data: { processedAt: new Date(), outcome },
    });
    return { received: true };
  }

  private async dispatch(
    type: string,
    resource: Record<string, unknown>,
  ): Promise<string> {
    switch (type) {
      case 'CHECKOUT.ORDER.APPROVED': {
        if (typeof resource.id === 'string')
          await this.orders.markApproved(resource.id);
        return 'order approved';
      }
      case 'PAYMENT.CAPTURE.COMPLETED':
      case 'PAYMENT.CAPTURE.PENDING':
      case 'PAYMENT.CAPTURE.DENIED':
      case 'PAYMENT.CAPTURE.DECLINED': {
        const capture = captureSchema.parse(resource);
        const orderId =
          capture.custom_id ?? (await this.orderIdForCapture(capture.id));
        if (!orderId) return 'capture for unknown order';
        await this.orders.applyCapture(orderId, capture);
        return `capture ${capture.status.toLowerCase()}`;
      }
      case 'PAYMENT.CAPTURE.REFUNDED':
        return this.refunds.handleRefundEvent(refundSchema.parse(resource));
      case 'PAYMENT.CAPTURE.REVERSED': {
        const capture = captureSchema.parse(resource);
        return this.refunds.handleReversal(capture.id);
      }
      case 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED':
      case 'PAYMENT.PAYOUTS-ITEM.FAILED':
      case 'PAYMENT.PAYOUTS-ITEM.UNCLAIMED':
      case 'PAYMENT.PAYOUTS-ITEM.RETURNED':
      case 'PAYMENT.PAYOUTS-ITEM.BLOCKED':
      case 'PAYMENT.PAYOUTS-ITEM.DENIED':
      case 'PAYMENT.PAYOUTS-ITEM.REFUNDED': {
        const item = payoutItemSchema.parse(resource);
        return this.payouts.applyItemStatus(
          item.payout_batch_id,
          item.payout_item_id ?? null,
          item.transaction_status,
        );
      }
      case 'CUSTOMER.DISPUTE.CREATED': {
        this.logger.warn('PayPal dispute opened; flagged for admin.');
        return 'dispute flagged for admin';
      }
      default:
        return `ignored ${type}`;
    }
  }

  private async orderIdForCapture(captureId: string): Promise<string | null> {
    const order = await this.prisma.order.findUnique({
      where: { paypalCaptureId: captureId },
      select: { id: true },
    });
    return order?.id ?? null;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
