#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

do_build=false
do_install=false
do_publish=false
release_notes=""
interactive=false

usage() {
  cat <<'EOF'
Usage: ./scripts/build-release.sh [--build] [--install] [--publish] [--release-notes TEXT]

With no arguments, the script interactively selects actions. Explicit action flags
run without prompts. --install targets the connected phone; --publish pushes main
to GitHub and publishes the release to the RePebble store without requiring
--build or --install. The Pebble publisher still performs its mandatory package build.
EOF
}

if [[ $# -eq 0 ]]; then
  interactive=true
else
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --build) do_build=true ;;
      --install) do_install=true ;;
      --publish) do_publish=true ;;
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

confirm() {
  local prompt="$1"
  local default="$2"
  local answer
  read -r -p "$prompt" answer
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy]$ ]]
}

if [[ "$interactive" == true ]]; then
  if confirm "Build the PBW? [Y/n] " y; then do_build=true; fi
  if confirm "Install on the connected phone? [y/N] " n; then do_install=true; fi
  if confirm "Push GitHub and publish to RePebble? [y/N] " n; then
    do_publish=true
    default_notes="$(git log -1 --pretty=%s)"
    read -r -p "Release notes [$default_notes]: " release_notes
    release_notes="${release_notes:-$default_notes}"
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

version="$(node -p "require('./package.json').version")"

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
  echo "Validating CrimsonBear Cgm $version..."
  npm ci
  npm run lint
  npm run format:check
fi

if [[ "$do_build" == true ]]; then
  echo "Building $version..."
  "$pebble_bin" build
  test -s build/pebble.pbw
fi

if [[ "$do_install" == true ]]; then
  if [[ ! -s build/pebble.pbw ]]; then
    echo "build/pebble.pbw is missing; include --build first." >&2
    exit 1
  fi
  echo "Installing $version on the connected phone..."
  "$pebble_bin" install build/pebble.pbw --phone
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
  "$pebble_bin" publish \
    --is-published \
    --non-interactive \
    --no-gif-all-platforms \
    --release-notes "$release_notes"
fi

echo "Completed selected actions for CrimsonBear Cgm $version."
