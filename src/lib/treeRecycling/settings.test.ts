import { describe, expect, it } from "vitest";
import {
  buildSettings,
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

describe("buildSettings", () => {
  const season = buildSettings({
    collectionDate: "2027-01-09",
    requestDeadline: "2027-01-07",
    pricePerTreeDollars: 15,
    pricePerWreathDollars: 10,
  });

  it("derives every date label from the two dates", () => {
    expect(season.collectionDateLabel).toBe("Saturday, January 9, 2027");
    expect(season.collectionDateNote).toBe(
      "Depending on weather and other circumstances, pickup may be delayed overnight to Sunday, January 10, but we guarantee pickup that weekend.",
    );
    expect(season.curbDeadlineLabel).toBe("9am on Saturday, January 9th");
    expect(season.curbInstructions).toContain("by your curb by 9am on Saturday, January 9th,");
    expect(season.requestDeadlineLabel).toBe("Thursday, January 7, 2027");
    expect(season.dropOffDatesLabel).toBe(
      "Saturdays and Sundays, January 2 through January 17, 2027",
    );
  });

  it("closes requests at the end of the deadline day, Pacific time", () => {
    expect(new Date(season.requestDeadlineAt).toISOString()).toBe("2027-01-08T07:59:59.000Z");
    expect(new Date(buildSettings({ ...season, requestDeadline: "2027-07-07" }).requestDeadlineAt).toISOString()).toBe(
      "2027-07-08T06:59:59.000Z",
    );
  });

  it("handles ordinals and drop-off weekends that start in December", () => {
    const early = buildSettings({ ...season, collectionDate: "2028-01-02" });
    expect(early.curbDeadlineLabel).toBe("9am on Sunday, January 2nd");
    expect(early.dropOffDatesLabel).toBe(
      "Saturdays and Sundays, December 26, 2027 through January 10, 2028",
    );
    expect(buildSettings({ ...season, collectionDate: "2028-01-11" }).curbDeadlineLabel).toBe(
      "9am on Tuesday, January 11th",
    );
    expect(buildSettings({ ...season, collectionDate: "2028-01-23" }).curbDeadlineLabel).toBe(
      "9am on Sunday, January 23rd",
    );
  });
});

describe("requestsOpen", () => {
  it("accepts requests through the end of the deadline day", () => {
    expect(requestsOpen(new Date("2026-12-01T12:00:00-08:00"))).toBe(true);
    expect(requestsOpen(new Date("2027-01-07T23:59:00-08:00"))).toBe(true);
    expect(requestsOpen(new Date("2027-01-08T00:00:01-08:00"))).toBe(false);
  });
});
