const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
let now = 1000000;
const source = fs
  .readFileSync("src/embeddedjs/main.js.in", "utf8")
  .replace(/\/\/ @if (\w+)\n([\s\S]*?)\/\/ @endif/g, (_, flag, body) => {
    const [yes, no = ""] = body.split(/\/\/ @else\n/);
    return flag === "luped" ? no : yes;
  })
  .replace(/^import .*;\n/gm, "")
  .replace(/@[A-Z][A-Z0-9_]*@/g, "0")
  .replace(
    "new CrimsonBearWatchface().start();",
    "globalThis.Face = CrimsonBearWatchface;"
  );
const context = {
  Date: class extends Date {
    static now() {
      return now;
    }
  },
  console,
};
vm.createContext(context);
vm.runInContext(source, context);
const face = Object.create(context.Face.prototype);
Object.assign(face, {
  state: { configured: true, updated: now },
  isConnected: false,
  refreshPending: false,
  telemetryPending: false,
  lastRefreshRequestedAt: 0,
  lastTelemetrySentAt: now,
  lastBatterySampleAt: now,
  lastMinuteEventAt: 0,
  diagnostics: { minuteEventLateMs: 0, minuteEventLateMaxMs: 0 },
  ensureDiagnosticsWindow() {},
  countDiagnostic() {},
  addDiagnostic() {},
  updateBattery() {},
  updateStaleState() {
    return false;
  },
  requestRender() {},
});
let attempts = 0,
  sent = 0,
  writable = true;
face.message = {
  write() {
    attempts++;
    if (!writable) throw Error("suspended");
    sent++;
  },
};
const tick = (minutes) => {
  now = 1000000 + minutes * 60000;
  face.drawMinute({ date: new Date(now) });
};
tick(4);
assert.equal(attempts, 0);
tick(5);
assert.equal(sent, 1, "stale disconnected flag must not block refresh");
tick(6);
assert.equal(sent, 2, "one-minute retry");
tick(7);
tick(10);
assert.equal(sent, 2, "no excessive successful sends");
writable = false;
tick(11);
assert.equal(face.refreshPending, true);
tick(12);
assert.equal(attempts, 4, "pending write retried without callback");
writable = true;
tick(13);
assert.equal(sent, 3);
assert.equal(face.refreshPending, false);
face.state.updated = now;
face.lastRefreshRequestedAt = 0;
tick(14);
assert.equal(sent, 3, "fresh reading suppresses refresh");
face.message.read = () => new Map([["ERROR", "source unavailable"]]);
face.phoneDisconnectedAt = now - 60000;
face.diagnostics.phoneDisconnectedMaxMs = 0;
face.draw = () => {};
face.readMessages();
assert.equal(face.isConnected, true, "incoming error still proves phone reachability");
assert.equal(sent, 3, "response processing must not cause duplicate refresh");
context.expandData = (data) => data;
face.checkGlucoseAlarm = () => {};
face.recordLatency = () => {};
face.isConnected = false;
face.refreshPending = true;
face.message.read = () => new Map([["DATA", JSON.stringify({ updated: now })]]);
face.readMessages();
assert.equal(face.isConnected, true);
assert.equal(face.state.error, null, "valid data clears ERR without restarting");
assert.equal(face.refreshPending, false);
assert.equal(sent, 3, "incoming data satisfies pending work before reconnect flush");
tick(18);
assert.equal(sent, 3, "new reading resets the retry sequence");
tick(19);
assert.equal(sent, 4);
console.log("Refresh recovery and cadence checks passed");
