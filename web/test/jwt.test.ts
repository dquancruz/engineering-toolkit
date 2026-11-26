import { describe, expect, it } from "vitest";
import { decodeJwt } from "../src/core/jwt.js";

const part = (value: unknown) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
const token = (payload: unknown, header: unknown = { alg: "HS256", typ: "JWT" }, signature = "c2ln") => `${part(header)}.${part(payload)}.${signature}`;
const NOW = 1_800_000_000;

describe("decodeJwt", () => {
  it("shows header and payload without altering numbers, with non-ASCII text", () => {
    const r = decodeJwt(token('{"name":"Ñandú 🚀","id":12345678901234567890}'), NOW);
    expect(r.header).toContain('"alg": "HS256"');
    expect(r.payload).toContain('"Ñandú 🚀"');
    expect(r.payload).toContain("12345678901234567890");
    expect(r.hasSignature).toBe(true);
    expect(r.notices).toEqual([]);
  });

  it.each([
    [{ exp: NOW - 1 }, "expired"],
    [{ exp: NOW }, "expired"],
    [{ exp: NOW + 1 }, "within-time"],
    [{ nbf: NOW + 60, exp: NOW + 120 }, "not-yet-valid"],
    [{ nbf: NOW, exp: NOW + 1 }, "within-time"],
    [{ iat: NOW }, "no-expiry"],
  ])("with %j the time is %s", (payload, time) => {
    expect(decodeJwt(token(payload), NOW).time).toBe(time);
  });

  it("lists the time claims relative to now", () => {
    expect(decodeJwt(token({ exp: NOW + 90, iat: NOW - 30 }), NOW).claims).toEqual([
      { claim: "iat", seconds: NOW - 30, iso: "2027-01-15T07:59:30.000Z", fromNow: -30 },
      { claim: "exp", seconds: NOW + 90, iso: "2027-01-15T08:01:30.000Z", fromNow: 90 },
    ]);
  });

  it("handles dates out of range and claims that are not numbers", () => {
    expect(decodeJwt(token({ exp: 1e20 }), NOW).claims[0]!.iso).toBeNull();
    const r = decodeJwt(token({ exp: "tomorrow" }), NOW);
    expect(r.notices).toEqual([{ code: "jwt-claim-not-number", path: "exp" }]);
    expect(r.time).toBe("no-expiry");
  });

  it("warns about alg none and a missing signature", () => {
    expect(decodeJwt(token({}, { alg: "NoNe" }, ""), NOW).notices.map((n) => n.code)).toEqual(["jwt-alg-none", "jwt-unsigned"]);
  });

  it.each(["Bearer ", "authorization: bearer ", "  "])("accepts the prefix %j and line breaks", (prefix) => {
    expect(() => decodeJwt(`${prefix}${token({}).replace(".", ".\n")}`, NOW)).not.toThrow();
  });

  it.each([
    ["abc", "jwt-parts"],
    ["a.b", "jwt-parts"],
    ["a.b.c.d.e", "jwt-jwe"],
    [`${part({})}.%%%.x`, "jwt-base64"],
    [`${part({})}.a.x`, "jwt-base64"],
    [`${part({})}.${Buffer.from([0xff, 0xfe]).toString("base64url")}.x`, "jwt-base64"],
    [`${part({})}.${part("not json")}.x`, "jwt-json"],
    [`${part({})}.${part([1])}.x`, "jwt-json"],
  ])("rejects %s", (input, code) => {
    expect(() => decodeJwt(input, NOW)).toThrowError(expect.objectContaining({ code }) as unknown as Error);
  });

  it("never puts the token in an error", () => {
    const secret = part({ password: "hunter2" });
    try {
      decodeJwt(`${secret}.%%%.sig`, NOW);
    } catch (e) {
      expect(JSON.stringify(e) + (e as Error).message).not.toContain(secret);
    }
  });
});
