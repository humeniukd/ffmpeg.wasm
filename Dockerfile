# syntax=docker/dockerfile-upstream:master-labs

# Base emsdk image with environment variables.
FROM emscripten/emsdk:5.0.7-arm64 AS emsdk-base
ARG EXTRA_CFLAGS
ARG EXTRA_LDFLAGS="-pthread -sPTHREAD_POOL_SIZE=32 -sINITIAL_MEMORY=1024MB"
ARG FFMPEG_ST
ARG FFMPEG_MT
ENV INSTALL_DIR=/opt

ENV FFMPEG_VERSION=wasm6.1
ENV CFLAGS="-I$INSTALL_DIR/include $CFLAGS $EXTRA_CFLAGS"
ENV CXXFLAGS="$CFLAGS"
ENV LDFLAGS="-L$INSTALL_DIR/lib $LDFLAGS $CFLAGS $EXTRA_LDFLAGS"
ENV EM_PKG_CONFIG_PATH=$EM_PKG_CONFIG_PATH:$INSTALL_DIR/lib/pkgconfig:/emsdk/upstream/emscripten/system/lib/pkgconfig
ENV EM_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake
ENV PKG_CONFIG_PATH=$PKG_CONFIG_PATH:$EM_PKG_CONFIG_PATH

RUN apt-get update && \
      apt-get install -y pkg-config autoconf automake libtool ragel

FROM emsdk-base AS fdkaac-builder
ENV FDK_VERSION=v2.0.3
ADD https://github.com/mstorsjo/fdk-aac.git#$FDK_VERSION /src
COPY build/fdkaac.sh /src/build.sh
RUN bash -x /src/build.sh

# Base ffmpeg image with dependencies and source code populated.
FROM emsdk-base AS ffmpeg-base
RUN embuilder build sdl2 sdl2-mt
ADD https://github.com/humeniukd/FFmpeg.git#$FFMPEG_VERSION /src
COPY --from=fdkaac-builder $INSTALL_DIR $INSTALL_DIR

# Build ffmpeg
FROM ffmpeg-base AS ffmpeg-builder
COPY build/ffmpeg.sh /src/build.sh
RUN bash -x /src/build.sh \
        --enable-filter=adumpwave \
        --enable-libfdk-aac \
        --enable-decoder=libfdk_aac \
        --enable-encoder=libfdk_aac \
        --enable-muxer=mp4

# Build ffmpeg.wasm
FROM ffmpeg-builder AS ffmpeg-wasm-builder
COPY src/bind /src/src/bind
COPY src/fftools /src/src/fftools
COPY build/ffmpeg-wasm.sh build.sh

# libraries to link
ENV FFMPEG_LIBS -lfdk-aac
RUN mkdir -p /src/dist/umd && bash -x /src/build.sh \
      ${FFMPEG_LIBS} \
      -o dist/umd/ffmpeg-core.js
RUN mkdir -p /src/dist/esm && bash -x /src/build.sh \
      ${FFMPEG_LIBS} \
      -sEXPORT_ES6 \
      -o dist/esm/ffmpeg-core.js

# Export ffmpeg-core.wasm to dist/, use `docker buildx build -o . .` to get assets
FROM scratch AS exportor
COPY --from=ffmpeg-wasm-builder /src/dist /dist
