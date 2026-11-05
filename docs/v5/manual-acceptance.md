# Manuel acceptliste – JARVIS v5.0.0

Status: **afventer manuel verifikation**. Alle felter nedenfor er bevidst åbne. En grøn Node-test, DOM-kontrakttest eller browseremulator er ikke fysisk accept. Brug kun den isolerede, syntetiske udviklings-/stagingkandidat. Ingen af trinene giver tilladelse til produktion, rigtige Nemlig-skrivninger, nye gentagne job, kontakt til andre eller ekstern behandling af persondata.

## Bind kontrollen til den faktiske kandidat

Registrér hver kontrol i [verification.md](verification.md). Et resultat fra en tidligere kandidat er ikke bevis for nyere ændringer.

| Oplysning | Udfyldes ved kontrollen |
| --- | --- |
| Kandidatens commit-SHA og app-subtree/content-hash | Ikke registreret |
| Testet URL/miljø og syntetisk datasæt | Ikke registreret; kun staging/udvikling |
| Fysisk enhed, OS, browser og versionsnummer | Ikke registreret |
| Dato, tester og faktisk resultat | Ikke registreret |
| Skærmbilleder/logs og begrænsning/fejl-ID | Ikke registreret; ingen hemmeligheder/persondata |

- [ ] Kontrollér, at kode, pakkeversion, kørende version, skema og evidens peger på samme kandidat. Ingen produktionsnøgler, produktionsdata eller aktive integrationsjob må være indlæst.
- [ ] Læs den nyeste kandidatbundne CI-/model-/performance-evidens. Historiske grønne workflows er kun historik. Alle P0/P1-rækker i kravmatricen skal have krævet evidens; ingen fejlet eller ukørt test er ommærket som bestået.
- [ ] Kør Chromium/WebKit-matricen på præcis kandidaten: 1390 × 950 og 390 × 844. Gem samtlige skærmbilleder, runtime-fejl og accessibility-report.json. En delvist kørt matrix er ikke 4/4.

Automatisk beregnet kontrast, tastaturrækkefølge og reducerede CSS-visningsbredder er supplerende evidens. **695 × 475 ved 1390 × 950 er kun en syntetisk 200 %-ækvivalent reflow-kontrol, ikke faktisk browserzoom.** 320/390 CSS-pixels er ikke en fysisk iPhone-test.

## Navigation, læsbarhed og kladder

- [ ] Desktop: I dag · Plan · Mad og indkøb · Min viden · Hjem · Projekter · Indstillinger. Mobil: I dag · Plan · Mad · Viden · Mere, med øvrige områder under Mere.
- [ ] I dag starter kompakt med chat og få relevante overblik. “Flere detaljer og historik” er lukket som standard. Kritiske lager-/leveringsfejl er stadig synlige. Beskedfelt og mikrofon kan let nås.
- [ ] Brug kun tastatur: Tab/Shift+Tab, Enter og mellemrum. Kontroller synligt fokus, ingen fælder, fornuftig rækkefølge, More/menu og details. Scrollbar historik må være et særskilt tastaturstop før beskedfeltet, men fokus må ikke hoppe til uvedkommende felter.
- [ ] Skriv en ufuldstændig kladde, markér tekst og vent gennem polling. Importér en uafhængig syntetisk nabo. Tekst, markering og fokus bevares. Skift side og tilbage; genindlæs fanen. Kontroller chat, note, struktureret oplysning, listepunkt, opgave, job, projekt, opskrift og familiens dagskort.
- [ ] Åbn præcis kilde fra søgningen: note, oplysning, listepunkt, opskrift, husstandsdato, opgave og bestemt skillversion. Brug Tilbage/Frem og kopieret direkte URL. Rigtig post/dato/version markeres, returvej og kladde bevares. Utilgængelig kilde må ikke erstattes af en anden post.
- [ ] Log ud med kladder og simuleret ventende læsesvar. Privat DOM og tab-session-kladder tømmes. Forsinket svar må ikke genvise dem. Afvist browserlager og hemmelighedslignende tekst skal give tydelig advarsel; adgangsnøgler må aldrig ligge i kladdelageret.

## Personlig hukommelse og selvstændig planlægning

- [ ] Brug én hukommelseseditor uden madplan/indkøb: opret note og struktureret forslag. Forslaget er ikke et bekræftet faktum. Kilde, kanal, revision, kategori og gyldighed kan læses.
- [ ] Ret et forslag med kilde/gyldighed; det forbliver foreslået. Ret et bekræftet punkt: originalen bevares, mens et nyt rettelsesforslag oprettes. Vælg den konkrete original/revision og bekræft udtrykkeligt. Først nu erstattes originalen, som bevares i historikken.
- [ ] Åbn samme oplysning/note i to testfaner. Gem i én, behold kladde i den anden. Gammel revision blokeres med synlig konflikt. “Hent nyeste … og kassér kladde” kræver et udtrykkeligt valg. Tekst skrevet under en igangværende gemning slettes ikke af kvitteringen.
- [ ] Skeln foreslået, bekræftet, modstridende, fremtidig, udløbet, ugyldig, erstattet og arkiveret viden. Ret/ugyldiggør og søg straks igen. Gamle/ugyldige fakta må ikke komme tilbage som aktuelle; manglende viden må ikke opfindes. Den kandidatbundne måling med mindst 80 danske spørgsmål og top-5-mål på 90 % er separat evidens.
- [ ] Opret/redigér personlig opgave med formål, resultat, varighed/usikkerhed, deadline, prioritet og afhængighed. Ingen automatiseret opgave eller kalenderhændelse oprettes.
- [ ] Simulér uden kalenderdækning eller manuel gennemgang: kapacitet er ukendt. Gennemgå eksplicit syntetiske tidsvinduer/aftaler; gem lokal placering og lås den. Ændr en anden opgave: fortsat gyldigt manuelt/låst valg bevares. Uforenelige krav forklares.
- [ ] Afprøv Europe/Copenhagen: 29. marts 2026 kl. 02.30 findes ikke; 25. oktober 2026 kl. 02.30 har to forekomster. Ingen stiltiende antagelse om enhedens tidszone eller første vintertidsforekomst.
- [ ] Opret opfølgningssag, udsæt næste tjek, registrér kildefejl som “ukendt” og afslut/annullér. Historik bevares. Kilden bliver ikke “uændret”, og der sendes ingen besked eller aktiveres noget job.

## Husstand, opskrifter og indkøb

- [ ] Gem eksplicit husstandsstandard, ugedagsregel og datoundtagelse. Kontroller datoundtagelse → gentagen regel → eksplicit standard. Manglende information må ikke blive gættet fremmøde.
- [ ] Redigér voksne, børn, oplyst alder/kontroldato, portionsfaktorer, gæster, ferie og fravær i strukturerede felter. Vis beregningsgrundlaget. Fravær uden aftensmad giver nul portioner; identisk gemning ændrer ikke revision eller andre dages manuelle valg.
- [ ] Vis familierytme og kalender side om side: valgt kalender, dækning, indlæsnings-/udløbstid og kendte travle aftener. Manglende/gammel/fejlet cache står som ukendt, ikke ledig. Kalendertekst må aldrig ændre deltagere. Polling læser kun lokal cache; upstream-læsning kræver særskilt klik og syntetisk adapter i denne kontrol.
- [ ] Importér syntetisk opskrift; gennemgå originalmateriale, kilde, mængde/enhed/portioner, tid og trin. Ufuldstændigt/utilgængeligt materiale står uafklaret. Godkendelse er eksplicit. Naboimport/genoptaget udtræk overskriver ikke en ufuldført ingredienskladde.
- [ ] Redigér, flyt, lås, byt og regenerér aftensmåltider; manuelle valg og ekstravarer bevares. Planlagte rester er ikke registreret forbrug/lager. Lager og reservationer har synligt grundlag; ukendt stykvægt eller inkompatible enheder må ikke gættes.
- [ ] Brug kun syntetisk Nemlig-adapter: gennemsyn → faktisk “Overfør til Nemlig”-klik → én revisionsbundet add-only overførsel, uden ekstra bekræftelsesfrase. Model, Discord, stemme, job, planændringer, søgning og polling giver nul kurveskrivninger. Urelaterede kurvelinjer bevares; ordre, checkout og betaling findes ikke.
- [ ] Pris ændres 20 → 99 DKK under budget 30 DKK: stale pris/tilgængelighed og ukendte omkostninger er synlige. Delvist/ukendt udfald genforsøges ikke automatisk. Lokal revision er ikke en atomisk Nemlig-transaktion eller garanti mod ekstern kurveændring mellem læsning og skrivning.

## Job, projekter og indstillinger

- [ ] Opret syntetisk automatiseret job **pauset**. Gennemgå præcis skillversion, parametre, tidszone, skema, læsetilladelser, budget, retry/pause, stilleperiode og missed-run-politik. Åbn hele den versionerede procedure og vend tilbage til kladden. Kør/fortsæt aldrig et reelt job under kontrollen.
- [ ] Brug tomt syntetisk projekt uden model-/installeradgang. Projekt-, oprettelses- og kodeforslagskladder samt udvidede filer/logs overlever polling/navigation. Revision/filhash-konflikt kræver filgennemgang. Ukendt operation blokerer gentagelse; en anden operationstype beviser ikke udfaldet. Pakke-/versionslisten svarer præcist til det godkendte sæt.
- [ ] Ret kun almindelig indstilling, fx syntetisk kørselsgrænse. Samtidige ændringer i andre felter bevares; samme felt giver konflikt. Kontroller også Discord-/overbliksformularers kladder uden aktivering. Nye hemmelige nøglefelter forbliver i RAM og gendannes ikke efter reload.
- [ ] Status skelner ikke konfigureret, ikke verificeret, forbundet, forældet, udløbet login og utilgængelig med tidsstempel. Planlagte tekniske muligheder er ikke aktive rettigheder. Eksisterende Home-funktionalitet bevares; kontrollen giver ingen ny konto-/OAuth-adgang.

## Fysiske enheder og administratorkontrol

- [ ] **Fysisk iPhone/Safari:** udfør kerneforløb på enheden. Åbn/luk skærmtastatur, redigér strukturerede felter, markér tekst, gå tilbage/frem og kontroller scroll, nederste navigation, fokus og læsbarhed. Notér model, iOS og Safari-version.
- [ ] **Fysisk desktop:** udfør med mus og tastatur alene. Vælg faktisk 200 % browserzoom i browsermenuen; kontroller ombrydning og adgang til knapper/felter på alle syv sider. Reduceret viewport tæller ikke. Kontroller tekst, feltrammer, fejl-/stale-tilstande og fokus mod baggrunden; dokumentér manuelle fund.
- [ ] **Mikrofon:** kontroller den eksisterende affordance og stop/start. End-to-end stemmetest kræver konkret brugervalg af eksisterende behandling/tilladelse og syntetisk tale. Hvis valg eller fysisk enhed mangler, forbliver punktet pending. Ingen automation simulerer Nemlig-ejerklikket.
- [ ] **Administrator, isoleret staging:** følg [migration-and-rollback.md](migration-and-rollback.md). Verificér backuphash, restore, afbrudt/gentaget migrering, ukendt nyere skema og blokering ved nyere brugerændringer. Gendan ikke gammel backup over nye data uden eksplicit beslutning. Ingen root-ejet produktionsservice/script ændres af denne liste.
- [ ] Saml kandidatbundet p95/payload/retrieval/write/queue/ekstern ventetid/hukommelse/model-/toolforbrug og begrænsninger. Fysisk stikprøve erstatter ikke den dokumenterede før/efter-serie.

## Releasebeslutning

M6 kan først accepteres, når krævede P0/P1-kriterier og nødvendige fysiske/administrative kontroller har faktisk evidens. Manglende adgang/udstyr/godkendelse noteres som **afventer manuel verifikation** eller **blocked**, med præcis næste handling — ikke som bestået.

**M7 kræver tre særskilte beslutninger:** flet til main; opret stabilt v5.0.0-tag/release; installér i produktion. Listen foretager eller godkender ingen af delene. Deploymentens forventning om stabile lightweight-tags og administratorens særskilte review bevares.
