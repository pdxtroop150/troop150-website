// Square webhook signatures: base64(HMAC-SHA256(signatureKey, notificationUrl + body)).
// https://developer.squareup.com/docs/webhooks/step3validate

export async function squareSignature(
  signatureKey: string,
  notificationUrl: string,
  body: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signatureKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(notificationUrl + body));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

export async function isValidSquareSignature(
  signatureKey: string,
  notificationUrl: string,
  body: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature) {
    return false;
  }
  const expected = await squareSignature(signatureKey, notificationUrl, body);
  // Constant-time comparison so the signature can't be guessed byte by byte.
  if (expected.length !== signature.length) {
    return false;
  }
  let difference = 0;
  for (let i = 0; i < expected.length; i++) {
    difference |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return difference === 0;
}
