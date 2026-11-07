# Drift, ejerprøve og tilbageførsel

## Sikre standarder

Ingen nye featureflags aktiveres af kodeændringen. Bevar den fungerende Jarvis-bot, datalager og scheduler. Pakkens version er stadig 5.4.0; ny release kræver separat synkron version/tag/schema-kontrol. Overskriv aldrig de eksisterende tags.

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
