import { describe, expect, it } from "vitest";
import { isValidSquareSignature, squareSignature } from "./webhookSignature";

const key = "test-signature-key";
const url = "https://example.com/tree-recycling/square-webhook";
const body = JSON.stringify({ type: "payment.updated", data: { id: "abc" } });

describe("Square webhook signatures", () => {
  it("matches Square's documented algorithm", async () => {
    const { createHmac } = await import("node:crypto");
    const expected = createHmac("sha256", key).update(url + body).digest("base64");
    expect(await squareSignature(key, url, body)).toBe(expected);
  });

  it("accepts a valid signature", async () => {
    const signature = await squareSignature(key, url, body);
    expect(await isValidSquareSignature(key, url, body, signature)).toBe(true);
  });

  it("rejects a tampered body, a different URL, or a missing signature", async () => {
    const signature = await squareSignature(key, url, body);
    expect(await isValidSquareSignature(key, url, body + " ", signature)).toBe(false);
    expect(await isValidSquareSignature(key, url + "x", body, signature)).toBe(false);
    expect(await isValidSquareSignature(key, url, body, null)).toBe(false);
  });
});
