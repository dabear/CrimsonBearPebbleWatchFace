# CrimsonBear Cgm

<p align="center">
  <img src="assets/crimsonbear-teddy.png" alt="CrimsonBear teddy logo" width="180">
</p>

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

## Quick build

You need Python 3, Node.js, [`uv`](https://docs.astral.sh/uv/), and a working ARM toolchain. Then run:

```sh
uv tool install pebble-tool
pebble sdk install latest
git clone git@github.com:dabear/CrimsonBearPebbleWatchFace.git
cd CrimsonBearPebbleWatchFace
npm install
pebble build
```

The finished package is written to `build/pebble.pbw`.

## Install

Enable Developer Connection in the Pebble phone app, then run:

```sh
pebble install build/pebble.pbw --phone
```

To build and install on the Time 2 emulator instead:

```sh
pebble install build/pebble.pbw --emulator emery
```

Open the watchface settings from the Pebble mobile app to configure a CGM source. The settings UI is bundled as a self-contained data URL, so it has no hosting dependency.

## Development notes

The watch code is in `src/embeddedjs/main.js`; phone networking and configuration are in `src/pkjs/index.js`. The watch requests a refresh at launch, the phone refreshes every five minutes, and the display calculates reading age locally every minute.
