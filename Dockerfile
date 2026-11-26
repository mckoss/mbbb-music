# Production image for Railway. Railway builds this Dockerfile automatically
# (a root Dockerfile takes precedence over its default builder), so every
# system tool the app needs is installed here, in the repo, not by hand:
#   - LilyPond (lilypond, musicxml2ly) for the LilyPond master pipeline
#   - MuseScore Studio 4.7.7 (opens 4.6.x scores), run headless under Xvfb via
#     the /usr/local/bin/mscore wrapper; MSCORE_BIN points the app at it
#   - unzip, used when building score parts
#   - fluidsynth + the FluidR3 General MIDI soundfont + lame, which render the
#     LilyPond pipeline's MIDI to full-band MP3s (src/lilypond/pipeline.js)
# Keep the cloud dev environment's setup script in step with this file.

FROM node:24.22.3-bookworm-slim AS node

FROM ubuntu:24.04 AS base
ENV DEBIAN_FRONTEND=noninteractive
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip lilypond \
      fluidsynth fluid-soundfont-gm lame \
      xvfb xauth fonts-dejavu-core \
      libegl1 libopengl0 libgl1 libxkbcommon0 libxkbcommon-x11-0 libfontconfig1 \
      libasound2t64 libpulse0 libpipewire-0.3-0t64 libnss3 libjack-jackd2-0 \
      libxcb-cursor0 libxcb-icccm4 libxcb-image0 libxcb-keysyms1 \
      libxcb-render-util0 libxcb-xinerama0 libxcb-shape0 \
 && rm -rf /var/lib/apt/lists/*

ARG MUSESCORE_URL=https://github.com/musescore/MuseScore/releases/download/v4.7.7/MuseScore-Studio-4.7.7.261109195-x86_64.AppImage
RUN mkdir -p /opt/musescore && cd /opt/musescore \
 && curl -fsSL -o ms.AppImage "$MUSESCORE_URL" \
 && chmod +x ms.AppImage && ./ms.AppImage --appimage-extract >/dev/null \
 && rm ms.AppImage
COPY scripts/mscore-headless.sh /usr/local/bin/mscore
ENV MSCORE_BIN=/usr/local/bin/mscore XDG_RUNTIME_DIR=/tmp/runtime-root \
    SOUNDFONT_PATH=/usr/share/sounds/sf2/FluidR3_GM.sf2
# Fail the build if any pipeline tool cannot run.
RUN lilypond --version | head -1 && mscore --version \
 && fluidsynth --version | head -1 && lame --version | head -1 && test -s "$SOUNDFONT_PATH"

FROM base AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM base
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["npm", "start"]
