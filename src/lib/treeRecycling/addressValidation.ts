// Server-side address standardization with the Google Address Validation API.
import { checkServiceArea } from "./serviceArea";

export interface AddressInput {
  street: string;
  unit: string;
  city: string;
  zip: string;
}

export interface StandardizedAddress {
  /** One-line address for people, e.g. "123 SW Main St, Portland, OR 97219". */
  formatted: string;
  /** The postal version split like the form's fields, e.g. "1500 SW 1st Ave". */
  street: string;
  /** "Apt 1201", or "" */
  unit: string;
  city: string;
  zip: string;
  lat: number;
  lng: number;
}

export type AddressCheck =
  | {
      status: "in-area" | "out-of-area";
      address: StandardizedAddress;
      /**
       * True when the postal address differs from what was typed by more than
       * capitalization and standard abbreviations, such as a fixed ZIP code,
       * city, or street name. The customer should confirm the change.
       */
      corrected: boolean;
      coverageNote?: string;
    }
  | { status: "not-found" };

interface GoogleValidationResponse {
  result?: {
    verdict?: {
      validationGranularity?: string;
      hasUnconfirmedComponents?: boolean;
      hasReplacedComponents?: boolean;
    };
    address?: {
      formattedAddress?: string;
      postalAddress?: { postalCode?: string; locality?: string; addressLines?: string[] };
    };
    geocode?: { location?: { latitude?: number; longitude?: number } };
    uspsData?: {
      standardizedAddress?: {
        firstAddressLine?: string;
        secondAddressLine?: string;
        cityStateZipAddressLine?: string;
        city?: string;
        zipCode?: string;
      };
      dpvConfirmation?: string;
    };
  };
}

// Matched to a specific building. Coarser matches (street or block only) are
// treated as not found so the customer can correct the address.
const PRECISE_ENOUGH = new Set(["PREMISE", "SUB_PREMISE"]);

// USPS confirms the address receives mail: Y (fully), or S/D (the building is
// confirmed but the apartment or unit is wrong or missing).
const USPS_CONFIRMED = new Set(["Y", "S", "D"]);

export async function checkAddress(
  input: AddressInput,
  apiKey: string,
): Promise<AddressCheck> {
  const addressLine = [input.street.trim(), input.unit.trim()]
    .filter(Boolean)
    .join(" ");

  const response = await fetch(
    `https://addressvalidation.googleapis.com/v1:validateAddress?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: {
          regionCode: "US",
          administrativeArea: "OR",
          locality: input.city.trim(),
          postalCode: input.zip.trim(),
          addressLines: [addressLine],
        },
        enableUspsCass: true,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Address Validation API returned ${response.status}: ${await response.text()}`,
    );
  }

  const { result } = (await response.json()) as GoogleValidationResponse;
  const granularity = result?.verdict?.validationGranularity ?? "";
  const lat = result?.geocode?.location?.latitude;
  const lng = result?.geocode?.location?.longitude;
  const usps = result?.uspsData?.standardizedAddress;
  const zip = (usps?.zipCode ?? result?.address?.postalAddress?.postalCode ?? "").slice(0, 5);

  // Google will "match" a made-up house number on a made-up street, but marks
  // it unconfirmed and USPS doesn't recognize it. Require one or the other.
  const confirmed =
    !result?.verdict?.hasUnconfirmedComponents ||
    USPS_CONFIRMED.has(result?.uspsData?.dpvConfirmation ?? "");

  if (
    !result ||
    !PRECISE_ENOUGH.has(granularity) ||
    !confirmed ||
    lat === undefined ||
    lng === undefined ||
    !/^\d{5}$/.test(zip)
  ) {
    return { status: "not-found" };
  }

  const parts = standardizedParts(result, zip);
  const address: StandardizedAddress = {
    ...parts,
    formatted: `${[parts.street, parts.unit].filter(Boolean).join(" ")}, ${parts.city}, OR ${parts.zip}`,
    lat,
    lng,
  };
  const area = checkServiceArea(zip, lat, lng);
  return {
    status: area.inArea ? "in-area" : "out-of-area",
    address,
    corrected: Boolean(result.verdict?.hasReplacedComponents) || differs(input, parts),
    coverageNote: area.coverageNote,
  };
}

// Words USPS puts before an apartment or unit number.
const UNIT_DESIGNATORS =
  "APT|UNIT|STE|SUITE|BLDG|FL|RM|SPC|TRLR|LOT|DEPT|OFC|PH|LOWR|UPPR|REAR|FRNT|SIDE|BSMT|LBBY|HNGR|KEY|PIER|SLIP|STOP";

/**
 * The postal address split into the form's fields. USPS puts the unit on the
 * street line ("1500 SW 1ST AVE APT 1201"), so split it back off.
 */
function standardizedParts(
  result: NonNullable<GoogleValidationResponse["result"]>,
  zip: string,
): { street: string; unit: string; city: string; zip: string } {
  const usps = result.uspsData?.standardizedAddress;
  if (usps?.firstAddressLine && usps.city) {
    const line = [usps.firstAddressLine, usps.secondAddressLine].filter(Boolean).join(" ");
    const match = line.match(new RegExp(`^(.*?)\\s+((?:#|(?:${UNIT_DESIGNATORS})\\b).*)$`));
    return {
      street: titleCaseStreet(match ? match[1] : line),
      unit: match ? titleCaseStreet(match[2]) : "",
      city: titleCase(usps.city),
      zip,
    };
  }
  const postal = result.address?.postalAddress;
  return {
    street: postal?.addressLines?.[0] ?? "",
    unit: "",
    city: postal?.locality ?? "",
    zip,
  };
}

// Spelled-out forms of USPS abbreviations, so typing either counts as the same.
const ABBREVIATIONS: Record<string, string> = {
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
  NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
  STREET: "ST", AVENUE: "AVE", AV: "AVE", BOULEVARD: "BLVD", ROAD: "RD", DRIVE: "DR",
  COURT: "CT", LANE: "LN", PLACE: "PL", TERRACE: "TER", CIRCLE: "CIR", PARKWAY: "PKWY",
  HIGHWAY: "HWY", TRAIL: "TRL", SQUARE: "SQ", CRESCENT: "CRES", HEIGHTS: "HTS",
  POINT: "PT", RIDGE: "RDG", VIEW: "VW", VISTA: "VIS", ALLEY: "ALY", CREST: "CRST",
  MOUNT: "MT", GREEN: "GRN", LOOP: "LOOP", WAY: "WAY",
  FIRST: "1ST", SECOND: "2ND", THIRD: "3RD", FOURTH: "4TH", FIFTH: "5TH",
  SIXTH: "6TH", SEVENTH: "7TH", EIGHTH: "8TH", NINTH: "9TH", TENTH: "10TH",
  APARTMENT: "APT", SUITE: "STE", BUILDING: "BLDG", FLOOR: "FL", ROOM: "RM", SPACE: "SPC",
};

/** Uppercase, abbreviated, without punctuation or unit designators like "Apt" or "#". */
function comparable(...parts: string[]): string {
  return parts
    .join(" ")
    .toUpperCase()
    .replace(/#/g, " ")
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ABBREVIATIONS[word] ?? word)
    .filter((word) => !new RegExp(`^(?:${UNIT_DESIGNATORS})$`).test(word))
    .join(" ");
}

/** Whether the postal address changed anything beyond formatting. */
function differs(
  input: AddressInput,
  parts: { street: string; unit: string; city: string; zip: string },
): boolean {
  return (
    comparable(input.street, input.unit) !== comparable(parts.street, parts.unit) ||
    comparable(input.city) !== comparable(parts.city) ||
    input.zip.trim() !== parts.zip
  );
}

const UPPERCASE_WORDS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW", "PO"]);

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

function titleCaseStreet(s: string): string {
  return s
    .split(" ")
    .map((word) =>
      UPPERCASE_WORDS.has(word)
        ? word
        : /\d/.test(word)
          ? word.replace(/^(\d+)(ST|ND|RD|TH)$/, (_, n, suffix) => n + suffix.toLowerCase()) // "52ND" -> "52nd"; "12B" stays
          : titleCase(word),
    )
    .join(" ");
}
