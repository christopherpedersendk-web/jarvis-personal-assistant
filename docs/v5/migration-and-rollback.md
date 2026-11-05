# Migration og gendannelse – syntetisk M6 og separat produktion

M6's isolerede tests og restoreprøver er autoriseret; de anvender kun syntetiske data og separat konfiguration. **Faktisk produktion, merge/tag/release, installation og ændring af root-ejede scripts/services kræver særskilte M7-/administratorbeslutninger.** Produktionsstier fra handover er ikke verificeret servertilstand eller tilladelse til adgang.

## Datakontrakt og offentliggørelse

- Appversion5.0.0; uafhængigt hovedskema1. Eksisterende v4.9.1-state uden skemafelt er skema0.
- Før migration oprettes og synkroniseres en privat0600-kopi af de præcise gamle bytes: state.json.v4.9.1-before-v5.backup. Eksisterende backup overskrives ikke. Afvigende/afbrudt kopi eller ændrede originalbytes stopper migration.
- Derefter publiceres skema1 atomisk for den enkelte statefil. Ukendte gamle felter bevares. Ukendt nyere skema, ugyldig JSON eller symlink til en lagerfil afvises uden en tavs nulstilling.
- Unikke midlertidige filer, fil-/mappe-fsync og rename skelner kendt fejl før publicering fra ukendt varighed efter mulig publicering. Ukendt udfald spærrer nye writes og kræver kontrolleret lagerrecovery.
- Én JARVIS-proces må skrive i det samme datalager. Ingen garanti gives mod vilkårlige samtidige eksterne filredigeringer eller en atomisk to-fil-transaktion.

## Samlet recoveryinventar

En backup af state.json alene er **ikke en komplet applikationsbackup**. Administratoren skal identificere faktiske konfigurerede placeringer og sikre et konsistent, privat inventar, uden at bringe produktionshemmeligheder eller persondata ind i udvikling.

| Del | Betydning ved backup/restore |
|---|---|
| state.json og pre-v5-migrationsbackup | Domæner, revisioner, action-/job-/projektstatus og skema; bevar aktuelle og ældre bytes separat |
| private-settings.json | Privat konfiguration/credentials; hverken logs, prompts, indekser eller offentlige artifacts |
| pending-state-transaction.json, hvis til stede | Privat recoveryjournal for præcise før/efter-hashes i state/settings; kan indeholde private bytes |
| update-state.json | Separat updaterjournal, skema `updateStateSchemaVersion: 1`, med commit-/test-/godkendelsesbinding og check-/stagingudfald; skal gendannes sammen med det tilsigtede releasegrundlag |
| discord-received.json | Varig ingress/dedup og genoptagelsesgrundlag; tab kan ændre replayrisiko |
| recipe-media | Gemte originale opskriftsbilleder/materiale og forbindelser fra state |
| code-backups og project-backups | Hashbundne manifests og tidligere præcist gennemgået projekt-/kodeindhold |
| Faktisk JARVIS_PROJECT_ROOT | Separate projekter/kildefiler; ligger ikke nødvendigvis i datamappen |
| .jarvis-npm-<operations-ID> ved siden af et projekt | review.json, staging, eventuel previous-node_modules og cache for det journalførte pakkeudfald |
| Valgfrie modelassets/runtime | Faste model-/dependencyhashes og lokal konfiguration; kan genklargøres fra public pinned assets efter eksplicit valg |

Slet aldrig en pendingjournal, et ukendt forsøg eller en recoverymappe for at få status grøn. Arkivering/glemning i det aktive indeks er ikke bevis for, at alle historiske backups eller logs er slettet. Retention og forsvarlig oprydning kræver en konkret beslutning; denne release opfinder ikke automatisk sletning.

## Isoleret M6-restoreprøve

1. Bind forsøget til kandidatcommit, app-træ, Nodeversion og skema. Brug nye syntetiske mapper, ingen produktionsnøgler, ingen aktive realintegrationer og ingen delt live-state.
2. Opret repræsentativ v4.9.1-syntetisk state med noter/manualvalg/jobs/projekter. Registrér inputhash; start kandidaten og verificér præcis migrationsbackup, skema, bevarede felter og revisioner.
3. Gentag opstart/migration; en uændret backup skal være uændret. Simulér afbrudt backup/publicering og disk-/rename-/fsync-fejl; kendte fejl må ikke give succes, ukendte skal blokere videre writes.
4. Afprøv en afbrudt privat/public-transaktion. Recovery må kun fuldføre det registrerede før/efter-par. Nye/uventede bytes eller nyere skema skal blokere recovery, aldrig overskrives.
5. Stop den isolerede skriver før restore. Sammenlign nyeste data og den ønskede backup, registrér det aktuelle SHA-256 og vælg eksplicit, hvilke data der ønskes gendannet.
6. Hjælperen restoreStateBackup({path,backupPath,expectedCurrentHash}) gendanner **én offline-statefil**. Den validerer skema og genkontrollerer aktuelle bytes før publicering; den er ikke en komplet flerfilsrestore eller filsystemets compare-and-swap mod andre skrivere. Brug den ikke alene til at blande en gammel state med nyere settings/journal/projekter.
7. Start kun efter et sammenhængende review af hele inventaret. Kontrollér procesliv separat fra /ready, lagerparathed og operationers faktiske udfald. Læs præcise revisioner/kilder, aktive kontra arkiverede fakta, jobs, projekt-/kodeforsøg og Discordjournal; genstart igen for at bevise vedvarende resultat.
8. Gem syntetiske hashes, kommandoer, fejl/resultater, tidspunkt og kontrollant i verification.md. De automatiske tests erstatter ikke administratorens isolerede driftsprøve.

## Ukendte handlinger og journaler

- Action-/Nemligjournal: running efter afbrudt mulig ekstern effekt bliver unknown; lokal revision eller tilbageført kode beviser ikke udfald hos en ekstern tjeneste. En delvis/ukendt kurvskrivning gentages ikke. Den faktiske ejer skal gennemgå kurven og en eventuel ny konkret revision.
- Jobs: ventende arbejde kan genoptages under den registrerede policy; usikre writes eller permanent fejl pauses. Read-retry er ikke write-retry. Migration må ikke tænde nye reelle jobs eller ændre en gammel skillbinding.
- Discord: bevar ingress/dedupjournalens sammenhæng med domænetilstanden. Ukendt leveringshul står synligt og kan ikke omfortolkes som “ingen beskeder”.
- Projekt-/kodeforsøg: manifest, revisions-/indholdshash, backup og testgrundlag skal stemme. Installerede pakker er ikke bevis for beståede tests.
- Npm: to mappeflytninger er ikke én atomisk transaktion. Ved afbrudt publicering skal administratoren sammenholde review.json, forsøgs-ID, aktuelt node_modules og previous-node_modules og vælge fremadrettet færdiggørelse eller tilbageførsel uden at overskrive nye ændringer. Se subprocess-safety.md. Ingen automatisk oprydning/retry.
- Updater: en kendt fejl før publicering efterlader kun den tidligere committed tilstand; et fejlet godkendelsesforsøg må ikke genpubliceres af næste versionskontrol. Ved post-publicering/fsync-ukendt er alle nye ændringer spærret, indtil en ny instans har indlæst og synkroniseret den autoritative fil. Afbrudt staging bliver `unknown` ved genstart, uden testbevis eller godkendelse. Kontrollér operationens ID, version/SHA, præcis stagingmappe og eventuel lokalt navngivet testcontainer. Knapperne må ikke omfortolke en uafsluttet journal som aktiv kørsel eller succes. Der er ingen automatisk sletning, genkørsel eller nulstilling af journalen.
- Updaterens gamle lokale skema 0 indlæses uden tab af øvrige felter og publiceres som skema 1. Ukendt nyere update-skema afvises uden omskrivning. En gammel app må ikke startes direkte mod den nye journal; den samlede rollbackbeslutning skal omfatte både hovedstate og updaterstate. Ligesom hovedlageret forudsætter updaterjournalen én skrivende proces.

## Rollback og fremtidig produktion

**Kode-rollback er ikke datarollback.** V4.9.1 kan ikke antages at beskytte skema1. Repositoryets opdaterede deploy-/rollbackværn afviser automatisk v4-rollback efter migration som rollback-blocked. Det er ikke bevis for, at disse værn allerede er installeret i de root-ejede produktionsscripts; de skal gennemgås og anvendes af administratoren før produktion.

Ved fejl: stop den relevante skriver sikkert, bevar aktuelle filer/journaler og backups, undersøg kompatibilitet og nyere brugerændringer, og indhent konkret beslutning før restore. Ingen gammel backup må lægges oven på nyere ændringer for at “komme tilbage”.

Før en separat produktionsinstallation skal den præcise godkendte SHA, stabile lightweight-tag, pakkeversion, skema, Nodekrav, tests, kapacitet/disk og rollbackbegrænsning være gennemgået. Den lokale semantic-child er crashisoleret, ikke en OS-sandbox; målt native-RAM, service-memorygrænser og core-dump-politik kræver administratorreview. Ingen bredere sudo-/Dockerrettigheder gives som genvej.

## Udført kontra afventer

De automatiske syntetiske suites omfatter blandt andet:

```sh
node --test test/v5-migration.test.mjs test/v5-recovery-durability.test.mjs test/v5-durable-state.test.mjs test/v5-readiness.test.mjs test/deploy-release.test.mjs
```

De dækker skema0→1, gentaget/afbrudt migration, backup-durabilitet, ukendt fremtidsskema, præcise restorehashes, concurrency, post-publicering-unknown og rollbackblokering. `test/v5-updater-durability.test.mjs` dækker separat updaterjournal, fejlet godkendelse, genstart og samtidighed. Projekt-/Discord-/npm-recovery har separate tests angivet i kravmatricen. Det faktisk testede kandidatindhold og resultater står i verification.md; en dokumenteret kommando er ikke alene et bestået resultat.

**Afventer:** fysisk/administrativ isoleret restoreprøve, faktisk drifts-/runtime-/diskkontrol og review af root-ejede scripts/services. **Ikke udført eller autoriseret her:** produktionstilslutning, produktionsrestore, merge, tag/release eller installation.
