import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaymentLink, type PaymentLinkRequest } from "./square";

const env = { SQUARE_ACCESS_TOKEN: "token", SQUARE_LOCATION_ID: "L1" };
const request: PaymentLinkRequest = {
  lineItems: [{ kind: "tree", name: "Tree pickup", quantity: 1, unitCents: 1500 }],
  metadata: { name: "Pat", instructions: "" },
  buyerEmail: "pat@example.com",
  buyerPhone: "+15035550100",
  redirectUrl: "http://localhost/confirmation",
  supportEmail: "info@troop150.org",
};

/** Records request bodies; the first `failures` calls fail with `error`. */
function fakeSquare(failures = 0, error = "") {
  const bodies: Record<string, any>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length <= failures) {
        return new Response(error, { status: 400 });
      }
      return Response.json({ payment_link: { url: "https://square.link/x", order_id: "o1" } });
    }),
  );
  return bodies;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPaymentLink", () => {
  it("leaves blank metadata out, since Square rejects empty values", async () => {
    const bodies = fakeSquare();
    await createPaymentLink(env, request);
    expect(bodies[0].order.metadata).toEqual({
      name: "Pat",
      source: "troop150-tree-recycling",
    });
  });

  it("retries without prefilled contact details when Square rejects them", async () => {
    const bodies = fakeSquare(
      1,
      '{"errors":[{"code":"INVALID_EMAIL_ADDRESS","field":"pre_populated_data.buyer_email"}]}',
    );
    expect(await createPaymentLink(env, request)).toEqual({
      url: "https://square.link/x",
      orderId: "o1",
    });
    expect(bodies[0]).toHaveProperty("pre_populated_data");
    expect(bodies[1]).not.toHaveProperty("pre_populated_data");
    expect(bodies[1].idempotency_key).not.toBe(bodies[0].idempotency_key);
  });

  it("does not retry other errors", async () => {
    const bodies = fakeSquare(1, '{"errors":[{"code":"UNAUTHORIZED"}]}');
    await expect(createPaymentLink(env, request)).rejects.toThrow("UNAUTHORIZED");
    expect(bodies).toHaveLength(1);
  });
});
