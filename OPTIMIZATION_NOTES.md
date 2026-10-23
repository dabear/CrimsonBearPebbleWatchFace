# Watch-Side Performance Optimization Notes

## Current Performance Characteristics

### Battery Usage

- **Battery sampling**: Every 5 minutes (good - not continuous)
- **No polling scheduler**: Watch requests data only when needed
- **Event-driven**: Uses minutechange events, not continuous timers

### Bluetooth Usage

- **On-demand refresh**: Watch requests at 5-min reading age
- **Quick retry**: 6-min retry if timestamp unchanged
- **Stale throttling**: 5-min intervals for continued stale retries
- **Piggyback telemetry**: Diagnostics ride outgoing messages (15-min grace)
- **Retry on write failure**: onWritable handler retries pending requests

### CPU/Rendering

- **Partial redraws**: Footer-only updates (~30px vs full 228/260px)
- **Coalesced rendering**: Multiple updates batched in single draw
- **Content preservation**: Static elements (ring, bear) not redrawn on minute updates
- **Smart footer updates**: Clock, date, battery, connection status updated independently

## Optimization Opportunities

### High Impact

#### 1. Cache Text Width Calculations

**Location**: `drawMinuteNow()` (lines 900-920)
**Issue**: `getTextWidth()` called every minute for clock, date, battery
**Impact**: CPU - string layout calculation each minute

```javascript
// Current: Recalculates every minute
const clockWidth = this.render.getTextWidth(clock, this.fonts.footer);

// Optimized: Cache until value changes
if (clock !== this.footerState.clock) {
  this.footerState.clockWidth = this.render.getTextWidth(clock, this.fonts.footer);
  // ... redraw ...
} else {
  const clockWidth = this.footerState.clockWidth; // cached
}
```

#### 2. Cache Graph Bounds Calculation

**Location**: `graph()` (lines 370-390)
**Issue**: Min/max bounds recalculated every full draw even when readings unchanged
**Impact**: CPU - Math.min/max over array every draw

```javascript
// Cache bounds signature
const readingsSig = JSON.stringify(this.state.readings);
if (readingsSig === this.lastReadingsSig) {
  // Use cached bounds
} else {
  // Recalculate bounds
  this.lastReadingsSig = readingsSig;
}
```

#### 3. Reduce Arrow Clear Overhead

**Location**: `face()` (lines 755-762)
**Issue**: Arrow area cleared on every full draw, even when direction unchanged
**Impact**: CPU + battery (unnecessary fillRectangle call)

```javascript
// Only clear if direction changed
if (this.lastDirection !== this.state.direction) {
  this.render.fillRectangle(
    this.colors.pale,
    arrowCx - arrowClearRadius,
    cy - arrowClearRadius,
    arrowClearRadius * 2,
    arrowClearRadius * 2
  );
  this.lastDirection = this.state.direction;
}
```

### Medium Impact

#### 4. Optimized Data Duplicate Detection

**Location**: `readMessages()` (lines 1180-1190)
**Issue**: `JSON.stringify(data)` for signature on every message
**Impact**: CPU - full JSON serialization each DATA message

```javascript
// Use lightweight signature instead
const signature = `${data.glucose}-${data.delta}-${data.direction}-${data.updated}`;
// Or use structured field comparison
const changed =
  data.glucose !== this.state.glucose ||
  data.delta !== this.state.delta ||
  data.direction !== this.state.direction ||
  data.updated !== this.state.updated;
```

#### 5. Footer State Comparison Optimization

**Location**: `drawMinuteNow()` (lines 905-915)
**Issue**: String comparisons for every field every minute
**Impact**: CPU - could use numeric checks first

```javascript
// Numeric comparison before string generation
const newHour = date.getHours();
const newMinute = date.getMinutes();
const clockChanged =
  newHour !== this.footerState.lastHour || newMinute !== this.footerState.lastMinute;

const dateChanged =
  date.getDate() !== this.footerState.lastDate ||
  date.getDay() !== this.footerState.lastDay;
```

### Low Impact / Monitoring

#### 6. Diagnostics Overhead

**Location**: Throughout draw paths
**Issue**: Diagnostic counting on every draw/minute event
**Impact**: Minimal but accumulates

- Consider sampling (count every Nth draw)
- Or add `perfMode` flag to disable during development

#### 7. Late Minute Event Calculation

**Location**: `drawMinute()` (lines 855-865)
**Issue**: Timestamp diff calculation every minute even when not late
**Impact**: Negligible, but adds arithmetic overhead

## Measurements Available

The watch already tracks comprehensive diagnostics:

- Full/minute draw counts and timing (ms, max ms)
- Invalidated pixels per draw type
- Late minute events and latency
- Phone disconnect durations
- Message counts and byte totals
- Refresh response latency buckets

Use `exportDebug` in phone companion to review real-world performance.

## Recommended Priority

1. **Cache text widths** - Easy win, visible CPU reduction
2. **Conditional arrow clear** - Simple logic, removes redundant fill
3. **Lightweight duplicate detection** - Reduces JSON.stringify overhead
4. **Cache graph bounds** - More complex but significant for full draws
5. **Footer numeric comparisons** - Minor optimization
