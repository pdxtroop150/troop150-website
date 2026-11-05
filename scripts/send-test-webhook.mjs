#!/usr/bin/env node
// Sends a signed Square "payment.updated" notification to the local
// square-webhook function, as Square would after a Sandbox payment.
//
// Usage:
//   node scripts/send-test-webhook.mjs [payment-or-order-id] [--times N]
//
// With no ID, uses the most recent completed payment in your Square Sandbox.
// Otherwise pass a payment or order ID from the Sandbox Square Dashboard.
// --times 2 sends the same notification twice to check that only one sheet
// row is added. Reads .dev.vars for the Square
// Sandbox token and signature key.
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

function readDevVars() {
  const vars = {};
  for (const line of readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (match) {
      vars[match[1]] = match[2].replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");
    }
  }
  return vars;
}

const args = process.argv.slice(2);
const timesIndex = args.indexOf("--times");
const times = timesIndex >= 0 ? Number(args[timesIndex + 1]) : 1;
const id = args.find((arg, i) => !arg.startsWith("--") && (timesIndex < 0 || i !== timesIndex + 1));

// The local Wrangler server, which runs the site's functions.
const WEBHOOK_URL = "http://localhost:8788/tree-recycling/square-webhook";

const env = readDevVars();
if (env.SQUARE_ENVIRONMENT === "production") {
  console.error("Refusing to run: .dev.vars must not set SQUARE_ENVIRONMENT=production.");
  process.exit(1);
}

const square = (path) =>
  fetch(`https://connect.squareupsandbox.com${path}`, {
    headers: { Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`, "Square-Version": "2025-01-23" },
  });

let paymentId = id;
if (!id) {
  const { payments = [] } = await (await square("/v2/payments?sort_order=DESC&limit=20")).json();
  const latest = payments.find((p) => p.status === "COMPLETED");
  if (!latest) {
    console.error("No completed Sandbox payments yet. Pay a pickup request in Sandbox first.");
    process.exit(1);
  }
  paymentId = latest.id;
  console.log(`Using payment ${paymentId} ($${(latest.amount_money.amount / 100).toFixed(2)}, ${latest.created_at})`);
} else {
  // Turn an order ID into its payment ID; payment IDs are used as given.
  const orderResponse = await square(`/v2/orders/${id}`);
  if (orderResponse.ok) {
    const { order } = await orderResponse.json();
    paymentId = order.tenders?.[0]?.payment_id;
    if (!paymentId) {
      console.error(`Order ${id} has no payment yet. Finish paying on the Square Sandbox page first.`);
      process.exit(1);
    }
  }
}

const body = JSON.stringify({
  merchant_id: "local-test",
  type: "payment.updated",
  event_id: randomUUID(),
  created_at: new Date().toISOString(),
  data: { type: "payment", id: paymentId, object: { payment: { id: paymentId } } },
});
const signature = createHmac("sha256", env.SQUARE_WEBHOOK_SIGNATURE_KEY)
  .update(WEBHOOK_URL + body)
  .digest("base64");

for (let i = 0; i < times; i++) {
  const response = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-square-hmacsha256-signature": signature },
    body,
  });
  console.log(`${response.status} ${await response.text()}`);
}
