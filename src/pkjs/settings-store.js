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

module.exports = SettingsStore;
