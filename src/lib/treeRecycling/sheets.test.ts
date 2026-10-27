import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendRequestRow,
  columnLetter,
  DROPOFF_COLUMNS,
  PICKUP_COLUMNS,
  type SheetRow,
} from "./sheets";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const env = {
  GOOGLE_SERVICE_ACCOUNT: JSON.stringify({
    client_email: "tree-sheet@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  }),
  TREE_SHEET_ID: "test-sheet",
};

function row(orderId: string, overrides: Partial<SheetRow> = {}): SheetRow {
  const r = Object.fromEntries(PICKUP_COLUMNS.map((c) => [c, ""]));
  return { ...r, "Square Order ID": orderId, Name: `Name ${orderId}`, ...overrides };
}

/** Column index from letters: A -> 0, AA -> 26. */
const columnIndex = (letters: string) =>
  [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/**
 * A fake Google Sheets holding each tab as a grid of strings. Tab names are
 * unique per test because the code remembers tabs it has already looked up.
 */
function fakeGoogle(initial: Record<string, string[][]>) {
  const tabs = new Map(
    Object.entries(initial).map(([title, rows], i) => [title, { sheetId: 100 + i, rows }]),
  );
  const byId = (sheetId: number) => [...tabs.values()].find((t) => t.sheetId === sheetId)!;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return Response.json({ access_token: "token", expires_in: 3600 });
      }
      const path = decodeURIComponent(url.replace(/^.*\/spreadsheets\/test-sheet/, ""));
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;

      if (path.startsWith("?fields")) {
        return Response.json({
          sheets: [...tabs].map(([title, t]) => ({ properties: { title, sheetId: t.sheetId } })),
        });
      }
      if (path === ":batchUpdate") {
        const request = body.requests[0];
        if (request.addSheet) {
          const sheetId = 100 + tabs.size;
          tabs.set(request.addSheet.properties.title, { sheetId, rows: [] });
          return Response.json({ replies: [{ addSheet: { properties: { sheetId } } }] });
        }
        const { sheetId, dimension, startIndex } = request.insertDimension.range;
        const t = byId(sheetId);
        if (dimension === "ROWS") {
          t.rows.splice(startIndex, 0, []);
        } else {
          t.rows.forEach((r) => r.length > startIndex && r.splice(startIndex, 0, ""));
        }
        return Response.json({});
      }

      const [, title, cells] = path.match(/^\/values\/'(.*)'!([^?:]+(?::[A-Z]*\d*)?)/)!;
      const t = tabs.get(title)!;
      if (path.includes(":append")) {
        t.rows.push(...body.values.map((r: unknown[]) => r.map(String)));
        return Response.json({});
      }
      if (init?.method === "PUT") {
        const [, col, rowNumber] = cells.match(/^([A-Z]+)(\d+)/)!;
        (body.values as unknown[][]).forEach((values, i) => {
          const r = (t.rows[Number(rowNumber) - 1 + i] ??= []);
          values.forEach((v, j) => {
            while (r.length < columnIndex(col) + j) r.push("");
            r[columnIndex(col) + j] = String(v);
          });
        });
        return Response.json({});
      }
      // GET: a header row ("1:1") or part of one column ("C2:C").
      if (cells === "1:1") {
        const header = t.rows[0] ?? [];
        return Response.json({ values: header.length ? [header] : undefined });
      }
      const [, col, from] = cells.match(/^([A-Z]+)(\d+)/)!;
      const values = t.rows.slice(Number(from) - 1).map((r) => r[columnIndex(col)] ?? "");
      while (values.length && values[values.length - 1] === "") values.pop();
      return Response.json({ values: values.map((v) => (v ? [v] : [])) });
    }),
  );
  return tabs;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("columnLetter", () => {
  it("names columns the way Sheets does", () => {
    expect([0, 25, 26, 27, 51, 52].map(columnLetter)).toEqual(["A", "Z", "AA", "AB", "AZ", "BA"]);
  });
});

describe("appendRequestRow", () => {
  it("creates a missing tab with a header row", async () => {
    const tabs = fakeGoogle({ "2027 Test (Old)": [] });
    expect(await appendRequestRow(env, "2030 Pickups Test", "pickup", row("o1"))).toBe(true);
    const rows = tabs.get("2030 Pickups Test")!.rows;
    expect(rows[0]).toEqual([...PICKUP_COLUMNS]);
    expect(rows[1][0]).toBe("o1");
    expect(tabs.get("2027 Test (Old)")!.rows).toEqual([]);
  });

  it("gives drop-off tabs no pickup details", async () => {
    const tabs = fakeGoogle({});
    await appendRequestRow(
      env,
      "2030 Drop-offs Test",
      "dropoff",
      row("o1", { Address: "", ZIP: "", Trees: 2 }),
    );
    const [header, added] = tabs.get("2030 Drop-offs Test")!.rows;
    expect(header).toEqual([...DROPOFF_COLUMNS]);
    for (const column of ["Address", "ZIP", "Customer Instructions", "Collection Date"]) {
      expect(header).not.toContain(column);
    }
    expect(added[header.indexOf("Name")]).toBe("Name o1");
    expect(added[header.indexOf("Trees")]).toBe("2");
  });

  it("adds a header to an existing empty tab", async () => {
    const tabs = fakeGoogle({ "2031 Pickups": [] });
    await appendRequestRow(env, "2031 Pickups", "pickup", row("o1"));
    expect(tabs.get("2031 Pickups")!.rows.map((r) => r[0])).toEqual(["Square Order ID", "o1"]);
  });

  it("puts a header above rows that don't have one", async () => {
    const existing = PICKUP_COLUMNS.map((c) => (c === "Square Order ID" ? "o0" : c === "Name" ? "Pat" : ""));
    const tabs = fakeGoogle({ "2032 Pickups": [existing] });
    await appendRequestRow(env, "2032 Pickups", "pickup", row("o1"));
    const rows = tabs.get("2032 Pickups")!.rows;
    expect(rows.map((r) => r[0])).toEqual(["Square Order ID", "o0", "o1"]);
    expect(rows[1][PICKUP_COLUMNS.indexOf("Name")]).toBe("Pat");
  });

  it("adds missing columns in place without losing data", async () => {
    // A tab from before Heard About Us and Notes existed, where a volunteer
    // added "Driver".
    const oldHeader = [
      ...PICKUP_COLUMNS.filter((c) => c !== "Heard About Us" && c !== "Notes"),
      "Driver",
    ];
    const oldRow = oldHeader.map((c) => (c === "Square Order ID" ? "o0" : c === "Driver" ? "Sam" : `${c} 0`));
    const tabs = fakeGoogle({ "2033 Pickups": [[...oldHeader], [...oldRow]] });

    await appendRequestRow(env, "2033 Pickups", "pickup", row("o1", { "Heard About Us": "Email" }));
    const [header, migrated, added] = tabs.get("2033 Pickups")!.rows;
    const cell = (r: string[], column: string) => r[header.indexOf(column)];

    // Heard About Us and Notes go after Payment Status, before Driver.
    expect(header.indexOf("Heard About Us")).toBe(header.indexOf("Payment Status") + 1);
    expect(header.indexOf("Notes")).toBe(header.indexOf("Heard About Us") + 1);
    expect(header[header.length - 1]).toBe("Driver");

    // The existing row keeps all its data under the right headers.
    expect(cell(migrated, "Name")).toBe("Name 0");
    expect(cell(migrated, "Customer Instructions")).toBe("Customer Instructions 0");
    expect(cell(migrated, "Driver")).toBe("Sam");

    // The new row lines up with the new columns.
    expect(cell(added, "Square Order ID")).toBe("o1");
    expect(cell(added, "Heard About Us")).toBe("Email");
    expect(cell(added, "Driver")).toBe("");
  });

  it("writes by header name when volunteers reorder columns", async () => {
    const header = [...PICKUP_COLUMNS].reverse();
    const tabs = fakeGoogle({ "2034 Pickups": [header] });
    await appendRequestRow(env, "2034 Pickups", "pickup", row("o1"));
    const [h, added] = tabs.get("2034 Pickups")!.rows;
    expect(added[h.indexOf("Square Order ID")]).toBe("o1");
    expect(added[h.indexOf("Name")]).toBe("Name o1");
  });

  it("does not add a second row for a repeated notification", async () => {
    const tabs = fakeGoogle({ "2035 Drop-offs Test": [] });
    await appendRequestRow(env, "2035 Drop-offs Test", "dropoff", row("o1"));
    expect(await appendRequestRow(env, "2035 Drop-offs Test", "dropoff", row("o1"))).toBe(false);
    expect(tabs.get("2035 Drop-offs Test")!.rows).toHaveLength(2);
  });

  it("leaves out coordinates and the service type", () => {
    for (const column of ["Latitude", "Longitude", "Type"]) {
      expect(PICKUP_COLUMNS).not.toContain(column);
    }
  });
});
