#!/bin/sh
# Run MuseScore Studio's CLI headless. MuseScore 4.7 needs an X display even for
# command-line exports, so give each run its own virtual one.
mkdir -p "${XDG_RUNTIME_DIR:-/tmp/runtime-root}" && chmod 700 "${XDG_RUNTIME_DIR:-/tmp/runtime-root}"
exec xvfb-run -a /opt/musescore/squashfs-root/AppRun "$@"
