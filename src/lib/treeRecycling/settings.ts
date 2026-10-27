// Season settings and rules shared by the tree recycling form (browser) and
// the tree-recycling Pages Functions (server). Keep this file free of Astro-only
// imports so Wrangler can bundle it.
import seasonConfig from "../../config/treeRecycling.json";

/** The yearly values in src/config/treeRecycling.json. */
export interface SeasonConfig {
  /** Pickup day, "YYYY-MM-DD". Its year also names the sheet tabs. */
  collectionDate: string;
  /** Last day to request a pickup, "YYYY-MM-DD"; requests close at midnight Pacific. */
  requestDeadline: string;
  pickupTreeDollars: number;
  pickupWreathDollars: number;
  dropOffTreeDollars: number;
  dropOffWreathDollars: number;
}

/** Curbside pickup, or prepaying for a drop-off at the lot. */
export type Service = "pickup" | "dropoff";

export interface TreeRecyclingSettings extends SeasonConfig {
  /** Pickup day and the day after: "January 9 and 10, 2027" */
  collectionWeekendLabel: string;
  collectionDateNote: string;
  /** Used in the receipt note: "9am on Saturday, January 9th". */
  curbDeadlineLabel: string;
  curbInstructions: string;
  /** When requests close, in milliseconds since 1970. */
  requestDeadlineAt: number;
  /** "Thursday, January 7, 2027" */
  requestDeadlineLabel: string;
  /** Drop-off runs from the weekend before pickup through the weekend after. */
  dropOffDatesLabel: string;
  /** "January 2 through January 17" */
  dropOffShortDatesLabel: string;
  /** When drop-off prepayment closes (end of the last drop-off day). */
  dropOffEndAt: number;
  dropOffLocation: string;
  dropOffAddress: string;
  dropOffHours: string;
  maxTrees: number;
  maxWreaths: number;
  maxAdditionalDonationDollars: number;
  supportEmail: string;
  /** Choices for "How did you hear about us?" */
  referralSources: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A "YYYY-MM-DD" date plus some days, as a UTC Date (time of day ignored). */
function day(date: string, plusDays = 0): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) + plusDays * DAY_MS);
}

function format(date: Date, options: Intl.DateTimeFormatOptions): string {
  return date.toLocaleDateString("en-US", { timeZone: "UTC", ...options });
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** "January 9 and 10, 2027", or "January 31 and February 1, 2027" across months. */
function weekendLabel(first: Date, second: Date): string {
  const secondDay =
    first.getUTCMonth() === second.getUTCMonth()
      ? format(second, { day: "numeric" })
      : format(second, { month: "long", day: "numeric" });
  return `${format(first, { month: "long", day: "numeric" })} and ${secondDay}, ${second.getUTCFullYear()}`;
}

/** The last second of a "YYYY-MM-DD" day in Portland, whether PST or PDT. */
function endOfPacificDay(date: string): number {
  for (const offset of ["-08:00", "-07:00"]) {
    const at = Date.parse(`${date}T23:59:59${offset}`);
    const hour = new Date(at).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      hourCycle: "h23",
    });
    if (hour === "23") {
      return at;
    }
  }
  return Date.parse(`${date}T23:59:59-08:00`);
}

/** Everything the site shows or enforces, derived from the yearly config. */
export function buildSettings(config: SeasonConfig): TreeRecyclingSettings {
  const pickup = day(config.collectionDate);
  const weekdayMonth = { weekday: "long", month: "long" } as const;
  const curbDeadlineLabel =
    `9am on ${format(pickup, { weekday: "long" })}, ` +
    `${format(pickup, { month: "long" })} ${ordinal(pickup.getUTCDate())}`;
  const dropOffStart = day(config.collectionDate, -7);
  const dropOffEnd = day(config.collectionDate, 8);
  const sameYear = dropOffStart.getUTCFullYear() === dropOffEnd.getUTCFullYear();
  const dropOffShortDatesLabel =
    `${format(dropOffStart, { month: "long", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })} ` +
    `through ${format(dropOffEnd, { month: "long", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })}`;

  return {
    ...config,
    collectionWeekendLabel: weekendLabel(pickup, day(config.collectionDate, 1)),
    collectionDateNote: "Depending on weather and other circumstances, pickups may be delayed.",
    curbDeadlineLabel,
    curbInstructions:
      `Please place your trees and wreaths by your curb by ${curbDeadlineLabel}, ` +
      "with all lights, ornaments, tinsel, and stands removed. No flocked trees.",
    requestDeadlineAt: endOfPacificDay(config.requestDeadline),
    requestDeadlineLabel: format(day(config.requestDeadline), {
      ...weekdayMonth,
      day: "numeric",
      year: "numeric",
    }),
    dropOffDatesLabel:
      "Saturdays and Sundays, " +
      `${format(dropOffStart, { month: "long", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })} ` +
      `through ${format(dropOffEnd, { month: "long", day: "numeric", year: "numeric" })}`,
    dropOffShortDatesLabel,
    dropOffEndAt: endOfPacificDay(dropOffEnd.toISOString().slice(0, 10)),
    dropOffLocation: "St. Andrews Presbyterian Church",
    dropOffAddress: "3228 SW Sunset Blvd, Portland, OR 97239",
    dropOffHours: "9am to 4pm",
    maxTrees: 10,
    maxWreaths: 10,
    maxAdditionalDonationDollars: 1000,
    supportEmail: "trees@troop150.org",
    referralSources: [
      "Internet search",
      "Door hanger",
      "Sign on street",
      "Metro website",
      "Word of mouth",
      "Email",
      "Other",
    ],
  };
}

export const settings = buildSettings(seasonConfig as SeasonConfig);

/**
 * Pickup requests are accepted through the request deadline day; drop-off
 * prepayment through the last drop-off day.
 */
export function serviceOpen(
  service: Service,
  now: Date,
  s: TreeRecyclingSettings = settings,
): boolean {
  return now.getTime() <= (service === "pickup" ? s.requestDeadlineAt : s.dropOffEndAt);
}

/** When the form stops taking any requests: the later of the two closings. */
export function formClosesAt(s: TreeRecyclingSettings = settings): number {
  return Math.max(s.requestDeadlineAt, s.dropOffEndAt);
}

export function prices(service: Service, s: TreeRecyclingSettings = settings) {
  return service === "pickup"
    ? { treeDollars: s.pickupTreeDollars, wreathDollars: s.pickupWreathDollars }
    : { treeDollars: s.dropOffTreeDollars, wreathDollars: s.dropOffWreathDollars };
}

export interface RecyclingRequest {
  name: string;
  email: string;
  phone: string;
  /** "" until the customer chooses. */
  service: Service | "";
  /** The address and instructions apply to pickups only. */
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
 * The order's line items: trees and wreaths at the chosen service's prices,
 * plus any additional donation. The form's summary and the Square order both
 * use this.
 */
export function orderLines(
  r: Pick<RecyclingRequest, "trees" | "wreaths" | "additionalDonationDollars"> & {
    service: Service;
  },
  s: TreeRecyclingSettings = settings,
): OrderLine[] {
  const { treeDollars, wreathDollars } = prices(r.service, s);
  const label = r.service === "pickup" ? "pickup" : "drop-off";
  const lines: OrderLine[] = [];
  if (r.trees > 0) {
    lines.push({ kind: "tree", name: `Tree ${label}`, quantity: r.trees, unitCents: treeDollars * 100 });
  }
  if (r.wreaths > 0) {
    lines.push({ kind: "wreath", name: `Wreath ${label}`, quantity: r.wreaths, unitCents: wreathDollars * 100 });
  }
  const donationCents = Math.round(r.additionalDonationDollars * 100);
  if (donationCents > 0) {
    lines.push({ kind: "donation", name: "Additional donation", quantity: 1, unitCents: donationCents });
  }
  return lines;
}

/**
 * The receipt note on a tree or wreath line. For a pickup, e.g. "Please place
 * your trees by your curb at 123 SW Main St, Portland, OR 97219 by 9am on
 * Saturday, January 9th for pickup." For a drop-off, where and when to bring
 * them.
 */
/** How to get trees and wreaths ready, for the receipt notes. */
const PREPARATION = "Please remove all lights, ornaments, tinsel, and stands. No flocked trees.";

export function itemNote(
  line: OrderLine,
  service: Service,
  address: string,
  s: TreeRecyclingSettings = settings,
): string {
  const item = `${line.kind}${line.quantity === 1 ? "" : "s"}`;
  const where =
    service === "pickup"
      ? `Please place your ${item} by your curb at ${address} by ${s.curbDeadlineLabel} for pickup.`
      : `Please bring your ${item} to ${s.dropOffLocation} (${s.dropOffAddress}) ` +
        `from ${s.dropOffHours}, ${s.dropOffDatesLabel}, and show this receipt.`;
  return `${where} ${PREPARATION}`;
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

/**
 * Browser storage key for the request details shown on the confirmation page.
 * Local storage, not session storage, so the details survive Square returning
 * the customer in a new tab. Kept for CONFIRMATION_STORAGE_MS.
 */
export const CONFIRMATION_STORAGE_KEY = "treeRecyclingRequest";
export const CONFIRMATION_STORAGE_MS = 24 * 60 * 60 * 1000;

/** Keep only the digits of a US phone number, dropping a leading 1. */
export function phoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
}

function formatPhoneDigits(d: string): string {
  if (d.length === 0) return "";
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Formats a US phone number as it's typed: "(503", "(503) 555", then
 * "(503) 555-0100", and says where the cursor belongs afterward so edits in
 * the middle of the number keep their place. A leading +1 from autofill or
 * pasting is dropped. If a backspace removed only punctuation, the digit
 * before it goes too, so backspacing never gets stuck on ")" or "-".
 */
export function formatPhoneAsTyped(
  value: string,
  previous: string,
  deleting: boolean,
  caret: number = value.length,
): { value: string; caret: number } {
  let digitsBefore = value.slice(0, caret).replace(/\D/g, "").length;
  let d = value.replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("1")) {
    d = d.slice(1);
    digitsBefore = Math.max(0, digitsBefore - 1);
  }
  d = d.slice(0, 10);
  digitsBefore = Math.min(digitsBefore, d.length);
  if (deleting && digitsBefore > 0 && d === previous.replace(/\D/g, "")) {
    d = d.slice(0, digitsBefore - 1) + d.slice(digitsBefore);
    digitsBefore -= 1;
  }

  const formatted = formatPhoneDigits(d);
  let position = digitsBefore === 0 && formatted ? 1 : 0;
  for (let i = 0, seen = 0; i < formatted.length && seen < digitsBefore; i++) {
    if (/\d/.test(formatted[i])) {
      seen += 1;
      position = i + 1;
    }
  }
  return { value: formatted, caret: position };
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
export function validateRequest(
  r: RecyclingRequest,
  s: TreeRecyclingSettings = settings,
): Partial<Record<keyof RecyclingRequest, string>> {
  const errors: Partial<Record<keyof RecyclingRequest, string>> = {};

  if (!r.name.trim() || r.name.length > 100) {
    errors.name = "Please enter your name.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim()) || r.email.length > 200) {
    errors.email = "Please enter a valid email address.";
  }
  if (phoneDigits(r.phone).length !== 10) {
    errors.phone = "Please enter a 10-digit phone number.";
  }
  if (r.service !== "pickup" && r.service !== "dropoff") {
    errors.service = "Please choose pickup or drop-off.";
  }
  if (r.service === "pickup") {
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
