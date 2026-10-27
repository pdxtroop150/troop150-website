import {
  CONFIRMATION_STORAGE_KEY,
  MAX_INSTRUCTIONS_LENGTH,
  describeItems,
  formatDollars,
  formatPhoneAsTyped,
  orderLines,
  orderTotalCents,
  prices,
  serviceOpen,
  settings,
  validateRequest,
  type RecyclingRequest,
  type Service,
} from "@/lib/treeRecycling/settings";
import React, { useEffect, useRef, useState } from "react";

const ADDRESS_FIELDS = ["street", "unit", "city", "zip"] as const;
type FieldErrors = Partial<Record<keyof RecyclingRequest, string>>;

interface CheckedAddress {
  formatted: string;
  street: string;
  unit: string;
  city: string;
  zip: string;
}

type AddressResponse =
  | {
      status: "in-area" | "out-of-area";
      address: CheckedAddress;
      /** The postal address differs from what was typed; ask before using it. */
      corrected: boolean;
      coverageNote?: string;
    }
  | { status: "not-found" }
  | { error: string };

interface PendingCorrection {
  typed: string;
  suggested: CheckedAddress;
  resolve: (accepted: boolean) => void;
}

const emptyRequest: RecyclingRequest = {
  name: "",
  email: "",
  phone: "",
  service: "",
  street: "",
  unit: "",
  city: "",
  zip: "",
  instructions: "",
  referral: "",
  trees: 1,
  wreaths: 0,
  additionalDonationDollars: NaN,
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({
    error: "Something went wrong. Please try again.",
  }));
  return data as T;
}

function OrderSummary({ request, service }: { request: RecyclingRequest; service: Service }) {
  const lines = orderLines({
    ...request,
    service,
    additionalDonationDollars: Number.isFinite(request.additionalDonationDollars)
      ? request.additionalDonationDollars
      : 0,
  });
  return (
    <table className="mb-6 w-full text-left">
      <tbody>
        {lines.map((line) => (
          <tr key={line.kind} className="border-b border-border">
            <td className="py-2">
              {line.name}
              {line.kind !== "donation" &&
                ` (${line.quantity} × ${formatDollars(line.unitCents)})`}
            </td>
            <td className="py-2 text-right">{formatDollars(line.quantity * line.unitCents)}</td>
          </tr>
        ))}
        <tr>
          <td className="py-2 font-bold text-dark">Total</td>
          <td className="py-2 text-right text-lg font-bold text-dark">
            {formatDollars(orderTotalCents(lines))}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function Field({
  label,
  name,
  error,
  hint,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <label htmlFor={name} className="mb-1 block font-semibold text-dark">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-sm text-text">{hint}</p>}
      {error && (
        <p id={`${name}-error`} className="mt-1 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default function TreeRecyclingForm() {
  // Which services are still taking requests; decided in the browser because
  // the site is static.
  const [open, setOpen] = useState<Record<Service, boolean> | null>(null);
  const [request, setRequest] = useState<RecyclingRequest>(emptyRequest);
  const [donationText, setDonationText] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<React.ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState<CheckedAddress | null>(null);
  const [addressNote, setAddressNote] = useState<React.ReactNode>(null);
  const [checkingAddress, setCheckingAddress] = useState(false);
  // A suggested correction awaiting the customer's answer in the dialog.
  const [correction, setCorrection] = useState<PendingCorrection | null>(null);
  // The customer kept their address over our correction, so it can't be used.
  const [declined, setDeclined] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const now = new Date();
    setOpen({ pickup: serviceOpen("pickup", now), dropoff: serviceOpen("dropoff", now) });
  }, []);

  useEffect(() => {
    if (correction && !dialogRef.current?.open) {
      dialogRef.current?.showModal();
    }
  }, [correction]);

  /** Show the suggested correction and wait for the customer's answer. */
  function confirmCorrection(typed: string, suggested: CheckedAddress): Promise<boolean> {
    return new Promise((resolve) => setCorrection({ typed, suggested, resolve }));
  }

  function answerCorrection(accepted: boolean) {
    dialogRef.current?.close();
    correction?.resolve(accepted);
    setCorrection(null);
  }

  function update<K extends keyof RecyclingRequest>(key: K, value: RecyclingRequest[K]) {
    setRequest((r) => ({ ...r, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    if ((ADDRESS_FIELDS as readonly string[]).includes(key)) {
      // A changed address needs checking again.
      setAddress(null);
      setAddressNote(null);
      setDeclined(false);
    }
  }

  function focusFirst(found: FieldErrors) {
    const firstError = Object.keys(found)[0];
    if (firstError) {
      document.getElementById(firstError)?.focus();
    }
    return Boolean(firstError);
  }

  /** Standardize the address and check the service area. */
  async function checkAddress(): Promise<CheckedAddress | null> {
    setMessage(null);
    const all = validateRequest(request);
    const found: FieldErrors = Object.fromEntries(
      ADDRESS_FIELDS.filter((f) => all[f]).map((f) => [f, all[f]]),
    );
    setErrors((e) => ({ ...e, ...found }));
    if (focusFirst(found)) {
      return null;
    }

    setCheckingAddress(true);
    const result = await postJson<AddressResponse>("/tree-recycling/validate-address", {
      street: request.street,
      unit: request.unit,
      city: request.city,
      zip: request.zip,
    });
    setCheckingAddress(false);

    const helpNote = (
      <span className="mt-2 block text-sm">
        If you think this is a mistake, or to schedule a bulk pickup, please email us at{" "}
        <a className="text-primary underline" href={`mailto:${settings.supportEmail}`}>
          {settings.supportEmail}
        </a>
        .
      </span>
    );

    if (!("error" in result) && result.status !== "not-found" && result.corrected) {
      const typed = `${[request.street, request.unit].filter((p) => p.trim()).join(" ")}, ${request.city}, OR ${request.zip}`;
      if (!(await confirmCorrection(typed, result.address))) {
        setDeclined(true);
        setAddressNote(
          <>
            <span className="text-red-700">
              We couldn't confirm this address as entered, so we can't schedule a pickup
              for it. Please correct it, or select Check address to see our suggested
              address again.
            </span>
            {helpNote}
          </>,
        );
        return null;
      }
    }

    if (!("error" in result) && result.status !== "not-found") {
      // Show the postal formatting in the form, so it matches what we'll save.
      // Formatting-only changes like "blvd" -> "Blvd" need no confirmation.
      const { street, unit, city, zip } = result.address;
      setRequest((r) => ({ ...r, street, unit, city, zip }));
      setErrors((e) => ({ ...e, street: undefined, unit: undefined, city: undefined, zip: undefined }));
    }

    if ("error" in result) {
      setAddressNote(
        <>
          <span className="text-red-700">{result.error}</span>
          {helpNote}
        </>,
      );
    } else if (result.status === "not-found") {
      setErrors((e) => ({
        ...e,
        street:
          "We couldn't find this address. Please check the street number, street name, and ZIP code.",
      }));
      setAddressNote(helpNote);
      document.getElementById("street")?.focus();
    } else if (result.status === "out-of-area") {
      setAddressNote(
        <>
          <span className="text-red-700">
            Sorry, <strong>{result.address.formatted}</strong> is outside our pickup area
            {result.coverageNote
              ? ` (in ZIP code ${result.address.zip}, we serve only addresses ${result.coverageNote})`
              : ""}
            . You're welcome to choose drop-off instead.
          </span>
          {helpNote}
        </>,
      );
    } else {
      setAddress(result.address);
      setAddressNote(
        <span className="text-primary">
          ✓ We pick up at <strong>{result.address.formatted}</strong>.
        </span>,
      );
      return result.address;
    }
    return null;
  }

  function changeCount(key: "trees" | "wreaths", count: number) {
    setRequest((r) => ({ ...r, [key]: count }));
    setErrors((e) => ({ ...e, trees: undefined, wreaths: undefined }));
  }

  function changeDonation(text: string) {
    setDonationText(text);
    update("additionalDonationDollars", text.trim() === "" ? NaN : Number(text));
  }

  /** Check everything, then go straight to Square's payment page. */
  async function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    setMessage(null);
    const found = validateRequest(request);
    setErrors(found);
    if (focusFirst(found)) {
      return;
    }

    // Pickups need a checked address. A declined correction blocks payment
    // until the address is changed or the suggestion is accepted.
    let checked: CheckedAddress | null = null;
    if (request.service === "pickup") {
      checked = address ?? (declined ? null : await checkAddress());
      if (!checked) {
        document.getElementById("check-address")?.scrollIntoView({ block: "center" });
        return;
      }
    }

    setBusy(true);
    const result = await postJson<{ url?: string; error?: string; fields?: FieldErrors }>(
      "/tree-recycling/checkout",
      request,
    );
    if (result.url) {
      // Saved so the confirmation page can repeat the details after Square.
      try {
        localStorage.setItem(
          CONFIRMATION_STORAGE_KEY,
          JSON.stringify({
            service: request.service,
            address: checked?.formatted ?? "",
            items: describeItems(request.trees, request.wreaths),
            savedAt: Date.now(),
          }),
        );
      } catch {
        // The confirmation page falls back to a general message.
      }
      window.location.href = result.url;
      return;
    }
    setBusy(false);
    if (result.fields) {
      setErrors(result.fields);
      focusFirst(result.fields);
    }
    setMessage(result.error ?? "Something went wrong. Please try again.");
  }

  if (open === null) {
    return null;
  }
  if (!open.pickup && !open.dropoff) {
    return (
      <div className="not-prose rounded-lg border border-border bg-theme-light p-6">
        Tree recycling is over for this season. Thank you for supporting Troop 150!
      </div>
    );
  }
  const service = request.service || null;

  const inputClass = (field: keyof RecyclingRequest) =>
    `form-input w-full ${errors[field] ? "border-red-700" : ""}`;
  const describedBy = (field: keyof RecyclingRequest) =>
    errors[field] ? `${field}-error` : undefined;

  const messageBox = message && (
    <div className="mb-6 rounded-lg border border-red-700 bg-red-50 p-4 text-dark" role="alert">
      {message}
    </div>
  );

  return (
    <>
    <form
      id="pickup-form"
      className="not-prose rounded-lg border border-border p-6 md:p-8"
      onSubmit={submit}
      noValidate
    >
      <h3 className="mb-4 text-h4 font-bold text-dark">Request a pickup or prepay a drop-off</h3>

      <Field label="Name" name="name" error={errors.name}>
        <input
          id="name"
          className={inputClass("name")}
          autoComplete="name"
          value={request.name}
          onChange={(e) => update("name", e.target.value)}
          aria-describedby={describedBy("name")}
        />
      </Field>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Email" name="email" error={errors.email} hint="We will send a request confirmation to this address.">
          <input
            id="email"
            type="email"
            className={inputClass("email")}
            autoComplete="email"
            value={request.email}
            onChange={(e) => update("email", e.target.value)}
            aria-describedby={describedBy("email")}
          />
        </Field>
        <Field
          label="Phone"
          name="phone"
          error={errors.phone}
          hint="Only used if we need to reach you about your request."
        >
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            className={inputClass("phone")}
            autoComplete="tel-national"
            maxLength={14}
            value={request.phone}
            onChange={(e) => {
              const input = e.target;
              const { value, caret } = formatPhoneAsTyped(
                input.value,
                request.phone,
                (e.nativeEvent as InputEvent).inputType?.startsWith("delete") ?? false,
                input.selectionStart ?? input.value.length,
              );
              update("phone", value);
              // React sets the new value after this handler, so restore the
              // cursor once it has.
              requestAnimationFrame(() => input.setSelectionRange(caret, caret));
            }}
            aria-describedby={describedBy("phone")}
          />
        </Field>
      </div>

      <fieldset className="mb-6">
        <legend className="mb-2 block font-semibold text-dark">Pickup or drop-off?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["pickup", "dropoff"] as const).map((option) => {
            const { treeDollars, wreathDollars } = prices(option);
            const available = open[option];
            const chosen = request.service === option;
            return (
              <label
                key={option}
                className={`flex cursor-pointer gap-3 rounded-lg border p-4 transition ${
                  chosen ? "border-primary bg-theme-light" : "border-border"
                } ${available ? "hover:border-primary" : "cursor-not-allowed opacity-60"}`}
              >
                <input
                  type="radio"
                  name="service"
                  value={option}
                  className="mt-1 text-primary focus:ring-primary"
                  checked={chosen}
                  disabled={!available}
                  onChange={() => update("service", option)}
                  aria-describedby={describedBy("service")}
                />
                <span>
                  <span className="block font-semibold text-dark">
                    {option === "pickup" ? "Curbside pickup" : `Drop-off at ${settings.dropOffLocation}`}
                  </span>
                  <span className="block text-sm">
                    {option === "pickup"
                      ? settings.collectionDateLabel
                      : `${settings.dropOffShortDatesLabel} (weekends)`}
                  </span>
                  <span className="block text-sm">
                    {available
                      ? treeDollars === wreathDollars
                        ? `$${treeDollars} per tree or wreath`
                        : `$${treeDollars} per tree, $${wreathDollars} per wreath`
                      : option === "pickup"
                        ? `Pickup requests closed ${settings.requestDeadlineLabel}.`
                        : "Drop-off prepayment is closed."}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {errors.service && (
          <p id="service-error" className="mt-1 text-sm text-red-700" role="alert">
            {errors.service}
          </p>
        )}
      </fieldset>

      {service === "pickup" && (
      <>
      <Field label="Street address" name="street" error={errors.street}>
        <input
          id="street"
          className={inputClass("street")}
          autoComplete="address-line1"
          value={request.street}
          onChange={(e) => update("street", e.target.value)}
          aria-describedby={describedBy("street")}
        />
      </Field>
      <div className="grid gap-x-4 sm:grid-cols-[1fr_2fr_1fr]">
        <Field label="Apt / unit (optional)" name="unit" error={errors.unit}>
          <input
            id="unit"
            className={inputClass("unit")}
            autoComplete="address-line2"
            value={request.unit}
            onChange={(e) => update("unit", e.target.value)}
            aria-describedby={describedBy("unit")}
          />
        </Field>
        <Field label="City" name="city" error={errors.city}>
          <input
            id="city"
            className={inputClass("city")}
            autoComplete="address-level2"
            value={request.city}
            onChange={(e) => update("city", e.target.value)}
            aria-describedby={describedBy("city")}
          />
        </Field>
        <Field label="ZIP code" name="zip" error={errors.zip}>
          <input
            id="zip"
            className={inputClass("zip")}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={5}
            value={request.zip}
            onChange={(e) => update("zip", e.target.value)}
            aria-describedby={describedBy("zip")}
          />
        </Field>
      </div>

      <div id="check-address" className="mb-6">
        <button
          type="button"
          className="btn btn-outline-primary disabled:opacity-60"
          onClick={checkAddress}
          disabled={checkingAddress || busy}
        >
          {checkingAddress ? "Checking address…" : address ? "Address checked" : "Check address"}
        </button>
        {addressNote && (
          <p className="mt-3" role="status">
            {addressNote}
          </p>
        )}
      </div>

      <Field
        label="Pickup instructions (optional)"
        name="instructions"
        error={errors.instructions}
      >
        <textarea
          id="instructions"
          className={`form-textarea w-full ${errors.instructions ? "border-red-700" : ""}`}
          rows={2}
          maxLength={MAX_INSTRUCTIONS_LENGTH}
          value={request.instructions}
          onChange={(e) => update("instructions", e.target.value)}
          aria-describedby={describedBy("instructions")}
        />
      </Field>

      </>
      )}

      {service === "dropoff" && (
        <div className="mb-6 rounded-md bg-theme-light p-4">
          <p className="font-semibold text-dark">
            Bring your trees and wreaths to {settings.dropOffLocation}
          </p>
          <p className="mt-1 text-sm">
            {settings.dropOffAddress}, from {settings.dropOffHours}, {settings.dropOffDatesLabel}.
            Please remove all lights, ornaments, tinsel, and stands, and show your receipt at the
            lot.
          </p>
        </div>
      )}

      {service && (
      <>
      <Field label="How did you hear about us?" name="referral" error={errors.referral}>
        <select
          id="referral"
          className={`form-select w-full rounded-md border-border py-3 text-text focus:border-primary focus:ring-transparent ${errors.referral ? "border-red-700" : ""}`}
          value={request.referral}
          onChange={(e) => update("referral", e.target.value)}
          aria-describedby={describedBy("referral")}
          required
        >
          <option value="" disabled>
            Choose one
          </option>
          {settings.referralSources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-x-4 sm:grid-cols-3">
        <Field
          label="Trees"
          name="trees"
          error={errors.trees}
          hint={`$${prices(service).treeDollars} each`}
        >
          <select
            id="trees"
            className="form-select w-full rounded-md border-border py-3 text-text focus:border-primary focus:ring-transparent"
            value={request.trees}
            onChange={(e) => changeCount("trees", Number(e.target.value))}
            aria-describedby={describedBy("trees")}
          >
            {Array.from({ length: settings.maxTrees + 1 }, (_, n) => n).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Wreaths"
          name="wreaths"
          error={errors.wreaths}
          hint={`$${prices(service).wreathDollars} each`}
        >
          <select
            id="wreaths"
            className="form-select w-full rounded-md border-border py-3 text-text focus:border-primary focus:ring-transparent"
            value={request.wreaths}
            onChange={(e) => changeCount("wreaths", Number(e.target.value))}
            aria-describedby={describedBy("wreaths")}
          >
            {Array.from({ length: settings.maxWreaths + 1 }, (_, n) => n).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Additional donation"
          name="additionalDonationDollars"
          error={errors.additionalDonationDollars}
        >
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dark">
              $
            </span>
            <input
              id="additionalDonationDollars"
              type="number"
              inputMode="decimal"
              className={`${inputClass("additionalDonationDollars")} pl-7`}
              min={0}
              max={settings.maxAdditionalDonationDollars}
              step="any"
              required
              value={donationText}
              onChange={(e) => changeDonation(e.target.value)}
              aria-describedby={describedBy("additionalDonationDollars")}
            />
          </div>
        </Field>
      </div>

      <OrderSummary request={request} service={service} />

      {service === "pickup" && (
        <div className="mb-6 rounded-md bg-theme-light p-4">
          <p className="font-semibold text-dark">Collection date: {settings.collectionDateLabel}</p>
          <p className="mt-1 text-sm">{settings.collectionDateNote}</p>
          <p className="mt-2 text-sm">{settings.curbInstructions}</p>
        </div>
      )}

      {messageBox}
      <button
        type="submit"
        className="btn btn-primary disabled:opacity-60"
        disabled={busy || checkingAddress}
      >
        {checkingAddress
          ? "Checking address…"
          : busy
            ? "Opening Square…"
            : "Continue to secure payment with Square"}
      </button>
      <p className="mt-3 text-sm">
        Square accepts Apple Pay, Google Pay, and credit or debit cards. Your request is
        complete once payment goes through.
      </p>
      </>
      )}
      <p className="mt-3 text-sm">
        Pickup requests close {settings.requestDeadlineLabel}. Questions? Email{" "}
        <a className="text-primary underline" href={`mailto:${settings.supportEmail}`}>
          {settings.supportEmail}
        </a>
        .
      </p>
    </form>

    <dialog
      ref={dialogRef}
      className="not-prose w-[calc(100%-2rem)] max-w-md rounded-lg border border-border p-6 text-text backdrop:bg-black/50"
      aria-labelledby="correction-title"
      onCancel={(e) => {
        e.preventDefault();
        answerCorrection(false);
      }}
    >
      {correction && (
        <>
          <h3 id="correction-title" className="mb-3 text-h5 font-bold text-dark">
            Confirm your address
          </h3>
          <p className="mb-4">
            Postal records show a slightly different address than the one you entered.
          </p>
          <dl className="mb-6 space-y-3">
            <div>
              <dt className="text-sm font-semibold text-dark">You entered</dt>
              <dd>{correction.typed}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-dark">Suggested</dt>
              <dd className="font-semibold text-dark">{correction.suggested.formatted}</dd>
            </div>
          </dl>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" className="btn btn-primary" onClick={() => answerCorrection(true)}>
              Use suggested address
            </button>
            <button
              type="button"
              className="btn btn-outline-primary"
              onClick={() => answerCorrection(false)}
            >
              Keep what I entered
            </button>
          </div>
        </>
      )}
    </dialog>
    </>
  );
}
