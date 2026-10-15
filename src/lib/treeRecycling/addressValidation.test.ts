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
              city: "PORTLAND",
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
          city: "PORTLAND",
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

  it("does not flag capitalization or standard abbreviations as corrections", async () => {
    google();
    const check = await checkAddress(
      { street: "8935 Southwest 52nd Avenue", unit: "", city: "portland", zip: "97219" },
      "key",
    );
    expect(check).toMatchObject({ status: "in-area", corrected: false });
  });

  it("flags a ZIP code Google replaced", async () => {
    google({ verdict: { validationGranularity: "PREMISE", hasReplacedComponents: true } });
    expect(await checkAddress({ ...input, zip: "97239" }, "key")).toMatchObject({
      corrected: true,
      address: { zip: "97219" },
    });
  });

  it("flags a misspelled street that Google fixed without saying so", async () => {
    google();
    expect(
      await checkAddress({ ...input, street: "8935 SW 52nd Avnue" }, "key"),
    ).toMatchObject({ corrected: true, address: { street: "8935 SW 52nd Ave" } });
  });

  it("splits the unit back off the postal street line", async () => {
    google({
      uspsData: {
        standardizedAddress: {
          firstAddressLine: "1500 SW 1ST AVE APT 1201",
          city: "PORTLAND",
          zipCode: "97201",
        },
        dpvConfirmation: "Y",
      },
    });
    const check = await checkAddress(
      { street: "1500 SW First Ave", unit: "#1201", city: "Portland", zip: "97201" },
      "key",
    );
    expect(check).toMatchObject({
      corrected: false,
      address: {
        street: "1500 SW 1st Ave",
        unit: "Apt 1201",
        city: "Portland",
        zip: "97201",
        formatted: "1500 SW 1st Ave Apt 1201, Portland, OR 97201",
      },
    });
  });

  it("uses Google's correction when USPS couldn't match the typed street", async () => {
    google({
      address: {
        formattedAddress: "4128 Southwest Condor Avenue, Portland, OR 97239-4107, USA",
        postalAddress: {
          addressLines: ["4128 Southwest Condor Avenue"],
          locality: "Portland",
          postalCode: "97239-4107",
        },
      },
      geocode: { location: { latitude: 45.4934, longitude: -122.6791 } },
      // USPS echoes the typo back without confirming it.
      uspsData: {
        standardizedAddress: {
          firstAddressLine: "4128 SW CODOR AVE",
          city: "PORTLAND",
          zipCode: "97239",
        },
      },
    });
    expect(
      await checkAddress(
        { street: "4128 SW Codor Ave", unit: "", city: "Portland", zip: "97239" },
        "key",
      ),
    ).toMatchObject({
      status: "in-area",
      corrected: true,
      address: { street: "4128 SW Condor Ave", city: "Portland", zip: "97239" },
    });
  });
});
