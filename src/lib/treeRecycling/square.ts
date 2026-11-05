// Minimal Square API client for the tree-recycling Pages Functions.
// https://developer.squareup.com/reference/square

const SQUARE_VERSION = "2025-01-23";

export interface SquareEnv {
  /**
   * Sandbox and production are separate Square servers, and an access token
   * only works on its own server. Unset (or anything but "production") means
   * Sandbox, so only the production deployment sets this.
   */
  SQUARE_ENVIRONMENT?: string;
  SQUARE_ACCESS_TOKEN: string;
  SQUARE_LOCATION_ID: string;
}

/** Order metadata key that marks orders created by this website. */
export const ORDER_SOURCE_KEY = "source";
export const ORDER_SOURCE = "troop150-tree-recycling";
/** Line item metadata key holding the item kind, e.g. "tree". */
export const LINE_KIND_KEY = "kind";

/** Real payments. Everything else (local, preview) uses Square Sandbox. */
export function isProduction(env: Pick<SquareEnv, "SQUARE_ENVIRONMENT">): boolean {
  return env.SQUARE_ENVIRONMENT === "production";
}

function baseUrl(env: SquareEnv): string {
  return isProduction(env)
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

async function squareRequest<T>(
  env: SquareEnv,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${baseUrl(env)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Square ${method} ${path} returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export interface PaymentLinkLineItem {
  /** Recorded on the line item so the webhook can count trees and wreaths. */
  kind: string;
  name: string;
  note?: string;
  quantity: number;
  unitCents: number;
}

export interface PaymentLinkRequest {
  lineItems: PaymentLinkLineItem[];
  /**
   * Up to 9 entries (Square allows 10, and one marks the source; this uses all
   * 9), each value at most 255 characters.
   */
  metadata: Record<string, string>;
  buyerEmail: string;
  buyerPhone: string; // E.164, e.g. +15035551234
  redirectUrl: string;
  supportEmail: string;
}

export async function createPaymentLink(
  env: SquareEnv,
  r: PaymentLinkRequest,
): Promise<{ url: string; orderId: string }> {
  const body = {
    order: {
      location_id: env.SQUARE_LOCATION_ID,
      line_items: r.lineItems.map((item) => ({
        name: item.name,
        note: item.note,
        quantity: String(item.quantity),
        base_price_money: { amount: item.unitCents, currency: "USD" },
        metadata: { [LINE_KIND_KEY]: item.kind },
      })),
      // Square rejects empty metadata values, so leave blank fields out.
      metadata: {
        ...Object.fromEntries(Object.entries(r.metadata).filter(([, value]) => value !== "")),
        [ORDER_SOURCE_KEY]: ORDER_SOURCE,
      },
    },
    checkout_options: {
      redirect_url: r.redirectUrl,
      merchant_support_email: r.supportEmail,
      ask_for_shipping_address: false,
      allow_tipping: false,
      // No coupon or loyalty sections.
      enable_coupon: false,
      enable_loyalty: false,
      accepted_payment_methods: { apple_pay: true, google_pay: true },
    },
    pre_populated_data: {
      buyer_email: r.buyerEmail,
      buyer_phone_number: r.buyerPhone,
    },
  };

  const create = (b: object) =>
    squareRequest<{ payment_link: { url: string; order_id: string } }>(
      env,
      "POST",
      "/v2/online-checkout/payment-links",
      { idempotency_key: crypto.randomUUID(), ...b },
    );

  let result;
  try {
    result = await create(body);
  } catch (error) {
    // Square is stricter about emails and phone numbers than our form. Rather
    // than fail, let the customer type them on Square's page instead.
    if (!String(error).includes('"field":"pre_populated_data')) {
      throw error;
    }
    const { pre_populated_data: _, ...withoutPrefill } = body;
    result = await create(withoutPrefill);
  }
  return { url: result.payment_link.url, orderId: result.payment_link.order_id };
}

export interface SquarePayment {
  id: string;
  status: string;
  order_id?: string;
  created_at: string;
  updated_at: string;
  amount_money: { amount: number; currency: string };
  total_money?: { amount: number; currency: string };
}

export async function getPayment(env: SquareEnv, paymentId: string): Promise<SquarePayment> {
  const { payment } = await squareRequest<{ payment: SquarePayment }>(
    env,
    "GET",
    `/v2/payments/${encodeURIComponent(paymentId)}`,
  );
  return payment;
}

export interface SquareOrder {
  id: string;
  metadata?: Record<string, string>;
  line_items?: {
    quantity: string;
    metadata?: Record<string, string>;
    total_money: { amount: number; currency: string };
  }[];
  total_money: { amount: number; currency: string };
  tenders?: { payment_id?: string }[];
}

export async function getOrder(env: SquareEnv, orderId: string): Promise<SquareOrder> {
  const { order } = await squareRequest<{ order: SquareOrder }>(
    env,
    "GET",
    `/v2/orders/${encodeURIComponent(orderId)}`,
  );
  return order;
}
