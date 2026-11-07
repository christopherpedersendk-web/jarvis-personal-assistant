# Drift, ejerprøve og tilbageførsel

## Sikre standarder

Ingen nye featureflags aktiveres af kodeændringen. Bevar den fungerende Jarvis-bot, datalager og scheduler. Aktuel remote-release er v5.5.0 på 14292e2338de2e18699c8910d342d71c88e88c77, verificeret 2026-11-07. Ny release kræver separat synkron version/tag/schema-kontrol. Overskriv aldrig de eksisterende tags.

Stamdata findes i eksisterende `private-settings.json`, mode 0600. Den fil indeholder også credentials og skal indgå i krypteret/begrænset backup, ikke vedhæftes PR/logs/chat. `state.json` indeholder kun ordre-/udviklingsjournal og adressefingerprint, ikke kontakt/adressearkivet. Sletning fjerner kontaktfelterne fra den aktive fil; historik gemmer kun tidspunkt/revision/antal. Ældre backups har selvstændig retention og er ikke fjernslettet af UI.

## Ejerprøve uden køb

1. I separat testinstallation: åbn Integrationer og læs Discord-kanaldiagnosen. Slå kun eksisterende kanalflag til bevidst. Bot skal have Manage Channels, View Channel, Send Messages og Read Message History, ikke Administrator. Prøv vis/opret privat kanal, godkend konkret forslag én gang, omdøb, vælg rapportkanal og slet testkanalen. Forkert ejer, beskyttet kanal, ændrede argumenter og genbrugt godkendelse skal afvises. Notér konkret Discord-fejl/status hvis installationen stadig fejler.
2. Indstillinger → Profil → Stamdata: opret en syntetisk profil, vælg standard, ret i to faner (én skal få revisionskonflikt uden mistet kladde), separat fakturering, slet og log ud. Bekræft at data ikke ligger i localStorage eller almindelig chat.
3. Struktureret privat chat/Discord-DM: `!stamdata gem {"expectedRevision":0,"profiles":[],"defaultProfileId":null}` viser review; erstat kun med bevidst indtastede testdata. Godkend med returneret `!stamdata godkend <id>` inden to minutter. Revision er den aktuelle arkivrevision. Fælles Discord-kanaler skal kun pege på privat UI, aldrig gentage adressefelter. Naturligt sprog udfylder ikke automatisk arkivet.
4. Kun test: `JARVIS_COMMERCE=yes` tillader lokale kladder. Indstillinger → Integrationer → Indkøbsklargøring: test en offentlig Proshop/Amazon.de-vare, kendt variant/sælger/pris/fragt og frisk observation. Ret adresse efter kladde og kontrollér nyt review kræves. Overdragelse viser varelinks; ingen ordre, kurv eller betaling er startet. Beløb er brugerindtastede observationer, ikke bekræftet realtimepris.
5. Madplan: høj variation over flere forslag, fasthold brugerens låste valg og kostkrav. Registrér faktisk tilberedt via UI eller konkret chatbesked. Kontroller samme revision og én aktiv plan i Discord/web. I Nemligoversigten skal mængden stå separat; søgning bruger navnet.
6. Prøv stop, restart og logout. Gamle ordrekladder bliver stopped ved restart, reviews forsvinder, ukendt udviklingspublicering genforsøges ikke.

## Særskilt OpenClaw-browser, først efter isolation

`openclaw-runtime/commerce-browser-config.mjs` eksporterer en separat testkonfiguration for den fastlåste OpenClaw 2026.11.1. Den må ikke flettes med research-gatewayens konfiguration. Brug frisk privat HOME/state, separat tjenestebruger/container, separat browser-control token og netværksregler, ingen Jarvis-data, browserprofiler, SSH/Docker-socket eller produktionssecrets. Ingen ekstra Discord-bot/scheduler. Den indbyggede `user`-profil er også konfigureret som isoleret managed profile, så global profilinspektion ikke forsøger at attach'e ejerens Chrome MCP.

Browserkontrol skal bindes til loopback. OpenClaw dokumenterer kontrolport gatewayport+2; Jarvis gætter den ikke. Adapteren kræver eksplicit `OPENCLAW_BROWSER_CONTROL_URL=http://127.0.0.1:<faktisk-port>` og `OPENCLAW_BROWSER_CONTROL_TOKEN`. Kontroller status/auth med `node scripts/openclaw-browser-contract.mjs`. Denne prøve starter den faktiske gateway men ingen Chrome, køber intet og beviser ikke netværkscontainment.

Før `JARVIS_OPENCLAW_BROWSER=yes` og `JARVIS_COMMERCE_ISOLATION_REVIEW=accepted`: dokumentér hostens netværksisolation med faktiske Chrome-prøver mod intern IP, metadata, redirect, DNS-skift og underressourcer. Konfigurationsattestation er ikke en test eller firewall. Hvis det ikke kan bevises, behold funktionen OFF og brug eksisterende sikre research. Ingen alternativ mindre sikker fallback.

Adapteren må kun kalde åbne/liste/snapshot/lukke eget faneblad med fast `profile=jarvis-commerce`. Den returnerer utroværdige kildedata. Ingen `/act`, formularer, cookies, login, checkout eller betaling. Rigtige merchantflows kræver særskilt fremtidig implementering, kontrollabel sandbox og ordrebindingsanalyse.

## Selvudvikling i test

OFF som standard. `JARVIS_SELF_DEVELOPMENT=yes` kræver separat `JARVIS_DEV_GITHUB_TOKEN` med kun den konkrete repositories contents/PR write samt nødvendige read-rettigheder. Ingen workflow/check/admin/release/deployrettighed. Branch protection skal afvise tokenets skrivning til main og beskyttede workflows. Credentials gives ikke til modellen eller Docker-funktionen. Fuldstændig fil-/APIadgang håndhæves desuden serverstyret.

UI: Indstillinger → System → Selvudvikling. Kun meal-variety.mjs/shopping-search-list.mjs, næste patchversion, højst tre opgaver/dag UTC og én samtidig. Tests i eksisterende Docker-sandbox, ingen host-kørsel af modelkode. Kun en draft-PR oprettes. Testcredential må ikke kobles til produktionsudrulning.

`JARVIS_SELF_RELEASE_APPROVAL=yes` er en separat beslutning. Agenten må efter ejerens mandat godkende sin egen kandidat, men kun præcis SHA/version/diff med alle seks historisk krævede workflows, alle krævede checks og checket `independent-security-review` fra GitHub Actions. Sidstnævnte check er endnu ikke konfigureret i repository; godkendelse forbliver derfor afvist. Reviewudsteder og branch protection skal være uafhængige af udviklingstokenet. Stop/resume ugyldiggør godkendelsens generation permanent. SHA-ændring, udløb, manglende/faldende checks eller utilgængelig verifikation gør lagret godkendelse ugyldig. Ingen automatisk merge, tag eller deploy.

## Ressourcer

Browser: én samtidighed, 20 sekunders læsning + højst 5 sekunders cleanup, 100 KB HTTP-svar/25K snapshot, faste origins. Én operation reserveres i fælles ProviderControl; faktiske HTTP-kald måles, tokens/pris er ukendt. Det er ikke en samlet økonomisk budgetgrænse.

Udvikling: tre forsøg/dag, én samtidig, request 2K/kodeændring 45KB, fast testfil og Dockergrænser fra isolated-test.mjs, GitHubkald 15 sekunder/1MB uden retry. Modelkald bruger eksisterende providergrænser; ingen påstand om besparelse. Ukendt publicering kræver manuel gren/PR-inspektion.

## Rollback

Stop først i Jarvis og slå de tre nye funktionsflags samt agentgodkendelse fra. Stop den særskilte OpenClaw-browserservice og luk dens profiler. Kandidaten har ingen tag/deploy/migrationsændring. Revert PR-committene i udviklingsgrenen eller senere via en reviewet rollback-PR; deploy kun gennem eksisterende særskilt tjeneste efter godkendelse. Bevar private indstillinger og journaler/backups, også når ældre kode ignorerer de nye felter. Genoptag ikke stoppede/ukendte opgaver eller gamle reviews. Kontroller eksisterende Discord-tekst/rapport, helbred og én aktiv madplan efter tilbageførsel. Faktisk installationsrestore er fortsat separat åben accept.

## Redigerbare kladder og review

Ordre: vælg Redigér ordrekladde, ret vare/antal/pris/profil og gem. Dette opdaterer samme ordre-id med en højere revision, nyt reviewhash og to minutters reviewfrist. Ingen gammel godkendelse genbruges. Priser skal stadig være kendte og højst 15 minutter gamle. Annullering afslutter kladden; overdragede/stoppede/annullerede kladder genåbnes ikke. Konflikter bevarer formularen, og Hent indkøbsstatus opdaterer listen uden at kassere indtastningen. Vælg selv en ny kladde, hvis den gamle er afsluttet.

Udvikling: Hent udviklingsstatus → udfyld ønske, tilladt fil, patchversion og eventuelle acceptkriterier → Gem udviklingskladde. Lokal lagring kræver login, men hverken udviklingscredential, model, Docker eller aktiveret selvudvikling. Globalt stop blokerer nye/gemte rettelser; annullering er stadig tilladt. Gemte udviklingskladder overlever restart. Start gennemgået kladde kræver de eksisterende aktiverings-/adgangskrav og forbruger præcis den gemte revision én gang. Ingen automatisk retry, heller ikke ved forbindelsesbrud. Hent status før en ny anmodning.

Udviklingsjournalen indeholder nu også brugerens konkrete ønske, acceptkriterier og den offentlige funktions før/efter-kode (maksimalt 45 KB pr. side). Undgå private oplysninger i udviklingsønsker. Secrets afvises; hukommelse/stamdata sendes ikke automatisk til kodeagenten. Kodevisningen bruger tekst, ikke HTML. Ved utilgængelig sandbox kan kodeforslaget gennemgås, men udføres/publiceres ikke. Den eksisterende daglige grænse tæller startdato, ikke kladdens oprettelsesdato.

API: POST /api/commerce/:id/revise med {expectedRevision,order}; POST /api/commerce/:id/cancel med {expectedRevision}. POST /api/self-development/drafts gemmer en opgave; POST /api/self-development/:id/draft med {expectedRevision,task} reviderer den; /cancel afslutter den. POST /api/self-development med {draftId,expectedRevision} starter eksisterende pipeline. Alle ligger bag eksisterende owner-autentifikation. Ingen nye modeltools er tilføjet.

Browserresultatet indeholder requestedUrl, url, observedAt og snapshotHash. Observationstidspunkt er ikke en garanti for pris/lager eller netværksisolation. Browseren bruger fem kontrolkald ved succes (open/list/snapshot/list/close), og faktisk antal HTTP-kald registreres. Tokens og pris forbliver null.

Rollback til ældre kode kræver, at nye udviklingskladder ikke startes gennem den ældre UI, som ikke forstår deres kladdestatus. Bevar journalen; ingen migration, pakkeversion eller featureflag ændres af denne udviklingspakke. Den nye før/efter-visning er syntakskontrolleret, ikke fysisk mobil- eller browseraccept.

## M12/M16-kandidat 5.5.1: afprøvet isolation og faktisk adgang

Denne opfølgning erstatter ældre udsagn om utilgængelig Docker/målhost: den aktuelle vært har Docker 29.9.3. Produktionsservice `jarvis.service` var aktiv med arbejdsmappe `/home/administrator/jarvis/current/jarvis-starter`, symlink til `releases/v5.5.0`; data og `.env` ligger i `/home/administrator/jarvis/shared`. Ingen tjeneste, symlink eller produktionsfil er ændret. Ingen ekstra gateway/bot er startet. Der fandtes ingen AGENTS.md i repository eller de undersøgte forældremapper. Udviklingen skete i separat klon `/tmp/jarvis-m12-m16`, gren `implement/m12-m16`.

Botcredential blev kun læst af lokalt script og sendt som Authorization til Discord. Faktisk guild-read og Manage Channels bestod, Administrator var ikke givet. Testkanal `1568620906543194122` blev oprettet privat, omdøbt, anvendt til én testbesked og slettet med readback. Første script stoppede efter bekræftet oprettelse på grund af en lokal referencekontrol; journalen blev inspiceret før fortsættelse af **samme** kanal. Ingen skrivehandling blev gentaget. Produktionsrapportkanalen blev ikke ændret.

Reproducerbart, kun med separat mandat til en ny disponibel testkanal:
`node jarvis-starter/scripts/discord-channel-live.mjs --live <privat-settings-sti>`.
Scriptet starter ingen gateway, skriver sin egen private journal i /tmp, ændrer kun en ny `jarvis-acceptance-*`-kanal og bruger isoleret rapportkonfiguration. Ved fejl skal journal/Discord inspiceres først; recovery-argumentet accepterer kun én dokumenteret completed oprettelse. Kør ikke automatisk igen ved ukendt udfald.

Opskriftsbilleder i en **separat staginginstallation**: klargør det eksisterende `media-runtime/Dockerfile`, der verificerer officiel signatur/checksum og bygger decoder uden netværksprotokoller. Kør containmentprøver før `JARVIS_RECIPE_IMAGES=yes` og `JARVIS_MEDIA_IMAGE=sha256:<præcist-lokalt-image>`. `JARVIS_DISCORD_MEDIA` behøver ikke aktiveres. Send billedet sammen med `Gem opskrift:`. Original og uverificeret kladde ligger i den eksisterende private Opskriftsindbakke; ingredienser/portioner/tid/kosttype kræver ejerreview før bekræftet opskrift og madplan. Uden decoder vises konkret diagnose; rå billedbytes sendes ikke til modellen. Målhostens samlede syntetiske billedprøve bestod faktisk Discord-upload, CDN-download, decoder/model og privat ubekræftet testindbakke, uden produktionsaktivering. Botvedhæftningen blev indtaget direkte i testscriptet; ejerens gatewaydialog og menneskelige review er fortsat åbne.

Proshop i **separat staging**, ikke produktionsaktivering: `JARVIS_COMMERCE=yes` og `JARVIS_PROSHOP_CART=yes` stiller konkret anonyme HTTP-formhandlinger til rådighed. Dette udvider ikke OpenClaws læserettigheder. Ingen butikskode udføres på værten; offentlig DNS valideres og pinnes for hvert TLS-kald. Browserlæsningen blev særskilt prøvet i netværksløs Chromium gennem eksisterende ressourcebroker. Sessionscookies ligger kun i `data/proshop-sessions/<ordre-id>.json` (mappe 0700, fil 0600); medtag dem kun i begrænset/krypteret backup. Ingen cookies, kontaktdata eller rå merchant-JSON sendes til modeller eller evidensfiler.

UI: Hent indkøbsstatus → Søg Proshop → vælg højst tre produkter → sammenlign → vælg vare. Ukendt fragt må ikke indtastes som nul eller en offentlig mindste fragtpris. Den konkrete kurvewritekontrakt er afgrænset til Sandberg 3298156, variant `Hvid, 1 m, USB-C til USB-C`, antal 1, DKK, manuel betaling og eksplicit faktureringsvalg. Alle ordrefelter og stamdatafingerprint bindes til engangsreview. Ikke-tom testkurv, ændret vare/pris/sælger/adresse, udløb eller stop afviser skrivning. Efter durabelt consume sendes én AddItem-POST, aldrig automatisk igen ved netværksbrud. Restart af preparing bliver unknown; unknown blokerer nye kurvewrites, indtil operatøren har inspiceret butik/session/journal. Der findes ingen automatisk clear/resume.

Den verificerede varekurv kan åbnes via butikkens native delingslink, som kun deler varevalg. Brugeren skal selv vælge at kopiere indholdet hos Proshop, kontrollere egne eksisterende varer, logge ind eller indtaste kontakt/adresser og gennemgå fragt/pris. Linket eksporterer ikke cookies og er **ikke** en færdig checkout. Login-/Register-/leverings-/betalingsformularer submitter adapteren ikke. Kun offentlig produktpris og mindste fragt kendes før adressevalg; total og levering til 2900 forbliver null. MobilePay/PayPal-logoer i footer beviser ikke et brugbart betalingsflow. Intet bindende køb udføres.

Reproducerbar faktisk anonym prøve: `node jarvis-starter/scripts/proshop-live.mjs --live` læser søgning/produkter; tilføj `--cart` kun med særskilt testmandat til én kurveændring ved den dokumenterede pris. Prøven bruger syntetisk adresseprofil som **aldrig** sendes og gemmer privat session/journal i /tmp. Den er ikke ejerens godkendelse af en rigtig ordre eller en 2900-fragtpris.

Rollback: slå de nye flags fra i staging, stop opgaver og bevar journal/sessioner til afklaring. Slet eller genstart ikke ukendte kurveforløb. Produktionen er uændret af dette arbejde.
