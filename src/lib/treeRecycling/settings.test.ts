import { describe, expect, it } from "vitest";
import {
  describeItems,
  orderLines,
  orderTotalCents,
  pickupNote,
  requestsOpen,
  sheetTabName,
  settings,
  validatePickupRequest,
  type PickupRequest,
} from "./settings";

const valid: PickupRequest = {
  name: "Pat Scout",
  email: "pat@example.com",
  phone: "(503) 555-0100",
  street: "123 SW Main St",
  unit: "",
  city: "Portland",
  zip: "97219",
  instructions: "",
  referral: "Door hanger",
  trees: 2,
  wreaths: 1,
  additionalDonationDollars: 0,
};

describe("orderLines", () => {
  it("charges $15 per tree and $10 per wreath", () => {
    const lines = orderLines({ trees: 2, wreaths: 3, additionalDonationDollars: 0 });
    expect(lines).toEqual([
      { kind: "tree", name: "Tree pickup", quantity: 2, unitCents: 1500 },
      { kind: "wreath", name: "Wreath pickup", quantity: 3, unitCents: 1000 },
    ]);
    expect(orderTotalCents(lines)).toBe(6000);
  });

  it("adds an additional donation line only when it is above zero", () => {
    const lines = orderLines({ trees: 1, wreaths: 0, additionalDonationDollars: 5.25 });
    expect(lines.map((l) => l.kind)).toEqual(["tree", "donation"]);
    expect(orderTotalCents(lines)).toBe(2025);
  });

  it("allows wreaths without trees", () => {
    const lines = orderLines({ trees: 0, wreaths: 1, additionalDonationDollars: 0 });
    expect(lines.map((l) => l.kind)).toEqual(["wreath"]);
  });
});

describe("pickupNote", () => {
  const address = "3228 SW Sunset Blvd, Portland, OR 97239";
  it("tells the customer where and when to put items out", () => {
    const [trees, wreath] = orderLines({ trees: 2, wreaths: 1, additionalDonationDollars: 0 });
    expect(pickupNote(trees, address)).toBe(
      "Please place your trees by your curb at 3228 SW Sunset Blvd, Portland, OR 97239 by 9am on Saturday, January 9th for pickup.",
    );
    expect(pickupNote(wreath, address)).toBe(
      "Please place your wreath by your curb at 3228 SW Sunset Blvd, Portland, OR 97239 by 9am on Saturday, January 9th for pickup.",
    );
  });
});

describe("sheetTabName", () => {
  it("uses the collection year, with a separate tab for testing", () => {
    expect(sheetTabName(true)).toBe("2027");
    expect(sheetTabName(false)).toBe("2027 Test");
    expect(sheetTabName(false, { ...settings, collectionDate: "2028-01-08" })).toBe("2028 Test");
  });
});

describe("describeItems", () => {
  it("names trees and wreaths", () => {
    expect(describeItems(1, 0)).toBe("1 tree");
    expect(describeItems(2, 1)).toBe("2 trees and 1 wreath");
    expect(describeItems(0, 3)).toBe("3 wreaths");
  });
});

describe("validatePickupRequest", () => {
  it("accepts a complete request", () => {
    expect(validatePickupRequest(valid)).toEqual({});
  });

  it("accepts an additional donation with cents", () => {
    expect(validatePickupRequest({ ...valid, additionalDonationDollars: 5.1 })).toEqual({});
  });

  it("requires an additional donation amount, even if it is 0", () => {
    expect(validatePickupRequest({ ...valid, additionalDonationDollars: NaN })).toHaveProperty(
      "additionalDonationDollars",
    );
  });

  it("rejects negative, fractional-cent, and too-large additional donations", () => {
    for (const additionalDonationDollars of [-1, 1.005, settings.maxAdditionalDonationDollars + 1]) {
      expect(validatePickupRequest({ ...valid, additionalDonationDollars })).toHaveProperty(
        "additionalDonationDollars",
      );
    }
  });

  it("requires at least one tree or wreath", () => {
    expect(validatePickupRequest({ ...valid, trees: 0, wreaths: 0 })).toHaveProperty("trees");
    expect(validatePickupRequest({ ...valid, trees: 0, wreaths: 1 })).toEqual({});
  });

  it("rejects bad tree and wreath counts", () => {
    for (const trees of [-1, 1.5, settings.maxTrees + 1, NaN]) {
      expect(validatePickupRequest({ ...valid, trees })).toHaveProperty("trees");
    }
    for (const wreaths of [-1, 1.5, settings.maxWreaths + 1, NaN]) {
      expect(validatePickupRequest({ ...valid, wreaths })).toHaveProperty("wreaths");
    }
  });

  it("requires a known referral source", () => {
    expect(validatePickupRequest({ ...valid, referral: "" })).toHaveProperty("referral");
    expect(validatePickupRequest({ ...valid, referral: "Billboard" })).toHaveProperty("referral");
    expect(validatePickupRequest({ ...valid, referral: "Other" })).toEqual({});
  });

  it("accepts a phone number with a leading 1", () => {
    expect(validatePickupRequest({ ...valid, phone: "+1 503 555 0100" })).toEqual({});
  });

  it("rejects missing contact and address fields", () => {
    const errors = validatePickupRequest({
      ...valid,
      name: " ",
      email: "pat",
      phone: "555-0100",
      street: "",
      city: "",
      zip: "9721",
    });
    expect(Object.keys(errors).sort()).toEqual(
      ["city", "email", "name", "phone", "street", "zip"].sort(),
    );
  });
});

describe("requestsOpen", () => {
  it("accepts requests until the deadline", () => {
    const deadline = new Date(settings.requestDeadline).getTime();
    expect(requestsOpen(new Date("2026-12-01T12:00:00-08:00"))).toBe(true);
    expect(requestsOpen(new Date(deadline))).toBe(true);
    expect(requestsOpen(new Date(deadline + 1000))).toBe(false);
  });
});
