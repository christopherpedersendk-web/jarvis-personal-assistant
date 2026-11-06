# Isoleret OpenClaw-test og tilbageførsel

Ingen af disse trin er udført på produktion. Brug præcis PR-kandidat i en testkopi.
Jarvis beholder egne data, revisioner, bots og scheduler. Installer ikke en ekstra bot.

## Runtime

OpenClaw og Parallel-plugin er fastlåst til 2026.11.1. Node 24.16+ (24.x) eller
26.1+ kræves af upstream; Jarvis' eksisterende Node 22-installation opgraderes ikke
automatisk. Kør runtime separat. Fra jarvis-starter:

```sh
npm ci --prefix openclaw-runtime --ignore-scripts --no-fund
npm audit --prefix openclaw-runtime --omit=dev --audit-level=high
node scripts/openclaw-runtime-probe.mjs --output /absolute/new-policy-result.json
node scripts/openclaw-runtime-probe.mjs --live --output /absolute/new-live-result.json
```

Probe starter og stopper en frisk midlertidig gateway, genererer egne testtokens,
validerer installeret config, tester forbudte tools og eventuelt én offentlig søgning.
Output overskrives ikke. `--live` bruger eksplicit Parallel Free; det er en ekstern
søgetjeneste uden credential, ikke lokal/private research. Dens tilgængelighed og
kvalitet er ikke garanteret. Ingen automatisk providervalg eller fallback.

Til vedvarende, separat TEST-service: gennemgå openclaw-runtime/openjarvis-research.service,
Node-/installationsstier, filrettigheder og ressourcegrænser. Unit bruger DynamicUser,
ProtectHome, ProtectSystem, PrivateTmp og ingen restart. Konfigurer en ny tilfældig
researchcredential lokalt i den root-beskyttede EnvironmentFile; del ikke credentials
med chatten eller den almindelige OpenClaw-installation. Upstream operator-token
skabes kun inde i runtime og deles ikke med Jarvis. CLI-start uden systemd er en
proces-/konfigurationsprøve, ikke samme OS-isolation som den anbefalede unit.

Jarvis-testkopiens indstillinger:

```text
OPENJARVIS_ENABLED=yes
OPENJARVIS_GATEWAY_MODE=restricted-v1
OPENJARVIS_GATEWAY_URL=http://127.0.0.1:18790
OPENJARVIS_GATEWAY_TOKEN=<den særskilt lokalt konfigurerede researchcredential>
```

Den interne OpenClaw-port 18791 og researchport 18790 bindes kun til 127.0.0.1;
publicér ingen af dem via proxy, Tailscale Serve eller firewall. Gateway-tokenet er
ikke en generel OpenClaw read-only credential. Fuld gatewaytoken giver operatoradgang.
Frisk state og kun Parallel-plugin indlæses. Ingen ejerhome, privat historik, API keys,
Discord eller gamle cronjobs arves. Der kopieres ikke OpenClaw-kode ind i Jarvis.

Researchgateway: højst 2 samtidige kald, 60 søgekald pr. proceslevetid, 2 KB input,
100 KB output, 18 s upstreamdeadline. Jarvis har fortsat sin varige requestkontrol,
20 s søgedeadline og 5 s healthdeadline. OpenClaw-plugin kan bruge flere HTTP-kald
(MCP initialize/notification/search) pr. ét Jarvis-søgekald. Antallet må ikke kaldes
samlet leverandørforbrug. Tokens/omkostning er ukendt/null. Der påstås ingen samlet
økonomisk budgetgrænse. Ingen automatisk genstart eller replay efter stop.

HTTP-abort sendes videre; det beviser ikke, at udbyderen afbrød allerede startet
arbejde. Ukendt udfald genforsøges ikke automatisk. Globalt stop i Jarvis forhindrer
næste trin. Stop service eksplicit, hvis gatewayprocessen også skal afsluttes.

## Ejerprøve

1. Kør samme restaurant-, AI/IT-revisions-, produktpris- og opskriftsforespørgsel i
   webchat og Discord. Kontroller kilder, relevante Maps, forbehold og ingen writes.
2. Kør en godkendt aktiv rapport; kontroller én journalføring, samme backend,
   kildelinks og levering til eksisterende rapportkanal. Genoptagelse må kun læse
   det gemte response-ID. Ingen ny søgning ved genoptagelse.
3. Afbryd gateway; ingen skjult skift til hosted research. Test globalt stop under
   ventetid. Genoptagelse starter ingen gammel handling.
4. Browserforslag går fortsat gennem eksisterende origin/URL/revisionsreview og
   `!web læs <review-ID>`; ingen automatisk URL-fetch fra søgeresultater. Test private
   IP'er, metadata, file:// og skrivende handlinger som afvisninger.
5. Ret madplan/listedata gennem almindelige Jarvis-værktøjer og kontroller én
   revision/ændring. Researchprocedurer kan kun foreslå, ikke selv gemme.

## Modelkvalitet og rollback

Med legitim API-adgang konfigureret lokalt, samme model og samme kandidat:

```sh
node scripts/assistant-evaluation.mjs --live --output /absolute/baseline-new.json
node scripts/assistant-evaluation.mjs --live --hybrid --output /absolute/hybrid-new.json
node scripts/assistant-evaluation.mjs --grade /absolute/baseline-new.json
node scripts/assistant-evaluation.mjs --grade /absolute/hybrid-new.json
node scripts/compare-assistant-evaluations.mjs /absolute/baseline-new.json /absolute/hybrid-new.json
```

Udfyld menneskelig bedømmelse af korrekthed, forståelse, tools, kilder og gemt state.
Mindst 27/30 samt alle kritiske opgaver skal bestå i begge sammenlignelige rapporter.
Varighed inkluderer testopstart; forbrug findes i hver scenaries providerjournal.
Ingen score eller besparelse findes endnu. Transporttests er ikke modelbedømmelse.

Rollback i test: stop den særskilte service og sæt OPENJARVIS_ENABLED=no i testkopien,
genstart Jarvis. Dette er et eksplicit operatørvalg, aldrig en automatisk fallback.
Baseline hosted research forbliver i kodebasen. Ingen domænedata flyttes til OpenClaw.
Der er kun tilføjet valgfrie kildefelter til opgavecheckpoint; schema forbliver 1.
Ved faktisk kode-rollback bruges kompatibel version og offline backup efter v5.2-vejledningen.

## Upstream og vedligeholdelse

Kilder gennemgået 6. november 2026, commit 4ffdd2047d192dd65554de3c8c46c0e0197c6e2a:

- https://github.com/openclaw/openclaw/tree/4ffdd2047d192dd65554de3c8c46c0e0197c6e2a
- https://docs.openclaw.ai/gateway/tools-invoke-http-api
- https://docs.openclaw.ai/gateway/config-gateway
- https://docs.openclaw.ai/gateway/config-extensions
- https://docs.openclaw.ai/tools/parallel-search

Upstream rootlicens: MIT. Parallel er upstream-plugin; paket, oprindelig commit og
integrity er fastlåst i lock/pin. Ingen lokale upstream-forks eller kopierede moduler.
Jarvis vedligeholder transport/config/procedurer og skal gennemgå hver manuel upgrade.
Plugin-runtime er gennemgået for fast HTTPS-endpoint, bounded requests og ingen
mutationer i denne søgevej; det er ikke en fuld revision af alle OpenClaws afhængigheder.
Initial audit fandt 4 high og 35 moderate. Pinned overrides zod=4.6.6/npm=12.2.2
fjernede high/critical; 34 moderate findings består (inklusive transitive metadata).
De skjules ikke og er et særskilt reviewpunkt før produktion. Ingen markedsinstallation
eller automatisk opdatering er aktiveret. Service-hardening er endnu kun leveret,
ikke accepteret på ejerens host.

## Researchprocedurer v1.0.0

Alle fire er Jarvis-ejede kontrakter i research-workflow.mjs, ikke installerbare
OpenClaw-marketplace-skills. Ingen nye afhængigheder ud over den ene gennemgåede
søgeplugin. Fælles input: offentlig søgestreng på 1–240 tegn. Fælles rettighed:
public-search, højst fem søgeresultater pr. upstreamkald, ingen mutation. Browser
kræver et separat eksisterende review. Fælles fejl: providerfejl afvises uden retry;
resultat uden kilder mærkes partial. Versionsændringer kræver kodereview og tests.

| Procedure | Nødvendige data | Forventet output | Særlige grænser og fejl |
|---|---|---|---|
| restaurant | Sted/køkken/område, offentlige søgeord | Kort opsummering, kilder, fundet navn/adresse og Maps via Jarvis | Ingen booking; ukendte priser/åbningstider må ikke opfindes |
| briefing | Offentligt emne og periode | 3–7 prioriterede nyheder, datoer, betydning og primære kilder | Ingen kundedata; forslag og vedtagne regler adskilles |
| product | Produktnavn og variant | Pris/valuta/tidspunkt/kilde med usikkerhed | Ingen køb; pris uden verificerbar variant er ukendt |
| recipe | Offentlige ingredienser/søgeord | Opskriftskilder og forslag, tydelige usikre mængder | Ingen automatisk lagring; ingen fuld husstandsprofil til gatewayen |

Efter search_web spærrer den fælles dispatcher alle mutationer i samme requestscope,
også via ældre stemmerute. En webstemmesession beholder scopet indtil afslutning.
Søgeresultater kan ikke ophæve spærringen. Researchsvar bevares til brugerens læsning,
men flagges og udelades fra efterfølgende modelhistorik. Nye gemmeønsker skal derfor
angive den konkrete ændring; et løst “gem det” er ikke en godkendelse af webindhold.
Assistentens stemmetransskripter bruges heller ikke automatisk som ny modelkontekst.
Dette reducerer handlingsrisiko, men dokumenterer ikke i sig selv modelkvalitet.

Hvis testmiljøets udgående netværk kræver en administreret proxy, kan proben køres
med `--use-environment-proxy`. Kun HTTP_PROXY/HTTPS_PROXY videreføres eksplicit;
loopback undtages. Flaget ændrer ikke produktion og er ikke en browser-SSRF-undtagelse.
