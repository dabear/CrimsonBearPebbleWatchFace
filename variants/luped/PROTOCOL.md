# Luped CGM mobile protocol

Luped CGM intentionally contains no PebbleKit JS companion and exposes no
settings page in the Pebble app. A supported mobile app such as Loop or Trio
owns settings, alarms and glucose delivery over a direct watch connection.

The mobile app should send `CONFIGURED: 1` and a `DATA` JSON array whenever
settings change, when a new glucose sample arrives, and in response to the
watch's one-time startup `COMMAND: "refresh"` request.

`DATA` uses this compact schema:

| Index | Value                                                                                         |
| ----: | --------------------------------------------------------------------------------------------- |
|     0 | Protocol version (`1`)                                                                        |
|     1 | Glucose value in the selected display unit                                                    |
|     2 | Delta in the selected display unit                                                            |
|     3 | Direction index: DoubleDown, SingleDown, FortyFiveDown, Flat, FortyFiveUp, SingleUp, DoubleUp |
|     4 | Up to 12 glucose values, oldest first                                                         |
|     5 | Units: `0` mg/dL, `1` mmol/L                                                                  |
|     6 | Urgent-low threshold                                                                          |
|     7 | Low threshold                                                                                 |
|     8 | High threshold                                                                                |
|     9 | Vibration alarms bitmask: `1` urgent low, `2` low, `4` high (`0` disables all)                |
|    10 | Low/urgent-low snooze minutes                                                                 |
|    11 | High snooze minutes                                                                           |
|    12 | Reading timestamp in Unix milliseconds                                                        |
|    13 | Full-screen ring: `0` trend mode, `1` full-screen mode                                        |
|    14 | Urgent-low repeat minutes (optional; defaults to index 10)                                    |
|    15 | Host-issued alert level (optional): `0` none, `1` info, `2` warning, `3` critical             |

Index 9 controls watch-evaluated glucose alarms. Loop and Trio evaluate their
own alerts on the phone and send alarm mask `0` (index 9), driving the watch
through the host-issued alert level (index 15) instead: the watch buzzes when
the level first rises and re-arms when the host clears it to `0`. A host that
instead wants the watch to evaluate thresholds itself sends a non-zero mask and
leaves index 15 at `0`; both paths are supported. Since Luped 0.1.1, the watch
always gives one short buzz when its latest reading becomes 15 minutes old,
whatever the mask.

The app may send `ERROR` for a temporary data-source error. It may request a
diagnostic snapshot with `COMMAND: "diagnostics"` or reset counters with
`COMMAND: "diagnostics-reset"`. The watch responds on `DIAGNOSTICS`.

Loop delivers these messages over its own PPoGATT session (the watch stays
connected to the Pebble app at the same time); see `LUPED.md` in the Loop
repository.

There is no watch-side periodic glucose fetch timer in this variant. Glucose is
pushed by Loop; the startup refresh request exists only to restore state after
the watchface starts.
