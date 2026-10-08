import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const code = readFileSync(new URL("../client/client.js", import.meta.url), "utf8");

test("accessibility roles and aria markers are present", () => {
  const needles = [
    'role", "menu"',
    'role", "menuitem"',
    'role", "treeitem"',
    'role", "heading"',
    'role", "alert"',
    'aria-level", "2"',
    'aria-haspopup", "menu"',
    'aria-selected',
    'aria-expanded',
    'aria-hidden',
    '[role="tree"]',
  ];
  for (const needle of needles) assert.ok(code.includes(needle), needle);
});

test("status text is exposed to assistive tech without changing layout", () => {
  assert.match(code, /dsm-status-label/);
  assert.match(code, /\.dsm-status-label\{[^}]*clip:rect\(0 0 0 0\)/);
});
