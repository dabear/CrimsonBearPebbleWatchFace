import Poco from "commodetto/Poco";
import Message from "pebble/message";
import Battery from "embedded:sensor/Battery";

class CrisonBearWatchface {
  constructor() {
    this.render = new Poco(screen);
    this.fonts = {
      glucose: new this.render.Font("Bitham-Medium", 42),
      delta: new this.render.Font("Gothic-Bold", 24),
      label: new this.render.Font("Gothic-Regular", 18),
      footer: new this.render.Font("Bitham-Black", 30),
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
      low: 70,
      high: 180,
      updated: 0,
      configured: false,
      error: null,
      battery: 100,
    };
  }

  start() {
    this.draw();
    this.startBatteryService();
    this.startMessageService();
    watch.addEventListener("minutechange", () => this.draw());
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

  drawGlucose(cx, y) {
    const color = this.glucoseColor(this.state.glucose);
    const value = this.glucoseText();
    if (this.state.units !== "mmol/L" || this.state.glucose == null) {
      this.text(value, this.fonts.glucose, color, cx, y, true);
      return;
    }

    const [whole, fraction] = value.split(".");
    const wholeWidth = this.render.getTextWidth(whole, this.fonts.glucose);
    const fractionWidth = this.render.getTextWidth(fraction, this.fonts.glucose);
    const decimalWidth = 9;
    const left = Math.round(cx - (wholeWidth + decimalWidth + fractionWidth) / 2);
    this.text(whole, this.fonts.glucose, color, left, y);
    this.render.drawCircle(color, left + wholeWidth + 4, y + 34, 3, 0, 360);
    this.text(fraction, this.fonts.glucose, color, left + wholeWidth + decimalWidth, y);
  }

  arrow(cx, cy, direction, color) {
    const slopes = {
      DoubleUp: -2,
      SingleUp: -1.2,
      FortyFiveUp: -0.5,
      Flat: 0,
      FortyFiveDown: 0.5,
      SingleDown: 1.2,
      DoubleDown: 2,
    };
    const slope = slopes[direction];
    if (slope === undefined) {
      this.text("?", this.fonts.delta, color, cx, cy - 12, true);
      return;
    }

    const dx = Math.abs(slope) > 1.5 ? 6 : 14;
    const dy = Math.max(-18, Math.min(18, Math.round(dx * slope)));
    this.render.drawLine(cx - dx, cy - dy, cx + dx, cy + dy, color, 5);
    for (const offset of [-0.72, 0.72]) {
      const angle = Math.atan2(dy, dx) + offset;
      this.render.drawLine(
        cx + dx,
        cy + dy,
        Math.round(cx + dx - 11 * Math.cos(angle)),
        Math.round(cy + dy - 11 * Math.sin(angle)),
        color,
        4
      );
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
      "CrisonBear Cgm settings",
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

  face() {
    const { width, height } = this.render;
    const footerHeight = 30;
    const headerHeight = Math.round(height * 0.54);
    const now = new Date();
    if (!this.state.configured) {
      this.setupScreen(width, height);
      return;
    }

    const clock = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes()
    ).padStart(2, "0")}`;
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const age = this.state.updated
      ? Math.max(0, Math.round((Date.now() - this.state.updated) / 60000))
      : null;
    const radius = Math.min(58, Math.round(headerHeight * 0.47));
    const cx = Math.round(width * 0.48);
    const cy = Math.round(headerHeight / 2);
    this.render.fillRectangle(this.colors.pale, 0, 0, width, height);
    this.bearBackdrop(cx, cy, radius);
    this.render.drawCircle(this.colors.white, cx, cy, radius, 0, 360);
    this.render.drawCircle(this.colors.ink, cx, cy, radius, 0, 360);
    this.render.drawCircle(this.colors.white, cx, cy, radius - 2, 0, 360);

    const unit = this.state.units === "mmol/L" ? "mmol" : "mg/dL";
    const ageText = age == null ? "--m" : `${age}m`;
    const delta =
      this.state.delta == null
        ? "--"
        : `${this.state.delta > 0 ? "+" : ""}${this.state.delta}`;
    this.drawGlucose(cx, cy - 45);
    this.text(
      `${unit}  ${ageText}`,
      this.fonts.label,
      age != null && age > 10 ? this.colors.low : this.colors.ink,
      cx,
      cy - 3,
      true
    );
    this.text(delta, this.fonts.delta, this.colors.ink, cx, cy + 19, true);
    this.arrow(width - 27, cy, this.state.direction, this.colors.crimson);

    this.graph(0, headerHeight, width, height - headerHeight - footerHeight);
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

  draw() {
    try {
      this.render.begin();
      this.face();
      this.render.end();
    } catch (error) {
      console.log(`draw failed: ${error}`);
      try {
        this.render.end();
      } catch (_) {
        // The failed frame may not have started.
      }
      this.fallback();
    }
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
      "Open CrisonBear Cgm",
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
          this.updateBattery();
          this.draw();
        },
      });
      this.updateBattery();
    } catch (error) {
      console.log(`battery unavailable: ${error}`);
    }
  }

  updateBattery() {
    const sample = this.battery.sample();
    if (sample && sample.percent != null) this.state.battery = sample.percent;
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

  readMessages() {
    for (const [key, value] of this.message.read()) {
      if (key === "DATA") {
        try {
          Object.assign(this.state, JSON.parse(value), { error: null });
        } catch (_) {
          this.state.error = "Bad response";
        }
      } else if (key === "ERROR") {
        this.state.error = value;
      } else if (key === "CONFIGURED") {
        this.state.configured = Boolean(value);
      }
    }
    this.draw();
  }
}

new CrisonBearWatchface().start();
