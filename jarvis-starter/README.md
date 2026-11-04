# JARVIS v4.8 – Google Kalender, madhukommelse, madplan og godkendt Nemlig-kurv

**v4.8-arbejdsbranch:** Tilføjer fanen **Mad & indkøb** med gemte husstandspræferencer, pantry, budgetmål, madplaner og indkøbslister. Lokal personlig søgning inkluderer nu eksplicit gemte madpræferencer og madplaner med kilde-ID'er. Google Kalender bruger OAuth2 og kun `calendar.readonly`; ved frivilligt tilvalg kan madplanen prioritere hurtigere retter på aftaledage. Kalenderaftalers tekst gemmes ikke i madplanerne.

Nemlig MCP fra [`kraenhansen/nemlig-mcp`](https://github.com/kraenhansen/nemlig-mcp) er en *valgfri*, som udgangspunkt deaktiveret adapter til produktsøgning, kurvlæsning og **kurvforslag**. JARVIS ændrer **kun** kurven efter at brugeren har gennemgået det konkrete forslag og skrevet `OPDATER NEMLIG-KURV` i brugerfladen. JARVIS har **ingen** bestillings-, checkout- eller betalingsfunktion. Chat, Discord og stemme kan kun forberede forslag. Se [V48_RELEASE.md](V48_RELEASE.md) for opsætning, begrænsninger, risiko og test.

Der er ingen nye runtime-npm-afhængigheder. De nye eksterne forbindelser kræver separat brugeropsætning og er **ikke** automatisk tilsluttede ved opgradering. Den eksisterende produktionsversion skal forblive uberørt, indtil v4.8 er reviewed, tagget, testet og godkendt via Auto-Update Manager.

---

## Tidligere: v4.7

Denne versions aktuelle installationsmetode er privat GitHub → Auto-Update Manager → isolerede tests → **udtrykkelig godkendelse** → systemd-deployment med rollback. Cloud-serveren bruger den fælles, private `shared/data`-mappe og den eksisterende lokale restic-backup. Se [V47_RELEASE.md](V47_RELEASE.md) for teknisk arkitektur, test, sikkerhed og opgraderingsplan. Afsnittene nedenfor om Windows beskriver ældre versioner.

## Nyt i v4.7

- **Chat først:** Hovedsiden viser samtalen højt oppe og et konkret overblik over i dag, de næste syv dage og dokumenterede forhold, der kræver opmærksomhed.
- **Dags- og ugebriefing:** JARVIS kan oprette faktabaserede, lokale overblik i indbakken kl. 07:30 dansk tid og søndag kl. 18:00. Indholdet kommer kun fra registrerede datoer, opgaver, godkendelser, projektstatus og indbakken. Tomme overblik giver ingen besked. Hvert overblik registreres kun én gang pr. periode.
- **Discord:** Udsendelse af nye briefinger via DM kræver *både* almindelige Discord-advarsler og det særskilte nye tilvalg. Stilletid gælder dags- og ugebriefinger. Eksisterende andre påmindelser styres fortsat af deres egne indstillinger.
- **Personlig søgning:** Fanen **Viden & skills** har en lokal RAG-lignende retrievalfunktion over gemt hukommelse, noter, datoer, opgaver og projekter. Resultaterne har kilder og kan hentes i både tekst- og stemmesamtalen. Samtalehistorik, adgangsnøgler og rå filer indekseres ikke. Denne første udgave anvender vægtet tekstsøgning; semantiske embeddings er **ikke** aktiveret.
- **SKILL.md-procedurer:** Tre gennemgåede, versionsstyrede arbejdsgange for dagsbriefing, personlig opfølgning og gaveplanlægning. Skills er vejledninger og må ikke automatisk udføre køb, kontakte andre eller køre kode.
- **Integrationskatalog:** Gør klar til Google Kalender, Google Tasks og Home Assistant med tydelige planlagte rettigheder. Viser ærligt status på eksisterende Discord, Hue og Sonos. Der oprettes **ingen** nye tredjepartsforbindelser i v4.7.

v4.7 kræver ingen nye npm-pakker, credentials eller konfigurationsfiler. Personlige data og tokens bliver i `shared/data` og `shared/.env` ved deployment. Test med `npm test` før tag/godkendelse.

Pull requesten har også en isoleret Chromium-browsertest i GitHub Actions med syntetiske data. Den gemmer skærmbilleder af desktop, mobil og fanen *Viden & skills*, som bør gennemgås, før der oprettes et release-tag. Playwright er kun en CI-afhængighed.

---

## Historik: v4.3 og tidligere

## Nyt i v4.3: Discord som ekstra samtalekanal

Du kan nu skrive direkte til din egen JARVIS-bot fra Discord på iPhone eller Windows. Discord-beskeder bruger samme AI-samtale, lister og gemte historik som tekstchatten i JARVIS. Den eksisterende stemmechat og kodeagent er uændrede.

1. Opret og invitér en Discord-bot via Discord Developer Portal. Slå **Message Content Intent** til på bot-siden. Brug en privat server.
2. Åbn JARVIS i browseren og gå til **Indstillinger → Discord**.
3. Indsæt **Bot Token** (ikke Application ID), **dit eget Discord User ID** og eventuelt **Server ID** fra din private server. Slå **Discord-bot aktiv** til og klik **Gem og forbind Discord**.
4. Status skal skifte fra `Forbinder` til `Forbundet` – opdater indstillingsfanen efter et par sekunder. Send så en DM til botten, fx `Hvad står der på min indkøbsliste?`. For at tale med botten i din private server kræves Server ID i indstillingerne.

Botten afviser beskeder fra andre bruger-ID'er og fra ikke-tilladte servere. Hvis du ikke indtaster Server ID, tillades kun DM. Tokenet gemmes lokalt i `data/private-settings.json` og returneres aldrig til browseren. Et tomt tokenfelt ved senere redigering bevarer det gemte token. Slå botten fra ved at fjerne markeringen og gemme. Del aldrig tokenet eller `data/private-settings.json`.

**Opgradering fra v4.2:** Stop JARVIS, lav backup af installationen, pak v4.3 ud i en **ny mappe**, og kopiér din gamle `.env` og **hele** `data/` til den nye `jarvis-starter`-mappe. Bevar samme `JARVIS_PROJECT_ROOT`, så D&D-projektet og backupmapperne ikke flyttes. Kør `npm start`; kør **ikke** setup igen. Din Tailscale HTTPS-adresse kan fortsætte uændret, når porten er den samme.

**Bemærk:** Windows skal være tændt, og JARVIS skal køre for at svare. Beskeder sendes via Discords servere – brug ikke botten til fortrolige klientoplysninger eller passwords. Discord tilbyder ikke her direkte stemmesamtaler; eksisterende JARVIS-webstemmen bruges fortsat. Der er endnu ikke tilføjet selvstændig booking eller eksterne køb via Discord.

## Nyt i v4.2: Mere personlig og proaktiv

**Command Center** på forsiden viser seneste gennemførte morgenrapport, dokumenterede ændringer fra overvågninger, næste planlagte researchopgaver, seneste projektstatus, nye indbakke-beskeder, godkendelser og kommende vigtige datoer. Alle opfordringer om at følge op henviser til konkrete gemte poster eller opgavehistorik. Ingen automatiske bookinger eller betalinger er aktiveret.

Den nye fane **Noter & lister** indeholder:

- Vigtige datoer og fødselsdage (med valgfri årlig gentagelse)
- Gaveidéer med beskrivelser, butikslinks og budgetnoter
- Indkøbslister med afkrydsning
- Frie noter og almindelige lister

Du kan oprette, omdøbe og arkivere en samling og tilføje, rette, krydse af eller slette punkter. Data gemmes i den eksisterende `data/state.json` og indgår i JARVIS' kontekst i almindelige samtaler, stemmesamtaler, research og kodeprojekter.

**Tale:** Fx "JARVIS, opret en indkøbsliste til weekenden og tilføj havremælk", "Hvad har jeg noteret om gaveidéer?", "Husk at mors fødselsdag er 11. november, hvert år" eller "Markér havremælk som købt". JARVIS kan bruge funktionskald til at læse og vedligeholde lister. Tekstchat bruger samme funktioner. Gem kun private oplysninger, du har tillid til at sende i modellens samtalekontekst – ikke adgangskoder, CPR-numre eller fortrolige kundedata.

**Proaktive påmindelser:** Når Windows-serveren kører, tjekker JARVIS cirka hvert 15. minut for kommende datoer. Ved en ny begivenhed inden for syv dage lægges en faktabaseret påmindelse i indbakken; der kan komme en ny, når der er én dag tilbage eller på selve dagen. Det logges, så samme begivenhed ikke gentages for hvert tjek. Under **Indstillinger** kan funktionen slås fra. Påmindelserne sender *ikke* automatisk personnavne eller fødselsdage til Pushover. Serveren skal være tændt, indtil vi flytter til skyen.

**Opgradering fra v4.1:** Stop serveren, lav en kopi af din v4.1-installation, pak v4.2 ud i en *ny* mappe, og kopier `.env` og hele `data/` derover. Hold `JARVIS_PROJECT_ROOT` uændret, så D&D-projektet bevares. Kør `npm start`. Genindlæs siden på Windows/iPhone. Kør ikke `npm run setup` igen.

## Nyt i v4.1: Dashboard med faner

- **Overblik:** Samtale og stemmechat samt antal nye beskeder, godkendelser, opgaver, kodeprojekter og seneste opgaveresultat.
- **Opgaver:** Skemalagte researchopgaver, overvågninger, test og sletning fra den aktive liste. Sletning arkiverer opgavehistorik lokalt.
- **Projekter:** Kodeprojekt, kodeagent og **Arkivér projekt**. Projektets filer flyttes til den skjulte mappe `.jarvis-archive` under den eksisterende projektrod, og **Gendan** kan flytte projektet tilbage. Arkivering er ikke permanent sletning. Bevar arkivmappen ved backup/migration.
- **Sekretær:** Skills-dokument, fælles hukommelse, indbakke, godkendelser og rapportskabeloner.
- **Indstillinger:** Gem daglig researchgrænse, JARVIS HTTPS-adresse, Pushover-nøgler og varige præferencenoter direkte i browseren. Push-nøgler vises aldrig efter lagring; de gemmes i `data/private-settings.json` med begrænsede filrettigheder. Gem også denne fil ved backup.

Ved opgradering fra v4: Stop serveren, behold en backup, pak **v4.1** ud i en ny mappe, og kopier `.env` samt hele `data/` over. Behold nøjagtig samme `JARVIS_PROJECT_ROOT` i `.env`, så de eksisterende D&D-projekter fortsætter. Kør `npm start` og opdater browseren på både Windows og iPhone. Kør **ikke** setup igen.

**Sikkerhed:** API-nøglen, JARVIS login-token, serveradresse og tilladelsen til at installere tredjepartspakker kan ikke ændres fra browseren. De kræver fortsat serveradministration, så en kompromitteret websession ikke kan give sig selv større rettigheder. Pushover er den eneste eksterne tjeneste, hvis nøgler kan angives i browseren; de bruges kun til notifikationer.

Din private JARVIS med dansk tekst- og stemmechat, **skemalagte rapporter, overvågninger, fælles hukommelse, indbakke, godkendelseskø** og projektværksted med separate lokale kodeprojekter.

## Opgradering fra v3.1 – behold din eksisterende installation

**Lav en kopi, før du ændrer noget.**

1. Stop v1 i PowerShell med `Ctrl+C`.
2. Kopiér hele den gamle `jarvis-starter`-mappe til en backup, fx `JARVIS-backup-v3-1`.
3. Pak v4 ZIP-filen ud i **en ny mappe**, fx `JARVIS-v4`. Åbn dens `jarvis-starter`-undermappe.
4. Kopiér **kun** filen `.env` og mappen `data` fra din gamle installation til den nye. De indeholder dine indstillinger, din private adgangskode, samtalehistorik og præferencer. Behold eventuelt en kopi af `persona.md`, hvis du har tilpasset den.
5. Åbn PowerShell i den nye `jarvis-starter`-mappe og kør:

   ```powershell
   npm start
   ```

6. Åbn den **samme** JARVIS HTTPS-adresse fra Tailscale på din iPhone. Tailscale Serve behøver normalt ikke ændres, når v3 stadig lytter på `127.0.0.1:8787`.
7. Kontrollér, at den gamle samtalehistorik vises, og at sektionen **Sekretær & hukommelse** er synlig.

**Kør ikke `npm run setup` igen ved opgraderingen.** Det kan ændre din opsætning. Del aldrig `.env` eller dens adgangskoder.

**Eksisterende kodeprojekter:** Lad `JARVIS_PROJECT_ROOT` i `.env` pege på den **samme** projektrod som i v3. Kopiér ikke projektmapper ind i den nye installationsmappe. Bevar også `data/project-backups` fra v3.

## Nyheder i v4: Din personlige sekretær

### 1. Skills-dokument og morgenrapport

1. Åbn **Sekretær & hukommelse → Skills-dokument**. Redigér de faste instruktioner, eller importér en egen `.md`-fil. Klik **Gem skills-dokument**. Du kan også eksportere dokumentet til Markdown.
2. Klik **+ Morgenrapport**. JARVIS udfylder en relevant skabelon til AI, cybersikkerhed, IT-revision og Norden, som du frit kan rette.
3. Vælg et **dansk klokkeslæt**, fx 07:30, og opret opgaven. JARVIS beregner næste køretid i tidszonen Europe/Copenhagen, så den følger normalt dansk sommer-/vintertid.
4. Når rapporten er færdig, finder du den både under **Baggrundsopgaver** og i din **Indbakke**.

### 2. Løbende overvågning og gaveidéer

1. Klik **+ Prisovervågning** eller **+ Gaveidéer**.
2. Angiv et præcist produkt med variant og link, eller beskriv modtager, budget og interesser for gaveidéer.
3. Vælg dagligt klokkeslæt eller gentagelse. JARVIS forsøger at sammenligne nyt resultat med seneste observation.
4. Ved et rapporteret `NO_CHANGE` oprettes ingen ny indbakke-besked. Andre resultater oprettes som besked. Tjek kilderne: AI-baseret webresearch er ikke en verificeret prisscraper, og produkter kan være udsolgt eller have ændret pris mellem kontrollerne.

**Vigtigt:** De eksisterende opgaver arbejder, så længe Windows-serveren kører og har internet. De kører ikke, når Windows sover/slukkes. Det ændrer vi ved den efterfølgende cloudmigration.

### 3. Hukommelse på tværs

Feltet **Hvad skal JARVIS huske?** gemmer eksplicitte punkter. De bruges i almindelige samtaler, stemmesamtaler, research og kodeforslag. Punkterne kan fjernes med **Glem**. Du kan også sige med stemmen: `JARVIS, husk at jeg foretrækker ...`. Gem ikke fortrolige kundedata eller adgangskoder.

Samtalehistorikken er fortsat begrænset, og dette er en **redigerbar langtidshukommelse**, ikke automatisk indeksering af alle gamle samtaler eller alle projektfiler. Den kan udvides med dokumentindeksering senere.

### 4. Kode og test

Projektværkstedet fra v3.1 er videreført: separate mapper, kodegenerering, versionsbackup, Docker-baserede tests og op til to fejlretningsforsøg. Projektets relevante fælles hukommelse sendes med til modellen.

### 5. Godkendelseskø for kommende browserautomation

JARVIS kan **forberede** en booking, et køb eller en besked via stemmen og vise den under **Handlinger til godkendelse**. Der kan du godkende eller afvise forslaget. En godkendelse får den tydelige status `approved_not_executed` og **udfører intet eksternt**. Før vi tilføjer en rigtig browseradapter, skal den kræve særskilt bekræftelse af konkret modtager, beløb og vilkår umiddelbart før afsendelse. Ingen automatisk betaling eller booking er implementeret endnu.

### iPhone-push (valgfrit)

V4 har en integration til Pushover, men den kræver din egen Pushover-konto og to nøgler i `.env`:

```ini
PUSHOVER_APP_TOKEN=DIN_APP_TOKEN
PUSHOVER_USER_KEY=DIN_USER_KEY
JARVIS_HTTPS_URL=https://DIN-PRIVATE-TAILSCALE-ADRESSE
```

Genstart, og brug **Test iPhone-push**. Uden disse oplysninger er resultaterne stadig tilgængelige i JARVIS-indbakken. Del ikke nøglerne i chatten. Pushover er en separat tredjepartstjeneste og kan kræve en app-licens efter prøveperioden.

## Nyhed i v3.1: Isoleret test og automatisk fejlrettelse

JARVIS prøver nu at teste kodeprojekter efter hver udviklingsrunde. Ved en reel testfejl kan den sende testloggen til modellen og forsøge **højst to selvstændige rettelser**, hvorefter den tester igen. Den viser status under projektet:

- **Bestået**: De tests, som faktisk fandtes og kunne køres, bestod.
- **Fejlet**: Isoleret test fandt en fejl. Se loggen og eventuelle rettelser.
- **Docker mangler**: Ingen projektkode blev udført; skrivningen er stadig gemt.
- **Kun statisk indhold**: Der var ikke automatisk eksekverbare tests. HTML/CSS skal kontrolleres i browseren.

### Opsæt Docker Desktop på Windows

1. Hent og installér [Docker Desktop fra Docker](https://docs.docker.com/desktop/setup/install/windows-install/). Vælg Linux-containere, som normalt kører med WSL 2. Følg deres aktuelle krav til Windows-version, WSL og virtualisering.
2. Start Docker Desktop og vent på, at motoren er klar.
3. Åbn PowerShell og prøv:

   ```powershell
   docker version
   ```

4. Hent de to faste test-images manuelt:

   ```powershell
   docker pull node:22-alpine
   docker pull python:3.12-alpine
   ```

5. Start JARVIS v3.1 med `npm start`. Åbn projektet **D&D Character Manager**, og tryk **Test isoleret**. Status bør vise resultatet; ved manglende unit tests giver JARVIS kun syntakskontrol.

**Ingen Docker?** JARVIS kan stadig oprette og videreudvikle projekter, men status bliver `Docker mangler`. Den afvikler **aldrig ukendt projektkode direkte på Windows som fallback**.

### Hvad testcontaineren må

- Projektets tilladte tekstfiler kopieres til en ny midlertidig mappe; originalen monteres aldrig i containeren.
- Netværk er slået fra (`--network none`), projektkopien er skrivebeskyttet, og containeren kører med droppede kapabiliteter, uden nye privilegier samt CPU-, hukommelses-, proces- og tidsgrænser.
- Ingen `.env`, API-nøgler, Docker-socket eller øvrige mapper monteres i containeren.
- JavaScript/JSON testes i Node-containeren, og eventuelle `*.test.js` køres med `node --test`. Python testes i en særskilt Python-container med syntakskontrol og `unittest`, hvis der findes relevante tests.
- Containeren fjernes efter testen. Docker er en stærk afgrænsning, **ikke en absolut sikkerhedsgaranti**; kør ikke ukendte privilegerede containere eller brug denne funktion til fjendtlig kode.
- Der køres **ingen** `npm install` eller shellkommandoer fra modellen inde i testmiljøet. Projektets egne afhængigheder kan derfor give testfejl, indtil vi udvider miljøet kontrolleret.

### Hvad der endnu ikke testes

En succesfuld syntakskontrol betyder ikke, at D&D-appen fungerer korrekt i browseren. HTML-layout, klikflows, localStorage, netværksintegrationer, performance og sikkerhed kræver yderligere tests. Næste skridt kan være automatiserede browsertests i samme isolerede arkitektur.

## JARVIS v3 – separate kodeprojekter

1. Stop serveren. Åbn `.env` i Notesblok og tilføj gerne **en fast, separat mappe**, eksempelvis:

   ```ini
   JARVIS_PROJECT_ROOT=C:\Users\DIT_BRUGERNAVN\Documents\JARVIS-Projects
   ```

   Erstat `DIT_BRUGERNAVN` med dit Windows-brugernavn; opret mappen i Dokumenter, hvis den ikke findes. Brug en **ny dedikeret mappe**, ikke Dokumenter-roden, din profilmappe eller en mappe med eksisterende filer. Hvis du ikke angiver en sti, oprettes `JARVIS-Projects` ved siden af installationsmappen; flyt eller sikkerhedskopiér denne projektrod ved senere opgraderinger.
2. Start igen med `npm start`.
3. I **Projektværksted**, opret et projekt, fx **D&D-karakterbog** med beskrivelsen `En simpel webapp til at gemme D&D-karakterer, klasser, level og udstyr i browserens lokale lager`.
4. Tryk **Byg projekt**. JARVIS genererer automatisk filer inde i den nye projektmappe.
5. Tryk **Se projektfiler** for at læse resultatet. Du kan åbne projektmappen i Windows Stifinder og forhåndsvise en simpel `index.html` lokalt. *Bemærk:* Kode med moduler/API'er kan kræve en udviklingsserver.
6. Skriv et nyt ønske under projektet og tryk **Videreudvikl**. Kun det valgte projekts filer må ændres.
7. Du kan vælge **Fortryd seneste kodeændring**, hvis filerne ikke siden er ændret uden for JARVIS. Kopier af ændrede filer opbevares under `data/project-backups`.

Du kan også tale til JARVIS: `Opret et kodeprojekt, der hedder D&D-kortgenerator` og derefter `Byg den første version af projektet`. Stemmen skal bruge projektets ID fra listen. Store kodegenereringer kan tage så lang tid, at en aktiv stemmeforbindelse afbrydes; brug da Projektværksted på iPhone eller Windows.

### Installation af npm-pakker

Genereret kode kan foreslå npm-pakker, men JARVIS **installerer dem aldrig automatisk**.

Hvis du vil aktivere installation i *projektmapper*:

1. Overvej risikoen: tredjepartspakker kan indeholde skadelig kode. Vælg kun pakker, du har undersøgt.
2. Tilføj `JARVIS_ALLOW_NPM_INSTALL=yes` til `.env` og genstart.
3. JARVIS viser de ønskede pakkenavne under projektet. Læs navnene og godkend hver samlet installation med knappen **Godkend npm-installation**.
4. Installationen bruger `npm install --ignore-scripts --no-audit --no-fund --save-exact` uden shell, inde i projektmappen. `--ignore-scripts` begrænser installationshooks, men gør **ikke** en pakke sikker at køre. Der udføres ingen genereret kode automatisk.

### Begrænsninger

- Hvert projekt har sin egen mappe under `JARVIS_PROJECT_ROOT`. Oprettede filer må kun have tilladte tekst/code-filendelser og sikre relative stier.
- Maksimalt 12 ændrede filer pr. udviklingsrunde og 30 projekter.
- JavaScript kontrolleres for syntaksfejl, og JSON valideres før skrivning. Det er **ikke fuld funktionstest**.
- Agenten kan ikke køre shellkommandoer, installere programmer uden godkendelse, læse øvrige mapper eller selv offentliggøre løsninger.
- Projekter er ikke automatisk sandboxede, hvis du selv åbner/kører deres genererede kode. Gennemse filerne først, især hvis de indeholder scripts eller netværkskald.
- Der er endnu ingen automatisk udviklingsserver, Git-integration, funktionstest eller løbende autonom kodeiteration. Det kan vi bygge i næste etape med isoleret eksekvering.
- `JARVIS_PROJECT_ROOT` og projektmetadata (`data/state.json`) skal begge sikkerhedskopieres. API-nøgler og adgangskoder må ikke kopieres ind i kodeprojekter.

## Ny installation

1. Installér Node.js 22.6+ og få en OpenAI Platform API-nøgle med adgang til Responses, web search og Realtime API. API-forbrug afregnes særskilt fra et ChatGPT-abonnement.
2. Pak ZIP-filen ud og åbn PowerShell i `jarvis-starter`.
3. Kør `npm run setup`, og åbn `notepad .env`.
4. Erstat pladsholderen `REPLACE_WITH_YOUR_OWN_KEY` efter `OPENAI_API_KEY=` med din nøgle. Behold `JARVIS_ACCESS_TOKEN`.
5. Kør `npm start`, og åbn `http://127.0.0.1:8787` på Windows. Log ind med værdien fra `JARVIS_ACCESS_TOKEN`.
6. Opsæt privat Tailscale Serve HTTPS til `http://127.0.0.1:8787`, og åbn HTTPS-adressen på iPhone. Brug Safari **Del → Føj til hjemmeskærm**.

Serveren er som standard kun tilgængelig på localhost. Åbn ikke port 8787 offentligt på internettet.

## Opgaver i v2

1. Åbn **Baggrundsopgaver** på Windows eller iPhone.
2. Udfyld titel og tydelig research-instruktion, fx `Undersøg 5 restauranter omkring Kongens Nytorv med pris og bookinglinks til fredag aften`.
3. Vælg **Kør snarest** eller et tidspunkt. Gentagelse er valgfri: hver time, hver 6. time, dagligt eller ugentligt.
4. Tryk **Opret opgave**. JARVIS udfører opgaven på serveren i baggrunden og gemmer resultatet i `data/state.json`.
5. Se status og resultat i opgavekortet, eller sig i en **aktiv stemmesamtale**: `JARVIS, opret en daglig researchopgave om ...` eller `Hvilke opgaver har jeg?`.

**Bemærk:** Almindelig tekstchat i v2 kan tale *om* opgaver, men opretter dem ikke automatisk. Brug opgaveformularen eller stemmesamtalens værktøj. Stemmeværktøjernes funktion afhænger af Realtime-modellens understøttelse.

## Kodeagent: selvforbedringer med godkendelse

1. Åbn **Kodeagent** i JARVIS på Windows eller iPhone.
2. Vælg en fil: personlighed, design, layout eller brugerfladens JavaScript.
3. Beskriv en lille, præcis forbedring, fx `Gør opgavekort mere kompakte på iPhone og bevar alle funktioner`.
4. Klik **Foreslå kodeændring**. Agenten genererer en komplet erstatning for den valgte fil. Du kan gennemse originalen og forslaget side om side i to kodefelter.
5. Kontrollér ændringen nøje. Tryk **Godkend og installér**. Agenten gemmer en backup i `data/code-backups/` og skriver den nye fil lokalt.
6. Genindlæs siden for UI-filer. Ændringer til `persona.md` kræver genstart af `npm start`.
7. Hvis resultatet er forkert, vælg **Fortryd installation** ved forslaget. Funktionen virker, så længe filen ikke er ændret siden installationen.

**Sikkerhedsgrænser:** Kodeagenten har ikke shelladgang, kan ikke skrive til `.env`, `data/` eller serverkode og kan ikke installere programmer. Den kan kun redigere fem eksplicit tilladte UI/persona-filer. JavaScript kontrolleres for syntaksfejl før installation, men funktionel korrekthed og sikkerhed er ikke garanteret. Læs altid ændringerne selv. Alle kodeforslag og filindhold sendes til din OpenAI API-model, når du beder om et forslag.

Dette er første skridt mod selvopdatering. En senere version kan få afgrænsede projektmapper, tests, Git og et separat, godkendt deploymentsystem. **Ingen uovervåget selvopdatering er slået til.**

### Næste skridt

Mere selvstændig udvikling: sikker testkørsel i en isoleret proces/container, Git-historik, oprettelse af lokale previews og godkendt deployment. I denne version er filgenerering automatisk, men kodeafvikling sker ikke automatisk.

### Grænser og økonomi

- Standard: maks. **10 startede baggrundskørsler pr. UTC-døgn**, på tværs af opgaver. Justeres med `JARVIS_MAX_RUNS_PER_DAY=5` i `.env` og genstart.
- Opgaver sættes i kø og køres én ad gangen. Serveren kontrollerer planen cirka hvert 15. sekund.
- Interval: mindst 60 minutter og højst 30 dage; højst 100 ikke-arkiverede opgaver.
- Hvis pc'en er slukket eller sover, starter nye opgaver **ikke**, før serveren kører igen. Ved opstart behandles forfaldne opgaver, underlagt dagsgrænsen.
- Resultater opdateres i brugerfladen, når siden er åben. **Ingen push-notifikationer** endnu.
- Baggrundsundersøgelser bruger en særskilt, betalt OpenAI API-kørsel med web search. Overvåg dit API-forbrug i Platform.
- Standardmodellen vælges med `OPENAI_TASK_MODEL` i `.env`; ellers anvendes `OPENAI_TEXT_MODEL` eller standardmodellen. Vælg en model med understøttelse af background mode og web search.
- Hvis en model eller et værktøj ikke er aktiveret på din API-konto, vises fejlen i opgavens resultat. Tryk **Kør nu** for at prøve igen.

## Hvad v2 kan og ikke kan

**Kan:** Chatte, tale, huske præferencer og historik, oprette opgaver fra stemmen, planlægge gentaget research, søge efter aktuel information, gemme resultater og foreslå samt installere godkendte UI-ændringer.

**Kan ikke endnu:** Booke restauranter, købe noget, sende beskeder, ændre vilkårlige kodeprojekter eller backend/serverkode, arbejde uden tændt Windows-server eller sende automatiske push-beskeder uden særskilt Pushover-konfiguration. Besøg af hjemmesider og eventuelle links i resultater skal du selv kontrollere før brug.

**Vigtigt om privatliv:** API-nøglen bliver på Windows-serveren. Appens separate adgangskode gemmes i browserens lokale lager. Samtaler, noter og opgaver gemmes ukrypteret i `data/state.json`; OpenAI modtager indholdet ved API-kald. Brug ikke fortrolige arbejdsdokumenter eller kundedata i opgaver uden passende godkendelse.

## Drift

For at køre JARVIS efter genstart: start PowerShell i mappen og kør `npm start`. Undgå Windows dvaletilstand, hvis du ønsker planlagte opgaver udført. En Windows Scheduled Task ved login kan automatisere serverstart; vælg et separat system/service-setup, før du forsøger at gøre maskinen døgnåben. En senere privat cloudserver kan levere reel 24/7 drift.

Funktionerne kræver Node.js og netadgang. Test lokalt med `npm test`. Ved problemer: se PowerShell-vinduet, kontrollér `.env`, Tailscale-forbindelsen og API-kreditter. **Send aldrig API-nøglen til nogen ved fejlfinding.**
# JARVIS v4.4 – Smart Home (forberedelsesversion)

Denne version viderefører v4.3 og tilføjer en **Smart Home**-fane, en statussektion på forsiden, hændelseshistorik, en test-dørklokke og en første Sonos Cloud Control API-adapter.

**Det virker nu:** UI, sikker lagring af Sonos-token i `data/private-settings.json`, indlæsning af Sonos-grupper og afspilningskommandoer, når et gyldigt OAuth access token og household-ID er oplyst, samt lokal registrering af simulerede hændelser. Sonos-API-kald kræver internet, gyldige tilladelser og korrekt enhedsopsætning; ingen fysisk enhed er testet endnu.

**Ikke klar endnu:** Google Home-enhedsadgang, Nest-/dørklokke-notifikationer, Sonos OAuth-login/automatisk tokenfornyelse, Spotify-søgning/playlistvalg og Discord-push fra Smart Home-hændelser. Disse kræver konkret enhedsmodel, autorisationsflow og yderligere implementering. Testhændelser er tydeligt mærket SIMULERET og kan ikke forveksles med en aktiv dørklokkeforbindelse.

**Opgradering:** Stop v4.3, lav backup, udpak v4.4 i en ny mappe, kopiér `.env` og hele `data/` fra v4.3, behold `JARVIS_PROJECT_ROOT`, start med `npm start`. Kør ikke setup igen. Kontrollér Smart Home-fanen og klik "Test dørklokke-hændelse". Ingen handlinger på låse, alarmer eller sikkerhedsfølsomme systemer er tilladt.

---

## JARVIS v4.6 – Cloud Operations (staging-release)

Version 4.6 tilføjer **System Health**, en **Auto-Update Manager** og **proaktive Discord-direktebeskeder**. De eksisterende noter, opgaver, projekter, Hue- og Sonos-indstillinger videreføres uændret.

- **System Health** viser JARVIS-proces, hukommelse, disk, Discord og seneste backup-service-status. Det er diagnosticering, ikke en ekstern overvågningstjeneste.
- **Discord-notifikationer** er fravalgt som standard. Ejeren kan slå dem til i indstillingerne. JARVIS sender kun til den konfigurerede ejers private Discord-DM, eksempelvis ved afsluttede/fejlede opgaver, påmindelser og nye versioner. Discord-bottens DM-indstillinger skal tillade beskeder.
- **Auto-Update Manager** finder nye `vX.Y.Z`-tags fra et privat GitHub-repository via SSH, downloader den præcise version til separat staging, kontrollerer commit-SHA og kører tests i en isoleret Docker-container uden netværk. Brugeren kan derefter godkende versionen. En **separat root-ejet deployment-service** kan, når den er installeret manuelt og afprøvet, aktivere en godkendt release med backup, healthcheck og rollback. Webprocessen har ikke sudo- eller systemd-rettigheder.

Se [V46_DEPLOYMENT.md](V46_DEPLOYMENT.md) for opsætning på Ubuntu, sikkerhed og begrænsninger. Tidligere README-afsnit dokumenterer oprindelige Windows-versioner og skal læses som historik.

---

# JARVIS v4.5 – Philips Hue + Google Nest-forberedelse

Denne komplette opgradering bygger videre på v4.4 og bevarer Discord, noter/lister, kodeprojekter og den eksisterende Sonos-adapter.

**Hue er implementeret:** lokal HTTPS-kommunikation til Hue Bridge (API v2), parring via Bridges fysiske linkknap, privat lagring af Hue-nøgle, TLS-certifikat-fastlåsning efter første godkendte parring, oversigt over Hue-rum/zoner, tænd/sluk, lysstyrke og aktivering af gemte scener. Tekst- og stemme-JARVIS kan også udføre Hue-handlinger, hvis brugeren konkret beder om det. JARVIS-serveren skal være på samme LAN som Hue Bridge. Brug den lokale IPv4-adresse fra Hue-appen eller routeren. Første parring er trust-on-first-use: udfør den kun på et netværk, du stoler på; skift af certifikat kræver manuel kontrol og genopsætning. Ingen bred deaktivering af TLS-verifikation foretages.

**Opsætning af Hue hjemme:** Smart Home → Indstillinger → Hue Bridge IP → Gem. Tryk på den store fysiske knap på Hue Bridge, og vælg "Par med Hue Bridge" inden 30 sekunder. Herefter kan du opdatere rum og aktivere scener. Gem ikke en lokal Bridge-IP som en cloud-adresse: dette kræver et lokalt netværk.

**Nest er ikke forbundet endnu:** Google Nest-dørklokker kan bruge Google Device Access / Smart Device Management API. Det kræver en personlig Google-konto, Device Access-registrering (Google oplyser et engangsgebyr på US$5), et Google Cloud-projekt, OAuth og et Pub/Sub-emne med abonnement. Eksisterende Google-hostede Pub/Sub-emner skal migreres til egne inden 30. november 2026. Når brugerens præcise Nest-model og godkendelser er kendt, kan vi tilføje faktisk ringetryk og Discord-notifikationer. Ingen automatiseret dørlåsning, alarmændring eller kamerastream er aktiveret. Den eksisterende dørklokke-test er stadig simuleret.

**Opgradering:** Stop v4.4, lav backup, udpak v4.5 i ny mappe, kopiér `.env` og `data/`, og start `npm start`. Kør ikke setup igen. Efter opgraderingen kan Hue parres senere; resten af JARVIS virker uden tilsluttede hjemmeenheder.

---

