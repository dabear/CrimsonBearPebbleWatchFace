# Luped CGM mobile protocol

Luped CGM intentionally contains no PebbleKit JS companion and exposes no
settings page in the Pebble app. A supported mobile app such as Loop or Trio
owns settings, alerts and glucose delivery over a direct watch connection.

The mobile app should send `CONFIGURED: 1` and a `DATA` JSON array whenever
settings change, when a new glucose sample arrives, when its alerts change, and
in response to the watch's one-time startup `COMMAND: "refresh"` request.

`DATA` is a minimal 10-element array (protocol version 1):

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
|     9 | Alert event: changes each time the host fires an alert, including repeats                      |

**History (index 4).** Only the graph uses it, and the full-screen ring has no
graph, so hosts send `[]` there (Loop does since elbbepTransport 0.3.8). The
current value, delta and trend travel in their own fields. When the user turns
full-screen off, the host sends a new `DATA` with the history at once. An empty
history in graph mode shows "Waiting for CGM" in the graph area.

**Alerts (indexes 8-9).** The host evaluates its own glucose alerts and applies
its own mute; the watch does not evaluate thresholds. Index 8 is the highest
active alert level, `0` while the user has turned watch alarms off. Index 9 is
an alert event the host advances every time it fires an alert, including each
repeat of an alert that is still active, whether or not watch alarms are on.
The host persists it so a restart can't reuse the value the watch last saw; it
wraps at 1000. The watch buzzes with the glucose-alarm pattern when the event
differs from the last one it saw and the level is above `0` (any level: a host
without the iOS critical-alert entitlement sends urgent alerts at warning
level). It records the event on every `DATA`, even when it doesn't buzz, and
records the first event after the watchface starts without buzzing. So the
watch buzzes when the host fires, repeats with the host, and stops when the
user acknowledges on the phone. Thresholds and repeat intervals do not travel;
the ring and graph are coloured from built-in, unit-aware limits (70/180 mg/dL,
3.9/10 mmol/L). Independently, the watch gives one short buzz when its latest
reading becomes 15 minutes old.

The app may send `ERROR` for a temporary data-source error. It may request a
diagnostic snapshot with `COMMAND: "diagnostics"` or reset counters with
`COMMAND: "diagnostics-reset"`. The watch responds on `DIAGNOSTICS`.
Luped appends two fields to the shared diagnostics array: index 38 counts
system pop-ups (notifications, alarms, calls) that covered the watchface, and
index 39 lists the last 5 host-alert buzzes as `[alert event, alert level,
start (ms since Unix epoch), outcome]`. PebbleOS silently drops an app's
vibration while another one plays and cancels it when a system pop-up closes,
so the outcome records whether a pop-up covered the watchface during the
4.7-second buzz: `-1` not covered, `0` already covered when the buzz started,
otherwise the milliseconds into the buzz.

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
