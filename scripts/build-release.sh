#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
repo_root="$(pwd)"

do_build=false
do_install=false
do_publish=false
do_minify=false
release_notes=""
interactive=false
variant="crimsonbear"

usage() {
  cat <<'EOF'
Usage: ./scripts/build-release.sh [--variant crimsonbear|luped] [--build] [--install] [--publish] [--minify] [--release-notes TEXT]

With no arguments, the script interactively selects actions. Explicit action flags
run without prompts. --install targets the connected phone; --publish pushes main
to GitHub and publishes the release to the RePebble store without requiring
--build or --install. Publishing is available only for CrimsonBear. The Pebble
publisher still performs its mandatory package build. --minify safely compresses
and mangles internal watch JavaScript identifiers without mangling protocol properties.
EOF
}

if [[ $# -eq 0 ]]; then
  interactive=true
else
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --variant)
        if [[ $# -lt 2 ]]; then
          echo "--variant requires crimsonbear or luped." >&2
          exit 2
        fi
        variant="$2"
        shift
        ;;
      --build) do_build=true ;;
      --install) do_install=true ;;
      --publish) do_publish=true ;;
      --minify) do_minify=true ;;
      --release-notes)
        if [[ $# -lt 2 ]]; then
          echo "--release-notes requires text." >&2
          exit 2
        fi
        release_notes="$2"
        shift
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        usage >&2
        exit 2
        ;;
    esac
    shift
  done
fi

if [[ "$variant" != "crimsonbear" && "$variant" != "luped" ]]; then
  echo "Unknown variant: $variant" >&2
  usage >&2
  exit 2
fi

confirm() {
  local prompt="$1"
  local default="$2"
  local answer
  read -r -p "$prompt" answer
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy]$ ]]
}

if [[ "$interactive" == true ]]; then
  read -r -p "Variant [crimsonbear/luped] (crimsonbear): " variant
  variant="${variant:-crimsonbear}"
  if [[ "$variant" != "crimsonbear" && "$variant" != "luped" ]]; then
    echo "Unknown variant: $variant" >&2
    exit 2
  fi
  if confirm "Build the PBW? [Y/n] " y; then do_build=true; fi
  if confirm "Install on the connected phone? [y/N] " n; then do_install=true; fi
  if confirm "Push GitHub and publish to RePebble? [y/N] " n; then
    do_publish=true
    default_notes="$(git log -1 --pretty=%s)"
    read -r -p "Release notes [$default_notes]: " release_notes
    release_notes="${release_notes:-$default_notes}"
  fi
  if [[ "$do_build" == true || "$do_publish" == true ]]; then
    if confirm "Minify generated watch JavaScript? [y/N] " n; then do_minify=true; fi
  fi
fi

if [[ "$do_build" == false && "$do_install" == false && "$do_publish" == false ]]; then
  echo "No action selected." >&2
  exit 2
fi

pebble_bin="${PEBBLE_BIN:-}"
if [[ -z "$pebble_bin" ]]; then
  pebble_bin="$(command -v pebble || true)"
fi
if [[ -z "$pebble_bin" || ! -x "$pebble_bin" ]]; then
  echo "Set PEBBLE_BIN to an executable pebble-tool command." >&2
  exit 1
fi

if [[ "$variant" == "luped" ]]; then
  package_file="variants/luped/package.json"
  artifact="build/luped-cgm.pbw"
  display_name="Luped CGM"
else
  package_file="package.json"
  artifact="build/pebble.pbw"
  display_name="CrimsonBear Cgm"
fi
version="$(node -p "require('./$package_file').version")"
stage="build/variants/$variant/project"

assemble_watchface() {
  node - "$1" "$2" "$3" <<'NODE'
const fs = require("fs");

const [templatePath, configPath, destinationPath] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const template = fs.readFileSync(templatePath, "utf8");
const output = [];
const stack = [];
let active = true;

for (const line of template.split("\n")) {
  const condition = line.match(/^\s*\/\/ @if ([A-Za-z][A-Za-z0-9]*)\s*$/);
  if (condition) {
    if (!(condition[1] in config))
      throw new Error(`Unknown variant condition: ${condition[1]}`);
    stack.push({ parent: active, matched: Boolean(config[condition[1]]), sawElse: false });
    active = active && Boolean(config[condition[1]]);
    continue;
  }
  if (/^\s*\/\/ @else\s*$/.test(line)) {
    const frame = stack[stack.length - 1];
    if (!frame || frame.sawElse) throw new Error("Unexpected variant @else");
    frame.sawElse = true;
    active = frame.parent && !frame.matched;
    continue;
  }
  if (/^\s*\/\/ @endif\s*$/.test(line)) {
    const frame = stack.pop();
    if (!frame) throw new Error("Unexpected variant @endif");
    active = frame.parent;
    continue;
  }
  if (active) output.push(line);
}
if (stack.length) throw new Error("Unclosed variant condition");

const color = (name) => {
  const value = config.colors && config.colors[name];
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => !Number.isFinite(item)))
    throw new Error(`Invalid color: ${name}`);
  return value.join(", ");
};
const arrowScale = config.flatArrowScale == null
  ? String(config.fullArrowScale)
  : `(this.state.direction === "Flat" ? ${config.flatArrowScale} : ${config.fullArrowScale})`;
const replacements = {
  COLOR_INK: color("ink"),
  COLOR_RING_BORDER: color("ringBorder"),
  COLOR_ACCENT: color("accent"),
  COLOR_GRAPH: color("graph"),
  COLOR_PANEL: color("panel"),
  COLOR_PALE: color("pale"),
  SETUP_APP_TEXT: JSON.stringify(config.text.setupApp),
  SETTINGS_TEXT: JSON.stringify(config.text.settings),
  SETUP_ACTION_TEXT: JSON.stringify(config.text.setupAction),
  FALLBACK_APP_TEXT: JSON.stringify(config.text.fallbackApp),
  FALLBACK_NAME_TEXT: JSON.stringify(config.text.fallbackName),
  COMPACT_GLUCOSE_Y: `(cy - ${Number(config.compactGlucoseOffset)})`,
  FULL_ARROW_SCALE: arrowScale,
};
const assembled = output.join("\n").replace(/@([A-Z][A-Z0-9_]*)@/g, (_, name) => {
  if (!(name in replacements)) throw new Error(`Unknown variant token: ${name}`);
  return replacements[name];
});
if (/@[A-Z][A-Z0-9_]*@/.test(assembled)) throw new Error("Unresolved variant token");
fs.writeFileSync(destinationPath, assembled);
NODE
}

prepare_stage() {
  rm -rf "$stage"
  mkdir -p "$stage/src/c" "$stage/src/embeddedjs" "$stage/resources/images"
  cp src/c/mdbl.c "$stage/src/c/mdbl.c"
  cp src/embeddedjs/protocol.js "$stage/src/embeddedjs/protocol.js"
  assemble_watchface \
    src/embeddedjs/main.js.in \
    "variants/$variant/watchface-config.json" \
    "$stage/src/embeddedjs/main.js"

  if [[ "$variant" == "luped" ]]; then
    cp variants/luped/package.json "$stage/package.json"
    cp variants/luped/wscript "$stage/wscript"
    cp variants/luped/src/embeddedjs/manifest.json "$stage/src/embeddedjs/manifest.json"
    cp variants/luped/resources/images/luped-menu-icon.png "$stage/resources/images/luped-menu-icon.png"
  else
    cp package.json package-lock.json wscript "$stage/"
    cp src/embeddedjs/manifest.json "$stage/src/embeddedjs/manifest.json"
    cp -R src/pkjs "$stage/src/pkjs"
    cp resources/images/crimsonbear-menu-icon.png "$stage/resources/images/crimsonbear-menu-icon.png"
  fi
}

if [[ "$do_publish" == true && "$variant" != "crimsonbear" ]]; then
  echo "Publishing is not configured for the Luped variant." >&2
  exit 1
fi

if [[ "$do_publish" == true ]]; then
  if [[ "$(git branch --show-current)" != "main" ]]; then
    echo "Publishing must run from the main branch." >&2
    exit 1
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Commit all changes before publishing." >&2
    exit 1
  fi
  release_notes="${release_notes:-$(git log -1 --pretty=%s)}"
fi

if [[ "$do_build" == true || "$do_publish" == true ]]; then
  echo "Validating $display_name $version..."
  npm ci
  npm run lint
  npm run format:check
fi

if [[ "$do_build" == true || "$do_publish" == true ]]; then
  prepare_stage
  npx eslint "$stage/src/embeddedjs/main.js"
  if [[ "$do_minify" == true ]]; then
    # Only these CrimsonBearWatchface prototype methods are eligible for property
    # mangling. State, diagnostics, AppMessage, Pebble and renderer properties are
    # deliberately absent so the phone/mobile protocol and host APIs stay stable.
    private_watch_methods='/^(start|text|glucoseColor|glucoseText|deltaText|newDiagnostics|ensureDiagnosticsWindow|countDiagnostic|addDiagnostic|recordDraw|diagnosticsSnapshot|recordLatency|resetDiagnostics|drawGlucose|arrow|graphPoint|graph|drawVariantRing|bearBackdrop|setupScreen|readingTime|drawCgmStatus|footer|drawBluetoothDisconnectedIndicator|fullScreenFace|face|requestRender|draw|recoverRender|drawNow|drawMinute|drawMinuteNow|fallback|startBatteryService|updateBattery|startMessageService|requestDataRefresh|requestDiagnostics|checkConnection|setPhoneConnected|flushOutbound|updateStaleState|checkGlucoseAlarm|readMessages)$/'
    for watch_module in main protocol; do
      readable_module="$stage/src/embeddedjs/$watch_module.js"
      minified_module="$stage/src/embeddedjs/$watch_module.min.js"
      readable_module_size="$(wc -c < "$readable_module" | tr -d ' ')"
      terser_arguments=(--compress passes=3 --mangle --module --comments false)
      if [[ "$watch_module" == "main" ]]; then
        terser_arguments+=(--mangle-props "regex=$private_watch_methods")
      fi
      npx terser "$readable_module" "${terser_arguments[@]}" --output "$minified_module"
      minified_module_size="$(wc -c < "$minified_module" | tr -d ' ')"
      mv "$minified_module" "$readable_module"
      echo "Minified $watch_module.js: $readable_module_size -> $minified_module_size bytes."
    done
    if [[ -d "$stage/src/pkjs" ]]; then
      for phone_module in "$stage"/src/pkjs/*.js; do
        minified_module="$phone_module.min"
        readable_module_size="$(wc -c < "$phone_module" | tr -d ' ')"
        npx terser "$phone_module" \
          --compress passes=3 \
          --mangle \
          --toplevel \
          --comments false \
          --output "$minified_module"
        minified_module_size="$(wc -c < "$minified_module" | tr -d ' ')"
        mv "$minified_module" "$phone_module"
        echo "Minified $(basename "$phone_module"): $readable_module_size -> $minified_module_size bytes."
      done
    fi
    echo "Only allowlisted private watch methods were property-mangled; protocol properties, exported names, and string values were preserved."
  fi
fi

if [[ "$do_build" == true ]]; then
  echo "Building $display_name $version..."
  (cd "$stage" && "$pebble_bin" build)
  alloy_limit=32133
  echo
  printf '%-10s %12s %12s %12s %14s\n' \
    "Platform" "App binary" "Alloy size" "Headroom" "Headroom %"
  for platform in emery gabbro; do
    resource_pack="$stage/build/$platform/app_resources.pbpack"
    app_binary="$stage/build/$platform/pebble-app.bin"
    resource_size="$(wc -c < "$resource_pack" | tr -d ' ')"
    app_size="$(wc -c < "$app_binary" | tr -d ' ')"
    if ((resource_size >= alloy_limit)); then
      echo "$display_name $platform resources are $resource_size bytes; the safe limit is below $alloy_limit." >&2
      exit 1
    fi
    alloy_headroom="$((alloy_limit - resource_size))"
    alloy_headroom_percent="$(awk -v headroom="$alloy_headroom" -v limit="$alloy_limit" \
      'BEGIN { printf "%.2f%%", (headroom / limit) * 100 }')"
    printf '%-10s %9s B %9s B %9s B %14s\n' \
      "$platform" "$app_size" "$resource_size" "$alloy_headroom" "$alloy_headroom_percent"
  done
  echo "Alloy limit: $alloy_limit bytes (build fails at or above this size)."
  cp "$stage/build/project.pbw" "$artifact"
  test -s "$artifact"
  artifact_size="$(wc -c < "$artifact" | tr -d ' ')"
  echo "PBW package: $artifact_size bytes ($artifact)"
  if command -v sha256sum >/dev/null 2>&1; then
    artifact_sha256="$(sha256sum "$artifact" | awk '{print $1}')"
  else
    artifact_sha256="$(shasum -a 256 "$artifact" | awk '{print $1}')"
  fi
  echo "PBW SHA-256: $artifact_sha256"
fi

if [[ "$do_install" == true ]]; then
  if [[ ! -s "$artifact" ]]; then
    echo "$artifact is missing; include --build first." >&2
    exit 1
  fi
  echo "Installing $display_name $version on the connected phone..."
  "$pebble_bin" install "$artifact" --phone
fi

if [[ "$do_publish" == true ]]; then
  git fetch origin main
  if ! git merge-base --is-ancestor origin/main HEAD; then
    echo "Local main does not contain origin/main; pull or rebase first." >&2
    exit 1
  fi

  echo "Pushing commit $(git rev-parse --short HEAD) to GitHub..."
  git push origin HEAD:main

  echo "Publishing $version to the RePebble store..."
  (
    cd "$stage"
    "$pebble_bin" publish \
      --is-published \
      --non-interactive \
      --no-gif-all-platforms \
      --screenshots \
        "$repo_root/assets/emery_graph_screenshot.png" \
        "$repo_root/assets/emery_fullscreen_screenshot.png" \
      --replace-screenshots \
      --release-notes "$release_notes"
  )
fi

echo "Completed selected actions for $display_name $version."
