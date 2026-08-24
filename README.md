# CrisonBear Cgm

A crimson, pulse-line glucose watchface for Pebble Time 2 and newer hardware. It shows current glucose in a circle, trend arrow, delta, a 12-reading graph, date/time, and battery using the current Alloy embedded JavaScript runtime.

On first launch, the watch displays a prominent setup notice directing the user to the watchface settings in the Pebble phone app.

## Supported watches

- Pebble Time 2 (`emery`, 200×228)
- Pebble Round 2 (`gabbro`, 260×260)

Older platforms are deliberately excluded. The layout uses the unobstructed screen size and adapts to rectangular and round displays.

## Data sources

- Nightscout: enter the site root URL and, for protected sites, an access token/API secret.
- mg/dL and mmol/L display modes, with configurable low/high thresholds.

Credentials remain in the Pebble phone companion's local storage and are sent only to the selected CGM service. This watchface is informational and must not be used to make treatment decisions.

## Build

Install `pebble-tool` 5.0.23 or newer and the latest Pebble SDK (4.9.148 or newer is recommended):

```sh
uv tool install pebble-tool
pebble sdk install latest
pebble build
```

Install on the Time 2 emulator:

```sh
pebble install --emulator emery
```

Open the watchface settings from the Pebble mobile app to configure a CGM source. The settings UI is bundled as a self-contained data URL, so it has no hosting dependency.

## Development notes

The watch code is in `src/embeddedjs/main.js`; phone networking and configuration are in `src/pkjs/index.js`. The watch requests a refresh at launch, the phone refreshes every five minutes, and the display calculates reading age locally every minute.
