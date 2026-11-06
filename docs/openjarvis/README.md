# OpenJarvis — hybrid, første integrationsfase

JARVIS ejer fortsat madplan, husstand, Nemlig, godkendelser, hukommelse,
rapportplanlægning og Discord-tekst. OpenClaw køres separat med egen bruger,
konfiguration og data. Der kopieres ikke en anden platforms state ind i JARVIS.

## Implementeret

`openjarvis.mjs` forbinder det eksisterende search_web-værktøj med OpenClaws
POST /tools/invoke. Kun tool=web_search og query/count sendes. Ingen vilkårlige
værktøjsnavne, sessioner, cookies, personhistorik, shell eller skrivehandlinger.
Aktivering gælder samme søgehandler i chat, Discord-tekst og webstemme.
GET /api/openjarvis er ejerautentificeret status, ikke en credential-/proxy-rute.
Default er deaktiveret; den tidligere søgeprovider bruges da som før. Ved fejl
på aktiveret OpenClaw er der ingen automatisk fallback, retry eller dobbeltbetaling.
Svar er ubetroede kildedata. 20 sekunders timeout, 100 KB svar og fælles stop.

## Serveropsætning — ikke udført her

1. Installér og gennemgå en fast OpenClaw-version separat. Undersøgt reference:
   2026.11.1. Verificér versionens afhængigheder og konfiguration før brug.
2. Kør gateway kun på 127.0.0.1:18789 med separat gateway-token og tool-policy,
   der kun tillader web_search. Konfigurér en understøttet søgeprovider.
   Ingen Discord-bot, cron, browser, shell eller JARVIS-datamappe i denne instans.
3. Gem følgende i JARVIS' private servicemiljø, aldrig i Git:

   OPENJARVIS_ENABLED=yes
   OPENJARVIS_GATEWAY_URL=http://127.0.0.1:18789
   OPENJARVIS_GATEWAY_TOKEN=<det separate gateway-token>

4. Genstart en isoleret testinstallation og verificér /api/openjarvis samt en
   restaurantforespørgsel via chat og Discord. Kontrollér kilder, fejl og stop.
   Test før produktion. Rollback: fjern aktiveringen og genstart JARVIS.

Gateway bearer-token er operatoradgang, ikke en begrænset søgenøgle. Adapterens
allowlist erstatter ikke gatewaypolicy/OS-isolation. Gateway må ikke være offentlig.
Der er endnu ingen samlet økonomisk budgetkontrol for OpenClaw-søgeprovider.

## Resterende hybridleverancer

- Faktisk installation og live kontraktprøve med den valgte OpenClaw-version.
- Isoleret dynamisk browser, kontrolleret netværk og JARVIS-handlingsgodkendelser.
- Afgrænset plugin/API, så OpenClaw kan læse/foreslå ændringer til JARVIS-madplan.
- Kontrolleret overdragelse af Discord/stemme til præcis én bot-ejer.
- Vedvarende samlet budget, audit og verificeret stop på begge platforme.
- UI-branding og migration efter disse integrationer er godkendt.

Dette er en fungerende, syntetisk testet søgeadapter, ikke en fuldt installeret
hybrid eller en release. Eksisterende v5.1-releasekrav består. Ingen upstream
kode er kopieret; ved fremtidig kopiering bevares licens og attribution.

Kilder gennemgået 6. november 2026:
https://docs.openclaw.ai/gateway/tools-invoke-http-api
https://docs.openclaw.ai/tools/browser
https://docs.openclaw.ai/channels/discord/voice-channels
