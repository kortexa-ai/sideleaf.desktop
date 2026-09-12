import assert from "node:assert/strict";
import { test } from "node:test";
import { SaveTransfer } from "../src/document/save-transfer.ts";
import { SAVE_CHUNK_CHARACTERS } from "../src/shared/contracts.ts";

test("a large Unicode draft crosses bounded packets without losing surrogate pairs or escapes", () => {
  const draft = { text: ('🌿 café 葉.\n\\"').repeat(500_000), threads: [] };
  const serialized = JSON.stringify(draft);
  assert.ok(Buffer.byteLength(serialized) > 8 * 1024 * 1024);
  const transfer = new SaveTransfer();
  const total = Math.ceil(serialized.length / SAVE_CHUNK_CHARACTERS);
  for (let index = 0; index < total; index++) {
    const part = { transferId: "large", index, total, text: serialized.slice(index * SAVE_CHUNK_CHARACTERS, (index + 1) * SAVE_CHUNK_CHARACTERS) };
    assert.ok(Buffer.byteLength(JSON.stringify(part)) < 8 * 1024 * 1024);
    transfer.append(part);
  }
  assert.deepEqual(transfer.take("large"), draft);
  assert.throws(() => transfer.take("large"), /incomplete/);
});

test("incomplete, cancelled, stale, oversized and invalid transfers cannot commit", () => {
  const transfer = new SaveTransfer();
  const begin = { transferId: "one", index: 0, total: 2, text: '{"text":' };
  transfer.append(begin);
  assert.throws(() => transfer.take("one"), /incomplete/);
  assert.throws(() => transfer.append({ ...begin, transferId: "stale", index: 1 }), /out of order/);
  assert.throws(() => transfer.append({ ...begin, text: 'x'.repeat(SAVE_CHUNK_CHARACTERS + 1) }), /Invalid/);
  transfer.clear("stale");
  transfer.append({ ...begin, index: 1, text: '"ok","threads":[]}' });
  assert.equal(transfer.take("one").text, "ok");
  transfer.append({ ...begin, total: 1, text: '{"text":2,"threads":[]}' });
  assert.throws(() => transfer.take("one"), /text documents/);
  transfer.append({ ...begin, total: 1, text: '{"text":"ok","threads":[]}' });
  transfer.clear("one");
  assert.throws(() => transfer.take("one"), /incomplete/);
});
