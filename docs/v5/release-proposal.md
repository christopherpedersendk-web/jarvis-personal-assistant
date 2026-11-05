# JARVIS v5.0.0 – forslag til senere særskilt M7

**Status: udviklingskandidat. M6 er ikke accepteret; ingen merge, tag/release eller installation er udført eller godkendt af dette dokument.** Alle P0/P1 skal være løst og dokumenteret verificeret før release. “Ingen rapporterede issues” er ikke en erstatning for krævede test-/device-/restorechecks.

## Kandidat og faktisk binding

- Baseline: v4.9.1 = **6b2b0736a32e0968d5db233512672d197b4885f7**. Main og tag genkontrolleres før næste publicering; historiske tags flyttes ikke.
- Remote feature/v5-foundation, [draft PR #7](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/pull/7) mod main. Isoleret lokal feature/v5-resume; det oprindelige dirty worktree bevares.
- Pakkeversion5.0.0; dataskema1; Node>=22.6.0. Ingen mellemliggende4.x-release eller antaget prerelease-deploy.
- Seneste publicerede runtimecheckpoint: **2f94679d0e5d800fb3623134e7368bb69c77f178**, app-træ **b519b67f04ccbdf90a7d8971ac28934f689876eb**, [CI42016975993](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42016975993).
- Den kørsel dokumenterer **674/674 Node22-tests**, ægte hybrid-kilde@5 **75/80=93,75 %**,16 sikkerhedsspørgsmål og dependency-audit med0 fund. Browserjobbet fejlede ved en kendt claim-UI-kontrakt, som rettes i næste samlede kandidat.
- Efterfølgende G1/G3/E1-/historik-/procedure-/pakkegodkendelses-/UI-ændringer og præcis runtime-lock skal selv gennem fuld suite,4 browserforløb, model/audit og performance. Nyeste faktiske commit/app-hash og evidence opdateres i progress.md og verification.md; gamle240/243-tests eller gamle screenshots kan ikke genbruges som bevis for dette indhold.

## Resterende acceptport

1. **Samlet kandidatbinding:** frys og test det præcise indhold. Node22, aktuelle Chromium/WebKit desktop1390×950/mobil390×844, model/audit/performance samt migrations-/recoveryregression skal være gennemført. Fejl og ikke-kørte checks skal forblive synlige.
2. **P0/P1-kravmatrix:** hver af alle56 A–L og13 R-fund skal have den relevante faktiske test/manualevidens. En grøn deltest eller en implementeret editor er ikke endelig accept.
3. **Fysiske enheder:** iPhone/Safari, desktop, rigtig200 %-zoom, tastatur/fokus, læsbarhed/kontrast, mikrofon og samlet kilde-/kladdeflow på isoleret syntetisk kandidat. Browseremulering er ikke fysisk prøve.
4. **Administrator:** isoleret sammenhængende backup/restore, afbrudt/gentaget migration, nyere data og schema-/rollbackværn; faktisk lokal test-/pakke-/runtimekonfiguration uden nye rettigheder. Den repo-opdaterede root-deployer er ikke påstået installeret i produktion.
5. **Begrænsninger:** den målte semantik opfylder den foreslåede90 %-grænse, men har fem dokumenterede misses. JSON, flerfilsjournal, native-RAM og ekstern Nemlig-race forklares præcist. Arkiv-/backupretention og stagednpm-recovery kræver udtrykkelige driftsvalg; ingen automatisk aktivering eller skjult sletning.

Åbne P0/P1 accepteres ikke som undtagelser for at frigive. Dokumenterede begrænsninger, som ikke er åbne P0/P1-krav, kan gennemgås særskilt. manual-acceptance.md har bevidst åbne felter, indtil en kontrollant har udført dem.

## Konkret rækkefølge, når M6 er accepteret

**Første foreslåede M7-handling er kun mergebeslutningen.** Der anmodes endnu ikke om den, mens ovenstående gates er åbne.

1. Læg en kort kandidatoversigt frem med præcis remote-SHA/app-træ, rent worktree, verificerede resultater, screenshots, manuel accept, migrations-/rollbackinstruktion og alle væsentlige beslutninger. Kontroller ny main/PR-status og eventuelle nyere godkendte ændringer.
2. **Beslutning A – merge:** bed om særskilt godkendelse til at flette præcis denne gennemgåede kandidat i main. Hvis merge ændrer appindholdet, test det nye indhold før næste handling; versionsnummer alene er ikke binding.
3. **Beslutning B – stabil release:** efter godkendt merge anmodes særskilt om lightweight **v5.0.0**-tag og release på den testede godkendte SHA. Tag, commit, pakke, schema og testmanifest skal stemme. Ingen eksisterende tags flyttes; unsupported prerelease-tags antages ikke at deploye.
4. **Beslutning C – installation:** først derefter særskilt ejer-/administratorbeslutning om produktion. Administrator gennemgår root-ejede scripts/service, faktisk backup/restore, kapacitet og rollbackspærre. Ingen sudo-/Dockerudvidelse. Verificér kørende version og /ready efter installation uden at sidestille liveness med fuldførte operationer.

Kode-rollback til v4.9.1 efter skema1 er ikke en sikker automatisk løsning. Nyere brugerændringer og ukendte eksterne handlinger bevares; gammel backup kræver konkret valg. Se migration-and-rollback.md.
