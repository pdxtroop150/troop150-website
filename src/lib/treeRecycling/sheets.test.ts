import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendRequestRow, SHEET_COLUMNS, type SheetRow } from "./sheets";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const env = {
  GOOGLE_SERVICE_ACCOUNT: JSON.stringify({
    client_email: "tree-sheet@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  }),
  TREE_SHEET_ID: "test-sheet",
};

const row = Object.fromEntries(SHEET_COLUMNS.map((c) => [c, ""])) as SheetRow;
row["Square Order ID"] = "order-1";

/**
 * A fake Google API holding a spreadsheet's tabs in memory. Tab names are
 * unique per test because the code remembers tabs it has already checked.
 */
function fakeGoogle(tabs: Record<string, string[][]>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = decodeURIComponent(url.replace(/^.*\/spreadsheets\/test-sheet/, ""));
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return Response.json({ access_token: "token", expires_in: 3600 });
      }
      calls.push(`${init?.method} ${path}`);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (path.startsWith("?fields")) {
        return Response.json({ sheets: Object.keys(tabs).map((title) => ({ properties: { title } })) });
      }
      if (path === ":batchUpdate") {
        tabs[body.requests[0].addSheet.properties.title] = [];
        return Response.json({});
      }
      const tab = path.match(/^\/values\/'(.*)'!/)![1];
      if (init?.method === "GET") {
        return Response.json({ values: tabs[tab].map((r) => [r[0]]) });
      }
      tabs[tab].push(...body.values);
      return Response.json({});
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("appendRequestRow", () => {
  it("creates a missing tab, then writes the header and the row", async () => {
    const tabs: Record<string, string[][]> = { "2027": [] };
    const calls = fakeGoogle(tabs);
    expect(await appendRequestRow(env, "2030 Test", row)).toBe(true);
    expect(calls).toContain("POST :batchUpdate");
    expect(tabs["2030 Test"]).toEqual([[...SHEET_COLUMNS], expect.arrayContaining(["order-1"])]);
    expect(tabs["2027"]).toEqual([]);
  });

  it("uses an existing tab without creating it again", async () => {
    const tabs = { "2031": [[...SHEET_COLUMNS], ["order-0"]] };
    const calls = fakeGoogle(tabs);
    expect(await appendRequestRow(env, "2031", row)).toBe(true);
    expect(calls).not.toContain("POST :batchUpdate");
    expect(tabs["2031"].map((r) => r[0])).toEqual(["Square Order ID", "order-0", "order-1"]);
  });

  it("does not add a second row for a repeated notification", async () => {
    const tabs: Record<string, string[][]> = { "2032 Test": [] };
    fakeGoogle(tabs);
    await appendRequestRow(env, "2032 Test", row);
    expect(await appendRequestRow(env, "2032 Test", row)).toBe(false);
    expect(tabs["2032 Test"]).toHaveLength(2);
  });

  it("leaves out coordinates", () => {
    expect(SHEET_COLUMNS).not.toContain("Latitude");
    expect(SHEET_COLUMNS).not.toContain("Longitude");
  });
});
