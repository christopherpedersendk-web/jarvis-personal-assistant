# Test- og driftsvejledning for kandidaten

Dette dokument beskriver manuelle prøver, som endnu ikke er udført på ejerens installation. Det er ikke en deploymentordre. Brug en isoleret testinstallation med den præcise kandidat-SHA fra PR #15. Bevar produktion og eksisterende data. Secrets konfigureres lokalt; indsæt dem aldrig i issues, testartefakter eller chat.

## 1. Kandidat og automatiske tests

Fra `jarvis-starter/`:

```sh
node --test --test-concurrency=2
node scripts/check-release-version.mjs v5.1.1
node scripts/assistant-evaluation.mjs
node scripts/openjarvis-contract.mjs
```

Pakken er stadig 5.1.1; et andet tag skal afvises, indtil et særskilt versionsløft er reviewet. De sidste to kommandoer er dry runs og skal vise `not_run` uden ekstern adgang. Kontroller alle checks for den præcise PR-SHA. Browser-CI gemmer screenshots, traces og kandidatidentitet, herunder Chromium/WebKit, mobil/desktop og syntetisk service. Ingen test her tæller som fysisk iPhone- eller produktionsaccept.

## 2. Offline backup og isoleret restore

Kortlæg først alle datarødder: faktisk `JARVIS_DATA_DIR`, `.env`/private indstillinger, systemd-unit og drop-ins, medier, projektmapper uden for datamappen og eventuelle lokalt installerede integrationskonfigurationer. Kopiér konfigurationsfilerne til en privat, særskilt mappe på målhosten; kopier ikke blindt hele `/etc` eller brugerkataloget. Bevar en oversigt over originale stier, UID/GID, ejerskab, servicebruger, Node-version og kandidat-SHA. Backup er ikke krypteret af værktøjet; opbevar den krypteret og adgangsbegrænset.

Eksempel på `backup-map.json` — **erstat alle eksempelstier med faktisk verificerede stier**:

```json
{
  "roots": [
    {"id":"data","directory":"/absolute/jarvis-data","required":["state.json","private-settings.json"]},
    {"id":"configuration","directory":"/absolute/private-config-copy","required":["jarvis.env","jarvis.service"]},
    {"id":"projects","directory":"/absolute/external-projects","required":[]}
  ]
}
```

Tilpas `required` efter den faktiske installation; opfind ikke en tom fil for at bestå en kontrol. `data` og `configuration` er obligatoriske. Hver ekstern projektrod tilføjes eksplicit. Symlinks og specialfiler afvises, så deres indhold skal kortlægges frem for at blive fulgt ukritisk.

Efter ejeren har stoppet servicen og **alle øvrige skrivere**, og destinationsforældrene findes:

```sh
node scripts/backup-bundle.mjs backup /absolute/backup-map.json /absolute/new-backup --service-stopped
node scripts/backup-bundle.mjs restore /absolute/new-backup /absolute/new-restore --service-stopped
```

Flaget er operatørens erklæring, ikke en automatisk kontrol af systemd. Eksisterende mål overskrives aldrig. Restore kontrollerer manifestets filhash og rettigheder før kopiering. Fejlede/ufuldstændige mapper bevares til gennemgang; prøv med et nyt mål efter årsagen er løst.

Gendan den faktiske backup på en isoleret VM med udgående netværk blokeret. Tilpas kun kopiens paths/servicekonfiguration; originalt gemte absolutte projektstier kræver særlig kontrol. Indstil kopiens lokale datamappe, projektrod og stagingrod. Deaktivér Discord, OpenJarvis, stemme, notifications, live Nemlig og planlagte eksterne job i kopien før opstart. Start med en separat serviceidentitet på loopback. Test `/ready`, læs kendte noter, madplan, opskriftsmedier, projekter og journaler. Sammenhold før/efter-manifest, dokumentér tilsigtede kopikonfigurationsændringer, og kontrollér ejerskab. Stop kopien bagefter.

Accept: komplette identificerede rødder, matchende hash før opstart, nødvendige indstillinger, fungerende faktisk service og ingen udgående handlinger fra kopien. Den automatiske syntetiske Node-serviceprøve dækker ikke dette installationsspecifikke krav. Rollback er tilbagevenden til den tidligere pakke sammen med et kompatibelt, offline datasnapshot; ældre kode må ikke åbne nyere, inkompatible data.

## 3. Isoleret JavaScript-browser — kun offentlig læsning

Kræver lokal Docker Engine, som kan køre Chromium med nested user namespaces og det medfølgende seccomp-profil. Docker Desktop skal ligeledes understøtte det lokale socket/npipe-endpoint. Et remote Docker-endpoint accepteres ikke. Giv kun servicebrugeren den nødvendige operatøradgang; Docker-adgang er i sig selv en betydelig hostrettighed.

Byg først lokalt i testmiljøet:

```sh
docker build -t jarvis-browser-review ./browser-runtime
docker image inspect jarvis-browser-review --format '{{.Id}}'
```

Efter særskilt beslutning om aktivering i testmiljø: sæt `JARVIS_DYNAMIC_BROWSER=yes` og `JARVIS_BROWSER_IMAGE` til det returnerede `sha256:...` image-ID. Der foretages ikke automatisk pull ved en læsning. Kør `node scripts/browser-preflight.mjs` og `node scripts/isolated-browser-smoke.mjs` med image-ID'et i miljøet. De to prøver bruger syntetiske kilder; de må ikke erstattes med `--no-sandbox`, `seccomp=unconfined`, privilegeret container eller host-netværk for at få grønt.

CI kører desuden `node scripts/public-browser-smoke.mjs --live` mod to faste offentlige sider med den rigtige HTTPS-/DNS-transport. Resultatet gemmes i `artifacts/browser/public-read.json` med præcis commit og indholdshash. Det beviser offentlig læsning i CI; JavaScript-udførelse og angreb kontrolleres særskilt med de syntetiske sider.

I **Planlægning → Webarbejde**: godkend én offentlig HTTPS-origin, vælg JavaScript-læsning, gennemgå præcis URL, og godkend én læsning. Kontrollér et kendt offentligt website med JS-indhold. Sammenhold uddragets tekst, URL og tidspunkt med siden manuelt. Afprøv stop; kontrollér, at ingen `jarvis-browser-*` container bliver tilbage. Skift til statisk læsning ved uunderstøttet side og vis begrænsningen ærligt.

Browseren har ingen loginprofil, cookies fra brugeren, hostfiler, netværk eller Docker-socket inde i containeren. Kun serverformidlede GET-ressourcer på den godkendte origin kan læses. Query-parametre, tredjeparts-CDN, formularer og serviceworkers er afvist; nogle offentlige sider vil derfor være ufuldstændige. Browseruddrag er kun synlige for ejeren i webarbejde; modellen har ikke et generelt browserkontrolværktøj.

## 4. Research og OpenClaw

Den eksisterende tekstchat og Discord bruger samme research-/rapportværktøjer. Afprøv i begge kanaler:

- Find en restaurant: kort resumé, konkrete kilder og Maps-link med fundet navn/adresse. Ingen opdigtede priser eller åbningstider.
- Find tre aktuelle AI-/IT-revisionsnyheder med kilder og dato, når kilden oplyser den.
- Kør én eksisterende, aktiv rapport med korrekt revision. Kontroller én udførelse og ét resultat i den valgte rapportkanal. Et pauset job skal kræve review i Planlægning.
- Simulér manglende researchadgang: fejlen skal fremgå, ingen opdigtet kilde og ingen automatisk genkørsel med ukendt udfald.

OpenClaw skal være en **separat, begrænset lokal gateway** med kun offentlig `web_search`. Dens bearer-token er en operatørcredential, ikke i sig selv en read-only capability. Slå andre tools, egne cronjobs, datalagre og Discord-bot fra i gatewayen. Jarvis forbliver data-/bot-/scheduler-ejer. Adapteren accepterer kun `http://127.0.0.1:<port>/` og bruger fast `/tools/invoke`/`web_search`; ingen vilkårlige toolnavne eller sessioner fra modellen.

Efter lokal konfiguration af `OPENJARVIS_ENABLED=yes`, `OPENJARVIS_GATEWAY_URL` og separat `OPENJARVIS_GATEWAY_TOKEN`:

```sh
node scripts/openjarvis-contract.mjs --live
```

Prøven foretager højst ét offentligt søgekald. Kræv `accepted` og mindst én kilde; test desuden deaktiveret tool/ugyldigt token i isoleret konfiguration og verificér tydelig afvisning uden rå credentials. `accepted` beviser en fungerende kontrakt, ikke alle søgeresultaters kvalitet eller rækkevidden af tokenets øvrige rettigheder.

## 5. Webstemme og Discord-stemme

Web: start en session, giv en kort opgave, stop under mikrofontilladelse, stop under oprettelse, stop aktiv tale, og stop via **Indstillinger → System**. Genstart testservicen og kontrollér, at den gamle session ikke genoptages. Bekræft i udbyderens eget grundlag, at hangup faktisk afslutter call. Ved `unknown` må der ikke automatisk startes en erstatning: afklar call hos udbyderen. En session uden et kendt call-ID kan ikke sikkert lukkes alene med en lokal statusændring.

Discord-stemme er opt-in og kræver Node **22.12+** eller en nyere kompatibel version. Installér den afgrænsede runtime i testmiljø:

```sh
npm ci --prefix discord-voice-runtime --ignore-scripts --no-fund
npm audit --prefix discord-voice-runtime --omit=dev --audit-level=high
node discord-voice-runtime/probe.mjs
```

Efter særskilt testaktivering: `JARVIS_DISCORD_VOICE=yes`, `JARVIS_DISCORD_VOICE_CHANNEL_ID=<valgt serverkanal>`. Brug eksisterende Discord-bot/token og konfigureret ejer/server. Botten skal kunne se, tilslutte sig og tale i kanalen, og serverens UDP-egress skal virke. Ingen credentials skal gives til testharnessen.

Ejeren går ind i den valgte kanal og skriver `!stemme start` i den konfigurerede Discord-server. Bekræft synlig AI-/lyttemeddelelse før lydbehandling. Prøv en kort researchforespørgsel og en madplansrettelse; tekstsvar med links skal også vises i den tekstkanal, hvor stemmen blev startet. Dette er turbaseret tale, ikke fulddupleks kontinuerlig samtale.

Prøv `!stemme status`, `!stemme stop`, globalt stop, ejers afgang og en anden deltagers indtræden. Forbindelsen skal lukkes; andre deltagere bliver aldrig godkendt automatisk. Prøv maksimumtid og genstart: ingen autojoin/replay. Skeln mellem bestået syntetisk DAVE/Opus-probe og et faktisk Discord-opkald med forståelig tale, passende latenstid og stop.

## 6. Én madplan og modelkvalitet

I en isoleret kopi: opret en ny plan ved siden af gamle planer. Kontroller én aktiv plan og ét fremmødepunkt i Today. Ret et måltid via web og via Discord; genindlæs og kontroller samme plan-ID/revision og indhold. Et gentaget identisk tool-call må ikke oprette en ekstra plan eller ændring. Historik skal kunne ses som historik, også i hukommelsessøgning, og ikke optræde som aktuel plan eller bevis for spiste måltider.

Den reelle modelprøve kræver lokalt sat `OPENAI_API_KEY` og `OPENAI_TEXT_MODEL`. Kør på den reviewede kandidat med en ny privat outputfil:

```sh
node scripts/assistant-evaluation.mjs --live --output /absolute/private/evaluation.json
```

30 separate, tomme testinstallationer bruger rigtig `/api/message` og rigtige domænehandlers. Der arves ingen Discord-/Nemlig-/OpenClaw-credentials eller ejerdata. Offentlig research kan koste API-/hosted-tool-forbrug. Hvert scenarie har 16 requestpladser, 40.000 reserverede outputtokens og 6 hosted-kald som øvre admissiongrænser; summen for 30 scenarier kan være stor. Det er ikke et økonomisk budget. Vælg model og udbyderens udgiftsloft lokalt før kørsel. Der foretages ingen automatisk retry.

Bedøm hvert scenaries faktiske svar, actions og `finalState` mod det faste `accept`-kriterium. Udfyld `passed`, `reviewedBy`, `reviewNote`; behold spørgsmål, ID, status, svar og provenance uændret. Kør:

```sh
node scripts/assistant-evaluation.mjs --grade /absolute/private/evaluation.json
```

Accept kræver mindst **27/30** og **alle kritiske scenarier** bestået. Fejlede HTTP-kørsler, manglende svar, udskiftede ID'er, fjernede critical-flags eller ændret dataset må ikke give grøn accept. Rapporten indeholder model, Node-version, dataset-hash og hash af core `.mjs`-filer/evaluatorscript/pakke; den er reviewevidens, ikke kryptografisk signeret attestation af hele installationen. Gem også den faktiske kandidat-SHA. Dry run og test af graderens logik tæller ikke som forståelsesevaluering.

Denne prøve dækker tekstmodellen gennem forsidens HTTP-kontrakt. Discord-gateway, fysisk mikrofon, Realtime og TTS/STT skal accepteres særskilt. Evalueringsrapporten må ikke publiceres med brugerdata; datasættet her er syntetisk.
