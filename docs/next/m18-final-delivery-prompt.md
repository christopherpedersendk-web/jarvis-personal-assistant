Du er implementeringsansvarlig for JARVIS / OpenJarvis.

Repository:
https://github.com/christopherpedersendk-web/jarvis-personal-assistant

Færdiggør **M18’s sammenhængende ejerforløb fra Discord til Codex og draft-PR**. Lever én fokuseret PR med fungerende kode og revisionsbundet evidens. Stop ikke efter analyse, kontrakttests eller en vejledning.

## 1. Mandat

Docker, GitHub-hentning, isolerede worktrees, projektspecifikke afhængigheder, målrettede tests og almindeligt udviklingsarbejde er allerede autoriseret. Du må committe, pushe og oprette/opdatere leverance-PR’en uden nye tilladelsesspørgsmål.

Brug eksisterende sikkert konfigureret adgang. Bed ikke om credentials i chat, og udskriv aldrig tokens, cookies eller private konfigurationsværdier.

Respektér faktiske platformskontroller. Ved en reel blokering: fortsæt uafhængigt arbejde gennem sikre tilgængelige løsninger.

Denne opgave omfatter **ingen merge, release, produktionsdeployment eller ændring af den aktive bot**. Hvis ende-til-ende-prøven kræver ny produktionskode, færdiggør først kode, tests og konkret installations-/rollbackgrundlag. Beskriv derefter præcist det nødvendige aktiveringsmandat.

## 2. Verificér aktuel status

Læs AGENTS.md og relevante filer:

- docs/next/acceptance-register.md
- docs/next/evidence.json
- docs/next/operations.md
- docs/next/codex-bridge.md
- docs/next/codex-test-only.md
- Tilhørende M18-evidens og eksisterende implementering.

Kontrollér main, lokal arbejdsstatus, åbne PR’er, installeret version, Codex-version, integrationsprotokol og eksisterende GitHub-transport.

Historiske holdepunkter, som skal verificeres:

- Stagingrelease 5.5.4: `7758d9491105c06792ae8f22831609017c633d7c`.
- Testet kandidat: `c62caae912475fb6f4f6ce7f91ba52857fa94dc4`.
- Syv grønne workflows og 1.400 beståede unit-tests på kandidaten; merge-træet var identisk.
- Produktionen pegede fortsat på 5.5.3.
- PR #31 rettede test-only-kontraktvalg og fejlagtig unknown-status før Docker-start.
- Ejeropgave `75f302d8-026f-4ac9-84dc-58a5622a3161` havde et eksisterende ukendt testudfald. Bevar journalen; ryd eller genafspil den ikke automatisk.

Brug aktuel kode og remote-status som sandhed. Genbrug eksisterende ændringer og bestået evidens på uændret kode.

## 3. Det konkrete afleveringsmål

Ejeren skal fra Discord kunne gennemføre ét sammenhængende forløb:

1. **“Start udviklingsopgave: …”**  
   Opretter én vedvarende JARVIS-opgave og starter Codex i en isoleret worktree.

2. **“Status på udviklingsopgaven.”**  
   Viser kort opgave-id, formål, faktisk tilstand, seneste relevante fremskridt, teststatus og eventuelle nødvendige beslutninger.

3. **“Fortsæt opgave <id>: …”**  
   Sender rettelsen til samme Codex-session og worktree. Flere mulige opgaver skal udløse et konkret spørgsmål om opgave-id.

4. **“Stop opgave <id>.”**  
   Afbryder aktivt arbejde. Vis “stop anmodet”, indtil afbrydelsen er bekræftet. Afsluttet og stoppet er forskellige tilstande.

5. **“Vis ændringer for opgave <id>.”**  
   Viser forståelig ændringsoversigt og præcise testresultater uden rå logs eller secrets.

6. **“Opret draft-PR for opgave <id>.”**  
   Publicerer den gennemgåede revision via JARVIS’ eksisterende GitHub-transport og returnerer det faktiske PR-link i Discord. Ingen automatisk merge.

Brug korte danske beskeder, som kan læses på telefonen. Undgå Markdown-tabeller, gentagne notifikationer og påstande om tests eller handlinger, der ikke er udført.

## 4. Genbrug den eksisterende arkitektur

Genbrug M18’s:

- Jobmodel, datalager og scheduler.
- Discord-bot, ejeridentifikation og kanalregler.
- Codex-bro, kodeagent og isolerede worktrees.
- GitHub-transport, godkendelser og globale stop.

Brug installeret Codex’ dokumenterede App Server- eller SDK-protokol. Kontrollér officielle dokumenter og installeret versions understøttelse, hvis protokollen ændres.

Ingen parallel scheduler, ekstra Discord-bot eller ubegrænset shell fra Discord. Forbindelsen skal være serverlokal og må ikke eksponeres offentligt. Codex må ikke arve unødvendige produktionscredentials.

Rutinemæssigt arbejde i den godkendte udviklingsmappe, inklusive Docker-tests, må ikke udløse gentagne ejerforespørgsler. Bevar særskilt kontrol af secrets, produktionsdata, udvidede rettigheder, sikkerhedskontroller og bindende eksterne handlinger.

## 5. Vedvarende status og sikker publicering

Gem forbindelsen mellem opgave, Codex-session, ejer, Discord-kontekst, repository, base-commit, gren, worktree, koderevision, tests, godkendelser og PR.

Verificér beskyttelse mod:

- Dobbelt start fra samme Discord-besked.
- Samtidige writes i samme worktree.
- Rettelser sendt til forkert opgave.
- Forældede godkendelser efter kode- eller scopeændring.
- Tab af stopstatus ved genstart.
- Automatisk gentagelse efter ukendt udfald.
- Dobbelt PR-oprettelse efter netværksfejl.

Efter genstart skal status kunne genfindes eller markeres som ukendt. Genstart må ikke automatisk gentage kodeændringer eller publicering.

En uklar PR-respons skal først undersøges gennem eksisterende GitHub-readback og journal. Opret ikke en ny PR, før udfaldet er afklaret.

Bevar eksisterende code-execution-isolation. Manglende isolation må ikke føre til ubeskyttet eksekvering.

## 6. Faktisk acceptprøve

Brug en lille, ufarlig probe-/testopgave, som ikke ændrer produktion, sikkerhedskontroller eller brugerdata.

Verificér gennem den eksisterende Discord-integration:

- Ejerens besked starter én faktisk Codex-opgave.
- Status kommer tilbage i Discord.
- En opfølgende rettelse når samme session og ændrer den relevante revision.
- Relevante tests udføres i faktisk isolation.
- JARVIS opretter en draft-PR og leverer linket i Discord.
- En uvedkommende bruger afvises.

Brug om nødvendigt en separat lille probe til stopprøven, så et bekræftet stop ikke forveksles med almindelig afslutning. Verificér også genstart/genfinding i et isoleret miljø.

Start ikke en ekstra gateway-bot med produktionsbottens token. Simulerede Discord-beskeder eller en PR, du selv opretter uden om broen, tæller ikke som ejerens ende-til-ende-accept.

Bed kun ejeren om de konkrete Discord-beskeder, der er nødvendige for ejeridentificeret gatewayaccept. Saml instruktionerne, følg prøven og registrér resultatet uden at bede om gentagne rutinetilladelser.

## 7. Tests og aflevering

Kør målrettede tests for ændret adfærd og nødvendige regressioner. Genkør ikke beståede tests på uændret kode uden en konkret integrationsgrund. Kontrollér CI-triggere før push, og omgå ingen kontroller.

Skeln tydeligt mellem:

- Implementeret kode.
- Lokale tests.
- Simulerede kontrakttests.
- Faktisk Codex-/Docker-/GitHub-integration.
- Ejerens faktiske Discord-forløb.
- Produktionsaccept.

Bind evidens til commit, filhash og relevant opgave-/sessionsreference uden secrets. Opdatér det eksisterende acceptregister uden at ændre M18’s betydning. Luk kun de kriterier, der faktisk er opfyldt; automatisk release og deployment er særskilte kriterier.

Lever **én fokuseret implementerings-PR**. En lille draft-PR oprettet af JARVIS som acceptprøve skal tydeligt mærkes som prøve og må ikke merges automatisk.

Afslut med:

- De præcise beskeder ejeren kan skrive fra telefonen.
- Hvad der faktisk er verificeret gennem Discord.
- Implementerings-PR, kandidatcommit og JARVIS-oprettet prøve-PR.
- Revisionsbundet testevidens og CI-status.
- Om ændringen er installeret eller alene leveret som kode.
- Kun de præcise resterende ejerhandlinger.

**Start med read-only kontrol, fortsæt implementeringen, og færdiggør alt inden for mandatet før en eventuel anmodning om produktionsaktivering.**
