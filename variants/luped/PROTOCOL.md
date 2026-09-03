# Luped CGM mobile protocol

Luped CGM intentionally contains no PebbleKit JS companion and exposes no
settings page in the Pebble app. A future Loop mobile integration owns settings,
alarms and glucose delivery.

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
|     9 | Vibration alarms enabled: `0` or `1`                                                          |
|    10 | Low/urgent-low snooze minutes                                                                 |
|    11 | High snooze minutes                                                                           |
|    12 | Reading timestamp in Unix milliseconds                                                        |
|    13 | Full-screen ring: `0` trend mode, `1` full-screen mode                                        |

The app may send `ERROR` for a temporary data-source error. It may request a
diagnostic snapshot with `COMMAND: "diagnostics"` or reset counters with
`COMMAND: "diagnostics-reset"`. The watch responds on `DIAGNOSTICS`.

There is no watch-side periodic glucose fetch timer in this variant. Glucose is
pushed by Loop; the startup refresh request exists only to restore state after
the watchface starts.
