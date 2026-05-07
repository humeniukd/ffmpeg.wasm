#!/bin/bash

set -euo pipefail

CONF_FLAGS=(
  --prefix=$INSTALL_DIR                            # install library in a build directory for FFmpeg to include
  --host=i686-none                                 # use i686 unknown
  --disable-shared                                 # not to build shared library
)

emconfigure ./autogen.sh
CFLAGS=$CFLAGS emconfigure ./configure "${CONF_FLAGS[@]}"
emmake make install -j
