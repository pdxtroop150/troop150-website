// POST /tree-recycling/validate-address
// Standardizes the customer's address and reports whether it is in our
// pickup area. The checkout function repeats this check.
import type { PagesFunction } from "@cloudflare/workers-types";
import { checkAddress } from "../../src/lib/treeRecycling/addressValidation";
import { json, type TreeRecyclingEnv } from "../../src/lib/treeRecycling/functionEnv";
import { serviceOpen } from "../../src/lib/treeRecycling/settings";

export const onRequestPost: PagesFunction<TreeRecyclingEnv> = async ({ request, env }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, string>;
  if (!serviceOpen("pickup", new Date())) {
    return json({ error: "Pickup requests are not being accepted right now." }, 403);
  }

  const address = {
    street: String(body.street ?? ""),
    unit: String(body.unit ?? ""),
    city: String(body.city ?? ""),
    zip: String(body.zip ?? ""),
  };
  if (!address.street.trim() || !/^\d{5}$/.test(address.zip.trim())) {
    return json({ error: "Please enter a street address and 5-digit ZIP code." }, 400);
  }

  try {
    return json(await checkAddress(address, env.GOOGLE_MAPS_API_KEY));
  } catch (error) {
    console.error("Address validation failed", error);
    return json({ error: "We couldn't check your address right now. Please try again." }, 502);
  }
};
