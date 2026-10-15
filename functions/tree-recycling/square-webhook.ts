// POST /tree-recycling/square-webhook
// Square calls this when a payment changes. Once a website pickup payment is
// COMPLETED, the request is added to the routing sheet. Responding with an
// error makes Square retry, so failures return 500.
import type { PagesFunction } from "@cloudflare/workers-types";
import { json, type TreeRecyclingEnv } from "../../src/lib/treeRecycling/functionEnv";
import { sheetTabName } from "../../src/lib/treeRecycling/settings";
import { appendRequestRow } from "../../src/lib/treeRecycling/sheets";
import {
  getOrder,
  getPayment,
  isProduction,
  LINE_KIND_KEY,
  ORDER_SOURCE,
  ORDER_SOURCE_KEY,
} from "../../src/lib/treeRecycling/square";
import { isValidSquareSignature } from "../../src/lib/treeRecycling/webhookSignature";

function notificationUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.origin}${url.pathname}`;
}

interface PaymentEvent {
  type?: string;
  data?: { object?: { payment?: { id?: string } } };
}

export const onRequestPost: PagesFunction<TreeRecyclingEnv> = async ({ request, env }) => {
  if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY) {
    console.error("SQUARE_WEBHOOK_SIGNATURE_KEY must be set");
    return json({ error: "Webhook is not configured" }, 500);
  }

  const body = await request.text();
  const valid = await isValidSquareSignature(
    env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    // Square signs the exact address it was told to call, which is the
    // address this request arrived on.
    notificationUrl(request.url),
    body,
    request.headers.get("x-square-hmacsha256-signature"),
  );
  if (!valid) {
    return json({ error: "Invalid signature" }, 401);
  }

  const event = JSON.parse(body) as PaymentEvent;
  const paymentId = event.data?.object?.payment?.id;
  if (!event.type?.startsWith("payment.") || !paymentId) {
    return json({ ignored: "not a payment event" });
  }

  try {
    // Look the payment up rather than trusting the notification's copy, which
    // may be older than the payment's current state.
    const payment = await getPayment(env, paymentId);
    if (payment.status !== "COMPLETED" || !payment.order_id) {
      return json({ ignored: `payment status ${payment.status}` });
    }
    const order = await getOrder(env, payment.order_id);
    const m = order.metadata ?? {};
    if (m[ORDER_SOURCE_KEY] !== ORDER_SOURCE) {
      return json({ ignored: "not a tree recycling order" });
    }

    const lines = order.line_items ?? [];
    const count = (kind: string) =>
      lines
        .filter((line) => line.metadata?.[LINE_KIND_KEY] === kind)
        .reduce((total, line) => total + Number(line.quantity), 0);
    const donationCents = lines
      .filter((line) => line.metadata?.[LINE_KIND_KEY] === "donation")
      .reduce((total, line) => total + line.total_money.amount, 0);
    // Real payments go on the season's tab and Sandbox payments on its test tab.
    const added = await appendRequestRow(env, sheetTabName(isProduction(env)), {
      "Square Order ID": order.id,
      "Paid At": payment.updated_at,
      Name: m.name ?? "",
      Email: m.email ?? "",
      Phone: m.phone ?? "",
      Address: m.address ?? "",
      ZIP: m.zip ?? "",
      Trees: count("tree"),
      Wreaths: count("wreath"),
      "Additional Donation": (donationCents / 100).toFixed(2),
      "Total Paid": (payment.amount_money.amount / 100).toFixed(2),
      "Customer Instructions": m.instructions ?? "",
      "Collection Date": m.collectionDate ?? "",
      "Square Payment ID": payment.id,
      "Payment Status": payment.status,
      "Heard About Us": m.referral ?? "",
      Notes: "",
    });
    return json({ recorded: added ? "added" : "already recorded", orderId: order.id });
  } catch (error) {
    console.error("Recording payment failed", error);
    return json({ error: "Recording failed" }, 500);
  }
};
