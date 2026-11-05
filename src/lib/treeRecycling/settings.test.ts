import { describe, expect, it } from "vitest";
import {
  buildSettings,
  describeItems,
  formatPhoneAsTyped,
  orderLines,
  formClosesAt,
  itemNote,
  orderTotalCents,
  serviceOpen,
  sheetTabName,
  settings,
  validateRequest,
  type RecyclingRequest,
} from "./settings";

const valid: RecyclingRequest = {
  name: "Pat Scout",
  email: "pat@example.com",
  phone: "(503) 555-0100",
  service: "pickup",
  street: "123 SW Main St",
  unit: "",
  city: "Portland",
  zip: "97219",
  instructions: "",
  referral: "Door hanger",
  trees: 2,
  wreaths: 1,
  additionalSupportDollars: 0,
};

describe("orderLines", () => {
  it("charges pickup prices for a pickup", () => {
    const lines = orderLines({ service: "pickup", trees: 2, wreaths: 3, additionalSupportDollars: 0 });
    expect(lines).toEqual([
      { kind: "tree", name: "Tree pickup", quantity: 2, unitCents: 2000 },
      { kind: "wreath", name: "Wreath pickup", quantity: 3, unitCents: 1000 },
    ]);
    expect(orderTotalCents(lines)).toBe(7000);
  });

  it("charges drop-off prices for a drop-off", () => {
    const lines = orderLines({ service: "dropoff", trees: 2, wreaths: 1, additionalSupportDollars: 0 });
    expect(lines).toEqual([
      { kind: "tree", name: "Tree drop-off", quantity: 2, unitCents: 1500 },
      { kind: "wreath", name: "Wreath drop-off", quantity: 1, unitCents: 1000 },
    ]);
    expect(orderTotalCents(lines)).toBe(4000);
  });

  it("uses the configured prices", () => {
    const custom = { ...settings, pickupTreeDollars: 25, dropOffWreathDollars: 12 };
    expect(orderLines({ service: "pickup", trees: 1, wreaths: 0, additionalSupportDollars: 0 }, custom)[0].unitCents).toBe(2500);
    expect(orderLines({ service: "dropoff", trees: 0, wreaths: 1, additionalSupportDollars: 0 }, custom)[0].unitCents).toBe(1200);
  });

  it("adds an additional support line only when it is above zero", () => {
    const lines = orderLines({ service: "pickup", trees: 1, wreaths: 0, additionalSupportDollars: 5.25 });
    expect(lines.map((l) => l.kind)).toEqual(["tree", "support"]);
    expect(orderTotalCents(lines)).toBe(2525);
  });

  it("allows wreaths without trees", () => {
    const lines = orderLines({ service: "dropoff", trees: 0, wreaths: 1, additionalSupportDollars: 0 });
    expect(lines.map((l) => l.kind)).toEqual(["wreath"]);
  });
});

describe("itemNote", () => {
  const address = "8935 SW 52nd Ave, Portland, OR 97219";
  it("tells pickup customers where and when to put items out", () => {
    const [trees, wreath] = orderLines({ service: "pickup", trees: 2, wreaths: 1, additionalSupportDollars: 0 });
    expect(itemNote(trees, "pickup", address)).toBe(
      "Please place your trees by your curb at 8935 SW 52nd Ave, Portland, OR 97219 by 9am on Saturday, January 9th for pickup. Please remove all lights, ornaments, tinsel, and stands. No flocked trees.",
    );
    expect(itemNote(wreath, "pickup", address)).toBe(
      "Please place your wreath by your curb at 8935 SW 52nd Ave, Portland, OR 97219 by 9am on Saturday, January 9th for pickup. Please remove all lights, ornaments, tinsel, and stands. No flocked trees.",
    );
  });

  it("tells drop-off customers where and when to bring items", () => {
    const [tree] = orderLines({ service: "dropoff", trees: 1, wreaths: 0, additionalSupportDollars: 0 });
    expect(itemNote(tree, "dropoff", "")).toBe(
      "Please bring your tree to St. Andrews Presbyterian Church (3228 SW Sunset Blvd, Portland, OR 97239) from 9am to 4pm, Saturdays and Sundays, January 2 through January 17, 2027, and show this receipt. Please remove all lights, ornaments, tinsel, and stands. No flocked trees.",
    );
  });
});

describe("sheetTabName", () => {
  it("uses the collection year and service, with separate tabs for testing", () => {
    expect(sheetTabName(true, "pickup")).toBe("2027 Pickups");
    expect(sheetTabName(true, "dropoff")).toBe("2027 Drop-offs");
    expect(sheetTabName(false, "pickup")).toBe("2027 Pickups Test");
    expect(sheetTabName(false, "dropoff")).toBe("2027 Drop-offs Test");
    expect(sheetTabName(false, "pickup", { ...settings, collectionDate: "2028-01-08" })).toBe(
      "2028 Pickups Test",
    );
  });
});

describe("formatPhoneAsTyped", () => {
  const typed = (keys: string) =>
    [...keys].reduce((value, key) => formatPhoneAsTyped(value + key, value, false).value, "");
  /** Apply an edit made with the cursor at the "|" in `edited`. */
  const edit = (edited: string, previous: string, deleting = false) => {
    const caret = edited.indexOf("|");
    const r = formatPhoneAsTyped(edited.replace("|", ""), previous, deleting, caret);
    return r.value.slice(0, r.caret) + "|" + r.value.slice(r.caret);
  };

  it("formats as digits are typed", () => {
    expect(typed("5")).toBe("(5");
    expect(typed("503")).toBe("(503");
    expect(typed("5035")).toBe("(503) 5");
    expect(typed("503555")).toBe("(503) 555");
    expect(typed("5035550")).toBe("(503) 555-0");
    expect(typed("5035550100")).toBe("(503) 555-0100");
  });

  it("ignores extra digits and non-digits", () => {
    expect(typed("50355501009")).toBe("(503) 555-0100");
    expect(typed("503-abc-555")).toBe("(503) 555");
  });

  it("drops a leading +1 from autofill or pasting", () => {
    expect(formatPhoneAsTyped("+1 503 555 0100", "", false).value).toBe("(503) 555-0100");
    expect(formatPhoneAsTyped("15035550100", "", false).value).toBe("(503) 555-0100");
  });

  it("backspaces from the end normally", () => {
    expect(edit("(503) 555-010|", "(503) 555-0100", true)).toBe("(503) 555-010|");
    expect(edit("(503) 555|", "(503) 555-0", true)).toBe("(503) 555|");
  });

  it("backspacing over punctuation removes the digit before it", () => {
    expect(edit("(503) 555|0100", "(503) 555-0100", true)).toBe("(503) 55|0-100");
    expect(edit("(503 |555-0100", "(503) 555-0100", true)).toBe("(50|5) 550-100");
  });

  it("keeps the cursor in place when editing mid-number", () => {
    expect(edit("(5039|) 555-010", "(503) 555-010")).toBe("(503) 9|55-5010");
    expect(edit("(50|) 555-0100", "(503) 555-0100", true)).toBe("(50|5) 550-100");
  });
});

describe("describeItems", () => {
  it("names trees and wreaths", () => {
    expect(describeItems(1, 0)).toBe("1 tree");
    expect(describeItems(2, 1)).toBe("2 trees and 1 wreath");
    expect(describeItems(0, 3)).toBe("3 wreaths");
  });
});

describe("validateRequest", () => {
  it("accepts a complete request", () => {
    expect(validateRequest(valid)).toEqual({});
  });

  it("accepts an additional support amount with cents", () => {
    expect(validateRequest({ ...valid, additionalSupportDollars: 5.1 })).toEqual({});
  });

  it("requires an additional support amount, even if it is 0", () => {
    expect(validateRequest({ ...valid, additionalSupportDollars: NaN })).toHaveProperty(
      "additionalSupportDollars",
    );
  });

  it("rejects negative, fractional-cent, and too-large additional support amounts", () => {
    for (const additionalSupportDollars of [-1, 1.005, settings.maxAdditionalSupportDollars + 1]) {
      expect(validateRequest({ ...valid, additionalSupportDollars })).toHaveProperty(
        "additionalSupportDollars",
      );
    }
  });

  it("requires at least one tree or wreath", () => {
    expect(validateRequest({ ...valid, trees: 0, wreaths: 0 })).toHaveProperty("trees");
    expect(validateRequest({ ...valid, trees: 0, wreaths: 1 })).toEqual({});
  });

  it("rejects bad tree and wreath counts", () => {
    for (const trees of [-1, 1.5, settings.maxTrees + 1, NaN]) {
      expect(validateRequest({ ...valid, trees })).toHaveProperty("trees");
    }
    for (const wreaths of [-1, 1.5, settings.maxWreaths + 1, NaN]) {
      expect(validateRequest({ ...valid, wreaths })).toHaveProperty("wreaths");
    }
  });

  it("requires a known referral source", () => {
    expect(validateRequest({ ...valid, referral: "" })).toHaveProperty("referral");
    expect(validateRequest({ ...valid, referral: "Billboard" })).toHaveProperty("referral");
    expect(validateRequest({ ...valid, referral: "Other" })).toEqual({});
  });

  it("accepts a phone number with a leading 1", () => {
    expect(validateRequest({ ...valid, phone: "+1 503 555 0100" })).toEqual({});
  });

  it("requires choosing pickup or drop-off", () => {
    expect(validateRequest({ ...valid, service: "" })).toHaveProperty("service");
  });

  it("doesn't need an address for a drop-off", () => {
    expect(
      validateRequest({ ...valid, service: "dropoff", street: "", city: "", zip: "", instructions: "x".repeat(300) }),
    ).toEqual({});
  });

  it("rejects missing contact and address fields", () => {
    const errors = validateRequest({
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
    pickupTreeDollars: 20,
    pickupWreathDollars: 15,
    dropOffTreeDollars: 15,
    dropOffWreathDollars: 15,
  });

  it("derives every date label from the two dates", () => {
    expect(season.collectionWeekendLabel).toBe("January 9 and 10, 2027");
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
    expect(buildSettings({ ...season, collectionDate: "2028-01-31" }).collectionWeekendLabel).toBe(
      "January 31 and February 1, 2028",
    );
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

describe("serviceOpen", () => {
  it("takes pickup requests through the end of the request deadline day", () => {
    expect(serviceOpen("pickup", new Date("2026-12-01T12:00:00-08:00"))).toBe(true);
    expect(serviceOpen("pickup", new Date("2027-01-07T23:59:00-08:00"))).toBe(true);
    expect(serviceOpen("pickup", new Date("2027-01-08T00:00:01-08:00"))).toBe(false);
  });

  it("takes drop-off prepayment through the last drop-off day", () => {
    expect(serviceOpen("dropoff", new Date("2027-01-08T00:00:01-08:00"))).toBe(true);
    expect(serviceOpen("dropoff", new Date("2027-01-17T23:59:00-08:00"))).toBe(true);
    expect(serviceOpen("dropoff", new Date("2027-01-18T00:00:01-08:00"))).toBe(false);
  });

  it("closes the form after the later of the two", () => {
    expect(new Date(formClosesAt()).toISOString()).toBe("2027-01-18T07:59:59.000Z");
  });
});
