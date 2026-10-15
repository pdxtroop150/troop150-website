import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAddress } from "./addressValidation";

const input = { street: "8935 sw 52nd ave", unit: "", city: "portland", zip: "97219" };

/** Fake Google response; `result` fields override a confirmed premise match. */
function google(result: Record<string, unknown> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        result: {
          verdict: { validationGranularity: "PREMISE" },
          address: { formattedAddress: "8935 Southwest 52nd Avenue, Portland, OR 97219-3322, USA" },
          geocode: { location: { latitude: 45.4612, longitude: -122.7286 } },
          uspsData: {
            standardizedAddress: {
              firstAddressLine: "8935 SW 52ND AVE",
              cityStateZipAddressLine: "PORTLAND OR 97219-3322",
              zipCode: "97219",
            },
            dpvConfirmation: "Y",
          },
          ...result,
        },
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkAddress", () => {
  it("standardizes a confirmed address with friendly capitalization", async () => {
    google();
    expect(await checkAddress(input, "key")).toMatchObject({
      status: "in-area",
      address: { formatted: "8935 SW 52nd Ave, Portland, OR 97219", zip: "97219" },
    });
  });

  it("rejects a made-up address that Google matched but could not confirm", async () => {
    google({
      verdict: { validationGranularity: "PREMISE", hasUnconfirmedComponents: true },
      uspsData: { dpvConfirmation: undefined },
    });
    expect(await checkAddress(input, "key")).toEqual({ status: "not-found" });
  });

  it("accepts an unconfirmed unit when USPS confirms the building", async () => {
    google({
      verdict: { validationGranularity: "PREMISE", hasUnconfirmedComponents: true },
      uspsData: {
        standardizedAddress: {
          firstAddressLine: "8935 SW 52ND AVE",
          secondAddressLine: "APT 12B",
          cityStateZipAddressLine: "PORTLAND OR 97219-3322",
          zipCode: "97219",
        },
        dpvConfirmation: "S",
      },
    });
    expect(await checkAddress(input, "key")).toMatchObject({
      status: "in-area",
      address: { formatted: "8935 SW 52nd Ave Apt 12B, Portland, OR 97219" },
    });
  });

  it("treats a street-level match as not found", async () => {
    google({ verdict: { validationGranularity: "ROUTE" } });
    expect(await checkAddress(input, "key")).toEqual({ status: "not-found" });
  });
});
