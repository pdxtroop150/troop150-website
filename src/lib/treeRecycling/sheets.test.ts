import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendRequestRow, columnLetter, SHEET_COLUMNS, type SheetRow } from "./sheets";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const env = {
  GOOGLE_SERVICE_ACCOUNT: JSON.stringify({
    client_email: "tree-sheet@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  }),
  TREE_SHEET_ID: "test-sheet",
};

function row(orderId: string, overrides: Partial<SheetRow> = {}): SheetRow {
  const r = Object.fromEntries(SHEET_COLUMNS.map((c) => [c, ""])) as SheetRow;
  return { ...r, "Square Order ID": orderId, Type: "Pickup", Name: `Name ${orderId}`, ...overrides };
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
    const tabs = fakeGoogle({ "2027": [] });
    expect(await appendRequestRow(env, "2030 Test", row("o1"))).toBe(true);
    const rows = tabs.get("2030 Test")!.rows;
    expect(rows[0]).toEqual([...SHEET_COLUMNS]);
    expect(rows[1][0]).toBe("o1");
    expect(tabs.get("2027")!.rows).toEqual([]);
  });

  it("adds a header to an existing empty tab", async () => {
    const tabs = fakeGoogle({ "2031": [] });
    await appendRequestRow(env, "2031", row("o1"));
    expect(tabs.get("2031")!.rows.map((r) => r[0])).toEqual(["Square Order ID", "o1"]);
  });

  it("puts a header above rows that don't have one", async () => {
    const existing = SHEET_COLUMNS.map((c) => (c === "Square Order ID" ? "o0" : c === "Name" ? "Pat" : ""));
    const tabs = fakeGoogle({ "2032": [existing] });
    await appendRequestRow(env, "2032", row("o1"));
    const rows = tabs.get("2032")!.rows;
    expect(rows.map((r) => r[0])).toEqual(["Square Order ID", "o0", "o1"]);
    expect(rows[1][SHEET_COLUMNS.indexOf("Name")]).toBe("Pat");
  });

  it("migrates an older layout in place without losing data", async () => {
    // The original layout: coordinates, "Instructions", and no Type,
    // Heard About Us, or Notes columns. A volunteer added "Driver".
    const oldHeader = [
      "Square Order ID", "Paid At", "Name", "Email", "Phone", "Address", "ZIP",
      "Latitude", "Longitude", "Trees", "Wreaths", "Additional Donation", "Total Paid",
      "Instructions", "Collection Date", "Square Payment ID", "Payment Status", "Driver",
    ];
    const oldRow = [
      "o0", "2026-10-15", "Pat", "pat@example.com", "(503) 555-0100", "1 Main St", "97219",
      "45.4", "-122.7", "2", "1", "5.00", "45.00", "By the gate", "2027-01-09", "p0",
      "COMPLETED", "Sam",
    ];
    const tabs = fakeGoogle({ "2033": [[...oldHeader], [...oldRow]] });

    await appendRequestRow(env, "2033", row("o1", { Type: "Drop-off", Notes: "" }));
    const [header, migrated, added] = tabs.get("2033")!.rows;
    const cell = (r: string[], column: string) => r[header.indexOf(column)];

    // Type goes right after Paid At; Heard About Us and Notes after Payment Status.
    expect(header.slice(0, 4)).toEqual(["Square Order ID", "Paid At", "Type", "Name"]);
    expect(header).toContain("Customer Instructions");
    expect(header).not.toContain("Instructions");
    expect(header.indexOf("Heard About Us")).toBe(header.indexOf("Payment Status") + 1);
    expect(header.indexOf("Notes")).toBe(header.indexOf("Heard About Us") + 1);
    // Old and volunteer columns stay.
    expect(header).toEqual(expect.arrayContaining(["Latitude", "Longitude", "Driver"]));

    // The existing row keeps all its data under the right headers.
    expect(cell(migrated, "Type")).toBe("Pickup");
    expect(cell(migrated, "Name")).toBe("Pat");
    expect(cell(migrated, "Customer Instructions")).toBe("By the gate");
    expect(cell(migrated, "Latitude")).toBe("45.4");
    expect(cell(migrated, "Driver")).toBe("Sam");

    // The new row lines up with the migrated columns.
    expect(cell(added, "Square Order ID")).toBe("o1");
    expect(cell(added, "Type")).toBe("Drop-off");
    expect(cell(added, "Name")).toBe("Name o1");
    expect(cell(added, "Driver")).toBe("");
  });

  it("writes by header name when volunteers reorder columns", async () => {
    const header = [...SHEET_COLUMNS].reverse();
    const tabs = fakeGoogle({ "2034": [header] });
    await appendRequestRow(env, "2034", row("o1"));
    const [h, added] = tabs.get("2034")!.rows;
    expect(added[h.indexOf("Square Order ID")]).toBe("o1");
    expect(added[h.indexOf("Name")]).toBe("Name o1");
  });

  it("does not add a second row for a repeated notification", async () => {
    const tabs = fakeGoogle({ "2035 Test": [] });
    await appendRequestRow(env, "2035 Test", row("o1"));
    expect(await appendRequestRow(env, "2035 Test", row("o1"))).toBe(false);
    expect(tabs.get("2035 Test")!.rows).toHaveLength(2);
  });

  it("leaves out coordinates", () => {
    expect(SHEET_COLUMNS).not.toContain("Latitude");
    expect(SHEET_COLUMNS).not.toContain("Longitude");
  });
});
