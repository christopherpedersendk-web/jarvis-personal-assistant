# Acceptregister

Commit: den præcise PR-kandidat og dens CI, registreret i evidence.json ved aflevering.
Historiske M1–M10-filer ændres ikke; se [videreførte kriterier](inherited-acceptance.md).
“Verificeret” nedenfor betyder kun den angivne prøve, aldrig automatisk liveaccept.

| ID | Kriterium | Status | Filer / verifikation | Begrænsning og næste handling |
|---|---|---|---|---|
| M11.1 | Ét katalog, filtre, oprindelse, version, årsag til blokering | verificeret | skill-capabilities.mjs, public/intelligence.js; katalog-/HTTP-tests | Ingen faktisk modeltest vises som bestået; sidste live test er ukendt |
| M11.2 | Mobil/keyboard, prøvekladde uden afsendelse, logout/stale | verificeret | scripts/skills-menu-smoke.mjs; Skills-trin bestod i CI 42344361877 på 07ef694 | Chromium/WebKit ved 320/390/1280 px, filtre, uafsendt kladde, bevaret kladde og logout. Stale dækkes af UI-regression. Fysisk iPhone mangler |
| M11.3 | Eksakte gamle versioner/hashes og fælles dansk skillvalg | verificeret | skills-registry.mjs, v5-skills-review/v5-settings-http tests | Deterministisk versionsvalg og instruktion; rigtig dansk forståelse følger M10.2 |
| M11.4 | Modelforståelse og hensigtsbaseret skillvalg | blokeret | selectionGuide; eksisterende 30-opgave-harness | Ingen legitim modelcredential; score=null, not_run |
| M12.1 | Liste/opret/omdøb/slet/rapportkanal via samme handler | verificeret | discord-channels.mjs, server.mjs; kanaltests | REST-fixtures, ingen virkelig kanalændring |
| M12.2 | Ejer/guild/kanal/parametre/config/revision/stop/expiry, højst én mutation | verificeret | discord-channels.test.mjs; eksisterende gatewayjournal + nye digestbindings-tests | Discords GET→PATCH/DELETE er ikke atomisk; ændringer efter sidste læsning kan ikke udelukkes |
| M12.3 | Live kanaler og rapportskift | blokeret | operations.md | Godkendt testserver/botrettigheder mangler; ingen produktionsmutation |
| M5.4 | Webkontrol, mute/decoder/stop og konfigurationsskift | verificeret | discord-voice/gateway/audio, public/assistant-control.js; regressionstests | Transport- og modelmocks; native runtime kontrolleres særskilt i CI |
| M5.5 | Providerafslutning og lydforbrug er sandfærdigt ukendt | verificeret | discord-voice.mjs, discord-audio.mjs | Lokal lukning beviser ikke providerhangup. Lydrequests tælles; lydtokens og valuta måles ikke |
| M13.1 | Ejer- og CDN-kontrol, MIME/magic/størrelse, ingen automatisk opskriftslagring | verificeret | discord-media-boundary.mjs, recipe-fetch.mjs, test/discord-media.test.mjs | Fixtures; rigtige private medier er ikke indlæst |
| M13.2 | Isoleret decoder, dimensioner, metadatafjernelse og oprydning | verificeret | isolated-media.mjs, media-runtime; rigtig Docker-prøve på 42fde6d, CI 42343014031 | JPEG/PNG/WebP, fem videoer, netværks-/hostisolering, stop og oprydning bestod. Syntetiske medier; ejerhost mangler |
| M13.3 | Separat tools:[]-analyse, durable dedupe, stop/restart og ukendt udfald | verificeret | discord-media.mjs, ProviderControl; medietests og gateway-stoptest | Modelsvar er fixtures. Intet udfald genforsøges automatisk |
| M13.4 | Screenshot/kvittering/opskrift/produkt med rigtig model | blokeret | Mediefixtures dækker struktur og kontrol, ikke forståelse | Ingen legitim model-/Discord-adgang; kræver separat ejerprøve |
| M14.1 | Uploadet MP4/WebM ≤30 MiB/60 s, ≤12 frames, ingen URL/livestream | verificeret | boundary/worker-inspection og fem video-handlercases | Rigtig decoding af syntetiske videoer er separat M13.2/CI |
| M14.2 | Tidsstempler, delvis lyd, ingen påstand om fuld videogennemgang | verificeret | discord-media.test.mjs, mediaAnalysisRequest | Fem fixtures; ingen rigtig modelscore |
| M14.3 | Rigtig decoder, afbrydelse og ingen efterladte containere | verificeret | media-isolation.yml; CI 42343901837 på f06c9d6 | Rigtig MP4/WebM, WAV, >60 s-afvisning, bekræftet aktiv fastlåst worker og ingen efterladte containere. Ejerhost er separat accept |
| M14.4 | Faktisk video-/lydforståelse | blokeret | operations.md | Modelcredential og godkendt Discord-testkanal mangler |
| M7.6 fortsat | Review og patch af relevante advisories | implementeret men ikke verificeret | OpenClaw minimatch override 11.0.1; security-review.md | npm bundler fortsat sårbare glob/minimatch; 34 moderate fund, 0 high/critical i lokal audit |
| M7.4 gentest | Offentlig research i præcis runtime | verificeret | CI 42343014053 på 42fde6d: rigtig research med fem kilder, 401/404-grænser bestod | Lokal research fejlede SEARCH_FAILED og bevares som separat evidens. Målhost mangler |
