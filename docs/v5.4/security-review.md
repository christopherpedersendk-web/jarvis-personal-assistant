# Sikkerheds- og kontraktreview — 2026-11-06

## OpenClaw

Runtime 2026.11.1 og gateway restricted-v1 fastholdes. Skema, version, forkert token,
fem forbudte værktøjer, stop og mismatch skal fortsat bestå. Skills-kataloget læser
kun eksisterende health; ingen shell-, fil-, browser-, admin- eller katalogrettigheder
åbnes i OpenClaw. Operator-token og Jarvis-researchcredential er fortsat adskilt.

Lokal `npm audit --omit=dev --json`: 34 moderate dependency entries, 0 high/critical.
Det er ikke 34 uafhængige advisories. To bagvedliggende relevante advisories:

- [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249):
  minimatch allocation/amplification ved høj optimizationLevel. Direkte transitiv
  minimatch fastlåses til rettet 11.0.1. Majoroverride kræver runtimekontrakttest.
- [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4):
  glob abort kan efterlade traversal. Rettet i 14.0.2, men npm 12.2.2 har bundlet
  glob 13.0.6/minimatch 10.2.5; npm-overrides udskifter ikke de bundtede filer.
  Ingen falsk “løst”-markering eller blind force-opgradering. npm's senest observerede
  version er 12.2.2. Følg en rettet upstreambundle.

Eksponering: Jarvis tillader kun det faste web_search-kald; npm-, fil-, glob-,
shell- og marketplaceværktøjer er ikke tilgængelige. Dette reducerer angrebsfladen,
men er ikke bevis for at alle transitivt installerede pakker er risikofrie.
Systemd-isolation på den faktiske host er fortsat et åbent acceptkrav.

## Discord og medier

Officielle kontrakter kontrolleret:

- [Discord channels](https://docs.discord.com/developers/resources/channel):
  guild channels GET/POST, channel GET/PATCH/DELETE og permissions.
- [Signed attachment URLs](https://docs.discord.com/developers/reference#signed-attachment-cdn-urls):
  ex/is er hex-tider og hm signatur. Ingen signatur logges eller sendes til modellen.
  Legacy unsigned paths accepteres kun på præcis Discord-CDN/channel/attachment.
- [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision?api-mode=responses):
  Responses input_image med normaliseret JPEG-data-URL og tools:[], store:false.
- [OpenClaw invoke](https://docs.openclaw.ai/gateway/tools-invoke-http-api):
  bearer gateway-token er bred operatoradgang; Jarvis bruger den begrænsede facade.

MIME, magic og dimensionskontrol er forskellige kontroller; ingen erstatter de
andre. DNS og TLS-adresse pinning genbruges fra recipe-fetch ved hvert redirect.
Ingen Discord-bearer sendes til CDN. Medieindhold/QR/OCR/lyd kan ikke godkende eller
kalde lokale værktøjer. Modelsvaret behandles som tekst og indsættes ikke i almindelig
agenthistorik. Kendte secretmønstre redigeres i output; ingen universel detektion af
credentials i billeder eller modelsvar påstås. Brugeren vælger data til analyse.

## Decoder

Første undersøgte Debian 7.1.5 blev fravalgt efter review af
[Debians tracker](https://security-tracker.debian.org/tracker/source-package/ffmpeg).
Bygget bruger [officiel FFmpeg 9.0.2](https://ffmpeg.org/download.html), publiceret
2026-09-18, SHA-256 `8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e`,
og kræver gyldig officiel PGP-signatur med fingerprint
`FCF986EA15E6E293A5644F10B4322F04D67658D8`.
Ingen decoderkilde kopieres ind i Jarvis. Build bruger LGPL-konfiguration uden
GPL/nonfree-tilvalg; behold upstreamlicens/source-referencen ved distribution.

Kun mov/matroska og JPEG/PNG/WebP-pipes, udvalgte codecs, JPEG/WAV-output og
file/pipe-protokoller kompileres. Ingen HTTP/HLS/DASH/RTSP/SSH/devices/concat.
Også 9.0.2 har åbne upstreamfund; bl.a. av_expr/decoder-DoS og fejl i formater uden
for denne allowlist. Isolation, lille codecflade og hårde ressourcegrænser er derfor
obligatoriske. Versionen er ikke “sårbarhedsfri”. Kontroller tracker igen før aktivering;
ingen produktion før kandidatens containmenttest og værtens isolation er accepteret.

Baseimage har fast versionstag; det færdige lokale image låses til sha256-ID ved
aktivering. Build/CI skal gemme image-ID, decoder-version og testresultat; et tag
alene er ikke bevis for identiske imagebytes på tværs af byggerier.

## Stop og ukendte udfald

Modtagelse journalføres før download/model. Stop tilbagekalder scopes, afbryder
transport og fjerner decodercontainer; efterfølgende providertrin må ikke starte.
Et afbrudt eller tvetydigt providerkald registreres ukendt, uden automatisk retry.
Lokal Discord-transportlukning og bekræftet fjernproviderhangup er separate felter.
HTTP-abort er ikke i sig selv bevis for at en ekstern model er stoppet eller gratis.
