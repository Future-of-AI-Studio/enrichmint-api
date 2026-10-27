import { Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';
import { env } from 'src/config/env';
import { toAmountString } from 'src/common/utils/money.util';
import {
  orderSchema,
  payoutBatchSchema,
  payoutCreateSchema,
  refundSchema,
  tokenSchema,
  verifySchema,
  type PaypalOrder,
  type PaypalRefund,
} from './schemas/paypal.schema';

const BASE_URL = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
} as const;

/** A non-2xx PayPal answer. Only the status, issue code and debug id are kept (no payload text). */
export class PaypalError extends Error {
  constructor(
    readonly status: number,
    readonly issue: string | null,
    readonly debugId: string | null,
  ) {
    super(`PayPal error ${status}${issue ? ` ${issue}` : ''}`);
  }
}

export class PaypalNotConfiguredError extends Error {
  constructor() {
    super('PayPal is not configured.');
  }
}

export interface CreateOrderInput {
  orderId: string;
  amountCents: number;
  currency: string;
  description: string;
  requestId: string;
}

export interface WebhookHeaders {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
}

/**
 * The only code that calls PayPal (REST, Orders v2, Payments v2, Payouts v1,
 * Notifications v1). Every POST that moves money carries a PayPal-Request-Id
 * so retries are idempotent on PayPal's side, and every response is parsed
 * with zod before use.
 */
@Injectable()
export class PaypalService {
  private readonly logger = new Logger(PaypalService.name);
  private token: { value: string; expiresAt: number } | null = null;

  get isConfigured(): boolean {
    return Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
  }

  createOrder(input: CreateOrderInput): Promise<PaypalOrder> {
    return this.request('POST', '/v2/checkout/orders', orderSchema, {
      requestId: input.requestId,
      body: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: input.orderId,
            // Echoed on the capture, so webhooks can find our order without a lookup.
            custom_id: input.orderId,
            description: input.description.slice(0, 127),
            amount: {
              currency_code: input.currency,
              value: toAmountString(input.amountCents),
            },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: 'EnrichMINT',
              shipping_preference: 'NO_SHIPPING',
              user_action: 'PAY_NOW',
            },
          },
        },
      },
    });
  }

  captureOrder(paypalOrderId: string, requestId: string): Promise<PaypalOrder> {
    return this.request(
      'POST',
      `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
      orderSchema,
      { requestId, body: {} },
    );
  }

  getOrder(paypalOrderId: string): Promise<PaypalOrder> {
    return this.request(
      'GET',
      `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`,
      orderSchema,
    );
  }

  /** Full refund when `amountCents` is omitted. */
  refundCapture(
    captureId: string,
    requestId: string,
    amountCents?: number,
    currency = 'USD',
  ): Promise<PaypalRefund> {
    return this.request(
      'POST',
      `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
      refundSchema,
      {
        requestId,
        body:
          amountCents === undefined
            ? {}
            : {
                amount: {
                  currency_code: currency,
                  value: toAmountString(amountCents),
                },
              },
      },
    );
  }

  createPayout(input: {
    payoutId: string;
    receiverEmail: string;
    amountCents: number;
    currency: string;
  }) {
    return this.request('POST', '/v1/payments/payouts', payoutCreateSchema, {
      requestId: input.payoutId,
      body: {
        sender_batch_header: {
          // PayPal rejects a repeated sender_batch_id, which makes retries safe.
          sender_batch_id: input.payoutId,
          email_subject: 'Your EnrichMINT earnings (sandbox)',
        },
        items: [
          {
            recipient_type: 'EMAIL',
            receiver: input.receiverEmail,
            sender_item_id: input.payoutId,
            amount: {
              currency: input.currency,
              value: toAmountString(input.amountCents),
            },
            note: 'EnrichMINT contributor earnings',
          },
        ],
      },
    });
  }

  getPayoutBatch(batchId: string) {
    return this.request(
      'GET',
      `/v1/payments/payouts/${encodeURIComponent(batchId)}`,
      payoutBatchSchema,
    );
  }

  /**
   * Asks PayPal whether a webhook is genuine. The event is posted back
   * byte-for-byte as received, which is why the raw body is spliced in
   * rather than re-serialized.
   */
  async verifyWebhook(
    headers: WebhookHeaders,
    rawBody: string,
  ): Promise<boolean> {
    if (!env.PAYPAL_WEBHOOK_ID) return false;
    const prefix = JSON.stringify({
      auth_algo: headers.authAlgo,
      cert_url: headers.certUrl,
      transmission_id: headers.transmissionId,
      transmission_sig: headers.transmissionSig,
      transmission_time: headers.transmissionTime,
      webhook_id: env.PAYPAL_WEBHOOK_ID,
    });
    const body = `${prefix.slice(0, -1)},"webhook_event":${rawBody}}`;
    try {
      const result = await this.request(
        'POST',
        '/v1/notifications/verify-webhook-signature',
        verifySchema,
        { rawBody: body },
      );
      return result.verification_status === 'SUCCESS';
    } catch (error) {
      this.logger.warn(`Webhook verification call failed: ${String(error)}`);
      return false;
    }
  }

  private async request<T extends z.ZodType>(
    method: 'GET' | 'POST',
    path: string,
    schema: T,
    options: { body?: unknown; rawBody?: string; requestId?: string } = {},
  ): Promise<z.infer<T>> {
    const token = await this.accessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
    if (options.requestId) headers['PayPal-Request-Id'] = options.requestId;

    const response = await fetch(`${BASE_URL[env.PAYPAL_ENV]}${path}`, {
      method,
      headers,
      body:
        options.rawBody ??
        (options.body === undefined ? undefined : JSON.stringify(options.body)),
      signal: AbortSignal.timeout(env.PAYPAL_TIMEOUT_MS),
    });
    const debugId = response.headers.get('paypal-debug-id');
    const json = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!response.ok) {
      const details = json.details as Array<{ issue?: string }> | undefined;
      const issue = details?.[0]?.issue ?? (json.name as string) ?? null;
      this.logger.warn(
        `PayPal ${method} ${path.split('/').slice(0, 4).join('/')} -> ${response.status} ${issue ?? ''} debug_id=${debugId ?? 'n/a'}`,
      );
      throw new PaypalError(response.status, issue, debugId);
    }
    return schema.parse(json);
  }

  private async accessToken(): Promise<string> {
    if (!this.isConfigured) throw new PaypalNotConfiguredError();
    if (this.token && this.token.expiresAt > Date.now())
      return this.token.value;

    const credentials = Buffer.from(
      `${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`,
    ).toString('base64');
    const response = await fetch(
      `${BASE_URL[env.PAYPAL_ENV]}/v1/oauth2/token`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(env.PAYPAL_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      this.logger.error(`PayPal token request failed: ${response.status}.`);
      throw new PaypalError(response.status, 'token_failed', null);
    }
    const parsed = tokenSchema.parse(await response.json());
    this.token = {
      value: parsed.access_token,
      // Refresh a minute early so a token never expires mid-request.
      expiresAt: Date.now() + (parsed.expires_in - 60) * 1000,
    };
    return this.token.value;
  }
}
