# Migration og gendannelse – kun efter separat M7-godkendelse

**Kørslen i udvikling har kun anvendt syntetiske data.** Følgende beskriver en fremtidig, særskilt godkendt administratorprocedure – ikke arbejde, der er udført i produktion.

## Datakontrakt

- Applikationsversion: `5.0.0`. **Dataskema:** `1`, uafhængigt af appversionen. v4.9.1-filen havde ikke et skemafelt og behandles som skema `0`.
- Første åbning af en eksisterende v4.9.1-tilstandsfil opretter en beskyttet nøjagtig kopi: `state.json.v4.9.1-before-v5.backup` (privat filrettighed 0600).
- Kopien overskrives aldrig. Hvis en tidligere afbrudt migration har efterladt en backup med andet indhold end kilden, stopper JARVIS og kræver manuel undersøgelse.
- Derpå publiceres den eksisterende tilstand atomisk med `schemaVersion: 1`. Ukendte gamle felter bevares. Ukendt højere dataskema afvises, uden at der skrives.
- Nye JSON-publiceringer bruger unikke midlertidige filer, filsynkronisering og atomisk omdøbning. Et lokalt filsystem kan dog stadig have fysiske fejl, så rigtig backup og restore skal efterprøves særskilt.

## Før en fremtidig installation

1. Få **særskilt** godkendelse til merge, stabilt `v5.0.0`-tag/release og installation. Et udviklingscommit eller et draft-PR er ikke denne godkendelse.
2. Gennemgå den præcise SHA, `package.json`, Node-version, dataskema, CI-browsere, brugeraccept og release-noter.
3. Lad administrator kontrollere driftsstatus, servicefiler, planlagt backup, tilgængelig lagerplads og faktisk produktionsbackup – uden at kopiere hemmelige indstillinger eller persondata til udvikling.
4. Gør eksisterende data revisionsbundne ved at notere en SHA-256 fra den lukkede tjenestes tilstandsfil og sørg for en prøve-gendannelse i et afgrænset miljø.
5. Giv adgang til produktion **først** efter særskilt installationsbeslutning; ingen nye sudo-, Docker- eller integrationsrettigheder.

## Rul tilbage uden tab

- **Kode-rollback er ikke lig datarollback.** V4.9.1 ved ikke, hvordan skema 1 skal beskyttes. Hvis v5 har nået at migrere data, stopper deploy-sikkerheden automatisk tilbagerulning til v4 og kræver administrativ genopretning (`rollback-blocked`).
- Gendan aldrig en ældre backup hen over ændringer lavet senere, uden ejerens **konkrete** valg. Den indbyggede offline-hjælper `restoreStateBackup({path,backupPath,expectedCurrentHash})` kræver hash for **den aktuelle** fil og afviser ændringer siden godkendelsen.
- Ved en fejl: stop tjenesten sikkert, bevar både aktuel fil og backup, kontroller kompatibilitet og indhent særskilt valg af data, der eventuelt skal bevares eller genindføres. Sammenlign data før en ny start.
- Hvis Nemlig-overførsel fik delvist eller ukendt udfald, må gammel software eller job **aldrig** gensende handlingen uden en ny faktisk ejer-gennemgang af kurven.

## Udført i isoleret udvikling

- Syntetisk v4.9.1-migration, gentaget/afbrudt migration, uændret backup, nægtet nyere skema, atomisk publicering og hash-bundet gendannelse: `node --test test/v5-migration.test.mjs`.
- Syntetisk deploy-rollback, præcist runtime-versionstjek og blokering af v4 efter skema 1: `node --test test/deploy-release.test.mjs`.
- **Ikke udført:** rigtig produktion, fysisk restore-øvelse, administratorens gennemgang af root-owned filer og en ægte installation.
