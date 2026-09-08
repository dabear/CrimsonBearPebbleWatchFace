# Project guidance

## Keeping this file current

- Whenever a task reveals a new project, build, emulator, rendering, integration, or workflow fact, update this file during the same task before handing off.
- Include the operational consequence, command or invariant when useful, and keep the guidance concise and actionable.
- If the task includes a commit or push, include the `AGENTS.md` update in that same commit.

## Builds

- Treat `crimsonbear` as the standard variant and `luped` as the standalone Loop variant. Build only `crimsonbear` unless the user explicitly requests Luped.
- Use `PEBBLE_BIN="$(command -v pebble)" ./scripts/build-release.sh --variant <variant> --build --minify` for release verification.
- The Alloy resource pack must remain below 32,133 bytes on every platform. Report Alloy size, byte/percentage headroom, PBW size, and SHA-256 from the build summary.
- The release wrapper's 32,133-byte Alloy guard is conservative, not a documented SDK resource-pack ceiling. With CrimsonBear's current code shape on physical Emery hardware, a controlled 66,708-byte `mc.xsa` / 71,159-byte resource pack launches repeatably, while adding one byte (66,709 / 71,160) repeatably fails with `Fatal Error: Memory Full`; SDK 4.33.1 emulators accept larger archives. Treat this as an app- and runtime-specific measured boundary rather than a universal Alloy limit, and keep substantial release headroom.
- The likely practical-limit improvement first shipped in PebbleOS v4.10.0: commit `8c1a32acef` moved high-churn `TaskTimer` allocations out of the kernel heap to prevent fragmentation. Alloy has always attempted to place its 32 KiB static XS block in kernel heap only when a contiguous 32 KiB block is available; otherwise that block consumes app RAM and leaves roughly the old 32 KiB archive headroom. This version attribution is source-based; proving it exactly requires hardware testing on v4.9.148 versus v4.10.0.
- CrimsonBear 2.2.19 with connection recovery cleanup uses 31,565 Alloy bytes, leaving 568 bytes (1.77%) of headroom.
- When bumping CrimsonBear, update `package.json`, both root version fields in `package-lock.json`, and the diagnostics version in `src/pkjs/index.js` together.
- Build both `emery` and `gabbro`; a successful build of only one platform is not sufficient.
- Pebble Tool requires Python 3.10 on Apple Silicon (`uv tool install --python 3.10 pebble-tool`).
- The macOS emulator also requires Homebrew `libpng`.
- Relative to v4.36.1, PebbleOS v4.36.2 is an alarm-only patch: it re-picks one-time alarm days at boot and fires alarms missed by up to five minutes while the watch was down. Relative to v4.36.0 it also includes v4.36.1's one-line change disabling resume for the native-heartbeat analytics logging session. None of these releases changes Alloy, Moddable, app memory, resource loading, AppMessage, or rendering.
- Release-build delays can come almost entirely from npm: the wrapper runs `npm ci`, and `pebble build` performs additional staged dependency checks. Warm-cache installs may finish in under a second, while a registry/cache validation can stall for about five minutes; Emery/Gabbro compilation itself typically takes under a second.
- Use `--skip-deps` for repeated local builds only after a successful dependency install. It requires `npm ls --all` to pass and the installed hidden lock to exactly match `package-lock.json`, then removes build-only dependencies from the isolated stage to prevent Pebble Tool's redundant install. It is rejected for publishing.

## Variant boundaries

- Variant selection happens while assembling `src/embeddedjs/main.js.in`; keep variant-only drawing and behavior inside the existing `// @if` sections.
- Keep constants used only by variant-gated code inside the same `// @if` section; otherwise generated variants can fail lint with unused bindings.
- CrimsonBear and Luped have separate UUIDs and can coexist. When emulator results look like the wrong variant, reset the disposable emulator state and install the intended PBW alone.
- Luped has no PebbleKit JS companion (`enableMultiJS: false`). CLI AppMessage injection does not reliably reproduce its Loop integration. For screenshots, a temporary source-level sample state may be used, but restore all production defaults and rebuild the final artifact afterward.
- For mmol/L visual fixtures, use mmol/L thresholds (for example urgent-low 3.0, low 4.0, high 10.0). Reusing mg/dL thresholds makes normal readings appear in the low/crimson color.

## Rendering invariants

- The footer owns cached state for clock, date, battery, and Bluetooth independently.
- Clock, date, and battery comparisons happen only from `minutechange`, using `event.date`; redraw only the region whose value changed.
- Connection changes redraw only the Bluetooth indicator region. Do not clear or redraw unrelated footer fields.
- The CGM reading timestamp is absolute local `HH:mm`, not relative age, and is updated only by a CGM/content render—not by the footer minute render.
- Treat the initial phone configuration state as unknown. Show the neutral connecting screen during the first handshake, and show setup instructions only after an explicit `CONFIGURED: 0` response.
- Graph mode follows the CGM Skyline hierarchy: bold glucose centered in the ring, a smaller delta below it, and a narrow reading-time strip rendered behind the lower part of the ring.
- Full-screen mode has no reading-time strip. Put the reading time inside the ring below the delta, and make the ring meet the footer without a gap.
- Once a configured face has rendered, preserve the pale content background and fixed status-strip fill during content updates; clear/redraw only the changing timestamp and dynamic ring/graph pixels. Initial setup, resize, and fullscreen/layout transitions still require the static layers.
- In graph mode, the trend arrow sits outside the ring's radius, so the ring/backdrop redraw never repaints that spot. Explicitly clear its bounding box (see `arrowClearRadius` in `face()`) before drawing, or a direction change leaves the old glyph's strokes mixed with the new one. Full-screen mode doesn't need this: its arrow sits inside the ring, which the inner white circle already repaints every render.

## Emulator verification

- Verify both graph and full-screen modes for both variants after layout changes.
- Capture Emery screenshots with `pebble screenshot --emulator emery --no-open <path>` and inspect the actual image, not only build success.
- The first frame immediately after install can be blank or show setup while the 400 ms coalesced render is pending. Capture again after the app settles before diagnosing a rendering failure.
- Open each requested screenshot automatically on macOS after capture.
- Never leave sample glucose data, forced `configured`, forced `fullScreen`, or diagnostic rendering changes in production source.

## CloudPebble and emulator operations

- CloudPebble installation requires `pebble login` first; the login flow authenticates through Firebase/GitHub and may open a browser.
- Install a phone build with `pebble install build/pebble.pbw --cloudpebble`. Confirm the proxy authenticates, the phone connects, and `App install succeeded` appears.
- CrimsonBear and Luped use different UUIDs. Installing one does not reliably make it the active emulator watchface when the other is already running; use `pebble wipe` (without `--emulator`) and `pebble kill`, then install the intended PBW alone for unambiguous screenshots.
- `pebble wipe` has no `--emulator` option; it resets the current disposable emulator state. Do not use `--everything` unless account data and all SDK-version state may be removed.
- After installing or injecting data, wait for the app’s coalesced render before capturing. A setup, blank, or stale frame immediately after the command can be transient.
- When a screenshot is requested, save it under `assets/`, open it with macOS `open`, and inspect the image contents before reporting visual verification.
- For Luped, the CLI cannot reliably inject named AppMessage fields because it has no PebbleKit JS companion. Use a temporary source-level sample state only for visual checks, then restore defaults and rebuild the production PBW.
- For refreshed visual assets, use the in-range mmol/L fixture (6.8 glucose, +0.2 delta, 5.4–6.8 readings, thresholds 3.0/4.0/10.0), isolate it from the companion with `SCREENSHOT_FIXTURE`, and use `--vnc` when the emulator must remain available for a separate screenshot command. Restore the fixture and rebuild production artifacts before publishing.

## Pixel-budget reporting

- The diagnostics `invalidatedPixels` counter reports transaction area, not individual drawing writes. For a typical 24-hour estimate, use 1 initial full frame, 288 CGM updates (5-minute cadence), and 1,440 minute events; add one 58×30 date region redraw and any actual battery/Bluetooth changes.
- Current minute redraws invalidate an approximately 86×30 clock region; minified and unminified builds have identical pixel geometry. Emery’s content-only region is 200×198 and Gabbro’s is 260×230.
- User-facing platform names are Pebble Time 2 (`emery`, 200×228) and Pebble Round 2 (`gabbro`, 260×260); use those names in reports instead of only the platform codenames.
- Rendering uses a single-flight gate (`renderBusy`) with dirty/priority flags and zero-delay event-loop coalescing. The gate is cleared in `finally`, and queued work is serviced afterward; render-failure retries preserve their longer delay. A lock alone would drop updates or cause redundant retries.
- `Battery` is sampled at most every `BATTERY_SAMPLE_INTERVAL_MS` (5 minutes) from the existing minute wake-up, not on every `minutechange`. Hourly diagnostics are marked pending (`telemetryPending`/`telemetryDueAt`) and ride the next outbound write (a refresh request or `onWritable` flush) instead of forcing their own; `DIAGNOSTICS_PIGGYBACK_GRACE_MS` (15 minutes) forces a dedicated flush only if nothing else has sent them by then. On-demand `COMMAND diagnostics` requests from the phone still flush immediately via `requestDiagnostics()`.
- The watch owns ongoing CGM polling; the phone companion has no refresh scheduler. It performs one startup fetch on PebbleKit JS `ready`, then fetches only for watch requests or immediately after settings change. On minute events, CrimsonBear requests when the current reading reaches 5 minutes old, retries once at 6 minutes if its timestamp did not advance, then retries every 5 minutes while that same reading remains stale; a new reading timestamp resets the sequence. Let message-service writability authorize outbound attempts because `watch.connected.app` can lag during startup; retain work when `message.write()` fails and retry from `onWritable` or reconnect.
- Keep the phone's duplicate-fetch guard at 30 seconds: it suppresses startup AppMessage/`ready` bursts without swallowing the deliberate one-minute retry between reading ages 5 and 6 minutes.
- Explicitly call `flushOutbound()` after assigning a newly constructed `Message`; its initial `onWritable` callback can run synchronously before `this.message` receives the instance and otherwise strand the startup request.
- `Message.onWritable` indicates send availability, not confirmed phone delivery; `onSuspend` can also mean temporary outbox contention (see the official Alloy App Messages guide). SDK 4.33.1 routes send failures through the same reactivation path as successful sends. Never gate due refreshes on cached `isConnected`: the existing minute event also retries pending rejected writes without needing a recovery callback. Incoming messages restore connection state after processing the response, so reconnect flushing does not resend satisfied requests. Successful writes retain the 5/6-minute reading cadence; rejected writes get at most one retry per minute from this fallback. Run `node scripts/test-refresh-recovery.cjs` to verify cached-disconnect recovery, pending writes, cadence, and ERR clearing without restart.
- Remaining battery opportunity: splitting CGM content into smaller dirty regions where Poco layering permits. The zero-delay coalescer minimizes latency; a short 25–75 ms coalescing window is an optional burst-energy tradeoff.
- After every release build, recompute and report the fixed daily pixel-redraw table below for both platforms (full frame + 288 CGM updates + 1,440 minute clock redraws + 1 date-rollover redraw; battery/Bluetooth redraws stay out of the fixed total since they're variable), diff it against the "Last recorded" table, call out any change (or state explicitly that there is none), and overwrite the "Last recorded" table with the new numbers and date/commit.
- Last recorded fixed pixel-redraw table (2026-09-08, connection recovery fix; recomputed with no change to the fixed geometry below):
  | Component            | Region                 | Count/day | Emery px/day   | Gabbro px/day  |
  | -------------------- | ---------------------- | --------- | -------------- | -------------- |
  | Full frame           | 200×228 / 260×260      | 1         | 45,600         | 67,600         |
  | CGM content updates  | 200×198 / 260×230      | 288       | 11,404,800     | 17,222,400     |
  | Minute clock redraws | 86×30 (both platforms) | 1,440     | 3,715,200      | 3,715,200      |
  | Date rollover        | 58×30 (both platforms) | 1         | 1,740          | 1,740          |
  | **Fixed total**      |                        |           | **15,167,340** | **21,006,940** |
- Keep exactly two screenshot assets per variant: normal graph mode and fullscreen mode. CrimsonBear publishing uploads its two `emery_` screenshots with `--replace-screenshots`; Luped remains local-only until a store publishing workflow is configured.
- RePebble rejects publishing a release version that already exists; screenshot-only store updates require a new CrimsonBear patch version before retrying publication.
- Luped alarm palette is variant-specific: low glucose uses red (`low`), high glucose uses yellow (`high`), and both the ring and glucose value obtain their color from the shared `glucoseColor()` path.
- Luped rings are solid: normal glucose uses the shared green `accent`, low uses red (`low`), and high uses yellow (`high`) through `glucoseColor()`. Do not add gradient or shading arcs.
- Emery/Gabbro are 6-bit color (2 bits per RGB channel: hardware quantizes every channel into 4 bins — 0–63, 64–127, 128–191, 192–255 — truncated to 0/85/170/255). Screenshot colors won't match source RGB values; use `pebble screenshot --no-correction` for the raw quantized framebuffer when verifying exact colors, since the default color-corrected output remaps them. This also caps how many visually distinct tones a gradient can show — more than 2–3 interpolated steps between close colors usually collapses back to the same 1–2 quantized buckets.
