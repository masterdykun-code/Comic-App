import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { xml, normalized } from "./normalize.mjs";
function convert(body) {
  const d = xml(
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>' +
      body +
      "</body></html>",
  );
  try {
    return normalized(d);
  } finally {
    d.defaultView.close();
  }
}
test("preserves paragraph order, entities and original punctuation", () => {
  assert.equal(
    convert("<h2>I</h2><p>“A &amp; B,” she said.</p><p>Next.</p>"),
    "I\n\n“A & B,” she said.\n\nNext.\n",
  );
});
test("nested emphasis retains every original word without replacing content", () => {
  assert.equal(
    convert("<p>Before <em>very <i>important</i></em> after.</p>"),
    "Before very important after.\n",
  );
});
test("table cells add only spacing, never invented pipe characters", () => {
  assert.equal(
    convert(
      "<table><tr><td>Name</td><td>Value</td></tr><tr><td>A</td><td>1</td></tr></table>",
    ),
    "Name Value\n\nA 1\n",
  );
});
test("poem line spans and explicit breaks remain distinct lines", () => {
  assert.equal(
    convert(
      '<p><span epub:type="line">First</span><span epub:type="line">Second</span></p><p>A<br/>B</p>',
    ),
    "First\nSecond\n\nA\nB\n",
  );
});
test("notes, labels and letters retain their text in reading order", () => {
  assert.equal(
    convert(
      '<p>Word<a href="#note-1">1</a>.</p><section id="note-1"><h3>Note 1</h3><p>Explanation.</p></section>',
    ),
    "Word1.\n\nNote 1\n\nExplanation.\n",
  );
});
test("malformed XHTML is refused rather than silently dropping text", () => {
  assert.throws(() => xml("<html><body><p>broken</body></html>"));
});
test("staging inspector refuses apply before environment or database access", () => {
  const cwd = fileURLToPath(new URL("../../", import.meta.url));
  const env = {
    ...process.env,
    DATABASE_URL:
      "postgresql://synthetic:synthetic@invalid.example/webnovel_db",
  };
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "src/scripts/inspect-library-expansion.ts",
      "--apply",
    ],
    { cwd, env, encoding: "utf8", timeout: 20000, windowsHide: true },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Read-only expansion check stopped/);
  assert.doesNotMatch(result.stderr, /synthetic|postgresql:|invalid\.example/);
});
