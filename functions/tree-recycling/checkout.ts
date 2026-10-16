// POST /tree-recycling/checkout
// Re-checks the request on the server, then creates a Square payment link and
// returns its URL. Nothing is recorded until Square confirms payment (see
// square-webhook.ts).
import type { PagesFunction } from "@cloudflare/workers-types";
import { checkAddress } from "../../src/lib/treeRecycling/addressValidation";
import {
  json,
  requestFrom,
  siteOrigin,
  type TreeRecyclingEnv,
} from "../../src/lib/treeRecycling/functionEnv";
import {
  formatPhone,
  orderLines,
  phoneDigits,
  itemNote,
  serviceOpen,
  settings,
  validateRequest,
  type Service,
} from "../../src/lib/treeRecycling/settings";
import { createPaymentLink } from "../../src/lib/treeRecycling/square";

export const onRequestPost: PagesFunction<TreeRecyclingEnv> = async ({ request, env }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const order = requestFrom(body);
  const errors = validateRequest(order);
  if (Object.keys(errors).length > 0) {
    return json({ error: "Please correct the highlighted fields.", fields: errors }, 400);
  }
  const service = order.service as Service;
  if (!serviceOpen(service, new Date())) {
    return json(
      {
        error:
          service === "pickup"
            ? "Pickup requests are closed for this season."
            : "Drop-off prepayment is closed for this season.",
      },
      403,
    );
  }

  try {
    let address = { formatted: "", zip: "" };
    if (service === "pickup") {
      const check = await checkAddress(order, env.GOOGLE_MAPS_API_KEY);
      if (check.status !== "in-area") {
        return json({ error: "This address is not in our pickup area." }, 400);
      }
      address = check.address;
    }

    const { url } = await createPaymentLink(env, {
      // Square's receipt shows item notes, so the tree and wreath lines tell
      // the customer where and when to put out or bring their items.
      lineItems: orderLines({ ...order, service }).map((line) => ({
        kind: line.kind,
        name: line.name,
        note: line.kind === "donation" ? undefined : itemNote(line, service, address.formatted),
        quantity: line.quantity,
        unitCents: line.unitCents,
      })),
      // Blank values (the address and instructions on drop-offs) are left out.
      metadata: {
        service,
        collectionDate: service === "pickup" ? settings.collectionDate : "",
        name: order.name.trim(),
        email: order.email.trim(),
        phone: formatPhone(order.phone),
        address: address.formatted.slice(0, 255),
        zip: address.zip,
        instructions: service === "pickup" ? order.instructions.trim().slice(0, 255) : "",
        referral: order.referral,
      },
      buyerEmail: order.email.trim(),
      buyerPhone: `+1${phoneDigits(order.phone)}`,
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
