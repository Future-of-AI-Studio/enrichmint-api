import { PaypalError } from 'src/paypal/paypal.service';
import type { PaypalOrder } from 'src/paypal/schemas/paypal.schema';

interface StoredOrder {
  id: string;
  ourOrderId: string;
  value: string;
  currency: string;
  captured: boolean;
}

/**
 * Stand-in for PaypalService at the module boundary. Knobs let a spec choose
 * what PayPal "says": capture status, a tampered amount, a declined card, or
 * an unverifiable webhook.
 */
export class FakePaypal {
  isConfigured = true;
  captureStatus: 'COMPLETED' | 'PENDING' | 'DECLINED' = 'COMPLETED';
  captureValueOverride: string | null = null;
  captureError: PaypalError | null = null;
  webhookVerified = true;
  payoutError: PaypalError | null = null;
  feeValue = '0.66';
  calls = { create: 0, capture: 0, refund: 0, payout: 0 };
  private orders = new Map<string, StoredOrder>();
  private counter = 0;

  reset(): void {
    this.captureStatus = 'COMPLETED';
    this.captureValueOverride = null;
    this.captureError = null;
    this.webhookVerified = true;
    this.payoutError = null;
    this.calls = { create: 0, capture: 0, refund: 0, payout: 0 };
  }

  createOrder(input: {
    orderId: string;
    amountCents: number;
    currency: string;
  }): Promise<PaypalOrder> {
    this.calls.create += 1;
    const id = `PP-${++this.counter}`;
    this.orders.set(id, {
      id,
      ourOrderId: input.orderId,
      value: (input.amountCents / 100).toFixed(2),
      currency: input.currency,
      captured: false,
    });
    return Promise.resolve({ id, status: 'CREATED', purchase_units: [] });
  }

  captureOrder(paypalOrderId: string): Promise<PaypalOrder> {
    this.calls.capture += 1;
    if (this.captureError) return Promise.reject(this.captureError);
    const order = this.orders.get(paypalOrderId)!;
    order.captured = true;
    return Promise.resolve(this.view(order));
  }

  getOrder(paypalOrderId: string): Promise<PaypalOrder> {
    const order = this.orders.get(paypalOrderId)!;
    return Promise.resolve(
      order.captured
        ? this.view(order)
        : { id: order.id, status: 'APPROVED', purchase_units: [] },
    );
  }

  refundCapture(captureId: string) {
    this.calls.refund += 1;
    return Promise.resolve({
      id: `REF-${captureId}`,
      status: 'COMPLETED',
      links: [
        {
          rel: 'up',
          href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}`,
        },
      ],
    });
  }

  createPayout(input: { payoutId: string }) {
    this.calls.payout += 1;
    if (this.payoutError) return Promise.reject(this.payoutError);
    return Promise.resolve({
      batch_header: {
        payout_batch_id: `BATCH-${input.payoutId}`,
        batch_status: 'PENDING',
      },
    });
  }

  getPayoutBatch(batchId: string) {
    return Promise.resolve({
      batch_header: { payout_batch_id: batchId, batch_status: 'SUCCESS' },
      items: [
        { payout_item_id: `ITEM-${batchId}`, transaction_status: 'SUCCESS' },
      ],
    });
  }

  verifyWebhook(): Promise<boolean> {
    return Promise.resolve(this.webhookVerified);
  }

  captureIdFor(paypalOrderId: string): string {
    return `CAP-${paypalOrderId}`;
  }

  /** A capture resource exactly as PayPal sends it in PAYMENT.CAPTURE.* webhooks. */
  captureResource(paypalOrderId: string, status = 'COMPLETED') {
    const order = this.orders.get(paypalOrderId)!;
    return {
      id: this.captureIdFor(paypalOrderId),
      status,
      custom_id: order.ourOrderId,
      amount: { currency_code: order.currency, value: order.value },
      seller_receivable_breakdown: {
        paypal_fee: { currency_code: order.currency, value: this.feeValue },
      },
    };
  }

  private view(order: StoredOrder): PaypalOrder {
    return {
      id: order.id,
      status: 'COMPLETED',
      purchase_units: [
        {
          reference_id: order.ourOrderId,
          payments: {
            captures: [
              {
                ...this.captureResource(order.id, this.captureStatus),
                amount: {
                  currency_code: order.currency,
                  value: this.captureValueOverride ?? order.value,
                },
              },
            ],
          },
        },
      ],
    };
  }
}
