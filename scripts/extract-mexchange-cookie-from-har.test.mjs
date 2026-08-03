import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

describe("extract-mexchange-cookie-from-har", () => {
  it("extrai Cookie com SESSION do HAR", () => {
    const har = {
      log: {
        entries: [
          {
            startedDateTime: "2026-07-25T10:00:00.000Z",
            request: {
              url: "https://mexchange-api.betbra.bet.br/api/events/1",
              headers: [
                { name: "Cookie", value: "BIAB_LANGUAGE=PT_BR; SESSION=abc123" },
              ],
            },
          },
        ],
      },
    };
    const path = resolve("tmp-test-mexchange.har");
    writeFileSync(path, JSON.stringify(har));
    try {
      const r = spawnSync(
        process.execPath,
        [resolve("scripts/extract-mexchange-cookie-from-har.mjs"), path],
        { encoding: "utf8" }
      );
      assert.equal(r.status, 0, r.stderr || r.stdout);
      assert.match(r.stdout, /SESSION=abc123/);
      assert.match(readFileSync("mexchange-cookie.txt", "utf8"), /SESSION=abc123/);
    } finally {
      try {
        unlinkSync(path);
      } catch {
        /* ignore */
      }
      try {
        unlinkSync("mexchange-cookie.txt");
      } catch {
        /* ignore */
      }
    }
  });
});
