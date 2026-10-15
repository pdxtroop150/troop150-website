// Environment and request helpers shared by the tree-recycling Pages Functions.
import type { SheetsEnv } from "./sheets";
import type { SquareEnv } from "./square";
import type { PickupRequest } from "./settings";

export interface TreeRecyclingEnv extends SquareEnv, SheetsEnv {
  SQUARE_WEBHOOK_SIGNATURE_KEY: string;
  GOOGLE_MAPS_API_KEY: string;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * The site address the customer is using (e.g. https://troop150.org or a
 * preview address), so Square can send them back to the same place.
 *
 * Locally the form runs on Astro's port and reaches the functions through a
 * proxy, so the browser's Origin header is trusted for localhost. Anywhere
 * else it must match the address the request arrived on.
 */
export function siteOrigin(request: Request): string {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin) {
    try {
      const o = new URL(origin);
      if (o.host === url.host || o.hostname === "localhost" || o.hostname === "127.0.0.1") {
        return o.origin;
      }
    } catch {
      // Ignore a malformed Origin header.
    }
  }
  return url.origin;
}

/** Read a pickup request from a JSON body, coercing every field to its type. */
export function pickupRequestFrom(body: Record<string, unknown>): PickupRequest {
  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : "");
  return {
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    street: text("street"),
    unit: text("unit"),
    city: text("city"),
    zip: text("zip"),
    instructions: text("instructions"),
    referral: text("referral"),
    trees: Number(body.trees),
    wreaths: Number(body.wreaths),
    // JSON turns NaN into null; Number(null) would be 0, so keep it missing.
    additionalDonationDollars:
      typeof body.additionalDonationDollars === "number" ? body.additionalDonationDollars : NaN,
  };
}
