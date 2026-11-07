# Test, flags og tilbageførsel

Kun en udviklingskandidat. Slå intet til i produktion uden særskilt accept.
Pakken er stadig 5.3.0; næste release kræver synkron pakkeversion/tag og nye checks.

## Skills

Åbn **Indstillinger → Skills**. Søg efter Madplan; filtrér Jarvis/OpenClaw,
kategori og status. Se version, data, rettigheder og blokering. OpenClaw-gruppen
er lokal gennemgået metadata, ikke automatisk marketplace-installation. “Prøv skill”
åbner en kladde; den må ikke sende. En eksisterende kladde overskrives ikke.
Historiske versioner kan læses; kun en aktuel tilgængelig procedure kan prøves.
Gatewayens health-resultat er højst fem sekunder cachet, katalog højst 60 sekunder;
faktisk udførelse genvaliderer serverpolitik. Ingen health-check er en modeltest.

## Kanaler og stemme

Brug særskilt testserver med konfigureret ejer. Kanalstyring kræver eksisterende
`JARVIS_DISCORD_CHANNELS=yes`. Giv botten Manage Channels, View Channel,
Send Messages og Read Message History på de nødvendige testkanaler; brug ikke
Administrator. Private kanaler er fortsat synlige for serveradministratorer.

- `Vis Discord kanaler` / `!kanal liste`.
- `Opret en privat kanal jarvis-test` / `!kanal opret jarvis-test`.
- `!kanal omdøb KANAL_ID nyt-navn`.
- `!kanal rapport KANAL_ID` vælger kun en eksisterende privat ejer-/botkanal
  med Jarvis' præcise permissions. Intet sendes ved review.
- `!kanal slet KANAL_ID` viser permanent sletning og konkret engangsreview.
- `!kanal godkend REVIEW_ID` inden to minutter, samme ejer/server/samtalekanal.
- `!kanal status REVIEW_ID` efter timeout. Ukendt write blokerer flere writes;
  afklar det i Discord og journalen. Gæt ikke udfald, slet ikke journalen for retry.

Stemme: behold pinned discord-voice-runtime og de eksisterende OFF-flags.
`JARVIS_DISCORD_VOICE=yes` + `JARVIS_DISCORD_VOICE_CHANNEL_ID` i TEST, og
eksplicit `!stemme start` fra den godkendte tekstkanal. Alternativt vælges
tekstkanal og Start under **Indstillinger → System → Discord-stemme**.
Botten skal have Connect/Speak og nødvendig kanaladgang. Kun ejer og bot må være
til stede. Test mute, ejerafgang, anden deltager, netværksbrud, stop og genstart.
Ingen automatisk genforbindelse. `!stemme stop`, webstop og globalt stop tilbagekalder
sessionen. “Provider unknown” betyder, at fjernudbyderens afslutning ikke er bevist.
Efter research gælder den eksisterende mutationsspærre fortsat; ny konkret
anmodning/session er nødvendig. Tekstkilder sendes i den valgte tekstkanal.

## Billeder og video — isoleret testinstallation

Byg kun det gennemgåede image og registrér præcis image-ID efter bestået CI:

```sh
docker build -t jarvis-media-reviewed jarvis-starter/media-runtime
docker image inspect jarvis-media-reviewed --format '{{.Id}}'
```

Konfigurér `JARVIS_DISCORD_MEDIA=yes` og `JARVIS_MEDIA_IMAGE=sha256:...` i separat
testmiljø. `JARVIS_DISCORD_VIDEO=yes` er et yderligere opt-in. Valgfri
`OPENAI_MEDIA_MODEL` arver ellers tekstmodellen; den skal understøtte Responses
image input. Ingen yderligere gateway- eller OpenClaw-rettigheder er nødvendige.
Der er ingen hostdecoder-fallback, automatisk image-pull eller mount af brugerdata.
Docker-daemonen skal være lokal og operatørstyret. Adgang til Docker-socket er en
privilegeret hostgrænse; brug en dedikeret test/servicekonto og host.

Upload et spørgsmål plus højst to JPEG/PNG/WebP (10 MiB hver, 20 MP) eller én
MP4/WebM (30 MiB, 60 sekunder). Uden spørgsmål hentes eller analyseres intet.
Grænserne er Jarvis-grænser, ikke Discords maksimale uploadstørrelser. GIF/SVG,
animerede billeder, andre codecs/streams og ukendte typer kan blive afvist.
Store detaljerede normaliserede billeder kan også ramme provider-inputgrænsen;
send i så fald et relevant beskåret udsnit.

`!medie status` viser journalen; `!medie stop` og globalt stop kan afbryde under
download/decoder/model. Stop/status går foran den almindelige beskedkø. Et allerede
sendt providerkald forbliver ukendt, hvis kvitteringen mangler. Genstart genoptager
aldrig gamle opgaver. Højst én medieopgave behandles ad gangen, 2.000 journalposter
før vedligeholdelsesreview. Ingen automatisk sletning af dedupe-bevis.

Medier findes kun i proceshukommelse og containerens private tmpfs. Containeren
har 45 sekunders ydergrænse, dekodertrin 10 sekunder, 512 MiB RAM, én CPU, 48 PID,
96 MiB tmpfs, intet netværk, read-only root, ingen capabilities/hostmounts/secrets.
Endelig `docker rm --force` skal bekræftes. Efter hoststrømsvigt kontrolleres
`docker ps -a --filter name=jarvis-media-`; genstart ikke afbrudte containere.
Rå medier, signed CDN-links, spørgsmål og modelsvar gemmes ikke i mediejournalen.
Discord selv beholder brugerens upload og svaret efter sin egen retention.

Video er højst 12 udvalgte normaliserede frames plus højst 60 sekunders WAV til
separat transskription. Der er intet direkte videoinput og ingen garanti for at
se kortvarige hændelser mellem frames. Lydfejl giver delvist svar med tydelig tekst.
Requests/tokens hvor tilgængeligt føres i ProviderControl; lydtokens/pris er ukendt.
Videovarighed og reserverede sessionssekunder er ikke faktureret forbrug eller valuta.

Test mindst screenshot, kvittering, opskrift, produkt og fem korte videoopgaver.
Kontrollér ulæseligt indhold, injectiontekst, dubletlevering og stop. Fixtures
beviser ikke modellens forståelse. Upload aldrig rigtige credentials til prøver.

## Tilbageførsel

Slå MEDIA/VIDEO/VOICE/CHANNELS tilbage til OFF, stop aktive sessioner og kontroller
containere/Discord. Gennemgå ukendte handlinger før genoptagelse. Gå tilbage til
den kendte v5.3.0-installation via eksisterende staging/deployforløb og verificeret
backup. Bevar state, kanal-/mediejournal og gamle jobversioner. Nye felter er additive;
ingen datamigration eller automatisk sletning indføres. Udførte kanalændringer skal
gennemgås særskilt; versionsrollback genskaber ikke slettede Discord-beskeder.
