import Poco from "commodetto/Poco";
import Message from "pebble/message";
import Vibes from "pebble/vibes";
import Battery from "embedded:sensor/Battery";

class CrimsonBearWatchface {
  constructor() {
    this.render = new Poco(screen);
    this.fonts = {
      glucose: new this.render.Font("Bitham-Medium", 42),
      delta: new this.render.Font("Gothic-Bold", 24),
      label: new this.render.Font("Gothic-Regular", 18),
      footer: new this.render.Font("Bitham-Black", 30),
      fullGlucose: new this.render.Font("Bitham-Bold", 42),
      fullDelta: new this.render.Font("Bitham-Black", 30),
      fullLabel: new this.render.Font("Gothic-Bold", 24),
    };
    this.colors = {
      ink: this.render.makeColor(64, 0, 16),
      crimson: this.render.makeColor(192, 0, 48),
      graph: this.render.makeColor(248, 160, 176),
      pale: this.render.makeColor(255, 224, 232),
      white: this.render.makeColor(255, 255, 255),
      low: this.render.makeColor(128, 0, 32),
      high: this.render.makeColor(255, 96, 48),
    };
    this.state = {
      glucose: null,
      delta: null,
      direction: "NONE",
      readings: [],
      units: "mg/dL",
      urgentLow: 55,
      low: 70,
      high: 180,
      alarmEnabled: true,
      lowSnooze: 15,
      highSnooze: 30,
      updated: 0,
      configured: false,
      fullScreen: false,
      error: null,
      battery: 100,
    };
    this.alarmZone = "normal";
    this.lastAlarmAt = 0;
    this.lastDataSignature = null;
    this.lastAgeTextWidth = 0;
    this.pendingRender = 0;
    this.renderTimer = null;
    this.renderRetryCount = 0;
  }

  start() {
    this.draw();
    this.startBatteryService();
    this.startMessageService();
    watch.addEventListener("minutechange", () => this.drawMinute());
    watch.addEventListener("resize", () => this.draw());
  }

  text(value, font, color, x, y, centered = false) {
    const string = String(value);
    const left = centered ? x - (this.render.getTextWidth(string, font) >> 1) : x;
    this.render.drawText(string, font, color, left, y);
  }

  glucoseColor(value) {
    if (value == null) return this.colors.ink;
    if (value <= this.state.low) return this.colors.low;
    if (value >= this.state.high) return this.colors.high;
    return this.colors.crimson;
  }

  glucoseText() {
    if (this.state.glucose == null) return "--";
    return this.state.units === "mmol/L"
      ? Number(this.state.glucose).toFixed(1)
      : String(this.state.glucose);
  }

  deltaText() {
    if (this.state.delta == null) return "--";
    const value =
      this.state.units === "mmol/L"
        ? Number(this.state.delta).toFixed(1)
        : String(this.state.delta);
    return `${this.state.delta > 0 ? "+" : ""}${value}`;
  }

  drawGlucose(cx, y, font = this.fonts.glucose) {
    const color = this.glucoseColor(this.state.glucose);
    const value = this.glucoseText();
    if (this.state.units !== "mmol/L" || this.state.glucose == null) {
      this.text(value, font, color, cx, y, true);
      return;
    }

    const [whole, fraction] = value.split(".");
    const wholeWidth = this.render.getTextWidth(whole, font);
    const fractionWidth = this.render.getTextWidth(fraction, font);
    const decimalWidth = 9;
    const left = Math.round(cx - (wholeWidth + decimalWidth + fractionWidth) / 2);
    this.text(whole, font, color, left, y);
    this.render.drawCircle(color, left + wholeWidth + 4, y + 34, 3, 0, 360);
    this.text(fraction, font, color, left + wholeWidth + decimalWidth, y);
  }

  arrow(cx, cy, direction, color, scale = 1) {
    const glyphs = {
      DoubleUp: [
        [-6, 13, -6, -4, -6, -14, 6],
        [6, 13, 6, -4, 6, -14, 6],
      ],
      SingleUp: [[0, 15, 0, -3, 0, -16, 9]],
      FortyFiveUp: [[-12, 12, 2, -2, 13, -13, 8]],
      Flat: [[-15, 0, 3, 0, 16, 0, 9]],
      FortyFiveDown: [[-12, -12, 2, 2, 13, 13, 8]],
      SingleDown: [[0, -15, 0, 3, 0, 16, 9]],
      DoubleDown: [
        [-6, -13, -6, 4, -6, 14, 6],
        [6, -13, 6, 4, 6, 14, 6],
      ],
    };
    const glyph = glyphs[direction];
    if (!glyph) {
      this.text("?", this.fonts.delta, color, cx, cy - 12, true);
      return;
    }

    const point = (value) => Math.round(value * scale);
    const shaftWidth = Math.max(5, point(glyph.length > 1 ? 5 : 7));
    for (const [sx, sy, bx, by, tx, ty, headRadius] of glyph) {
      this.render.drawLine(
        cx + point(sx),
        cy + point(sy),
        cx + point(bx),
        cy + point(by),
        color,
        shaftWidth
      );

      const vx = tx - bx;
      const vy = ty - by;
      const length = Math.sqrt(vx * vx + vy * vy);
      const px = -vy / length;
      const py = vx / length;
      const steps = Math.max(6, point(length));
      for (let step = 0; step <= steps; step += 1) {
        const progress = step / steps;
        const centerX = bx + vx * progress;
        const centerY = by + vy * progress;
        const halfWidth = headRadius * (1 - progress);
        this.render.drawLine(
          cx + point(centerX - px * halfWidth),
          cy + point(centerY - py * halfWidth),
          cx + point(centerX + px * halfWidth),
          cy + point(centerY + py * halfWidth),
          color,
          2
        );
      }
    }
  }

  graphPoint(value, index, count, bounds) {
    const mmol = this.state.units === "mmol/L";
    const margin = mmol ? 1.1 : 20;
    const floor = mmol ? 2.2 : 40;
    const ceiling = mmol ? 22.2 : 400;
    const minimum = Math.max(
      floor,
      Math.min(this.state.low - margin, ...this.state.readings)
    );
    const maximum = Math.max(
      minimum + margin,
      Math.min(ceiling, Math.max(this.state.high + margin, ...this.state.readings))
    );
    return {
      x: Math.round(
        bounds.x + (count < 2 ? bounds.width : (index * bounds.width) / (count - 1))
      ),
      y: Math.round(
        bounds.y +
          bounds.height -
          ((value - minimum) / Math.max(1, maximum - minimum)) * bounds.height
      ),
    };
  }

  graph(x, y, width, height) {
    this.render.fillRectangle(this.colors.graph, x, y, width, height);
    const values = this.state.readings;
    if (!values.length) {
      this.text(
        this.state.error || "Waiting for CGM",
        this.fonts.label,
        this.colors.ink,
        x + width / 2,
        y + height / 2 - 10,
        true
      );
      return;
    }

    const bounds = {
      x: x + 8,
      y: y + 7,
      width: width - 16,
      height: height - 14,
    };
    const points = values.map((value, index) =>
      this.graphPoint(value, index, values.length, bounds)
    );
    for (let index = 1; index < points.length; index += 1) {
      this.render.drawLine(
        points[index - 1].x,
        points[index - 1].y,
        points[index].x,
        points[index].y,
        this.colors.ink,
        4
      );
    }
    points.forEach((point, index) => {
      this.render.drawCircle(
        this.glucoseColor(values[index]),
        point.x,
        point.y,
        index === points.length - 1 ? 5 : 4,
        0,
        360
      );
    });
  }

  bearBackdrop(cx, cy, radius) {
    const earY = cy - Math.round(radius * 0.72);
    const earOffset = Math.round(radius * 0.72);
    const earRadius = Math.round(radius * 0.34);
    const innerRadius = Math.round(earRadius * 0.52);
    const pawY = cy + Math.round(radius * 0.68);
    const pawOffset = Math.round(radius * 0.82);
    const pawRadius = Math.round(radius * 0.25);

    for (const side of [-1, 1]) {
      const earX = cx + side * earOffset;
      this.render.drawCircle(this.colors.crimson, earX, earY, earRadius, 0, 360);
      this.render.drawCircle(this.colors.graph, earX, earY, innerRadius, 0, 360);
      this.render.drawCircle(
        this.colors.crimson,
        cx + side * pawOffset,
        pawY,
        pawRadius,
        0,
        360
      );
    }
  }

  setupScreen(width, height) {
    const center = width >> 1;
    const phoneWidth = 42;
    const phoneHeight = 62;
    const phoneX = center - (phoneWidth >> 1);
    const phoneY = 20;
    this.render.fillRectangle(this.colors.ink, 0, 0, width, height);
    this.render.fillRectangle(
      this.colors.white,
      phoneX,
      phoneY,
      phoneWidth,
      phoneHeight
    );
    this.render.fillRectangle(
      this.colors.crimson,
      phoneX + 3,
      phoneY + 3,
      phoneWidth - 6,
      phoneHeight - 9
    );
    this.render.fillRectangle(
      this.colors.ink,
      center - 3,
      phoneY + phoneHeight - 4,
      6,
      2
    );
    this.text("!", this.fonts.glucose, this.colors.white, center, phoneY + 6, true);
    this.text("SET UP REQUIRED", this.fonts.delta, this.colors.white, center, 91, true);
    this.text(
      "Open the Pebble app",
      this.fonts.label,
      this.colors.pale,
      center,
      126,
      true
    );
    this.text("on your phone", this.fonts.label, this.colors.pale, center, 148, true);
    this.text(
      "CrimsonBear Cgm settings",
      this.fonts.label,
      this.colors.white,
      center,
      178,
      true
    );
    this.text(
      "enter your data source",
      this.fonts.label,
      this.colors.white,
      center,
      199,
      true
    );
  }

  footer(width, height, footerHeight, now) {
    const clock = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes()
    ).padStart(2, "0")}`;
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    this.render.fillRectangle(
      this.colors.ink,
      0,
      height - footerHeight,
      width,
      footerHeight
    );
    this.text(
      `${days[now.getDay()]} ${now.getDate()}`,
      this.fonts.label,
      this.colors.white,
      5,
      height - footerHeight + 5
    );
    this.text(
      clock,
      this.fonts.footer,
      this.colors.white,
      width / 2,
      height - footerHeight,
      true
    );
    const battery = `${this.state.battery}%`;
    this.text(
      battery,
      this.fonts.label,
      this.colors.white,
      width - 5 - this.render.getTextWidth(battery, this.fonts.label),
      height - footerHeight + 5
    );
  }

  readingAge() {
    return this.state.updated
      ? Math.max(0, Math.round((Date.now() - this.state.updated) / 60000))
      : null;
  }

  drawAgeLabel(cx, y, font, age) {
    const unit = this.state.units === "mmol/L" ? "mmol" : "mg/dL";
    const value = `${unit}  ${age == null ? "--m" : `${age}m`}`;
    this.lastAgeTextWidth = this.render.getTextWidth(value, font);
    this.text(
      value,
      font,
      age != null && age > 10 ? this.colors.low : this.colors.ink,
      cx,
      y,
      true
    );
  }

  fullScreenFace(width, height, footerHeight, now, age) {
    const contentHeight = height - footerHeight;
    const cx = width >> 1;
    const cy = contentHeight >> 1;
    const radius = Math.min((width >> 1) - 9, (contentHeight >> 1) - 7);
    this.render.fillRectangle(this.colors.pale, 0, 0, width, height);
    this.bearBackdrop(cx, cy, radius);
    this.render.drawCircle(this.colors.white, cx, cy, radius, 0, 360);
    this.render.drawCircle(this.colors.ink, cx, cy, radius, 0, 360);
    this.render.drawCircle(this.colors.white, cx, cy, radius - 3, 0, 360);
    this.drawGlucose(cx, cy - 53, this.fonts.fullGlucose);
    this.drawAgeLabel(cx, cy - 7, this.fonts.fullLabel, age);
    this.text(
      this.deltaText(),
      this.fonts.fullDelta,
      this.colors.ink,
      cx,
      cy + 22,
      true
    );
    this.arrow(
      cx + Math.round(radius * 0.67),
      cy,
      this.state.direction,
      this.colors.crimson,
      1.25
    );
    this.footer(width, height, footerHeight, now);
  }

  face() {
    const { width, height } = this.render;
    const footerHeight = 30;
    const headerHeight = Math.round(height * 0.54);
    const now = new Date();
    if (!this.state.configured) {
      this.setupScreen(width, height);
      return;
    }

    const age = this.readingAge();
    if (this.state.fullScreen) {
      this.fullScreenFace(width, height, footerHeight, now, age);
      return;
    }
    const radius = Math.min(58, Math.round(headerHeight * 0.47));
    const cx = Math.round(width * 0.48);
    const cy = Math.round(headerHeight / 2);
    this.render.fillRectangle(this.colors.pale, 0, 0, width, height);
    this.bearBackdrop(cx, cy, radius);
    this.render.drawCircle(this.colors.white, cx, cy, radius, 0, 360);
    this.render.drawCircle(this.colors.ink, cx, cy, radius, 0, 360);
    this.render.drawCircle(this.colors.white, cx, cy, radius - 2, 0, 360);

    const delta = this.deltaText();
    this.drawGlucose(cx, cy - 45);
    this.drawAgeLabel(cx, cy - 3, this.fonts.label, age);
    this.text(delta, this.fonts.delta, this.colors.ink, cx, cy + 19, true);
    this.arrow(width - 21, cy, this.state.direction, this.colors.crimson);

    this.graph(0, headerHeight, width, height - headerHeight - footerHeight);
    this.footer(width, height, footerHeight, now);
  }

  requestRender(priority, delay = 400) {
    this.pendingRender = Math.max(this.pendingRender, priority);
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      const pending = this.pendingRender;
      this.pendingRender = 0;
      if (pending === 3) this.drawNow();
      else if (pending === 2) {
        this.drawAgeNow();
        this.drawFooter();
      } else if (pending === 1) this.drawFooterNow();
      if (this.pendingRender) this.requestRender(this.pendingRender);
    }, delay);
  }

  draw() {
    this.requestRender(3);
  }

  recoverRender(error) {
    this.renderRetryCount += 1;
    if (this.renderRetryCount > 5) return;
    const delay = Math.min(4000, 400 * 2 ** (this.renderRetryCount - 1));
    console.log(`render retry ${this.renderRetryCount} in ${delay}ms: ${error}`);
    this.requestRender(3, delay);
  }

  drawNow() {
    let began = false;
    try {
      this.render.begin();
      began = true;
      this.face();
      began = false;
      this.render.end();
      this.renderRetryCount = 0;
    } catch (error) {
      console.log(`draw failed: ${error}`);
      if (began) {
        began = false;
        try {
          this.render.end();
        } catch (_) {
          // The failed frame may no longer be active.
        }
      }
      // Never begin a fallback transaction immediately after a display error.
      this.recoverRender(error);
    }
  }

  drawFooter() {
    this.requestRender(1);
  }

  drawFooterNow() {
    if (!this.state.configured) return;
    const { width, height } = this.render;
    const footerHeight = 30;
    let began = false;
    try {
      this.render.begin(0, height - footerHeight, width, footerHeight);
      began = true;
      this.footer(width, height, footerHeight, new Date());
      began = false;
      this.render.end();
      this.renderRetryCount = 0;
    } catch (error) {
      console.log(`footer draw failed: ${error}`);
      if (began) {
        began = false;
        try {
          this.render.end();
        } catch (_) {
          // The failed frame may no longer be active.
        }
      }
      this.recoverRender(error);
    }
  }

  drawAgeNow() {
    if (!this.state.configured) return;
    const { width, height } = this.render;
    const footerHeight = 30;
    const age = this.readingAge();
    const fullScreen = this.state.fullScreen;
    const headerHeight = Math.round(height * 0.54);
    const contentHeight = height - footerHeight;
    const cx = fullScreen ? width >> 1 : Math.round(width * 0.48);
    const cy = fullScreen ? contentHeight >> 1 : Math.round(headerHeight / 2);
    const radius = fullScreen
      ? Math.min((width >> 1) - 9, (contentHeight >> 1) - 7)
      : Math.min(58, Math.round(headerHeight * 0.47));
    const font = fullScreen ? this.fonts.fullLabel : this.fonts.label;
    const y = cy + (fullScreen ? -7 : -3);
    const unit = this.state.units === "mmol/L" ? "mmol" : "mg/dL";
    const value = `${unit}  ${age == null ? "--m" : `${age}m`}`;
    const widthNow = this.render.getTextWidth(value, font);
    const labelWidth = Math.max(widthNow, this.lastAgeTextWidth) + 8;
    const x = Math.round(cx - labelWidth / 2);

    let began = false;
    try {
      this.render.begin(x, y, labelWidth, font.height);
      began = true;
      this.render.fillRectangle(this.colors.white, x, y, labelWidth, font.height);
      this.drawAgeLabel(cx, y, font, age);
      this.arrow(
        fullScreen ? cx + Math.round(radius * 0.67) : width - 21,
        cy,
        this.state.direction,
        this.colors.crimson,
        fullScreen ? 1.25 : 1
      );
      began = false;
      this.render.end();
      this.renderRetryCount = 0;
    } catch (error) {
      console.log(`age draw failed: ${error}`);
      if (began) {
        began = false;
        try {
          this.render.end();
        } catch (_) {
          // The failed frame may no longer be active.
        }
      }
      this.recoverRender(error);
    }
  }

  drawMinute() {
    if (!this.state.configured) return;
    this.requestRender(2);
  }

  fallback() {
    const center = this.render.width >> 1;
    this.render.begin();
    this.render.fillRectangle(
      this.colors.ink,
      0,
      0,
      this.render.width,
      this.render.height
    );
    this.text("SET UP REQUIRED", this.fonts.delta, this.colors.white, center, 55, true);
    this.text(
      "Open Pebble on phone",
      this.fonts.label,
      this.colors.pale,
      center,
      101,
      true
    );
    this.text(
      "Open CrimsonBear Cgm",
      this.fonts.label,
      this.colors.white,
      center,
      128,
      true
    );
    this.text("Settings", this.fonts.delta, this.colors.white, center, 158, true);
    this.render.end();
  }

  startBatteryService() {
    try {
      this.battery = new Battery({
        onSample: () => {
          if (this.updateBattery()) this.drawFooter();
        },
      });
      if (this.updateBattery()) this.drawFooter();
    } catch (error) {
      console.log(`battery unavailable: ${error}`);
    }
  }

  updateBattery() {
    const sample = this.battery.sample();
    if (!sample || sample.percent == null || sample.percent === this.state.battery)
      return false;
    this.state.battery = sample.percent;
    return true;
  }

  startMessageService() {
    try {
      this.message = new Message({
        keys: ["COMMAND", "DATA", "ERROR", "CONFIGURED"],
        onReadable: () => this.readMessages(),
        onWritable: () => this.message.write(new Map([["COMMAND", "refresh"]])),
      });
      console.log("message service ready");
    } catch (error) {
      console.log(`message service failed: ${error}`);
    }
  }

  checkGlucoseAlarm() {
    const glucose = Number(this.state.glucose);
    const updated = Number(this.state.updated);
    if (!Number.isFinite(glucose) || !Number.isFinite(updated) || updated <= 0) return;

    // Never produce a glucose alarm from stale data restored after a disconnect.
    if (Date.now() - updated > 15 * 60 * 1000) return;

    let zone = "normal";
    if (glucose <= Number(this.state.urgentLow)) zone = "urgentLow";
    else if (glucose <= Number(this.state.low)) zone = "low";
    else if (glucose >= Number(this.state.high)) zone = "high";

    if (zone === "normal") {
      this.alarmZone = zone;
      this.lastAlarmAt = 0;
      return;
    }
    if (!this.state.alarmEnabled) {
      this.alarmZone = zone;
      this.lastAlarmAt = 0;
      return;
    }

    const snoozeMinutes =
      zone === "high" ? this.state.highSnooze : this.state.lowSnooze;
    const snoozeElapsed =
      Date.now() - this.lastAlarmAt >= Number(snoozeMinutes) * 60000;
    const changedZone = zone !== this.alarmZone;
    if (!changedZone && this.lastAlarmAt && !snoozeElapsed) return;

    this.alarmZone = zone;
    this.lastAlarmAt = Date.now();
    if (zone === "urgentLow") {
      Vibes.longPulse();
      setTimeout(() => Vibes.longPulse(), 700);
      setTimeout(() => Vibes.longPulse(), 1400);
    } else if (zone === "low") {
      Vibes.longPulse();
    } else {
      Vibes.doublePulse();
    }
  }

  readMessages() {
    let receivedData = false;
    let needsFullDraw = false;
    for (const [key, value] of this.message.read()) {
      if (key === "DATA") {
        try {
          const data = JSON.parse(value);
          const signature = JSON.stringify(data);
          needsFullDraw =
            needsFullDraw ||
            signature !== this.lastDataSignature ||
            this.state.error != null;
          this.lastDataSignature = signature;
          Object.assign(this.state, data, { error: null });
          receivedData = true;
        } catch (_) {
          needsFullDraw = needsFullDraw || this.state.error !== "Bad response";
          this.state.error = "Bad response";
        }
      } else if (key === "ERROR") {
        needsFullDraw = needsFullDraw || this.state.error !== value;
        this.state.error = value;
      } else if (key === "CONFIGURED") {
        const configured = Boolean(value);
        needsFullDraw = needsFullDraw || this.state.configured !== configured;
        this.state.configured = configured;
      }
    }
    if (receivedData) this.checkGlucoseAlarm();
    if (needsFullDraw) this.draw();
  }
}

new CrimsonBearWatchface().start();
