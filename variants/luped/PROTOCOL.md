# Luped CGM mobile protocol

Luped CGM intentionally contains no PebbleKit JS companion and exposes no
settings page in the Pebble app. A supported mobile app such as Loop or Trio
owns settings, alerts and glucose delivery over a direct watch connection.

The mobile app should send `CONFIGURED: 1` and a `DATA` JSON array whenever
settings change, when a new glucose sample arrives, when its alerts change, and
in response to the watch's one-time startup `COMMAND: "refresh"` request.

`DATA` is a minimal 9-element array (protocol version 1):

| Index | Value                                                                                          |
| ----: | ---------------------------------------------------------------------------------------------- |
|     0 | Protocol version (`1`)                                                                         |
|     1 | Glucose value in the selected display unit                                                     |
|     2 | Delta in the selected display unit                                                             |
|     3 | Direction index: DoubleDown, SingleDown, FortyFiveDown, Flat, FortyFiveUp, SingleUp, DoubleUp  |
|     4 | Up to 12 glucose values, oldest first, for the graph. `[]` in full-screen mode (index 7 = `1`) |
|     5 | Units: `0` mg/dL, `1` mmol/L                                                                   |
|     6 | Reading timestamp in Unix milliseconds                                                         |
|     7 | Full-screen ring: `0` ring with graph, `1` full-screen ring                                    |
|     8 | Host-issued alert level: `0` none, `1` info, `2` warning, `3` critical                         |

**History (index 4).** Only the graph uses it, and the full-screen ring has no
graph, so hosts send `[]` there (Loop does since elbbepTransport 0.3.8). The
current value, delta and trend travel in their own fields. When the user turns
full-screen off, the host sends a new `DATA` with the history at once. An empty
history in graph mode shows "Waiting for CGM" in the graph area.

**Alerts (index 8).** The host evaluates its own glucose alerts and applies its
own mute; the watch does not evaluate thresholds. The watch buzzes with the
glucose-alarm pattern whenever the level rises (any level: a host without the
iOS critical-alert entitlement sends urgent alerts at warning level) and re-arms
when the host clears it to `0`. Thresholds and repeat intervals do not travel;
the ring and graph are coloured from built-in, unit-aware limits (70/180 mg/dL,
3.9/10 mmol/L). Independently, the watch gives one short buzz when its latest
reading becomes 15 minutes old.

The app may send `ERROR` for a temporary data-source error. It may request a
diagnostic snapshot with `COMMAND: "diagnostics"` or reset counters with
`COMMAND: "diagnostics-reset"`. The watch responds on `DIAGNOSTICS`.

Loop delivers these messages over its own PPoGATT session (the watch stays
connected to the Pebble app at the same time) through the LupedKitWatchFace
plugin. The phone side of this protocol is the `LupedKit` library in
[elbbepTransport](https://github.com/dabear/elbbepTransport), which Loop links
and other apps such as Trio can share.

There is no watch-side periodic glucose fetch timer in this variant. Glucose is
pushed by the host; the startup refresh request exists only to restore state
after the watchface starts.

The CrimsonBear variant keeps its own 16-element layout with watch-evaluated
thresholds (`src/embeddedjs/protocol.js`); it is unaffected.
