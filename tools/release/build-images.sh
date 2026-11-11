#!/usr/bin/env bash
# Builds Saylo's two images, checks that each one starts, and with --push
# publishes them.
#
#   tools/release/build-images.sh v0.2.0           # build and check only
#   tools/release/build-images.sh v0.2.0 --push    # ...then publish
#
# Images default to saylo and saylo-voice-router. Set SAYLO_SERVER_IMAGE and
# SAYLO_ROUTER_IMAGE to publish somewhere else, for example
# ghcr.io/<github-owner>/saylo. Tags written: <version>, <short commit>, latest.
# Each image carries LICENSE and NOTICE in /licenses and OCI labels.
set -euo pipefail

VERSION=${1:?usage: build-images.sh <version> [--push]}
PUSH=${2:-}
SERVER_IMAGE=${SAYLO_SERVER_IMAGE:-saylo}
ROUTER_IMAGE=${SAYLO_ROUTER_IMAGE:-saylo-voice-router}
SHA=$(git rev-parse --short HEAD)
cd "$(git rev-parse --show-toplevel)"

LABELS=(--label org.opencontainers.image.licenses=Apache-2.0
        --label "org.opencontainers.image.version=$VERSION"
        --label "org.opencontainers.image.revision=$(git rev-parse HEAD)"
        --label "org.opencontainers.image.description=Saylo: real-time voice agents that speak the caller's language")
if [ -n "${IMAGE_SOURCE:-}" ]; then
  LABELS+=(--label "org.opencontainers.image.source=${IMAGE_SOURCE}")
fi

build() { # image, context
  local image="$1" context="$2"
  local base="saylo-build/${image##*/}:$SHA"
  docker build --platform linux/amd64 -t "$base" "$context"
  # LICENSE and NOTICE live at the repo root, outside the router's context.
  printf 'FROM %s\nCOPY LICENSE NOTICE /licenses/\n' "$base" |
    docker build --platform linux/amd64 "${LABELS[@]}" -t "$image:$VERSION" -f - .
}

build "$SERVER_IMAGE" .
build "$ROUTER_IMAGE" voice-router

echo "== checking the images"
for image in "$SERVER_IMAGE" "$ROUTER_IMAGE"; do
  docker run --rm --entrypoint sh "$image:$VERSION" -c 'test -s /licenses/LICENSE && test -s /licenses/NOTICE' ||
    { echo "$image: /licenses is missing LICENSE or NOTICE"; exit 1; }
done
# The server starts and listens with no config.
cid=$(docker run -d --rm "$SERVER_IMAGE:$VERSION")
trap 'docker stop "$cid" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do
  docker logs "$cid" 2>&1 | grep -q "listening on" && break
  sleep 1
done
docker logs "$cid" 2>&1 | grep -q "listening on" || { docker logs "$cid"; echo "saylo: the server didn't start"; exit 1; }
docker stop "$cid" >/dev/null; trap - EXIT
# The router loads everything it needs before it can speak. Starting it for
# real downloads ~1.5 GB of voices, so this loads the libraries and the
# language models instead: what broke the 664c63e image (spaCy's English
# model) fails here.
docker run --rm --entrypoint python "$ROUTER_IMAGE:$VERSION" -c '
import en_core_web_sm; en_core_web_sm.load()
import kokoro, piper, misaki, lingua, fastapi, uvicorn, soundfile, scipy
import ast; ast.parse(open("server.py").read())
print("voice router: libraries and models load")'

if [ "$PUSH" != "--push" ]; then
  echo "Built and checked $VERSION ($SHA). Not pushed: add --push."
  exit 0
fi
for image in "$SERVER_IMAGE" "$ROUTER_IMAGE"; do
  for tag in "$SHA" latest; do
    docker tag "$image:$VERSION" "$image:$tag"
  done
  for tag in "$VERSION" "$SHA" latest; do
    docker push "$image:$tag"
  done
done
echo "Pushed $VERSION ($SHA) and latest."
