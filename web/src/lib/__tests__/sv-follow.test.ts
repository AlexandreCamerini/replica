import assert from "node:assert/strict";
import { test } from "node:test";
import { FOLLOW_MAX, parseFollows, serializeFollows } from "../../components/sv/follow-shared.ts";

test("parseFollows: cookie malformado vira lista vazia, sem lançar", () => {
  assert.deepEqual(parseFollows("%E0"), []);
  assert.deepEqual(parseFollows("%25E0"), []);
  assert.deepEqual(parseFollows("a.%"), []);
  assert.deepEqual(parseFollows(undefined), []);
  assert.deepEqual(parseFollows(null), []);
  assert.deepEqual(parseFollows(""), []);
});

test("parseFollows: só slugs válidos, sem repetição, até FOLLOW_MAX", () => {
  assert.deepEqual(parseFollows("ana-silva.bruno.ana-silva.X!"), ["ana-silva", "bruno"]);
  assert.deepEqual(parseFollows(encodeURIComponent("ana.bia")), ["ana", "bia"]);
  const muitos = Array.from({ length: FOLLOW_MAX + 3 }, (_, i) => `p${i}`);
  assert.equal(parseFollows(serializeFollows(muitos)).length, FOLLOW_MAX);
});
