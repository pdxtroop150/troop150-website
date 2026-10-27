// Appends paid requests to the Tree Recycling Google Sheet using a service
// account. Pickups and drop-offs, for production and for testing, share one
// spreadsheet on separate tabs (see sheetTabName), and a missing tab is
// created on first use.
//
// Rows are written by header name, not position, so volunteers can reorder
// columns or add their own. When a tab's columns change, existing tabs are
// migrated in place: missing columns are inserted where they belong (keeping
// formatting), and old columns are left alone.
import type { Service } from "./settings";

export interface SheetsEnv {
  GOOGLE_SERVICE_ACCOUNT: string; // the service account's JSON key
  TREE_SHEET_ID: string;
}

/** The pickup tab's columns. */
export const PICKUP_COLUMNS = [
  "Square Order ID",
  "Paid At",
  "Name",
  "Email",
  "Phone",
  "Address",
  "ZIP",
  "Trees",
  "Wreaths",
  "Additional Donation",
  "Total Paid",
  "Customer Instructions",
  "Collection Date",
  "Square Payment ID",
  "Payment Status",
  "Heard About Us",
  // Left blank for volunteers' own notes.
  "Notes",
] as const;

export type SheetColumn = (typeof PICKUP_COLUMNS)[number];

/** Pickup details that drop-offs don't have. */
const PICKUP_ONLY: readonly SheetColumn[] = [
  "Address",
  "ZIP",
  "Customer Instructions",
  "Collection Date",
];

/** The drop-off tab's columns: the pickup tab's, less the pickup details. */
export const DROPOFF_COLUMNS = PICKUP_COLUMNS.filter((c) => !PICKUP_ONLY.includes(c));

export function sheetColumns(service: Service): readonly SheetColumn[] {
  return service === "pickup" ? PICKUP_COLUMNS : DROPOFF_COLUMNS;
}

/** A row's values; columns the tab doesn't have are left out. */
export type SheetRow = Partial<Record<SheetColumn, string | number>> & {
  "Square Order ID": string;
};

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

let cachedToken: { token: string; expires: number; account: string } | undefined;

function base64Url(data: ArrayBuffer | string): string {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function accessToken(env: SheetsEnv): Promise<string> {
  const account = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT) as {
    client_email: string;
    private_key: string;
  };
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.account === account.client_email && cachedToken.expires > now + 60) {
    return cachedToken.token;
  }

  const der = Uint8Array.from(
    atob(account.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "")),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  )}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64Url(signature)}`,
    }),
  });
  if (!response.ok) {
    throw new Error(`Google token request returned ${response.status}: ${await response.text()}`);
  }
  const { access_token, expires_in } = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = { token: access_token, expires: now + expires_in, account: account.client_email };
  return access_token;
}

async function sheetsRequest<T>(
  env: SheetsEnv,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${SHEETS_API}/${encodeURIComponent(env.TREE_SHEET_ID)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken(env)}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Sheets ${method} ${path} returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** A range on the tab, e.g. 'Tab Name'!A1, with the tab name quoted. */
function range(tab: string, cells: string): string {
  return encodeURIComponent(`'${tab.replace(/'/g, "''")}'!${cells}`);
}

/** Column letter for a zero-based index: 0 -> A, 26 -> AA. */
export function columnLetter(index: number): string {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

async function readValues(env: SheetsEnv, tab: string, cells: string): Promise<string[][]> {
  const { values = [] } = await sheetsRequest<{ values?: string[][] }>(
    env,
    "GET",
    `/values/${range(tab, cells)}`,
  );
  return values;
}

async function writeValues(
  env: SheetsEnv,
  tab: string,
  cells: string,
  values: (string | number)[][],
): Promise<void> {
  await sheetsRequest(env, "PUT", `/values/${range(tab, cells)}?valueInputOption=RAW`, { values });
}

async function insertDimension(
  env: SheetsEnv,
  sheetId: number,
  dimension: "ROWS" | "COLUMNS",
  index: number,
): Promise<void> {
  await sheetsRequest(env, "POST", ":batchUpdate", {
    requests: [
      {
        insertDimension: {
          range: { sheetId, dimension, startIndex: index, endIndex: index + 1 },
          // Take formatting from the neighbor, like inserting in the Sheets app.
          inheritFromBefore: index > 0,
        },
      },
    ],
  });
}

const knownTabs = new Map<string, number>();

/** The tab's sheet ID, adding the tab to the spreadsheet if it isn't there yet. */
async function ensureTab(env: SheetsEnv, tab: string): Promise<number> {
  const known = knownTabs.get(tab);
  if (known !== undefined) {
    return known;
  }
  const { sheets = [] } = await sheetsRequest<{
    sheets?: { properties: { sheetId: number; title: string } }[];
  }>(env, "GET", "?fields=sheets.properties(sheetId,title)");
  let sheetId = sheets.find((sheet) => sheet.properties.title === tab)?.properties.sheetId;
  if (sheetId === undefined) {
    const { replies } = await sheetsRequest<{
      replies: { addSheet: { properties: { sheetId: number } } }[];
    }>(env, "POST", ":batchUpdate", { requests: [{ addSheet: { properties: { title: tab } } }] });
    sheetId = replies[0].addSheet.properties.sheetId;
  }
  knownTabs.set(tab, sheetId);
  return sheetId;
}

/**
 * The tab's header row, after bringing it up to date with the columns.
 * Adds a header to a tab without one, and inserts any missing columns next
 * to the column they follow.
 */
async function ensureHeader(
  env: SheetsEnv,
  tab: string,
  sheetId: number,
  columns: readonly SheetColumn[],
): Promise<string[]> {
  const header = (await readValues(env, tab, "1:1"))[0] ?? [];

  if (header.every((cell) => cell === "")) {
    await writeValues(env, tab, "A1", [[...columns]]);
    return [...columns];
  }
  if (!header.some((cell) => (columns as readonly string[]).includes(cell))) {
    // Data without a header row: put one above it.
    await insertDimension(env, sheetId, "ROWS", 0);
    await writeValues(env, tab, "A1", [[...columns]]);
    return [...columns];
  }

  for (const [k, column] of columns.entries()) {
    if (header.includes(column)) {
      continue;
    }
    // Insert right after the nearest earlier column that the tab has.
    const before = columns
      .slice(0, k)
      .map((c) => header.indexOf(c))
      .filter((i) => i >= 0);
    const index = before.length > 0 ? Math.max(...before) + 1 : 0;
    await insertDimension(env, sheetId, "COLUMNS", index);
    header.splice(index, 0, column);
    await writeValues(env, tab, `${columnLetter(index)}1`, [[column]]);
  }
  return header;
}

/**
 * Creates the tab if needed and brings its header up to date, without adding
 * a row. Writing a row does this too; this is for preparing a tab ahead of time.
 */
export async function prepareTab(env: SheetsEnv, tab: string, service: Service): Promise<string[]> {
  return ensureHeader(env, tab, await ensureTab(env, tab), sheetColumns(service));
}

/**
 * Adds the row unless a row for the same Square order already exists, since
 * Square may deliver the same notification more than once. Returns false if
 * the row already existed.
 */
export async function appendRequestRow(
  env: SheetsEnv,
  tab: string,
  service: Service,
  row: SheetRow,
): Promise<boolean> {
  const sheetId = await ensureTab(env, tab);
  const header = await ensureHeader(env, tab, sheetId, sheetColumns(service));

  const idColumn = columnLetter(header.indexOf("Square Order ID"));
  const ids = await readValues(env, tab, `${idColumn}2:${idColumn}`);
  const orderId = String(row["Square Order ID"]);
  if (ids.some(([id]) => id === orderId)) {
    return false;
  }

  // Line values up with this tab's columns; other columns stay blank.
  const values = header.map((column) => row[column as SheetColumn] ?? "");
  await sheetsRequest(
    env,
    "POST",
    `/values/${range(tab, "A1")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values: [values] },
  );
  return true;
}
