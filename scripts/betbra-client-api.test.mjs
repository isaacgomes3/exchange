import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseSetCookieHeaders,
  cookieHeaderFromJar,
  mergeCookieJars,
  maskLogin,
  resolveBetbraClientApiBase,
} from "./lib/betbra-client-api.mjs";

describe("betbra-client-api helpers", () => {
  it("resolve base default", () => {
    assert.match(resolveBetbraClientApiBase(), /betbra\.bet\.br\/client\/api/);
  });

  it("parse Set-Cookie via getSetCookie", () => {
    const res = {
      headers: {
        getSetCookie: () => [
          "SESSION=abc123; Path=/; HttpOnly",
          "BIAB_LANGUAGE=PT_BR; Path=/",
        ],
        get: () => null,
      },
    };
    const jar = parseSetCookieHeaders(res);
    assert.equal(jar.SESSION, "abc123");
    assert.equal(jar.BIAB_LANGUAGE, "PT_BR");
    assert.equal(
      cookieHeaderFromJar(jar),
      "SESSION=abc123; BIAB_LANGUAGE=PT_BR"
    );
  });

  it("merge jars", () => {
    const m = mergeCookieJars({ A: "1" }, { B: "2", A: "3" });
    assert.equal(m.A, "3");
    assert.equal(m.B, "2");
  });

  it("mask login", () => {
    assert.equal(maskLogin("ab@x.com"), "ab***@x.com");
    assert.equal(maskLogin("isaac"), "is***c");
  });
});
