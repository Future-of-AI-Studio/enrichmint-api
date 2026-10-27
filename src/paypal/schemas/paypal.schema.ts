import { z } from 'zod';

const money = z.object({ currency_code: z.string(), value: z.string() });

export const tokenSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

export const captureSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: money,
  custom_id: z.string().optional(),
  seller_receivable_breakdown: z
    .object({ paypal_fee: money.optional() })
    .optional(),
  status_details: z.object({ reason: z.string().optional() }).optional(),
});

export const orderSchema = z.object({
  id: z.string(),
  status: z.string(),
  purchase_units: z
    .array(
      z.object({
        reference_id: z.string().optional(),
        custom_id: z.string().optional(),
        amount: money.optional(),
        payments: z
          .object({ captures: z.array(captureSchema).optional() })
          .optional(),
      }),
    )
    .default([]),
});

export const refundSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: money.optional(),
  links: z.array(z.object({ href: z.string(), rel: z.string() })).optional(),
});

export const payoutCreateSchema = z.object({
  batch_header: z.object({
    payout_batch_id: z.string(),
    batch_status: z.string(),
  }),
});

export const payoutBatchSchema = z.object({
  batch_header: z.object({
    payout_batch_id: z.string(),
    batch_status: z.string(),
  }),
  items: z
    .array(
      z.object({
        payout_item_id: z.string(),
        transaction_status: z.string().optional(),
        errors: z.object({ name: z.string().optional() }).optional(),
      }),
    )
    .default([]),
});

export const verifySchema = z.object({ verification_status: z.string() });

export type PaypalOrder = z.infer<typeof orderSchema>;
export type PaypalCapture = z.infer<typeof captureSchema>;
export type PaypalRefund = z.infer<typeof refundSchema>;
