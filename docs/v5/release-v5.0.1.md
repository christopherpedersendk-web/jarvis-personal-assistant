# JARVIS v5.0.1

## Ændringer

- Retter webchat og Discord-chat, herunder afsluttende svar efter værktøjskald, tydelige fejlårsager og bevaring af kladder uden automatisk gentagelse af mulige handlinger.
- Viser én valgt madplan med sammenfoldede dage, historikvalg og bevarede redigeringskladder.
- Tilføjer Sonos OAuth-login og automatisk tokenfornyelse, understøtter gruppe-ID'er med kolon og viser afvist login korrekt.

PR #10 og #11 er merged. Det samlede main-træ ved d5627d58a9121cd08f8808bd672694fbc55de180 er identisk med den CI-verificerede kandidat 72c2b0cd837d6185718e13a8c40025e983c1ef6e. Releaseklargøringen ændrer kun package.json-version fra 5.0.0 til 5.0.1 og den tilsvarende healthcheck-test samt dette dokument. Dataskemaet forbliver 1.

## Verifikation

Kandidat-CI: https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42072532359 — 1016 Node-tests, GUI og gennemgående Chromium/WebKit-forløb samt performance og semantik bestået. Versionsændringen er efterfølgende kontrolleret med den samlede lokale testsuite.

## Udgivelse og installation

Opret et nyt lightweight-tag `v5.0.1` på releaseklargøringscommittet, og publicér en GitHub Release med dette tag. Genbrug eller flyt ikke `v5.0.0`.

På det private JARVIS-dashboard: søg efter opdateringer, stage/test v5.0.1, kontrollér versionsnummer og commit, og godkend installationen. Den eksisterende root-ejede deployer skal udføre backup, aktivering og readiness/rollback-kontrol. Merge alene installerer ikke opdateringen.

Efter installation: kontrollér /health og /ready, at version er 5.0.1, samt chat i I dag, Discord-DM og madplan på telefonen. Ved fejl: gennemgå deployment-resultat og service-log før nyt forsøg. Gendan ikke gamle brugerdata alene for at rulle kode tilbage.

Sonos kræver separat opsætning og live-test; se [sonos-oauth.md](sonos-oauth.md). Nest og Home Assistant er ikke implementeret af denne release. Produktion og fysisk telefon er ikke verificeret fra udviklingsmiljøet.
