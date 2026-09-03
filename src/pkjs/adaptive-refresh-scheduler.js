class AdaptiveRefreshScheduler {
  constructor(diagnostics, refresh) {
    this.diagnostics = diagnostics;
    this.refresh = refresh;
    this.lastReadingUpdated = 0;
    this.timer = null;
  }

  schedule(data, error) {
    const now = Date.now();
    let delay = error ? 60000 : 5 * 60000;
    if (data) {
      const cadence = Math.max(
        2 * 60000,
        Math.min(10 * 60000, Number(data.cadenceMs) || 5 * 60000)
      );
      const expectedAt = Number(data.updated) + cadence;
      const skew = now - expectedAt;
      if (Number(data.updated) === this.lastReadingUpdated && skew >= 0)
        this.diagnostics.increment("duplicateReadingRetries");
      this.lastReadingUpdated = Number(data.updated);
      delay = skew >= -30000 ? 60000 : Math.max(60000, -skew + 30000);
      this.diagnostics.data.phone.readingCadenceMs = cadence;
      this.diagnostics.data.phone.currentFetchSkewMs = skew;
      this.diagnostics.data.phone.fetchSkewMaxMs = Math.max(
        Number(this.diagnostics.data.phone.fetchSkewMaxMs || 0),
        skew
      );
      this.diagnostics.data.phone.readingAgeAtFetchMs = Math.max(
        0,
        now - Number(data.updated)
      );
    }
    this.scheduleIn(delay);
  }

  scheduleIn(delay) {
    if (this.timer) clearTimeout(this.timer);
    const safeDelay = Math.max(1000, Number(delay) || 60000);
    this.diagnostics.data.phone.adaptiveTimerDelayMs = safeDelay;
    this.diagnostics.save();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refresh();
    }, safeDelay);
  }
}

module.exports = AdaptiveRefreshScheduler;
