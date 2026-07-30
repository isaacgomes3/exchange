/**
 * Anti-regressão layout — metas e textos das páginas críticas.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  SYSTEM_NON_REGRESSION_VERSION,
  SYSTEM_NON_REGRESSION_LOCK,
  UI_CRITICAL_MARKERS,
  assertUiPageMarkers,
} from "./lib/ui-markers-contract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

describe("UI markers — páginas críticas", () => {
  it("versão e lock", () => {
    assert.equal(SYSTEM_NON_REGRESSION_VERSION, "system-non-regression-v1");
    assert.equal(
      SYSTEM_NON_REGRESSION_LOCK,
      "DO_NOT_CHANGE_SYSTEM_SURFACE_WITHOUT_EXPLICIT_REQUEST"
    );
    assert.ok(Object.keys(UI_CRITICAL_MARKERS).length >= 4);
  });

  it("AGENTS.md e docs travam system non-regression", () => {
    const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8");
    const doc = readFileSync(
      resolve(root, "docs/SYSTEM_NON_REGRESSION.md"),
      "utf8"
    );
    assert.match(agents, /BEGIN:system-non-regression/);
    assert.match(agents, /system-non-regression-v1/);
    assert.match(agents, /DO_NOT_CHANGE_SYSTEM_SURFACE_WITHOUT_EXPLICIT_REQUEST/);
    assert.match(doc, /system-non-regression-v1/);
    assert.match(doc, /DO_NOT_CHANGE_SYSTEM_SURFACE_WITHOUT_EXPLICIT_REQUEST/);
  });

  for (const rel of Object.keys(UI_CRITICAL_MARKERS)) {
    it(`meta/body OK: ${rel}`, () => {
      const html = readFileSync(resolve(root, rel), "utf8");
      const out = assertUiPageMarkers(rel, html);
      assert.equal(out.ok, true, out.errors.join("\n"));
    });
  }
});
