# Sikkerhedsgrænser og releasekrav

Dato: 6. november 2026. Dokumentet supplerer v5.1 og angiver faktisk kodeadfærd, ikke en generel sikkerhedscertificering.

## Rettigheder og tillid

- Jarvis er single-owner. HTTP-bearer og Discord-ejer/server kontrolleres på serveren. Modellen vælger blandt et fast katalog, men tildeler ikke sig selv rettigheder. Webstemme skal også have en aktiv ejerbundet serverlease. Den gamle `/api/assistant/tool` er nu samme leasebeskyttede rute som `/api/voice/tool`.
- Lokale, reversible domæneændringer har fælles validering/journal/revision. Website-/værktøjsindhold er data. Modellen kan foreslå en browserlæsning, men har intet værktøj til godkendelse eller udførelse. Den separate browseropsummering har ingen tools, privat kontekst eller hukommelseswrite.
- Nemlig-kurvforslag kræver konkret ejerreview af handling, parametre/indhold, revision, stopgeneration, engangstoken og udløb; checkout/betaling er ikke tilgængelig. Kodeudvikling/installering er ikke stemme-/chatcapability og kræver eksisterende projektgennemgang. Browserreview giver kun en konkret læsning.
- Smart Home er også blokeret på gamle direkte styringsruter. Kalenderwrite, login, booking, betaling og formularafsendelse er ikke aktiveret.
- OpenClaw-tokenet skal behandles som en bred operatørcredential. Jarvis' faste adapter begrænser hvad Jarvis sender, men reducerer ikke tokenets rettigheder i OpenClaw. Brug en isoleret gateway med kun `web_search` og uden parallel bot/scheduler/dataejerskab.

## Hvad måles og begrænses?

| Område | Standardgrænse | Evidens / begrænsning |
|---|---|---|
| Responses/OpenClaw/Discord-lydrequests | 200 requestreservationer/dag | Reserveres før transport. Ukendt usage bevarer reservation. OpenClaw/lyd bruger requestpladser, ikke fiktive outputtokens. |
| Responses-output | 300.000 reserverede/registrerede outputtokens/dag; 22.000/kald | Faktisk rapporteret usage erstatter reservation, hvor den findes. Det er ikke inputtokenpris eller audio-/hosted-faktura. |
| Requestinput | 512.000 bytes/kald | Størrelsesgrænse; ikke målt tokenpris. |
| Hosted tools | 100 reserverede toolkald/dag; research reserverer normalt 2/kald | Providerrequest skal have eksplicit `max_tool_calls` på 1–10. Dette måler/afgrænser kald, ikke deres aktuelle pris. |
| Web-Realtime | 600 sekunder/session, 3.600 sekunder/dag | Hele maksimumperioden reserveres før oprettelse, ingen refundering. Server forsøger hangup ved udløb/stop/restart. Ingen faktisk måling af audiotokens. |
| Discord-stemme | 300 sekunder/session, 1.800 sekunder/dag | Én valgt kanal, én ejer; ingen autojoin. Højst 20 sekunders input, 60 sekunders TTS-output og 1.600 tegn til tale pr. tur. Oplæsning: én Realtime-response uden værktøjer/historik, 30 sekunders timeout og `max_output_tokens=4096`. |
| Dynamisk browser | 20 sekunder; 25 ressourcer; 500 KB/ressource; 4 MB samlet; 768 MB RAM, 1 CPU, 128 processer | Ingen eget netværk. Samme-origin GET via eksisterende DNS-pinned HTTPS-transport. Browserworkspace har også antal-/samtidighedsgrænser. |

Providergrænser bruger Europe/Copenhagen-dag. Fuld reservation gør korte afbrudte stemmesessioner dyrere i kvoten med vilje. Dagsskifte frigiver ikke uafklarede providerrequestreservationer. **Ingen af disse tal er en samlet økonomisk budgetgrænse.** Brug et selvstændigt udbyderloft; der er ikke implementeret komplet multi-provider-fakturaregnskab.

## Stop, ukendte udfald og genstart

Stop gemmes varigt før cancellation, ugyldiggør gamle scopes/generationer og afbryder aktive transporter. En senere genoptagelse starter ikke gamle handlinger igen. Webmikrofon/peer og serverlease lukkes; sene svar fra gamle sessioner kan ikke overtage en nyere. Discord stopper dekodning/lyd, tilbagekalder scope og lader ikke en gammel callback lukke den nye session.

Et allerede sendt request kan være modtaget eksternt. HTTP-abort er ikke rollback. Web-Realtime bliver kun `closed` ved bekræftet hangup; ellers `unknown`, og ny session afvises. En proces, som er helt nede, kan ikke sende hangup i nedetiden; startup forsøger oprydning før HTTP/Discord accepterer nye sessioner. Intet løfte om fuldstændig ekstern cancellation uden udbyderens bekræftelse.

Discord-runtime efter processlut er væk, og der genforbindes ikke automatisk; journalens `process_restart` beskriver lokal sessionophør. Faktisk gateway-/UDP-afbrydelse og serverens tilstand skal verificeres ved liveaccept.

## Browserindeslutning

Chromium kører med sin sandbox, som bruger namespaces via et versionsbundet Playwright-seccomp-profil. Den medfølgende Apache-licens/NOTICE er bevaret; Jarvis-ændringen tillader `chroot` i den isolerede user namespace. Der gives ikke host-CAP_SYS_CHROOT, SYS_ADMIN, hostnetværk eller privilegeret container. Containeren er ikke-root, read-only, alle capabilities er fjernet, og den får ingen hostmount, credentials eller Docker-socket. Browseren leverer ikke hoststier eller shellkommandoer.

Parentprocessen kontrollerer hver ressource, offentlig DNS, TLS-pinning og redirect. POST, serviceworkers, downloads, popups, iframe-navigation og WebSockets afvises. Query-/login-/private URLs afvises før læsning. Resource- og outputgrænser samt containerfjernelse testes, også ved timeout/afbrudt JavaScript. Et kompromis i browseren har stadig en kernel/containertrussel: hold Docker/kernel/Chromium opdateret og begræns servicehostens øvrige rettigheder.

## Releasekrav før aktivering

1. Præcis kandidat har grønne unit-, GUI-/WebKit-, containment- og dependencychecks. Ingen svækkelse af sandbox eller testkrav.
2. Faktisk installationsbackup er isoleret gendannet, service startet og dataintegritet dokumenteret. Secrets er sikret i backup og runtime.
3. Webstemme: faktisk call/hangup og fysisk iPhone; Discord-stemme: faktisk ejerkanal, DAVE/UDP, synlig lyttestatus, fremmed deltager, stop og kvoter.
4. Browser/OpenClaw: offentlig research på målhost, misbrugsprøver og verificeret begrænset gateway. Læsning giver stadig ikke ret til login/afsendelse.
5. Mindst 27/30 reelle modelopgaver og alle kritiske sikkerhedsprøver. Eksisterende memory-retrievaltests er ikke en erstatning for dette.

## Officielle kontrakter gennemgået 2026-11-06

- [OpenAI Realtime hangup](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup)
- [OpenAI WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc), [WebSockets](https://developers.openai.com/api/docs/guides/voice-websockets) og [modeludfasninger](https://developers.openai.com/api/docs/deprecations). Nye standarder bruger `gpt-live-transcribe` til WebRTC, `gpt-transcribe` til optaget Discord-lyd og `gpt-realtime-2.1-mini` til oplæsning. Den nye oplæsning bruger ikke `/v1/audio/speech`.
- [OpenAI speech to text](https://developers.openai.com/api/docs/guides/speech-to-text) og [text to speech](https://developers.openai.com/api/docs/guides/text-to-speech)
- [OpenClaw HTTP Tools Invoke](https://docs.openclaw.ai/gateway/tools-invoke-http-api)
- [Discord Voice Connections](https://docs.discord.com/developers/topics/voice-connections)
- [discord.js voice 0.19.2](https://discord.js.org/docs/packages/voice/0.19.2): Discord dokumenterer ikke lydmodtagelse fuldt; stabil modtagelse kan ikke garanteres af bibliotekets kontrakt alene.
- [Playwright Docker](https://playwright.dev/docs/docker) og [seccomp v1.64.1](https://github.com/microsoft/playwright/blob/v1.64.1/utils/docker/seccomp_profile.json)

Pinning, audit og kompatibilitetsprobe reducerer afhængighedsrisiko; de beviser ikke fravær af ukendte sårbarheder. Versionsløft kræver ny containment-/lydprøve.

## Nye opt-in-forløb efter d4cc25b

`JARVIS_BROWSER_RESEARCH=yes` giver kun adgang til forslag og den eksplicitte ejerkommando `!web læs`. `JARVIS_DYNAMIC_BROWSER=yes` med pinned image-ID og godkendt origin kræves fortsat for JavaScript. URL-/DNS-/sandboxkontroller genbruges uden fallback. Opsummering er én separat Responses-kørsel, højst 1.000 outputtokens og 30 sekunder, under fælles providerkontrol. Ingen sideindhold/resultater føres tilbage til den generelle assistents historik eller værktøjsloop. Browseruddrag opbevares efter Webarbejdets eksisterende retention; ejerens svar kan stadig indeholde vildledende tekst og skal læses kritisk.

`JARVIS_DISCORD_CHANNELS=yes` tillader eksplicitte ejerkommandoer i konfigureret guild. Nye tekstkanaler tildeler kun ejer/bot View/Send/History; serveradministratorer har fortsat adgang. Der anmodes ikke om Administrator. Botten skal allerede have Discords nødvendige kanalrettigheder; Jarvis opgraderer dem aldrig selv. Ingen kategorier, roller, voicekanaler eller massehandlinger styres.

Hvert review udløber efter 120 sekunder og er bundet til identitet, konkret indhold, konfigurationens hash, kanalgrundlag, proces og stopgeneration. Før mutation gemmes `sending`; timeout/ugyldigt svar/savefejl bliver `unknown` og genforsøges ikke. Ved restart vises `sending` som unknown, og gamle reviews er ugyldige. Højst 100 journalposter (ingen automatisk trimning af uafklarede poster), 10 sekunders timeout pr. REST-kald, højst 1 MB svar, ingen redirects eller automatiske 429-retries. Dette er ikke del af OpenAI-tokenregnskabet.

DELETE har ingen leverandørunderstøttet atomisk revisionslås. Vi sammenholder kanalgrundlaget umiddelbart før afsendelse, men kan ikke garantere mod en samtidig administratorændring derefter. Beskeder/tabte kanaler kan ikke gendannes af Jarvis. Et ukendt udfald kræver offline operatørgennemgang af faktisk Discord og journal; der findes bevidst ingen modelkommando til at nulstille det.

Officielle Discord-kontrakter kontrolleret 2026-11-06: [Create Guild Channel](https://docs.discord.com/developers/resources/guild#create-guild-channel) og [Delete/Close Channel](https://docs.discord.com/developers/resources/channel#deleteclose-channel). Syntetiske kontrakttests er ikke en live Discord-accept.
