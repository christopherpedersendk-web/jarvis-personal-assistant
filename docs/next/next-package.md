# Næste reviewbare pakke: målhost og reel hybridaccept

Afhænger af grøn mediecontainment og merge af PR #19. Ingen release, deployment, featureaktivering eller køb er implicit autoriseret.

## A. Målhostinventar og isoleret accept

Brug eksisterende operatøradgang; send aldrig credentials i chat eller PR. Registrér commit, pakke/schema, Node/OpenClaw-version, tjenestebruger, loopback-porte og eksisterende fungerende integrationer. Læs systemd-unit og effektive sandboxegenskaber (NoNewPrivileges, ProtectSystem, ProtectHome, PrivateTmp, read/write paths). Researchcredential må ikke have operatorrettigheder. Bevar eksisterende data, scheduler, bot og flags.

På særskilt godkendt testinstans: kør den eksisterende pinned researchkontrakt, bevar kilder, afvis forkert credential og forbudte tools. For commerce: separat browserprofil/tjeneste uden private data eller Docker-socket; dokumentér faktisk afvisning af loopback, RFC1918, metadata, redirects, DNS-skift og underressourcer. Konfigurationsattestation alene er ikke accept. Alle nye flags forbliver OFF indtil konkret ejerbeslutning.

## B. Samme 30 danske opgaver

Eksisterende scripts genbruges, ingen nyt datasæt. Fra jarvis-starter på en isoleret testhost med sikkert konfigureret OPENAI_API_KEY, OPENAI_TEXT_MODEL og hybridens restricted-v1 gateway:

```sh
node scripts/assistant-evaluation.mjs
node scripts/assistant-evaluation.mjs --live --output baseline-unreviewed.json
node scripts/assistant-evaluation.mjs --live --hybrid --output hybrid-unreviewed.json
```

Første kommando er kun offlineplan. Livekommandoer reserverer/forbruger faktiske API-kald. Brug nye outputfiler og samme kildekode/model/datasæt. Bedøm begge rapporters svar, kilder, handlinger og faktisk finalState med passed, reviewedBy og reviewNote for hver opgave, og bevar de oprindelige rårapporter. Kør derefter:

```sh
node scripts/assistant-evaluation.mjs --grade baseline-reviewed.json
node scripts/assistant-evaluation.mjs --grade hybrid-reviewed.json
node scripts/compare-assistant-evaluations.mjs baseline-reviewed.json hybrid-reviewed.json
```

Accept: mindst 27/30 i begge forløb og alle kritiske opgaver bestået. durationMs inkluderer setup, ikke ren modeltid. Rapportér faktiske usagefelter; manglende gateway-/providerforbrug er null/ukendt. Pris kræver dateret tariffgrundlag og fuld dækning af model, hosted tools og gateway; ingen procentbesparelse ved ufuldstændige data. Denne session har ingen model- eller gatewaycredentials, så begge forløb er not_run og scores null.

## C. Ejerprøver uden køb

Følg operations.md: godkendt testguild, live kanalreview/ændring/stop; syntetiske stamdata og revisionskonflikt i web/DM; én aktiv madplan gennem web/Discord; låste valg/kostkrav og faktisk historik; Nemlig navnesøgning med separate mængder, uden kurvwrite. Registrér observation, version, tidspunkt og udfald pr. kriterium. Fysisk iPhone, voice og backup/restore kræver konkret ejerhostadgang.

## D. Senere særskilte kontrakter

Handel: login i isoleret testprofil uden eksponering af credentials; tilladte butiksendpoints/handlinger; sessionsudløb/logout; kurv med præcis sælger/variant/antal/pris/fragt/adresse; nyt review ved ændring; ordre-preview adskilt fra bindende afsendelse; idempotens og ingen automatisk retry ved ukendt udfald; ingen betalingsappgodkendelse af agenten. Rigtige køb kræver særskilt ejerbeslutning.

Selvudvikling: separat testmodel og GitHub-credential, branch protection og uafhængigt beskyttet security-check først. Lav en lille tilladt ændring i eksisterende Docker-sandbox; dokumentér fejl før/fix efter, uændret hostkode og eksakt draft-PR-SHA. Credential må ikke kunne ændre main, workflows, checks, release eller deployment. Test stop, genbrug og ukendt publicering. Ingen automatisk merge eller deployment.
