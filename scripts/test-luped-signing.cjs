// Luped's signed bolus MAC (plain-JavaScript HMAC-SHA256, see main.js.in) against
// Node's own HMAC-SHA256, truncated to 16 bytes as the phone checks it.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");

const config = JSON.parse(
  fs.readFileSync("variants/luped/watchface-config.json", "utf8")
);
const source = fs
  .readFileSync("src/embeddedjs/main.js.in", "utf8")
  .replace(/\/\/ @if (\w+)\n([\s\S]*?)\/\/ @endif/g, (_, flag, body) => {
    const [yes, no = ""] = body.split(/\/\/ @else\n/);
    return config[flag] ? yes : no;
  })
  .replace(/^import .*;\n/gm, "")
  .replace(/@[A-Z][A-Z0-9_]*@/g, "0")
  .replace("new CrimsonBearWatchface().start();", "");
const context = { console };
vm.createContext(context);
vm.runInContext(source, context);
const { bolusMac, hmacKey, hexBytes } = context;

const expected = (keyHex, message) =>
  crypto
    .createHmac("sha256", Buffer.from(keyHex, "hex"))
    .update(message, "latin1")
    .digest("hex")
    .slice(0, 32);
const sign = (keyHex, message) => bolusMac(hmacKey(hexBytes(keyHex)), message);

// The phone's key size (32 bytes), a canonical request, and edge lengths around
// SHA-256's 64-byte block (55, 56, 64 bytes of message after the 64-byte pad).
const canonical = "v1|0123456789abcdef|1|1798000000|signedforcedbolus|0.1|1";
const key = "00".repeat(32);
assert.equal(sign(key, canonical), expected(key, canonical));
for (let n = 0; n < 200; n++) {
  const keyHex = crypto.randomBytes([32, 16, 64, 100][n % 4]).toString("hex");
  const message = crypto.randomBytes(n % 140).toString("latin1");
  assert.equal(
    sign(keyHex, message),
    expected(keyHex, message),
    `key ${keyHex.length / 2} B, message ${message.length} B`
  );
}
// One key, several messages: the prepared key isn't changed by signing.
const prepared = hmacKey(hexBytes(key));
assert.equal(bolusMac(prepared, "a"), expected(key, "a"));
assert.equal(bolusMac(prepared, canonical), expected(key, canonical));
assert.equal(bolusMac(prepared, "a"), expected(key, "a"));
console.log("Luped signed bolus MAC matches HMAC-SHA256 (201 cases)");
