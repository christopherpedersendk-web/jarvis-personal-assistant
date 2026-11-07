# FFmpeg public release-verification key

This is a PUBLIC verification key, not a credential or private key.

Source: official FFmpeg website mirror, https://github.com/FFmpeg/web/blob/5d9fe46111b3fac1628b04d98e8cdecc14113119/htdocs/ffmpeg-devel.asc
Retrieved 2026-11-07. Original blob: 3a4d521afafd69bbb8c4b12711673950db51ad78.
SHA-256: 397b3becedcd5a98769967ff1ff8501ddc89f8368b8f766e4701377d7dbaabe5.
Fingerprint verified using gpg --show-keys: FCF986EA15E6E293A5644F10B4322F04D67658D8, matching https://ffmpeg.org/download.html and the pre-existing Docker verification rule.

Purpose: make the existing trust anchor reviewable and independent of a fresh key download during every build. The exact source archive SHA-256 and official detached release signature MUST still verify before compilation. This does not substitute a new signer or bypass a failed signature download. Changes require explicit source/fingerprint review. No auto-update, no executable code from the website mirror is copied.

CI on 5b8c4f671675f92aca7c659801b514de3a5897ee successfully fetched the source archive on retry, but its next transfer (detached signature) timed out/reset before any signature verification or build. An unavailable signature remains a hard failure. TLS/signature checks must not be disabled to obtain green CI.
