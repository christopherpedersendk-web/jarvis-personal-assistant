# v5.3.0 — merge- og deployforberedelse

Repository: https://github.com/christopherpedersendk-web/jarvis-personal-assistant
PR: https://github.com/christopherpedersendk-web/jarvis-personal-assistant/pull/17
Udgangspunkt: v5.2.1 / a991408da3ab505f3ce3c18c04c4858350086849.
Mål: **v5.3.0**, package.json **5.3.0**, schema **1**, readableFrom **0**.
Ingen ny databasemigration. Den endelige kandidat-SHA og commitbundne CI fremgår af PR'en.

## Releaseindhold

- Versionsfastlåst, separat OpenClaw-runtime og begrænset lokal researchgateway.
- Fælles researchkontrakt for samtaler og rapportforberedelse; kilder bevares ved resume.
- Fire versionerede researchprocedurer; ingen automatisk marketplace-installation.
- Mutationer spærres efter offentlig research i samme samtaletur/stemmesession.
  Researchhistorik vises, men genbruges ikke automatisk som modelkontekst.
- Baseline/hybrid-evaluator til 30 danske opgaver. Ingen opfundet score/besparelse.

## To adskilte godkendelser

1. **Merge og installation af Jarvis-koden:** kræver grøn CI på den præcise PR-SHA,
   gennemgang af ændringer og ejerens stagingprøve. PR klargøres til review; dette
   dokument udgør hverken merge, releasepublicering eller installationsgodkendelse.
2. **Aktivering af OpenClaw, browser eller nye Discord-handlefunktioner:** kræver
   særskilt accept på testinstallationen. Den isolerede runtime installeres ikke af
   Jarvis-opdateringen. Installer ikke OpenClaw-afhængigheder i almindelig staging.

Anbefalet første deploymentprofil: eksisterende Jarvis med nye funktioner OFF.
Kontroller lokalt OPENJARVIS_ENABLED, JARVIS_BROWSER_RESEARCH, JARVIS_DYNAMIC_BROWSER,
JARVIS_DISCORD_VOICE og JARVIS_DISCORD_CHANNELS. Udeladte flags er OFF. Hvis et flag
allerede er aktiveret, er dette ikke en baseline-only installation: afprøv den
faktiske konfiguration særskilt eller aftal eksplicit deaktivering før installation.
Ingen eksisterende indstillinger ændres automatisk af denne forberedelse.

Den installerede OpenClaw 2026.11.1 har bestået offentlig søgning med fem kilder og
værktøjsafvisninger i CI. Det beviser ikke ejerens serverisolation. Runtime kræver
separat kompatibel Node 24.16+ / 26.1+; Jarvis' Node 22-krav ændres ikke.
34 moderate dependency-auditfund er fortsat åbne (0 high/critical i den registrerede
kørsel). Hostisolation og de to rigtige modelevalueringer mangler. Disse punkter
må ikke lukkes ved merge eller release. Se acceptance-register.md og operations.md.

## Merge og release, når ejeren vælger det

1. Kontroller PR #17's aktuelle HEAD, reviews, konflikter og alle fem checks.
   Historisk grønt på 48acd3962d1ea5443cdfe7f2c6de351ce3e1331f gælder ikke nye ændringer.
2. Merge kun den gennemgåede kandidat. Notér den faktiske resulterende main-SHA.
   Ved squash eller merge-commit er det ikke nødvendigvis PR-hovedets SHA.
3. På det præcise release-checkout:
   `node jarvis-starter/scripts/check-release-version.mjs v5.3.0`.
   Kræv package.version=5.3.0 og schema=1/readableFrom=0. Tag v5.3.0 må kun pege
   på denne verificerede kode. Flyt ikke et allerede offentliggjort tag.
4. Opret tag/release efter særskilt beslutning. Kræv grøn Release metadata-workflow
   på tagget. Brug releaseindholdet ovenfor og oplys flags/åbne acceptpunkter.
5. Kontroller release-taggets faktiske commit, ikke kun target_commitish=main.
   Staging og installationsgodkendelse skal referere til netop denne commit.

## Test og deployment på serveren

Serveradgang er ikke tilgængelig her. Stier og serviceopsætning skal kontrolleres
mod den faktiske installation; kør ikke et nyt deployscript blindt som root.
Brug den eksisterende root-ejede deployer og dens særskilte systemd-service.
Repositoryets deployer bruger UID/GID 1000 til Git og /home/administrator/jarvis
som standardrod; kontrollér at det matcher hosten før brug.

1. Kortlæg og sikkerhedskopiér faktisk data, private indstillinger, servicekonfiguration
   og eventuelle eksterne projektmapper efter docs/v5.2/operations-and-acceptance.md.
   En syntetisk restoretest er ikke bevis for denne backup. Kontroller backupservicen
   og gendannelsesmuligheden, før produktionen skiftes.
2. I Jarvis → Opdateringer: find v5.3.0 og kontrollér SHA, hent og test i isoleret staging.
   Kræv aktuelt testgrundlag og korrekt pakkeversion. Rediger aldrig update-state.json
   for at fremstille en godkendelse eller springe versionskontrollen over.
3. Prøv mobil opstart, login, tekstchat, eksisterende Discord-tekst/rapportlevering,
   én aktiv madplan og redigering, kildelinks og stop. Lav ingen nye livehandlinger
   uden et konkret review. Hybridprøver følger operations.md i en separat testkopi.
4. Godkend den viste, testede version/SHA gennem updaterens eksisterende godkendelse.
   Hvis deploy-timeren er aktiv, kan denne godkendelse medføre installation inden
   for dens næste kørsel. Giv derfor først godkendelsen, når serviceafbrydelsen er passende.
5. Den eksisterende deployer kræver matchende testedSha/version/schema, starter
   jarvis-backup.service før skift, skifter current-link og genstarter jarvis.service.
   Den kræver /health med version 5.3.0. Kontroller også /ready, servicejournal,
   deployment-result.json og at forventede data/integrationer stadig virker.
6. Fejl/ukendt udfald er ikke en opfordring til automatisk genkørsel. Gennemgå journal
   og aktive processer. Deployerens egne idempotens-/rollbackkontroller bevares.

## Tilbageførsel

Bevar tidligere v5.2.1-release, konfiguration og verificeret offline backup. Deployer
kan tilbageføre kodelink ved healthfejl; det er ikke automatisk datagendannelse og
beviser ikke alle domænefunktioner. Bekræft kompatibilitet og data efter et skift.
Gendan aldrig gammel backup oven i nyere brugerændringer uden at bevare dem først.
Ved hybridfejl: stop den separate researchservice og deaktivér OpenJarvis eksplicit;
baselinebackend er bevaret. Ingen automatisk fallback til flere rettigheder.

## Overdragelse

Næste udvikling følger next-development-prompt.md. M1–M10's restpunkter fortsætter
med deres nuværende status. Skills-menuen og Discord-kanaler/stemme har allerede
komponenter i koden og skal udbygges; almindelig videoanalyse findes ikke som en
verificeret generel Discord-funktion. Releasestatus er ikke bevis for aktivering.
