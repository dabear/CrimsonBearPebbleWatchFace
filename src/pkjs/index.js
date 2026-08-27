/* Phone-side Nightscout and configuration bridge for CrimsonBear Cgm. */
class SettingsStore {
  constructor(key) {
    this.key = key;
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.key)) || {};
      const clean = {
        endpoint: saved.endpoint || "",
        token: saved.token || "",
        units: saved.units || "mg/dL",
        // Thresholds are always persisted canonically as mg/dL.
        urgentLow: String(saved.urgentLow || 55),
        low: String(saved.low || 70),
        high: String(saved.high || 180),
        alarmEnabled: saved.alarmEnabled !== false,
        lowSnooze: String(saved.lowSnooze || 15),
        highSnooze: String(saved.highSnooze || 30),
        fullScreen: Boolean(saved.fullScreen),
      };
      this.save(clean);
      return clean;
    } catch (_) {
      return {};
    }
  }

  save(settings) {
    localStorage.setItem(this.key, JSON.stringify(settings));
  }
}

class DiagnosticStore {
  constructor(key) {
    this.key = key;
    this.windowMs = 48 * 60 * 60 * 1000;
    this.data = this.load();
  }

  empty() {
    return {
      startedAt: Date.now(),
      phone: {
        fetches: 0,
        fetchSuccesses: 0,
        fetchErrors: 0,
        messagesSent: 0,
        messageErrors: 0,
        watchRefreshRequests: 0,
        incomingWatchMessages: 0,
        incomingWatchBytes: 0,
        outgoingWatchBytes: 0,
        fetchMs: 0,
        fetchMaxMs: 0,
        fetchLatencyBuckets: [0, 0, 0, 0, 0, 0, 0, 0],
        duplicatePayloads: 0,
        dataAgeMs: 0,
        dataAgeMaxMs: 0,
        watchRestarts: 0,
      },
      watch: [],
      events: [],
    };
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.key));
      if (saved && Date.now() - Number(saved.startedAt) < this.windowMs) return saved;
    } catch (_) {
      // Start a clean diagnostics window if stored data cannot be decoded.
    }
    return this.empty();
  }

  rollover() {
    if (Date.now() - Number(this.data.startedAt) < this.windowMs) return;
    this.data = this.empty();
    this.event("diagnostics-reset");
  }

  save() {
    this.rollover();
    localStorage.setItem(this.key, JSON.stringify(this.data));
  }

  clear() {
    this.data = this.empty();
    localStorage.setItem(this.key, JSON.stringify(this.data));
  }

  increment(name) {
    this.rollover();
    this.data.phone[name] = Number(this.data.phone[name] || 0) + 1;
    this.save();
  }

  event(type, detail) {
    this.rollover();
    this.data.events.push({ at: Date.now(), type, detail: detail || "" });
    this.data.events = this.data.events.slice(-100);
    this.save();
  }

  addWatch(snapshot) {
    this.rollover();
    if (Array.isArray(snapshot)) snapshot = this.expandWatchSnapshot(snapshot);
    const previous = this.data.watch[this.data.watch.length - 1];
    if (previous && previous.startupId !== snapshot.startupId)
      this.data.phone.watchRestarts = Number(this.data.phone.watchRestarts || 0) + 1;
    this.data.watch.push(snapshot);
    this.data.watch = this.data.watch.slice(-60);
    this.save();
  }

  expandWatchSnapshot(values) {
    const names = [
      "at",
      "battery",
      "startedAt",
      "startupId",
      "fullDraws",
      "fullDrawMs",
      "fullDrawMaxMs",
      "minuteDraws",
      "minuteDrawMs",
      "minuteDrawMaxMs",
      "renderFailures",
      "renderRetries",
      "dataMessages",
      "refreshRequests",
      "refreshDeferred",
      "urgentLowAlarms",
      "lowAlarms",
      "highAlarms",
      "incomingMessages",
      "incomingBytes",
      "outgoingMessages",
      "outgoingBytes",
      "refreshResponses",
      "refreshResponseMs",
      "refreshResponseMaxMs",
      "invalidatedPixels",
      "lateMinuteEvents",
      "minuteEventLateMs",
      "minuteEventLateMaxMs",
      "refreshResponseP50Ms",
      "refreshResponseP95Ms",
    ];
    const snapshot = {};
    names.forEach((name, index) => {
      snapshot[name] = Number(values[index + 1] || 0);
    });
    return snapshot;
  }

  recordLatency(name, elapsed) {
    const limits = [250, 500, 1000, 2000, 5000, 10000, 20000];
    const key = `${name}LatencyBuckets`;
    const buckets = this.data.phone[key] || new Array(limits.length + 1).fill(0);
    let index = limits.findIndex((limit) => elapsed <= limit);
    if (index < 0) index = limits.length;
    buckets[index] = Number(buckets[index] || 0) + 1;
    this.data.phone[key] = buckets;
  }

  percentile(buckets, percentile) {
    const values = [250, 500, 1000, 2000, 5000, 10000, 20000, 20000];
    const total = (buckets || []).reduce((sum, count) => sum + Number(count || 0), 0);
    if (!total) return 0;
    const target = Math.ceil(total * percentile);
    let seen = 0;
    for (let index = 0; index < values.length; index += 1) {
      seen += Number(buckets[index] || 0);
      if (seen >= target) return values[index];
    }
    return values[values.length - 1];
  }

  export() {
    this.rollover();
    const first = this.data.watch[0];
    const last = this.data.watch[this.data.watch.length - 1];
    let batterySummary = null;
    if (first && last && Number(last.at) > Number(first.at)) {
      const hours = (Number(last.at) - Number(first.at)) / 3600000;
      const lost = Number(first.battery) - Number(last.battery);
      batterySummary = {
        observedHours: Number(hours.toFixed(2)),
        percentLost: lost,
        percentPerHour: Number((lost / hours).toFixed(2)),
      };
    }
    const phone = Object.assign({}, this.data.phone, {
      fetchP50Ms: this.percentile(this.data.phone.fetchLatencyBuckets, 0.5),
      fetchP95Ms: this.percentile(this.data.phone.fetchLatencyBuckets, 0.95),
    });
    delete phone.fetchLatencyBuckets;
    return Object.assign(
      {
        app: "CrimsonBear Cgm",
        version: "2.2.7",
        exportedAt: Date.now(),
        windowHours: 48,
        batterySummary,
      },
      this.data,
      { phone }
    );
  }
}

class NightscoutClient {
  constructor(settings) {
    this.settings = settings;
  }

  updateSettings(settings) {
    this.settings = settings;
  }

  direction(delta) {
    if (delta >= 4) return "DoubleUp";
    if (delta >= 2) return "SingleUp";
    if (delta >= 1) return "FortyFiveUp";
    if (delta > -1) return "Flat";
    if (delta > -2) return "FortyFiveDown";
    if (delta > -4) return "SingleDown";
    return "DoubleDown";
  }

  normalize(entries) {
    const valid = entries.filter((entry) => Number(entry.sgv) > 0);
    if (!valid.length) throw new Error("No CGM readings");
    valid.sort((left, right) => Number(left.date) - Number(right.date));

    const latest = valid[valid.length - 1];
    const previous = valid.length > 1 ? valid[valid.length - 2] : latest;
    const mmol = this.settings.units === "mmol/L";
    const scale = mmol ? 1 / 18 : 1;
    const precision = mmol ? 1 : 0;
    const rounded = (value) => Number((value * scale).toFixed(precision));
    const delta = rounded(Number(latest.sgv) - Number(previous.sgv));
    return {
      glucose: rounded(Number(latest.sgv)),
      delta,
      direction: latest.direction || this.direction(delta),
      readings: valid.slice(-12).map((entry) => rounded(Number(entry.sgv))),
      units: mmol ? "mmol/L" : "mg/dL",
      urgentLow: rounded(Number(this.settings.urgentLow || 55)),
      low: rounded(Number(this.settings.low || 70)),
      high: rounded(Number(this.settings.high || 180)),
      alarmEnabled: this.settings.alarmEnabled !== false,
      lowSnooze: Math.max(5, Number(this.settings.lowSnooze) || 15),
      highSnooze: Math.max(5, Number(this.settings.highSnooze) || 30),
      updated: Number(latest.date || Date.now()),
      fullScreen: Boolean(this.settings.fullScreen),
    };
  }

  request(url, headers, done) {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    Object.keys(headers).forEach((key) => xhr.setRequestHeader(key, headers[key]));
    xhr.timeout = 20000;
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        done(new Error(`HTTP ${xhr.status}`));
        return;
      }
      try {
        done(null, JSON.parse(xhr.responseText));
      } catch (_) {
        done(new Error("Invalid server response"));
      }
    };
    xhr.onerror = () => done(new Error("Network unavailable"));
    xhr.ontimeout = () => done(new Error("Request timed out"));
    xhr.send(null);
  }

  fetch(done) {
    const base = String(this.settings.endpoint || "").replace(/\/$/, "");
    if (!base) {
      done(new Error("Open settings in Pebble app"));
      return;
    }
    const headers = this.settings.token ? { "api-secret": this.settings.token } : {};
    this.request(`${base}/api/v1/entries/sgv.json?count=12`, headers, (error, data) => {
      if (error) {
        done(error);
        return;
      }
      try {
        done(null, this.normalize(data));
      } catch (parseError) {
        done(parseError);
      }
    });
  }
}

const DIRECTIONS = [
  "DoubleDown",
  "SingleDown",
  "FortyFiveDown",
  "Flat",
  "FortyFiveUp",
  "SingleUp",
  "DoubleUp",
];

function compactData(data) {
  return [
    1,
    data.glucose,
    data.delta,
    Math.max(0, DIRECTIONS.indexOf(data.direction)),
    data.readings,
    data.units === "mmol/L" ? 1 : 0,
    data.urgentLow,
    data.low,
    data.high,
    data.alarmEnabled ? 1 : 0,
    data.lowSnooze,
    data.highSnooze,
    data.updated,
    data.fullScreen ? 1 : 0,
  ];
}

class CrimsonBearCompanion {
  constructor() {
    this.store = new SettingsStore("crimson-cgm-settings-v2");
    this.diagnostics = new DiagnosticStore("crimson-cgm-diagnostics-v1");
    this.settings = this.store.load();
    this.client = new NightscoutClient(this.settings);
    this.lastSentDataSignature = null;
    this.fetchInFlight = false;
    this.lastFetchStartedAt = 0;
    this.lastResponsePayload = null;
  }

  start() {
    Pebble.addEventListener("ready", () => this.refresh("ready"));
    Pebble.addEventListener("appmessage", (event) => {
      this.diagnostics.increment("incomingWatchMessages");
      this.diagnostics.data.phone.incomingWatchBytes =
        Number(this.diagnostics.data.phone.incomingWatchBytes || 0) +
        Object.keys(event.payload).reduce(
          (total, key) => total + key.length + String(event.payload[key]).length,
          0
        );
      this.diagnostics.save();
      if (event.payload.COMMAND === "refresh") {
        this.diagnostics.increment("watchRefreshRequests");
        this.refresh("watch");
      }
      if (event.payload.DIAGNOSTICS) {
        try {
          this.diagnostics.addWatch(JSON.parse(event.payload.DIAGNOSTICS));
        } catch (_) {
          this.diagnostics.event("bad-watch-diagnostics");
        }
      }
    });
    Pebble.addEventListener("showConfiguration", () => {
      // Ask for a fresh watch snapshot before embedding the retained log in
      // the settings page. The short delay lets the round-trip complete.
      this.send({ COMMAND: "diagnostics" });
      setTimeout(() => Pebble.openURL(this.configurationUrl()), 750);
    });
    Pebble.addEventListener("webviewclosed", (event) => {
      this.saveConfiguration(event.response);
    });
    setInterval(() => this.refresh("timer"), 5 * 60 * 1000);
  }

  send(payload) {
    this.diagnostics.increment("messagesSent");
    this.diagnostics.data.phone.outgoingWatchBytes =
      Number(this.diagnostics.data.phone.outgoingWatchBytes || 0) +
      Object.keys(payload).reduce(
        (total, key) => total + key.length + String(payload[key]).length,
        0
      );
    this.diagnostics.save();
    Pebble.sendAppMessage(
      payload,
      () => {},
      (error) => {
        this.diagnostics.increment("messageErrors");
        this.diagnostics.event("phone-send-failed", JSON.stringify(error));
        console.log(`send failed: ${JSON.stringify(error)}`);
      }
    );
  }

  refresh(source = "timer") {
    const now = Date.now();
    if (this.fetchInFlight) return;
    if (now - this.lastFetchStartedAt < 60 * 1000) {
      // A watch request still needs a response, but the fallback phone timer
      // can simply reuse the recent fetch on its next interval.
      if (source === "watch" && this.lastResponsePayload)
        this.send(this.lastResponsePayload);
      return;
    }
    this.diagnostics.increment("fetches");
    if (!this.settings.endpoint) {
      this.diagnostics.increment("fetchErrors");
      this.send({ CONFIGURED: 0, ERROR: "Open phone settings" });
      return;
    }
    const startedAt = now;
    this.fetchInFlight = true;
    this.lastFetchStartedAt = now;
    this.client.fetch((error, data) => {
      this.fetchInFlight = false;
      const elapsed = Math.max(0, Date.now() - startedAt);
      this.diagnostics.data.phone.fetchMs =
        Number(this.diagnostics.data.phone.fetchMs || 0) + elapsed;
      this.diagnostics.data.phone.fetchMaxMs = Math.max(
        Number(this.diagnostics.data.phone.fetchMaxMs || 0),
        elapsed
      );
      this.diagnostics.recordLatency("fetch", elapsed);
      this.diagnostics.increment(error ? "fetchErrors" : "fetchSuccesses");
      if (error) this.diagnostics.event("nightscout-error", error.message);
      if (data) {
        const signature = JSON.stringify(data);
        if (signature === this.lastSentDataSignature)
          this.diagnostics.increment("duplicatePayloads");
        this.lastSentDataSignature = signature;
        const age = Math.max(0, Date.now() - Number(data.updated || Date.now()));
        this.diagnostics.data.phone.dataAgeMs =
          Number(this.diagnostics.data.phone.dataAgeMs || 0) + age;
        this.diagnostics.data.phone.dataAgeMaxMs = Math.max(
          Number(this.diagnostics.data.phone.dataAgeMaxMs || 0),
          age
        );
        this.diagnostics.save();
      }
      this.lastResponsePayload = error
        ? { CONFIGURED: 1, ERROR: error.message }
        : { CONFIGURED: 1, DATA: JSON.stringify(compactData(data)) };
      this.send(this.lastResponsePayload);
    });
  }

  configurationUrl() {
    const values = encodeURIComponent(JSON.stringify(this.settings));
    const diagnostics = encodeURIComponent(JSON.stringify(this.diagnostics.export()));
    const html = `<!doctype html>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
body{font:17px system-ui;margin:20px;background:#ffe0e8;color:#400010;position:relative}
.bear-bg{position:fixed;left:0;right:0;bottom:5vh;text-align:center;font-size:min(65vw,280px);line-height:1;opacity:.1;pointer-events:none;user-select:none;-webkit-user-select:none}
form,h2{position:relative}
label{display:block;margin:14px 0 4px}
input,select,button{box-sizing:border-box;width:100%;font:inherit;padding:10px}
.stepper{display:grid;grid-template-columns:48px 1fr 48px;gap:8px}
.stepper button{margin:0;background:#800020;color:white;border:0;font-size:24px;font-weight:bold;touch-action:manipulation;user-select:none;-webkit-user-select:none}
.stepper input{text-align:center}
.toggle{display:flex;align-items:center;gap:10px;margin-top:18px}
.toggle input{width:auto;transform:scale(1.35)}
.save,.debug-button{margin-top:14px;background:#c00030;color:white;border:0}
.debug{position:relative;margin-top:28px;padding-top:12px;border-top:2px solid #c00030}
.debug pre{box-sizing:border-box;max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#fff;padding:10px;font:12px ui-monospace,monospace}
.hint{font-size:13px}
</style>
<div class="bear-bg" aria-hidden="true">&#129528;</div>
<h2>CrimsonBear Cgm</h2>
<form id="f">
<label>Nightscout URL</label><input name="endpoint" type="url" placeholder="https://my-site.example">
<label>Nightscout token / API secret</label><input name="token">
<label>Units</label><select name="units"><option>mg/dL</option><option>mmol/L</option></select>
<label id="urgentLowLabel">Urgent-low threshold</label><div class="stepper"><button type="button" data-field="urgentLow" data-direction="-1" aria-label="Decrease urgent-low threshold">−</button><input name="urgentLow" type="number"><button type="button" data-field="urgentLow" data-direction="1" aria-label="Increase urgent-low threshold">+</button></div>
<label id="lowLabel">Low threshold</label><div class="stepper"><button type="button" data-field="low" data-direction="-1" aria-label="Decrease low threshold">−</button><input name="low" type="number"><button type="button" data-field="low" data-direction="1" aria-label="Increase low threshold">+</button></div>
<label id="highLabel">High threshold</label><div class="stepper"><button type="button" data-field="high" data-direction="-1" aria-label="Decrease high threshold">−</button><input name="high" type="number"><button type="button" data-field="high" data-direction="1" aria-label="Increase high threshold">+</button></div>
<label class="toggle"><input name="alarmEnabled" type="checkbox">Glucose vibration alarms</label>
<label>Low alarm snooze (minutes)</label><input name="lowSnooze" type="number" min="5" max="240" step="5">
<label>High alarm snooze (minutes)</label><input name="highSnooze" type="number" min="5" max="240" step="5">
<label class="toggle"><input name="fullScreen" type="checkbox">Full-screen glucose ring (hide trend graph)</label>
<label class="toggle"><input name="clearDiagnostics" type="checkbox">Clear diagnostic timers when Save is tapped</label>
<button class="save">Save</button>
<section class="debug">
<h2>Debug</h2>
<p class="hint">Includes the latest watch snapshot requested when this page opened. Counters reset every 48 hours.</p>
<button type="button" class="debug-button" id="showDebug">Fetch logs</button>
<button type="button" class="debug-button" id="exportDebug">Export / Mail attachment</button>
<pre id="debugOutput" hidden></pre>
</section>
</form>
<script>
const s=JSON.parse(decodeURIComponent("${values}"));
const diagnostics=JSON.parse(decodeURIComponent("${diagnostics}"));
const f=document.getElementById("f");
Object.keys(s).forEach((k)=>{if(f[k])f[k].value=s[k]});
f.fullScreen.checked=Boolean(s.fullScreen);
f.alarmEnabled.checked=s.alarmEnabled!==false;
let previousUnit="mg/dL";
const updateThresholds=(unit)=>{const fields=["urgentLow","low","high"];const toMmol=unit==="mmol/L"&&previousUnit==="mg/dL";const toMg=unit==="mg/dL"&&previousUnit==="mmol/L";fields.forEach((field)=>{if(toMmol)f[field].value=(Number(f[field].value)/18).toFixed(1);else if(toMg)f[field].value=Math.round(Number(f[field].value)*18);const mmol=unit==="mmol/L";f[field].step=mmol?"0.1":"1";f[field].min=mmol?"1.0":"18"});document.getElementById("urgentLowLabel").textContent="Urgent-low threshold ("+unit+")";document.getElementById("lowLabel").textContent="Low threshold ("+unit+")";document.getElementById("highLabel").textContent="High threshold ("+unit+")";previousUnit=unit};
document.querySelectorAll(".stepper button").forEach((button)=>{button.onclick=()=>{const input=f[button.dataset.field];const step=Number(input.step);const value=Number(input.value)||0;const next=Math.max(Number(input.min),value+Number(button.dataset.direction)*step);input.value=f.units.value==="mmol/L"?next.toFixed(1):String(Math.round(next))}});
updateThresholds(f.units.value);
f.units.onchange=()=>updateThresholds(f.units.value);
const closeSettings=()=>{if(Number(f.urgentLow.value)>=Number(f.low.value)||Number(f.low.value)>=Number(f.high.value)){alert("Thresholds must be ordered: urgent low < low < high");return}const o={};new FormData(f).forEach((v,k)=>{o[k]=v});o.alarmEnabled=f.alarmEnabled.checked;o.fullScreen=f.fullScreen.checked;o.clearDiagnostics=f.clearDiagnostics.checked;if(o.units==="mmol/L"){o.urgentLow=String(Math.round(Number(o.urgentLow)*18));o.low=String(Math.round(Number(o.low)*18));o.high=String(Math.round(Number(o.high)*18))}location="pebblejs://close#"+encodeURIComponent(JSON.stringify(o))};
f.onsubmit=(e)=>{e.preventDefault();closeSettings()};
const debugText=JSON.stringify(diagnostics,null,2);
document.getElementById("showDebug").onclick=()=>{const output=document.getElementById("debugOutput");output.textContent=debugText;output.hidden=!output.hidden};
document.getElementById("exportDebug").onclick=async()=>{const blob=new Blob([debugText],{type:"application/json"});let file=null;try{file=new File([blob],"crimsonbear-diagnostics.json",{type:"application/json"});if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){await navigator.share({title:"CrimsonBear Cgm diagnostics",files:[file]});return}}catch(error){if(error&&error.name==="AbortError")return}const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="crimsonbear-diagnostics.json";link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);alert("The diagnostics file was downloaded. Attach it in Mail if the share sheet was unavailable.")};
</script>`;
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  }

  saveConfiguration(response) {
    if (!response) return;
    try {
      const decoded = decodeURIComponent(response);
      const result = JSON.parse(decoded);
      if (result.clearDiagnostics === true) {
        this.diagnostics.clear();
        Pebble.sendAppMessage(
          { COMMAND: "diagnostics-reset" },
          () => {},
          (error) => console.log(`diagnostics reset failed: ${JSON.stringify(error)}`)
        );
        delete result.clearDiagnostics;
        this.settings = result;
        this.store.save(this.settings);
        this.client.updateSettings(this.settings);
        return;
      }
      delete result.clearDiagnostics;
      this.settings = result;
      this.store.save(this.settings);
      this.client.updateSettings(this.settings);
      this.refresh("settings");
    } catch (_) {
      this.send({ ERROR: "Could not save settings" });
    }
  }
}

new CrimsonBearCompanion().start();
