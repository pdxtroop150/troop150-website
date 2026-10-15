// Appends paid pickup requests to the routing Google Sheet using a service
// account. Production and testing share one spreadsheet, on separate tabs
// (see sheetTabName), and a missing tab is created on first use.

export interface SheetsEnv {
  GOOGLE_SERVICE_ACCOUNT: string; // the service account's JSON key
  TREE_SHEET_ID: string;
}

export const SHEET_COLUMNS = [
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

export type SheetRow = Record<(typeof SHEET_COLUMNS)[number], string | number>;

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
  method: "GET" | "POST",
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

/** The tab name as a sheet range prefix, e.g. '2027 Test'. */
function rangePrefix(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

const knownTabs = new Set<string>();

/** Add the tab to the spreadsheet if it isn't there yet. */
async function ensureTab(env: SheetsEnv, tab: string): Promise<void> {
  if (knownTabs.has(tab)) {
    return;
  }
  const { sheets = [] } = await sheetsRequest<{
    sheets?: { properties: { title: string } }[];
  }>(env, "GET", "?fields=sheets.properties.title");
  if (!sheets.some((sheet) => sheet.properties.title === tab)) {
    await sheetsRequest(env, "POST", ":batchUpdate", {
      requests: [{ addSheet: { properties: { title: tab } } }],
    });
  }
  knownTabs.add(tab);
}

/**
 * Adds the row unless a row for the same Square order already exists, since
 * Square may deliver the same notification more than once. Writes the header
 * row first if the sheet is empty. Returns false if the row already existed.
 */
export async function appendRequestRow(
  env: SheetsEnv,
  tab: string,
  row: SheetRow,
): Promise<boolean> {
  await ensureTab(env, tab);
  const { values = [] } = await sheetsRequest<{ values?: string[][] }>(
    env,
    "GET",
    `/values/${encodeURIComponent(`${rangePrefix(tab)}!A:A`)}`,
  );
  const orderId = String(row["Square Order ID"]);
  if (values.some(([id]) => id === orderId)) {
    return false;
  }

  const rows = SHEET_COLUMNS.map((column) => row[column]);
  await sheetsRequest(
    env,
    "POST",
    `/values/${encodeURIComponent(`${rangePrefix(tab)}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values: values.length === 0 ? [[...SHEET_COLUMNS], rows] : [rows] },
  );
  return true;
}
