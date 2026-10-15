# Tree Recycling

Each January, Troop 150/5150 picks up Christmas trees and wreaths from curbs
and runs a drop-off lot, as a fundraiser. This document is in two parts:

1. **[Season runbook](#season-runbook):** what to do each year to get ready.
2. **[How it works](#how-it-works):** architecture, implementation, local
   development, and troubleshooting.

---

## Season runbook

Work through these steps on a branch, test on its preview site, then merge to
`main`. Plan on an hour or two, plus time for volunteers to try the preview.

### 1. Update the season settings

Edit [`src/config/treeRecycling.json`](../src/config/treeRecycling.json). It
holds only what changes each year:

```json
{
  "collectionDate": "2027-01-09",
  "requestDeadline": "2027-01-07",
  "pricePerTreeDollars": 15,
  "pricePerWreathDollars": 10
}
```

| Setting | Meaning |
| --- | --- |
| `collectionDate` | Pickup day. Its year also names the Tree Recycling sheet's tabs (see step 3). |
| `requestDeadline` | Last day to request a pickup. Requests close at midnight Pacific at the end of that day. |
| `pricePerTreeDollars`, `pricePerWreathDollars` | Prices for pickup and drop-off. |

Everything else is worked out from these
(`buildSettings` in [`settings.ts`](../src/lib/treeRecycling/settings.ts)):
the pickup date shown on the page, the "may be delayed overnight to Sunday"
note, the "9am on Saturday, January 9th" curb time on receipts and the form,
the deadline shown on the form, and the drop-off dates (the weekend before
pickup through the weekend after).

There is no "open" date: **the form is live as soon as it is deployed** and
closes automatically after `requestDeadline`. Merge to `main` only when you're
ready for people to start requesting pickups.

Things that rarely change are in code rather than settings. Edit them there if
needed:

- Form limits, support email (trees@troop150.org), and "How did you hear about
  us?" choices: `buildSettings` in `settings.ts`.
- Drop-off location, hours, and payment text: the Drop-off section of
  [`treerecycling.mdx`](../src/content/pages/treerecycling.mdx).
- Service area: see step 2.

### 2. Review the service area (only if it changes)

The ZIP codes and boundaries are defined in
[`scripts/build-service-area.py`](../scripts/build-service-area.py) (`ZIPS`
for every ZIP code served, plus a boundary for each one served only in part),
which generates `src/config/treeRecyclingServiceArea.json`. To change them,
edit the script and rerun it as its header explains; `--preview map.html` draws
a map to check. Then update the test locations in
[`serviceArea.test.ts`](../src/lib/treeRecycling/serviceArea.test.ts) so each
boundary has a test point on both sides, and run `npm test`.

At the lot, set the Venmo business profile's QR code amount to one tree's
price in the Venmo app; the website can't change it.

### 3. Check the Tree Recycling sheet

The [Tree Recycling](https://docs.google.com/spreadsheets/d/1TiLXFh8-Y09coQHAvwWLhJput4MCw75az0uFoUwAVh0)
Google Sheet gets two tabs per season, named from the
year of `collectionDate`: **`<year>`** for real payments and **`<year> Test`**
for Sandbox testing. They are created automatically, with a header row, on
the first recorded payment. Nothing to do unless you want to pre-format them.

If you rename the spreadsheet, nothing breaks; the site uses its ID.

### 4. Write the season post

Copy last year's post in `src/content/posts/` (for example
`tree-recycling-pickup-2026.md`) to a new file, update the `date`, and update
the dates, prices, and deadline in the text. Posts don't read the settings
file, so these must match by hand. Keep the same image unless you have a new
one.

### 5. Check credentials and accounts

These normally carry over, but confirm before the season:

- **Cloudflare Pages** (`troop150-website` → Settings → Variables and Secrets,
  with the environment selector at the top of the page): Production and
  Preview each have the variables in [Configuration](#configuration).
- **Square:** the troop's production webhook subscription to
  `https://troop150.org/tree-recycling/square-webhook` still exists, and its
  signature key matches Cloudflare's Production `SQUARE_WEBHOOK_SIGNATURE_KEY`.
  If anyone regenerated the production access token, update it in Cloudflare.
- **Google Cloud** (`troop150-website` project): billing is active, the budget
  alert is set, and the Maps key and service account key haven't been
  revoked. The sheet is still shared with the service account as Editor.
- **Cloudflare Access** still lists the right people for previews (see
  [Preview access](#preview-access)).

### 6. Test on the preview site

Do this season's work on a branch named **`tree-recycling`**, and it **must
be** that name. Square's Sandbox webhook is registered for that branch's
preview address,
`https://tree-recycling.troop150-website.pages.dev/tree-recycling/square-webhook`,
so on any other branch, test payments won't reach the Tree Recycling sheet.

1. Create the `tree-recycling` branch from `main` (or reuse it if it still
   exists), commit your changes, and push it to
   **pdxtroop150/troop150-website**. Cloudflare doesn't build branches from
   forks.
2. In Cloudflare (**Workers & Pages → troop150-website → Deployments**), wait
   for the preview build to finish.
3. Open `https://tree-recycling.troop150-website.pages.dev/treerecycling`,
   sign in (one-time PIN), and check:
   - An in-area address is accepted and standardized, an out-of-area one gets
     the "outside our pickup area" message, and a made-up one is not found.
   - The form totals match the new prices.
   - Paying on Square's Sandbox testing panel (**Test Payment**) returns you
     to the confirmation page.
   - A row appears in the **`<year> Test`** tab within a minute.

### 7. Launch

1. Open a pull request into `main`, review, and merge. The site deploys and
   **the form goes live immediately.**
2. **Smoke test right away, before announcing:** on troop150.org, make one
   real $15 pickup request with a real card or Apple/Google Pay, using your
   own email. Confirm the Square receipt email arrives with the curb note, a
   row appears in the **`<year>`** tab, and the payment shows in the Square
   Dashboard. Then have the Square admin refund it, and delete the row.
3. Publish the season post and send flyers or emails.

### 8. During and after the season

- Watch the `<year>` tab for new rows. The **Notes** column is for
  volunteers; the site never writes to it.
- If a payment appears in Square without a row, see
  [Troubleshooting](#troubleshooting).
- After `requestDeadline`, the form shows a "closed" message and the server
  rejects requests, with no deploy needed. The drop-off section stays up.

---

## How it works

### Customer flow

1. The customer opens [troop150.org/treerecycling](https://troop150.org/treerecycling)
   and fills in the form: contact info, address, pickup instructions, how
   they heard about us, tree and wreath counts, and a required additional
   donation (which may be $0).
2. **Check address** (or the final button) standardizes the address with
   Google and checks the service area. Out-of-area and unrecognized
   addresses get a note to email trees@troop150.org for mistakes or bulk pickups.
3. **Continue to secure payment with Square** sends the request to the server,
   which repeats every check, creates a Square order and payment link, and
   redirects the customer to Square's hosted payment page (Apple Pay, Google
   Pay, cards). There's no separate review step.
4. After payment, Square returns the customer to `/treerecycling/confirmation`
   on whichever site they started from, and emails a receipt (production
   only; Square's Sandbox never sends email).
5. Square notifies the site that the payment completed, and the site adds a
   row to the Tree Recycling sheet.

Drop-offs don't use the website: customers pay at the lot with Venmo, cash,
or check.

### Components

| Piece | Location |
| --- | --- |
| Season settings | `src/config/treeRecycling.json` (dates and prices), expanded by `buildSettings` in `src/lib/treeRecycling/settings.ts` |
| Service area | `src/config/treeRecyclingServiceArea.json` (ZIP codes and boundary polygons), generated by `scripts/build-service-area.py` |
| Page | `src/content/pages/treerecycling.mdx` |
| Form | `src/layouts/components/TreeRecyclingForm.tsx` (React island) |
| Confirmation page | `src/pages/treerecycling/confirmation.astro` |
| Shared logic | `src/lib/treeRecycling/` (settings and validation, service area, Google address validation, Square client, Google Sheets client, webhook signatures), with Vitest tests beside each file |
| Server functions | `functions/tree-recycling/` (Cloudflare Pages Functions) |
| Local webhook replay | `scripts/send-test-webhook.mjs` |

The site is static (Astro); the three Pages Functions are the only server code:

| Route | Purpose |
| --- | --- |
| `POST /tree-recycling/validate-address` | Google Address Validation, then the service-area check. |
| `POST /tree-recycling/checkout` | Re-validates everything, then creates the Square payment link and returns its URL. |
| `POST /tree-recycling/square-webhook` | Verifies Square's signature, looks up the payment and order, and appends the sheet row. |

The shared code in `src/lib/treeRecycling/` avoids Astro-only imports so both
the browser form and Wrangler can bundle it. The form and the server run the
same `validatePickupRequest`, so a modified page can't skip a check.

### Address checking and the service area

Google's Address Validation API returns a standardized address, its ZIP code,
and coordinates. An address counts as found only if Google matched a specific
building (`PREMISE` or `SUB_PREMISE`) **and** either confirmed every part of
it or USPS confirms it receives mail. Without that rule, Google "matches"
made-up house numbers on made-up streets.

The service-area check then uses the ZIP code: a ZIP served in full (97035,
97219, 97239) accepts any address, and a ZIP served in part also requires the
coordinates to fall inside that ZIP's polygon. Each polygon follows boundary roads or water from
OpenStreetMap and extends slightly beyond the ZIP, so the ZIP check is always
the outer limit. Current partial ZIPs:

| ZIP | Served area |
| --- | --- |
| 97034 | North of Oswego Lake |
| 97201 | South of US 26 and I-405 |
| 97221 | South of US 26 |
| 97223 | North of Highway 217 |
| 97229 | East of NW Saltzman Road, west of NW Skyline Boulevard, and south of NW Thompson Road |

### Pricing

Trees and wreaths are separate Square line items at the configured prices,
and a positive additional donation is a third. The server computes prices from
the settings file, never from the browser. The tree and wreath lines carry a
note that Square prints on the receipt, telling the customer where and when to
put their items out.

### Data flow: everything rides on the Square order

The site has no database. At checkout, the whole request is stored on the
Square order:

- **Line items** for trees, wreaths, and the donation, each tagged in its
  metadata with its kind (`tree`, `wreath`, `donation`).
- **Order metadata**: name, email, phone, standardized address, ZIP,
  collection date, customer instructions, how they heard about us, and a
  `source` marker identifying tree recycling orders. Square allows at most 10
  metadata entries of 255 characters each; we use 9, and blank values are
  left out because Square rejects them.

When Square sends `payment.updated`, the webhook function:

1. Verifies the `x-square-hmacsha256-signature` header: an HMAC-SHA256 of the
   request's own URL plus the body, keyed with `SQUARE_WEBHOOK_SIGNATURE_KEY`.
2. Fetches the payment from Square (not trusting the notification's copy) and
   continues only if it's `COMPLETED`.
3. Fetches the order and ignores it unless it carries the tree recycling
   `source` marker.
4. Appends the row to the `<year>` tab for production Square or `<year> Test`
   for Sandbox (creating the tab if needed), unless that order ID is already
   in the tab. Square retries notifications, so duplicates are expected.

Errors return `500`, so Square retries. Because every detail lives on the
Square order, any missing row can be rebuilt from Square.

The sheet's columns, in order:

> Square Order ID · Paid At · Name · Email · Phone · Address · ZIP · Trees ·
> Wreaths · Additional Donation · Total Paid · Customer Instructions ·
> Collection Date · Square Payment ID · Payment Status · Heard About Us · Notes

Changing columns in `SHEET_COLUMNS` (in `sheets.ts`) only affects new tabs, so
delete or fix an existing tab's header by hand.

The confirmation page doesn't need any of this: the form saves the address
and items in the browser's session storage before leaving for Square, and the
confirmation page reads them back. (Square's Sandbox doesn't add `orderId` to
the return address, so nothing relies on it.)

### Environments

| | Local | Preview | Production |
| --- | --- | --- | --- |
| Address | `http://localhost:4321` | `https://tree-recycling.troop150-website.pages.dev` | `https://troop150.org` |
| Git branch | any | `tree-recycling` in pdxtroop150 | `main` |
| Square | Sandbox | Sandbox | Production |
| Sheet tab | `<year> Test` | `<year> Test` | `<year>` |
| Secrets | `.dev.vars` (git-ignored) | Cloudflare **Preview** variables | Cloudflare **Production** variables |
| Access | none | Cloudflare Access sign-in | public |

`SQUARE_ENVIRONMENT=production` is the single switch for real money: it
selects Square's production API and the `<year>` tab. Anywhere it's unset,
the site uses Sandbox and the test tab.

### Configuration

| Name | Kind | Notes |
| --- | --- | --- |
| `SQUARE_ENVIRONMENT` | Text | `production` in Production only. Unset everywhere else. |
| `SQUARE_ACCESS_TOKEN` | Secret | Sandbox token (local, Preview) or the troop's production token. |
| `SQUARE_LOCATION_ID` | Text | The Sandbox test location or the troop's real location. |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Secret | From that environment's Square webhook subscription. |
| `GOOGLE_MAPS_API_KEY` | Secret | Restricted to the Address Validation API. |
| `GOOGLE_SERVICE_ACCOUNT` | Secret | The service account's JSON key on one line. In Cloudflare, paste it without surrounding quotes. |
| `TREE_SHEET_ID` | Text | The "Tree Recycling" spreadsheet's ID, from its address. |

No address settings are needed: Square's return link uses the address the
customer started from, and the webhook verifies signatures against the address
it was called on.

### Accounts

- **Square:** the troop's Square account (production) and a Square developer
  account with an application (Sandbox and production credentials, webhook
  subscriptions). On the troop's free Square plan, adding a team member with a
  custom permission set required upgrading, so production credentials and the
  production webhook are set up by the account owner, and Sandbox work can use
  a separate developer account. Receipt email settings are in the Square
  Dashboard.
- **Google Cloud project `troop150-website`:** Address Validation API and
  Google Sheets API enabled, billing with a budget alert, one API key, and one
  service account (`tree-sheet@…`) shared as Editor on the spreadsheet.
- **Cloudflare:** the `troop150-website` Pages project, connected to
  pdxtroop150/troop150-website through Cloudflare's GitHub app, and a free
  Zero Trust organization for preview access.

#### Square Sandbox webhook

In the Square Developer Console → application → **Webhooks → Subscriptions →
Sandbox**, one subscription for `payment.updated` points at the `tree-recycling`
branch's preview address,
`https://tree-recycling.troop150-website.pages.dev/tree-recycling/square-webhook`.
Cloudflare keeps that address pointed at the branch's latest build, so it never
needs updating as long as season work happens on that branch. Its signature
key is the Preview `SQUARE_WEBHOOK_SIGNATURE_KEY`. Keep just one Sandbox
subscription, since Preview holds only one key.

#### Preview access

Cloudflare Zero Trust (free for up to 50 users) protects previews:

- **Preview Websites** (`*.troop150-website.pages.dev`) with the **Allow Troop
  Leaders** policy: `@troop150.org` addresses plus specific Gmail addresses,
  signing in with a one-time PIN emailed by Cloudflare.
- **Preview Websites Tree Recycling Square Webhooks**
  (`*.troop150-website.pages.dev/tree-recycling/square-webhook`) with a
  **Bypass, Include Everyone** policy, so Square can reach the webhook. The
  function still rejects anything without Square's signature.

To check from a terminal: an unsigned `POST` to the webhook path should return
`401 {"error":"Invalid signature"}`, and the page should redirect (`302`) to
`cloudflareaccess.com`.

### Local development

1. Copy `.dev.vars.example` to `.dev.vars` and fill in Sandbox and Google
   values. For the service account key:

   ```bash
   python3 - ~/Downloads/your-key-file.json <<'EOF'
   import json, sys
   key = json.dumps(json.load(open(sys.argv[1])), separators=(",", ":"))
   lines = [l for l in open(".dev.vars").read().splitlines() if not l.startswith("GOOGLE_SERVICE_ACCOUNT=")]
   open(".dev.vars", "w").write("\n".join(lines + [f"GOOGLE_SERVICE_ACCOUNT='{key}'"]) + "\n")
   print("Saved key for", json.loads(key)["client_email"])
   EOF
   ```

2. Run `./run-wrangler.sh` (Pages Functions on port 8788) and `./run-dev.sh`
   (Astro on port 4321) in separate terminals. Astro proxies
   `/tree-recycling/*` to Wrangler.
3. Open `http://localhost:4321/treerecycling`.
4. After paying on Square's Sandbox testing panel, record the payment the way
   Square would:

   ```bash
   node scripts/send-test-webhook.mjs --times 2
   ```

   With no ID it uses your latest completed Sandbox payment. The second
   response should say `already recorded`.
5. `npm test` runs the Vitest suite. `npx astro check` and
   `npx tsc --noEmit -p functions/tree-recycling/tsconfig.json` type-check the
   site and the functions.

### Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Local form doesn't appear; console shows `jsxDEV is not a function` | Stale Vite cache. Stop Astro, `rm -rf node_modules/.vite`, restart. |
| Every address check fails | `GOOGLE_MAPS_API_KEY` missing or restricted to the wrong API, or Google billing lapsed. Check Cloudflare's function logs. |
| A real address is "not found" | Google couldn't confirm it to the building. Customers are told to email trees@troop150.org; handle it by hand. |
| Payment works but no row appears | Check the webhook subscription's delivery log in Square's Developer Console, the signature key in Cloudflare, `GOOGLE_SERVICE_ACCOUNT`, and that the sheet is shared with the service account. On previews, check the Access bypass with the `curl` test above. |
| Rows land in the wrong columns | The tab was created with an older header. Fix the header row, or delete the tab and let it be recreated. |
| No receipt email in testing | Square's Sandbox never sends email. Test receipts with the production smoke test. |
| Preview not built after a push | The branch must be in pdxtroop150, not a fork. |
| Preview payments don't add rows | The work must be on the `tree-recycling` branch, since that's the only preview address Square's Sandbox webhook calls. |

Cloudflare's function logs are in the Pages project under **Workers & Pages →
troop150-website**: open the deployment and look for its Functions or real-time
logs.
