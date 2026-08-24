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
        low: String(saved.low || 70),
        high: String(saved.high || 180),
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
      low: rounded(Number(this.settings.low || 70)),
      high: rounded(Number(this.settings.high || 180)),
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

class CrimsonBearCompanion {
  constructor() {
    this.store = new SettingsStore("crimson-cgm-settings-v2");
    this.settings = this.store.load();
    this.client = new NightscoutClient(this.settings);
  }

  start() {
    Pebble.addEventListener("ready", () => this.refresh());
    Pebble.addEventListener("appmessage", (event) => {
      if (event.payload.COMMAND === "refresh") this.refresh();
    });
    Pebble.addEventListener("showConfiguration", () => {
      Pebble.openURL(this.configurationUrl());
    });
    Pebble.addEventListener("webviewclosed", (event) => {
      this.saveConfiguration(event.response);
    });
    setInterval(() => this.refresh(), 5 * 60 * 1000);
  }

  send(payload) {
    Pebble.sendAppMessage(
      payload,
      () => {},
      (error) => {
        console.log(`send failed: ${JSON.stringify(error)}`);
      }
    );
  }

  refresh() {
    if (!this.settings.endpoint) {
      this.send({ CONFIGURED: 0, ERROR: "Open phone settings" });
      return;
    }
    this.client.fetch((error, data) => {
      this.send(
        error
          ? { CONFIGURED: 1, ERROR: error.message }
          : { CONFIGURED: 1, DATA: JSON.stringify(data) }
      );
    });
  }

  configurationUrl() {
    const values = encodeURIComponent(JSON.stringify(this.settings));
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
.save{margin-top:22px;background:#c00030;color:white;border:0}
</style>
<div class="bear-bg" aria-hidden="true">&#129528;</div>
<h2>CrimsonBear Cgm</h2>
<form id="f">
<label>Nightscout URL</label><input name="endpoint" type="url" placeholder="https://my-site.example">
<label>Nightscout token / API secret</label><input name="token">
<label>Units</label><select name="units"><option>mg/dL</option><option>mmol/L</option></select>
<label id="lowLabel">Low threshold</label><div class="stepper"><button type="button" data-field="low" data-direction="-1" aria-label="Decrease low threshold">−</button><input name="low" type="number"><button type="button" data-field="low" data-direction="1" aria-label="Increase low threshold">+</button></div>
<label id="highLabel">High threshold</label><div class="stepper"><button type="button" data-field="high" data-direction="-1" aria-label="Decrease high threshold">−</button><input name="high" type="number"><button type="button" data-field="high" data-direction="1" aria-label="Increase high threshold">+</button></div>
<label class="toggle"><input name="fullScreen" type="checkbox">Full-screen glucose ring (hide trend graph)</label>
<button class="save">Save</button>
</form>
<script>
const s=JSON.parse(decodeURIComponent("${values}"));
const f=document.getElementById("f");
Object.keys(s).forEach((k)=>{if(f[k])f[k].value=s[k]});
f.fullScreen.checked=Boolean(s.fullScreen);
let previousUnit="mg/dL";
const updateThresholds=(unit)=>{const toMmol=unit==="mmol/L"&&previousUnit==="mg/dL";const toMg=unit==="mg/dL"&&previousUnit==="mmol/L";if(toMmol){f.low.value=(Number(f.low.value)/18).toFixed(1);f.high.value=(Number(f.high.value)/18).toFixed(1)}else if(toMg){f.low.value=Math.round(Number(f.low.value)*18);f.high.value=Math.round(Number(f.high.value)*18)}const mmol=unit==="mmol/L";f.low.step=mmol?"0.1":"1";f.high.step=mmol?"0.1":"1";f.low.min=mmol?"1.0":"18";f.high.min=mmol?"1.0":"18";document.getElementById("lowLabel").textContent="Low threshold ("+unit+")";document.getElementById("highLabel").textContent="High threshold ("+unit+")";previousUnit=unit};
document.querySelectorAll(".stepper button").forEach((button)=>{button.onclick=()=>{const input=f[button.dataset.field];const step=Number(input.step);const value=Number(input.value)||0;const next=Math.max(Number(input.min),value+Number(button.dataset.direction)*step);input.value=f.units.value==="mmol/L"?next.toFixed(1):String(Math.round(next))}});
updateThresholds(f.units.value);
f.units.onchange=()=>updateThresholds(f.units.value);
f.onsubmit=(e)=>{e.preventDefault();const o={};new FormData(f).forEach((v,k)=>{o[k]=v});o.fullScreen=f.fullScreen.checked;if(o.units==="mmol/L"){o.low=String(Math.round(Number(o.low)*18));o.high=String(Math.round(Number(o.high)*18))}location="pebblejs://close#"+encodeURIComponent(JSON.stringify(o))};
</script>`;
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  }

  saveConfiguration(response) {
    if (!response) return;
    try {
      this.settings = JSON.parse(decodeURIComponent(response));
      this.store.save(this.settings);
      this.client.updateSettings(this.settings);
      this.refresh();
    } catch (_) {
      this.send({ ERROR: "Could not save settings" });
    }
  }
}

new CrimsonBearCompanion().start();
