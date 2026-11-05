import { describe, expect, it } from "vitest";
import { siteOrigin } from "./functionEnv";

const request = (url: string, origin?: string) =>
  new Request(url, { method: "POST", headers: origin ? { Origin: origin } : {} });

describe("siteOrigin", () => {
  it("returns customers to the address they used", () => {
    expect(siteOrigin(request("https://troop150.org/tree-recycling/checkout", "https://troop150.org"))).toBe(
      "https://troop150.org",
    );
    expect(
      siteOrigin(request("https://tree-recycling.troop150-website.pages.dev/tree-recycling/checkout")),
    ).toBe("https://tree-recycling.troop150-website.pages.dev");
  });

  it("uses the Astro dev server's address locally, behind the proxy", () => {
    expect(
      siteOrigin(request("http://localhost:8788/tree-recycling/checkout", "http://localhost:4321")),
    ).toBe("http://localhost:4321");
  });

  it("ignores an Origin header for some other site", () => {
    expect(siteOrigin(request("https://troop150.org/tree-recycling/checkout", "https://evil.example"))).toBe(
      "https://troop150.org",
    );
  });
});
