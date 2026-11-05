# Sonos OAuth – næste udviklingsmilestone

Bygger på PR #10. Ingen release, merge, serverinstallation eller live-login er udført.

## Implementeret

- Ejerautentificeret start af Sonos-login fra Indstillinger, browserbundet engangstilstand og udløb efter 10 minutter.
- Serverbaseret udveksling af kode og automatisk fornyelse før brug; parallelle forespørgsler deler én fornyelse.
- Access token og refresh token gemmes i eksisterende private-settings-transaktion før brug. Samtidig fjernelse eller erstatning af login vinder over et forsinket svar.
- Ingen automatisk genafspilning af musikkommandoer. Eksisterende handlingsjournal bevares.
- Manuelt token virker fortsat. Fjern token fjerner også refresh token. Snapshot/polling starter ikke login eller netværkskald.
- Gruppe-ID med kolon understøttes og URL-kodes.

## Opsætning ved senere installation

1. Opret en Control API-integration i Sonos Developer Portal.
2. Registrer en HTTPS-returadresse med stien `/api/smart-home/sonos/callback`. Sonos dokumenterer krav om en offentligt routbar adresse; kompatibilitet med den nuværende private Tailscale-adresse er **ikke verificeret**. Åbn ikke hele JARVIS offentligt for denne integration. Afklar returadressen før aktivering.
3. Sæt `SONOS_CLIENT_ID`, `SONOS_CLIENT_SECRET` og `SONOS_REDIRECT_URI` på serveren. Ingen hemmeligheder skal i GitHub eller chat.
4. Åbn JARVIS på samme HTTPS-origin som returadressen (browserbindingen anvender en Secure-cookie). Vælg **Forbind med Sonos** i Indstillinger.
5. Gem household-ID og hent Sonos-rum fra Hjem. Login alene er ikke bevis på en fungerende enhedsforbindelse.
6. Test play/pause og senere tokenfornyelse på egen konto. Test også afvist login og lokal fjernelse af forbindelsen.

Login kræver Sonos' `playback-control-all`-scope. Den lokale fjernelse sletter JARVIS' gemte credentials, men tilbagekalder ikke selve tilladelsen hos Sonos. Et nyt login erstatter et tidligere igangværende login. Genstart kræver et nyt loginforsøg, hvis callback endnu ikke er gennemført.

## Test og afgrænsning

Automatiserede tests dækker state/cookie, replay, udløb, afvisning, parallel fornyelse, mangelfuldt svar, gemmefejl, samtidig frakobling og ingen gentagelse af en fejlet musikkommando. Alle eksterne kald i disse tests er simulerede.

Nest-livehændelser og Home Assistant er fortsat planlagte særskilte milestones. Direkte Google SDM/PubSub er ikke implementeret her. Fysisk iPhone-test, egne Sonos-credentials og driftstest afventer senere opsætning.

Kilder: https://docs.sonos.com/docs/authorize og https://docs.sonos.com/reference/refreshtoken (kontrolleret 5. november 2026). Udløb beregnes ud fra det faktiske `expires_in` i svaret.
