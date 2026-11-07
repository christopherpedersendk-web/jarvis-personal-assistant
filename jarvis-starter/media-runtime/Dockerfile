FROM node:24.22.1-trixie-slim AS decoder
RUN apt-get update && apt-get install -y --no-install-recommends build-essential pkg-config zlib1g-dev curl ca-certificates gnupg xz-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /build
# Official release signature AND exact archive. No unreviewed system FFmpeg drift.
RUN curl --fail --location --connect-timeout 15 --retry 2 --retry-delay 2 --retry-max-time 180 --max-time 120 -o ffmpeg.tar.xz https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz && \
    curl --fail --location --connect-timeout 15 --retry 2 --retry-delay 2 --retry-max-time 180 --max-time 60 -o ffmpeg.tar.xz.asc https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz.asc && \
    curl --fail --location --connect-timeout 15 --retry 2 --retry-delay 2 --retry-max-time 180 --max-time 60 -o signing-key.asc https://ffmpeg.org/ffmpeg-devel.asc && \
    echo '8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e  ffmpeg.tar.xz' | sha256sum -c - && \
    gpg --batch --import signing-key.asc && \
    gpg --batch --status-fd 1 --verify ffmpeg.tar.xz.asc ffmpeg.tar.xz | grep 'VALIDSIG FCF986EA15E6E293A5644F10B4322F04D67658D8 ' && \
    tar -xf ffmpeg.tar.xz
WORKDIR /build/ffmpeg-9.0.2
# Only the container/image readers and codecs we explicitly accept. Protocols
# cannot fetch HTTP, HLS, DASH, SSH, crypto, concat, playlists or devices.
RUN ./configure --prefix=/opt/decoder --disable-everything --disable-network --disable-autodetect --disable-doc --disable-debug --disable-x86asm \
    --enable-ffmpeg --enable-ffprobe --enable-zlib --enable-protocol=file,pipe \
    --enable-demuxer=mov,matroska,image_png_pipe,image_jpeg_pipe,image_webp_pipe \
    --enable-parser=h264,hevc,av1,vp8,vp9,mjpeg,png,webp,aac,opus,vorbis,mpegaudio,flac \
    --enable-decoder=h264,hevc,av1,vp8,vp9,mjpeg,png,webp,aac,opus,vorbis,mp3,flac,pcm_s16le \
    --enable-encoder=mjpeg,pcm_s16le --enable-muxer=image2,wav \
    --enable-filter=scale,format,aresample,anull,null,trim,atrim,aformat && make -j2 && make install
RUN /opt/decoder/bin/ffmpeg -hide_banner -demuxers | grep 'jpeg_pipe' && \
    /opt/decoder/bin/ffmpeg -hide_banner -demuxers | grep 'png_pipe' && \
    /opt/decoder/bin/ffmpeg -hide_banner -demuxers | grep 'webp_pipe'
FROM node:24.22.1-trixie-slim
COPY --from=decoder /opt/decoder/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=decoder /opt/decoder/bin/ffprobe /usr/local/bin/ffprobe
WORKDIR /app
COPY worker.mjs /app/worker.mjs
USER 1000:1000
ENTRYPOINT ["node", "--max-old-space-size=192", "/app/worker.mjs"]
