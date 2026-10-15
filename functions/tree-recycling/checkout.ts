// POST /tree-recycling/checkout
// Re-checks the request on the server, then creates a Square payment link and
// returns its URL. Nothing is recorded until Square confirms payment (see
// square-webhook.ts).
import type { PagesFunction } from "@cloudflare/workers-types";
import { checkAddress } from "../../src/lib/treeRecycling/addressValidation";
import {
  json,
  pickupRequestFrom,
  siteOrigin,
  type TreeRecyclingEnv,
} from "../../src/lib/treeRecycling/functionEnv";
import {
  formatPhone,
  orderLines,
  phoneDigits,
  pickupNote,
  requestsOpen,
  settings,
  validatePickupRequest,
} from "../../src/lib/treeRecycling/settings";
import { createPaymentLink } from "../../src/lib/treeRecycling/square";

export const onRequestPost: PagesFunction<TreeRecyclingEnv> = async ({ request, env }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!requestsOpen(new Date())) {
    return json({ error: "Pickup requests are not being accepted right now." }, 403);
  }

  const pickup = pickupRequestFrom(body);
  const errors = validatePickupRequest(pickup);
  if (Object.keys(errors).length > 0) {
    return json({ error: "Please correct the highlighted fields.", fields: errors }, 400);
  }

  try {
    const check = await checkAddress(pickup, env.GOOGLE_MAPS_API_KEY);
    if (check.status !== "in-area") {
      return json({ error: "This address is not in our pickup area." }, 400);
    }
    const { address } = check;
    // Square's receipt shows item notes, so the pickup lines tell the customer
    // where and when to put their items out.

    const { url } = await createPaymentLink(env, {
      lineItems: orderLines(pickup).map((line) => ({
        kind: line.kind,
        name: line.name,
        note: line.kind === "donation" ? undefined : pickupNote(line, address.formatted),
        quantity: line.quantity,
        unitCents: line.unitCents,
      })),
      metadata: {
        collectionDate: settings.collectionDate,
        name: pickup.name.trim(),
        email: pickup.email.trim(),
        phone: formatPhone(pickup.phone),
        address: address.formatted.slice(0, 255),
        zip: address.zip,
        instructions: pickup.instructions.trim().slice(0, 255),
        referral: pickup.referral,
      },
      buyerEmail: pickup.email.trim(),
      buyerPhone: `+1${phoneDigits(pickup.phone)}`,
      redirectUrl: `${siteOrigin(request)}/treerecycling/confirmation`,
      supportEmail: settings.supportEmail,
    });
    return json({ url });
  } catch (error) {
    console.error("Checkout failed", error);
    return json(
      { error: "We couldn't start the payment right now. Please try again in a few minutes." },
      502,
    );
  }
};
