import { parseJson, printJson, type JsonNode } from "./json.js";
import { CoreError, Notices, type Notice } from "./notice.js";

export const TIME_CLAIMS = ["iat", "nbf", "exp"] as const;

export interface TimeClaim {
  claim: (typeof TIME_CLAIMS)[number];
  /** Seconds since 1970, as written in the token. */
  seconds: number;
  /** ISO 8601, or null when the number is outside the range of dates. */
  iso: string | null;
  /** Seconds from now to the claim (negative: in the past). */
  fromNow: number;
}

export interface DecodedJwt {
  header: string;
  payload: string;
  claims: TimeClaim[];
  /** Only about time: the signature is never verified. */
  time: "expired" | "not-yet-valid" | "within-time" | "no-expiry";
  hasSignature: boolean;
  notices: Notice[];
}

function decodePart(part: string, name: string): { text: string; node: JsonNode } {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(part) || part.replace(/=/g, "").length % 4 === 1) throw new CoreError("jwt-base64", { detail: name });
  let text: string;
  try {
    const binary = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    throw new CoreError("jwt-base64", { detail: name });
  }
  try {
    const { node } = parseJson(text);
    if (node.type !== "object") throw new CoreError("jwt-json", { detail: name });
    return { text: printJson(node), node };
  } catch {
    throw new CoreError("jwt-json", { detail: name });
  }
}

const field = (node: JsonNode, key: string): JsonNode | undefined =>
  node.type === "object" ? node.entries.findLast((e) => e.key === key)?.value : undefined;

/** Reads a JWT. Nothing about its authenticity is checked. `now` is in seconds. */
export function decodeJwt(input: string, now: number): DecodedJwt {
  const token = input.trim().replace(/^(authorization:\s*)?bearer\s+/i, "").replace(/\s+/g, "");
  const parts = token.split(".");
  if (parts.length === 5) throw new CoreError("jwt-jwe");
  if (parts.length !== 3) throw new CoreError("jwt-parts", { detail: `${parts.length} part(s)` });
  const [head, body, signature] = parts as [string, string, string];
  const header = decodePart(head, "header");
  const payload = decodePart(body, "payload");

  const notices = new Notices();
  const alg = field(header.node, "alg");
  if (alg?.type === "string" && alg.value.toLowerCase() === "none") notices.add("jwt-alg-none");
  if (signature === "") notices.add("jwt-unsigned");

  const claims: TimeClaim[] = [];
  for (const claim of TIME_CLAIMS) {
    const value = field(payload.node, claim);
    if (!value) continue;
    if (value.type !== "number") {
      notices.add("jwt-claim-not-number", claim);
      continue;
    }
    const seconds = Number(value.raw);
    const date = new Date(seconds * 1000);
    claims.push({ claim, seconds, iso: Number.isNaN(date.getTime()) ? null : date.toISOString(), fromNow: Math.round(seconds - now) });
  }

  const exp = claims.find((c) => c.claim === "exp");
  const nbf = claims.find((c) => c.claim === "nbf");
  // RFC 7519: expired on and after "exp"
  const time = exp && now >= exp.seconds ? "expired" : nbf && now < nbf.seconds ? "not-yet-valid" : exp ? "within-time" : "no-expiry";
  return { header: header.text, payload: payload.text, claims, time, hasSignature: signature !== "", notices: notices.list() };
}
