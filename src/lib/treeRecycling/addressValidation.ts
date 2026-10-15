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
  zip: string;
  lat: number;
  lng: number;
}

export type AddressCheck =
  | { status: "in-area"; address: StandardizedAddress; coverageNote?: string }
  | { status: "out-of-area"; address: StandardizedAddress; coverageNote?: string }
  | { status: "not-found" };

interface GoogleValidationResponse {
  result?: {
    verdict?: {
      validationGranularity?: string;
      hasUnconfirmedComponents?: boolean;
    };
    address?: {
      formattedAddress?: string;
      postalAddress?: { postalCode?: string };
    };
    geocode?: { location?: { latitude?: number; longitude?: number } };
    uspsData?: {
      standardizedAddress?: {
        firstAddressLine?: string;
        secondAddressLine?: string;
        cityStateZipAddressLine?: string;
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

  const address: StandardizedAddress = {
    formatted: formatAddress(result, usps),
    zip,
    lat,
    lng,
  };
  const area = checkServiceArea(zip, lat, lng);
  return {
    status: area.inArea ? "in-area" : "out-of-area",
    address,
    coverageNote: area.coverageNote,
  };
}

/**
 * USPS formatting ("1234 SW MAIN ST APT 2, PORTLAND OR 97219-1234") is the
 * most consistent, so use it with friendlier capitalization when available.
 */
function formatAddress(
  result: NonNullable<GoogleValidationResponse["result"]>,
  usps: NonNullable<NonNullable<GoogleValidationResponse["result"]>["uspsData"]>["standardizedAddress"],
): string {
  if (usps?.firstAddressLine && usps.cityStateZipAddressLine) {
    const street = titleCaseStreet(
      [usps.firstAddressLine, usps.secondAddressLine].filter(Boolean).join(" "),
    );
    // "PORTLAND OR 97219-1234" -> "Portland, OR 97219"
    const match = usps.cityStateZipAddressLine.match(/^(.*) ([A-Z]{2}) (\d{5})/);
    if (match) {
      return `${street}, ${titleCase(match[1])}, ${match[2]} ${match[3]}`;
    }
  }
  return (result.address?.formattedAddress ?? "").replace(/, USA$/, "");
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
