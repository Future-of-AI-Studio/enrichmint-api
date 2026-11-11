import { Injectable, Logger } from '@nestjs/common';
import { env } from 'src/config/env';

export type ZapierEvent =
  | 'order.completed'
  | 'request.sent'
  | 'request.accepted'
  | 'request.delivered'
  | 'payout.succeeded'
  | 'refund.completed'
  | 'field_note.published';

/** Ids, amounts and states only. Never emails, names or message content. */
export type ZapierPayload = Record<string, string | number | boolean | null>;

/**
 * Posts marketplace events to a Zapier Catch Hook so teams can automate
 * follow-ups (Slack alerts, sheets, emails) without touching this code.
 * It never throws and never blocks the money path: call it after a commit.
 */
@Injectable()
export class ZapierService {
  private readonly logger = new Logger(ZapierService.name);

  notify(event: ZapierEvent, payload: ZapierPayload): void {
    if (!env.ZAPIER_WEBHOOK_URL) return;
    void this.post(env.ZAPIER_WEBHOOK_URL, event, payload);
  }

  private async post(
    url: string,
    event: ZapierEvent,
    payload: ZapierPayload,
  ): Promise<void> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event,
          environment: env.PAYPAL_ENV,
          occurredAt: new Date().toISOString(),
          ...payload,
        }),
        signal: AbortSignal.timeout(env.ZAPIER_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`Zapier ${event} answered ${response.status}.`);
      }
    } catch {
      this.logger.warn(`Zapier ${event} unreachable.`);
    }
  }
}
