# Underprocesser, projektpakker og lokale tests

Denne kodegennemgang er en sikkerhedsrettelse til A2/A3, I5, J6 og R06. Den er **ikke dokumentation for en brugerhændelse**. Ingen reelle npm-installationer, Docker-tests, eksterne kald eller nye driftsrettigheder blev aktiveret ved implementeringen. Kode-/kontrakttests bruger syntetiske filer og procesdobler; en virkelig Node-proces bruges kun til at bevise parse-only og miljøfiltrering.

## Afgrænsning og ændret kompatibilitet

| Sti | Kontrakt |
|---|---|
| CodeAgent / ProjectAgent syntakskontrol | `node --check` udfører ikke projektkoden. Arvet `NODE_OPTIONS`, `NODE_PATH`, credentials, proxy- og loaderopsætning følger ikke med. Kontrollen har tids- og outputgrænser. Den er ikke en funktionstest eller en sandbox, som kan køre brugerprogrammer. |
| Projekt- og release-tests | Docker-konteksten læses lokalt én gang. Kun `unix:///…` og lokale Windows named pipes accepteres; TCP/SSH/ukendt kontekst afvises. Alle efterfølgende Docker-kald bindes til samme `--host`. Containeren er fortsat uden netværk, read-only, uden capabilities, med begrænsede ressourcer og uden værtsmiljø/secrets. Timeout-oprydning må kun ramme denne kørsel, identificeret med et unikt containernavn. |
| Npm-pakker | Den tidligere ulåste `npm install`-sti er erstattet af en reviewet `npm ci --ignore-scripts`-sti. Der kræves almindeligt manifest, lockfileVersion 3, fuldstændig offentlig dependency-graf, SHA-512-integritet og eksakt godkendt direkte pakkesæt. Dette er en **synlig kompatibilitetsændring**, ikke en bagudkompatibel installation af vilkårlige npm-projekter. |
| Driftsdiagnostik | Det faste `systemctl show`-kald har filtreret miljø, tre sekunders frist og begrænset output. Det læser kun servicestatus; ingen start, restart eller ændring af rettigheder. |
| Root-deployer / øvrig drift | Ingen sudo-, Docker-gruppe-, root-script- eller serviceændringer. Root-deployeren kræver fortsat særskilt administratorreview. Git-opdateringens eksisterende, konfigurerede SSH-adgang ændres ikke af denne slice. Nemlig beholder sit snævre eksisterende miljø og tool-allowlist. |

Et lokalt socketnavn beviser transporttypen, ikke hvem der ejer daemonen eller om en administrator har etableret en proxy bag socketen. Installerede CLI-binærer, lokale Docker-konfigurationer og images skal stadig være administratorgennemgåede. Der er ingen host-fallback, automatisk image-download eller automatisk oprettelse af Docker-adgang.

Release-staging kontrollerer desuden `lstat`/`realpath` for hele stagingforældrestien **før** der oprettes undermapper eller køres clone. Checkoutroden, `jarvis-starter`, `package.json` og hele testtræet må ikke indeholde symbolske links. Kontrollen gentages før metadata læses, umiddelbart før Docker bind-mount og efter testen, før evidens gemmes. Den normale metadatareader bruger no-follow, inode-/ændringskontrol og en 128 KiB-grænse. Testtræet afgrænses til 20.000 poster og 32 niveauer. En symlinkbaseret konfiguration skal gennemgås og pege på en almindelig, kanonisk stagingmappe; den omgås ikke automatisk. Dette er ikke en atomisk filesystem-snapshot eller et værn mod en kompromitteret administrator, der ændrer navnerummet mellem systemkald.

Det konkrete manglende pathværn er reproduceret syntetisk **før rettelsen**: den nye suite havde fem forventede afvisninger, som udeblev, mens normalflowet bestod. Efter rettelsen består både de uændrede adversarial betingelser og normalflowet. Det er kode-/kontraktevidens, ikke en påstand om læste produktionsdata eller en tidligere hændelse.

Git-kontrollen omfatter nu både ikke-sporet **og ignoreret** checkoutinput (`status --porcelain --untracked-files=all --ignored=matching`) efter checkout, umiddelbart før bind-mount og efter testen. HEAD kontrolleres samme steder. Selv en almindelig ignoreret `data/extra.test.mjs` må ikke nå mount eller blive til gyldig testevidens. Der slettes ikke automatisk input for at gøre kontrollen grøn; brug en frisk checkout. En lokal syntetisk Git-repositorytest viser, at den gamle statuskommando skjuler netop filen, mens det nye værn afviser den. Ingen eksterne Git-kald er nødvendige for beviset. Den før/efter-kontrol er fortsat ikke et atomisk snapshot mod samtidige værtsændringer.

## Updaterens lokale transaktioner og recovery

`update-state.json` bruger nu samme `DurableState`/`atomicStateWrite`-kontrakt som den øvrige lokale lagring: kun committed snapshots er synlige, hele lokale ændringer serialiseres, hver skrivning har unik tempfil, fil-fsync, atomisk rename og directory-fsync. En læser får en uafhængig kopi og kan ikke ændre staged/approved i lageret. Updaterens eget `updateStateSchemaVersion: 1` er adskilt fra appens dataskema; nyere ukendte versioner afvises uden omskrivning. Denne grænse forudsætter én updaterproces som skriver, ikke samtidige uafhængige administratorwriters.

Git-, checkout- og Docker-ventetid ligger **uden for** den korte lokale commitkø. `checkOperation` og `stageOperation` gemmer operationens ID, udfald, tider og relevant version/SHA. Samtidige versionskontroller deler én igangværende læsning; en anden staging starter ikke et konkurrerende testforløb. Nye stagingforsøg nulstiller tidligere test/godkendelse i et varigt startcheckpoint, før ekstern kode kan køre. Ved slutningen skal både operations-ID og stadig aktuel version/SHA matche. En ny versionskontrol under testen må ikke få gammel test dokumenteret som den nye kandidat.

HTTP-reviewet sender den viste version og SHA til staging og den viste SHA til godkendelse. Domænet sammenligner igen **inde i transaktionen**, så en anden sessions nye SHA under samme tag afvises. Ældre direkte interne kald uden det valgfrie reviewfelt bevarer den eksisterende versionsbinding; et faktisk sendt forkert eller mangelfuldt felt ignoreres ikke. En gentaget, allerede kendt identisk godkendelse er en no-op, ikke et nyt samtykke.

- Fejl **før rename** efterlader den tidligere committed tilstand. En fejlet godkendelse er hverken synlig eller kan blive gemt senere af en almindelig versionskontrol. Den oprindelige diskfejl rapporteres; den omklassificeres ikke til en Git-/testfejl eller forsøges gemt igen som succes.
- Fejl **efter rename** kan betyde, at den nye godkendelse allerede ligger på disk. Den publicerede snapshot beholdes derfor, men `publicationUnknown: true` og `storage.ready: false` gør udfaldet eksplicit ukendt. Alle nye updaterændringer og eksterne kald afvises indtil en ny proces/instans har læst den autoritative fil og gennemført fsync. Der er ingen in-process reset, automatisk rollback eller blind gentaget godkendelse.
- Et varigt `running` stagingcheckpoint efter afbrydelse bliver `unknown` ved genstart, uden genkørsel eller fabrikeret test/godkendelse. En afbrudt ren versionslæsning bliver `failed` og kan vælges igen. Ukendt testcontaineroprydning bliver ligeledes `unknown`.
- Recovery af ukendt staging kræver særskilt gennemgang af operations-ID, version/SHA, checkout og navngiven testcontainer. Med tjenesten stoppet skal en administrator bevare den aktuelle journal, verificere/afslutte den konkrete container og vælge et nyt rent staginggrundlag. Ingen mappe, godkendelse eller journal slettes automatisk. Root-deployerens installations-/rollbackkontrakt er uændret og skal fortsat reviewes og autoriseres særskilt under M7.

Fejlen med synlig godkendelse efter renamefejl og begge ignored-input-regressioner blev først kørt røde: **3/3 tests fejlede på de forventede manglende værn**. De samme assertions består efter rettelsen. Yderligere injektioner dækker pre-/postpublicationfejl, køens genopretning, snapshotisolering, version/SHA-konflikter, afbrudt staging og responsive læsninger under ekstern ventetid. Det er reproducerede kodefund, ikke dokumentation for en tidligere produktionshændelse.

## Npm-review før noget startes

`GET /api/projects/:id` tilføjer `dependencyReview` ved afventende pakker. Det er en læsning, ikke en godkendelse. Svaret indeholder status, konkrete mangler, direkte pakkesæt, manifest-/lockhash, antal låste pakker og tidspunkt. Privat `.npmrc` bliver kun opdaget; dens indhold læses ikke ind i review, prompt eller logs.

Installationsknappen skal gennemgå præcis den aktuelle projektrevision og komplette kildehash. Lockfilen er en del af kildehashen, også når den er for stor til modellens eller UI'ets afgrænsede filvisning. En udeladt fil er ikke læst eller accepteret af modellen; ejeren skal i så fald gennemgå den konkrete lokale fil separat. En SHA er identitetsbinding, ikke en vurdering af pakkens kvalitet.

UI sender `expectedRevision` og `expectedContentHash`. Den inspicerede hash valideres før preflight og igen før klargøring/publicering. Ældre interne kald uden det valgfrie hashfelt beholder stadig den fuldstændige gemte projektbinding; et sendt tomt, forkert eller forældet hashfelt ignoreres aldrig.

Den lokale preflight afviser blandt andet:

- Manglende, ugyldige, linkede eller for store manifest-/lockfiler; grænser: manifest 128 KiB, lock 2 MiB og højst 3.000 låste pakker.
- Implicit `latest`, versionsranges i direkte dependencies, dubletter og forskel mellem manifest, lock og det godkendte sæt. Alle direkte dependencies, også tidligere installerede, skal stå i det viste sæt på højst otte pakker.
- Privat registry, Git-/fil-/URL-/alias-referencer, manglende SHA-512, ufuldstændig graf, workspaces, overrides og bundles. Et privat **eget projekt** (`private: true`) med offentlige dependencies er derimod tilladt.
- `.npmrc`, `npm-shrinkwrap.json` og `yarn.lock`, som ellers kunne ændre fortolkningen. Disse filer slettes eller omskrives ikke automatisk.

Ved en manglende forudsætning er svaret `dependency-review-required` med den konkrete grund. Der er nul processtart og ingen falsk `running`/`unknown`-registrering. En slukket installationsfunktion kræver stadig et separat administratorvalg; normal kodeændring, projektinspektion og de eksisterende isolerede testfunktioner er bevaret.

## Klargør et offentligt lockgrundlag

Dette er et **fremtidigt manuelt trin efter et eksplicit valg**, ikke en del af den udførte implementeringstest:

1. Brug en særskilt, tom udviklingsmappe uden persondata, credentials, eksisterende `node_modules` eller `.npmrc`. Kopiér kun det gennemgåede `package.json`; behold præcise direkte versioner. Brug en allerede godkendt npm-installation og et miljø uden arvede credentials/preloads/proxies.
2. Opret to forskellige tomme filer, `empty-user.npmrc` og `empty-global.npmrc`, i denne reviewmappe. På Linux kan nedenstående kommando køres fra reviewmappen. Vælg en konkret godkendt PATH; brug ikke en projektmappe som binærsti. På Windows skal det tilsvarende afgrænsede procesmiljø etableres eksplicit, ikke blot den samme shellkommando kopieres.

   ```sh
   env -i PATH=/usr/local/bin:/usr/bin:/bin npm install --package-lock-only --ignore-scripts --no-audit --no-fund --workspaces=false --registry=https://registry.npmjs.org/ --userconfig=./empty-user.npmrc --globalconfig=./empty-global.npmrc --cache=./review-cache
   ```

3. Gennemgå manifest, hele lockfilen, indirekte kilder, integritet og eventuelle sikkerhedsadvarsler. Kommandoen er ikke i sig selv en sikkerhedsgodkendelse. Ret ikke integritetshashes ved at gætte eller lade en model opfinde dem. Private eller ikke-understøttede grafer kræver særskilt vurdering, ikke en omgåelse af preflight.
4. Overfør kun det gennemgåede manifest/lock til projektet og opret en ny projektrevision, så det samlede kildegrundlag og direkte pakkesæt bliver bundet igen. Gennemgå den nye status i UI. En ekstra filkopi uden ny review må ikke genbruge en gammel godkendelse.
5. Kun ejerens særskilte installationsvalg må starte klargøringen. Denne vej kører aldrig pakke-/projektscripts, `npm test`, `npm start` eller et build på værten. Pakker, der kræver installationsscripts, bliver ikke tavst gjort kompatible ved at aktivere dem.

Den officielle npm-kontrakt for [npm ci](https://docs.npmjs.com/cli/v10/commands/npm-ci/), [scriptfravalg](https://docs.npmjs.com/cli/v10/commands/npm-install/#ignore-scripts) og [konfigurationskilder](https://docs.npmjs.com/cli/v10/using-npm/config/#npmrc-files) er grundlaget for denne snævre sti. Docker-kontekster og overrides er beskrevet i [Docker-dokumentationen](https://docs.docker.com/engine/manage-resources/contexts/).

## Staging, udfald og recovery

Før klargøring journalfører ProjectAgent operations-ID, projektrevision, komplet kildehash, reviewhashes og den konkrete private stagingmappe `.jarvis-npm-<operations-ID>` ved siden af projektet. Navnet er bundet til det journalførte ID og genbruges aldrig.

Npm får kun kopier af det gennemgåede manifest og lock. Dets user/global config og cache ligger separat i staging, miljøet er filtreret, audit/fund er slået fra, og scripts er slået fra. En ny `.npmrc` i brugerprojektet kan derfor ikke skifte npm-konfigurationen under klargøringen. Npm er fortsat et administratorvalgt værktøj, **ikke en fuld proces-/filsystemsandbox**. Den låste offentlige graf og scriptfravalget er afgørende sikkerhedsgrænser; tidsgrænsen på 120 sekunder erstatter ikke disk-/ressourceovervågning.

Før publicering kontrolleres projektets kildehash samt originalernes og stagingkopiernes manifest-/lockhash igen. Kun `node_modules` publiceres; alle øvrige projektfiler bevares. Eksisterende `node_modules` flyttes først til stagingmappens `previous-node_modules`, og den nye mappe flyttes derefter ind. Den tidligere mappe slettes ikke.

- Preflightfejl: intet forsøgsjournaleret som kørende, ingen processtart.
- Fejl under klargøring eller ny kildekonflikt før publicering: `blocked`, **ingen projektpakker publiceret**. Offentlige pakker kan være hentet til staging; det må ikke beskrives som “npm blev aldrig startet”. Ingen automatisk retry. Ny eksplicit review/godkendelse kan forsøges, når grundlaget er korrekt.
- Fejl efter publicering er begyndt: `unknown` eller en varig `running`-post, som bliver `unknown` ved genstart. Intet blindt gentaget forsøg. Den gamle mappe og reviewjournalen bevares som recoverygrundlag.
- Fuldt afsluttet publicering: `completed`; tidligere testresultat nulstilles. En pakkeinstallation er ikke bevis for beståede projektfunktioner eller runtime-kompatibilitet.

To mappeflytninger er **ikke én atomisk transaktion**. Ved afbrudt publicering skal en administrator læse forsøgs-ID, `review.json`, kildehash, projektets aktuelle `node_modules` og `previous-node_modules`, og vælge enten afslutning eller tilbageførsel. En gammel mappe må aldrig gendannes hen over nye ændringer uden det eksplicitte valg. Automatisk recovery, sletning eller oprydning af disse mapper er ikke implementeret. Bevarede staging-/backupdata kræver plads og en eksplicit retention-/oprydningsbeslutning; de må ikke loves slettet.

## Faktisk syntetisk verifikation

```sh
node --test test/v5-subprocess-safety.test.mjs test/v5-npm-review.test.mjs test/v5-updater-local-sandbox.test.mjs test/v5-update-path-binding.test.mjs test/v5-updater-durability.test.mjs test/isolated-test.test.mjs test/code-agent.test.mjs test/project-agent.test.mjs test/v46-features.test.mjs test/v5-stability.test.mjs test/v5-project-review.test.mjs test/v5-project-basis.test.mjs
```

De nye tests dækker real Node parse-only/secret-filtrering, præcis Docker-endpointbinding, timeout-cleanup, sikre snapshotstier, låst dependency-graf og offentlig kilde/integritet, præflight uden spawn, disk-/kopi-/kildekonflikt, bevaret gammel pakkemappe, delvis publicering samt eksplicit nyt forsøg efter kendt ingen publicering. Docker-/npm-kørsler er procesdobler, ikke live integrationsbevis. Den relevante CI-revision, faktisk kommando/resultat og senere administrator-/runtimekontrol skal fortsat bindes i den samlede verifikation; dette dokument accepterer ikke M6 eller M7.
