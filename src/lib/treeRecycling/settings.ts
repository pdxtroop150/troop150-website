// Season settings and rules shared by the pickup form (browser) and the
// tree-recycling Pages Functions (server). Keep this file free of Astro-only
// imports so Wrangler can bundle it.
import settingsJson from "../../config/treeRecycling.json";

export type ZipCoverage = "full" | "partial";

export interface TreeRecyclingSettings {
  season: string;
  collectionDate: string;
  collectionDateLabel: string;
  collectionDateNote: string;
  /** Used in the receipt note, e.g. "9am on Saturday, January 9th". */
  curbDeadlineLabel: string;
  curbInstructions: string;
  requestDeadline: string;
  requestDeadlineLabel: string;
  pricePerTreeDollars: number;
  pricePerWreathDollars: number;
  maxTrees: number;
  maxWreaths: number;
  maxAdditionalDonationDollars: number;
  supportEmail: string;
  /** Choices for "How did you hear about us?" */
  referralSources: string[];
  zipCodes: Record<string, ZipCoverage>;
  dropOff: {
    location: string;
    address: string;
    dates: string;
    hours: string;
    venmoHandle: string;
    venmoQrImage: string;
    checksPayableTo: string;
  };
}

export const settings = settingsJson as TreeRecyclingSettings;

/** Pickup requests are accepted until the request deadline. */
export function requestsOpen(now: Date, s: TreeRecyclingSettings = settings): boolean {
  return now.getTime() <= new Date(s.requestDeadline).getTime();
}

export interface PickupRequest {
  name: string;
  email: string;
  phone: string;
  street: string;
  unit: string;
  city: string;
  zip: string;
  instructions: string;
  referral: string;
  trees: number;
  wreaths: number;
  /** Required; NaN until the customer enters an amount (which may be 0). */
  additionalDonationDollars: number;
}

export type OrderLineKind = "tree" | "wreath" | "donation";

export interface OrderLine {
  kind: OrderLineKind;
  name: string;
  quantity: number;
  unitCents: number;
}

/**
 * The order's line items: trees and wreaths at their set prices, plus any
 * additional donation. The form's summary and the Square order both use this.
 */
export function orderLines(
  r: Pick<PickupRequest, "trees" | "wreaths" | "additionalDonationDollars">,
  s: TreeRecyclingSettings = settings,
): OrderLine[] {
  const lines: OrderLine[] = [];
  if (r.trees > 0) {
    lines.push({ kind: "tree", name: "Tree pickup", quantity: r.trees, unitCents: s.pricePerTreeDollars * 100 });
  }
  if (r.wreaths > 0) {
    lines.push({ kind: "wreath", name: "Wreath pickup", quantity: r.wreaths, unitCents: s.pricePerWreathDollars * 100 });
  }
  const donationCents = Math.round(r.additionalDonationDollars * 100);
  if (donationCents > 0) {
    lines.push({ kind: "donation", name: "Additional donation", quantity: 1, unitCents: donationCents });
  }
  return lines;
}

/**
 * The receipt note on a tree or wreath line, e.g. "Please place your trees by
 * your curb at 123 SW Main St, Portland, OR 97219 by 9am on Saturday,
 * January 9th for pickup."
 */
export function pickupNote(
  line: OrderLine,
  address: string,
  s: TreeRecyclingSettings = settings,
): string {
  const item = `${line.kind}${line.quantity === 1 ? "" : "s"}`;
  return `Please place your ${item} by your curb at ${address} by ${s.curbDeadlineLabel} for pickup.`;
}

/**
 * The routing sheet tab for this season: the collection year ("2027") for
 * real payments, and "2027 Test" for Sandbox testing.
 */
export function sheetTabName(production: boolean, s: TreeRecyclingSettings = settings): string {
  const year = s.collectionDate.slice(0, 4);
  return production ? year : `${year} Test`;
}

export function orderTotalCents(lines: OrderLine[]): number {
  return lines.reduce((total, line) => total + line.quantity * line.unitCents, 0);
}

export function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/** "2 trees and 1 wreath" */
export function describeItems(trees: number, wreaths: number): string {
  const part = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return [trees > 0 && part(trees, "tree"), wreaths > 0 && part(wreaths, "wreath")]
    .filter(Boolean)
    .join(" and ");
}

export const MAX_INSTRUCTIONS_LENGTH = 250;

/** Browser session key for the request details shown on the confirmation page. */
export const CONFIRMATION_STORAGE_KEY = "treeRecyclingRequest";

/** Keep only the digits of a US phone number, dropping a leading 1. */
export function phoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
}

export function formatPhone(phone: string): string {
  const d = phoneDigits(phone);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : phone;
}

/**
 * Check a pickup request's fields. Returns a map of field name to error
 * message; an empty map means the request is valid. The browser and the
 * server both run this, so a modified page cannot skip it.
 */
export function validatePickupRequest(
  r: PickupRequest,
  s: TreeRecyclingSettings = settings,
): Partial<Record<keyof PickupRequest, string>> {
  const errors: Partial<Record<keyof PickupRequest, string>> = {};

  if (!r.name.trim() || r.name.length > 100) {
    errors.name = "Please enter your name.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim()) || r.email.length > 200) {
    errors.email = "Please enter a valid email address.";
  }
  if (phoneDigits(r.phone).length !== 10) {
    errors.phone = "Please enter a 10-digit phone number.";
  }
  if (!r.street.trim() || r.street.length > 200) {
    errors.street = "Please enter your street address.";
  }
  if (r.unit.length > 50) {
    errors.unit = "Please shorten the apartment or unit.";
  }
  if (!r.city.trim() || r.city.length > 100) {
    errors.city = "Please enter your city.";
  }
  if (!/^\d{5}$/.test(r.zip.trim())) {
    errors.zip = "Please enter a 5-digit ZIP code.";
  }
  if (r.instructions.length > MAX_INSTRUCTIONS_LENGTH) {
    errors.instructions = `Please keep instructions under ${MAX_INSTRUCTIONS_LENGTH} characters.`;
  }
  if (!s.referralSources.includes(r.referral)) {
    errors.referral = "Please tell us how you heard about us.";
  }
  if (!Number.isInteger(r.trees) || r.trees < 0 || r.trees > s.maxTrees) {
    errors.trees = `Please choose up to ${s.maxTrees} trees.`;
  }
  if (!Number.isInteger(r.wreaths) || r.wreaths < 0 || r.wreaths > s.maxWreaths) {
    errors.wreaths = `Please choose up to ${s.maxWreaths} wreaths.`;
  }
  if (!errors.trees && !errors.wreaths && r.trees + r.wreaths === 0) {
    errors.trees = "Please choose at least one tree or wreath.";
  }
  const donation = r.additionalDonationDollars;
  const wholeCents = Math.abs(Math.round(donation * 100) - donation * 100) < 1e-6;
  if (!Number.isFinite(donation) || donation < 0 || !wholeCents) {
    errors.additionalDonationDollars = "Please enter an additional donation amount, or 0.";
  } else if (donation > s.maxAdditionalDonationDollars) {
    errors.additionalDonationDollars = `For donations over $${s.maxAdditionalDonationDollars}, please contact us at ${s.supportEmail}.`;
  }

  return errors;
}
