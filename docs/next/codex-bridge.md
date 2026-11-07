# JARVIS → Codex fra Discord

Broen er en M18-udviklingsadapter, ikke en ny bot eller scheduler. Den gemmer `engine: codex-app-server`-opgaver i det eksisterende `selfDevelopmentJobs`, bruger samme DurableState, ProviderControl-stopgeneration og integrationskø og publicerer kun gennem den typed M18-GitHub-transport. Ældre M18-kladder og denne adapter deler arkiv/adgangsgrænse og højst tre startede opgaver pr. UTC-døgn. Én udviklingsopgave kan arbejde ad gangen.

## Telefonbetjening

Skriv i den konfigurerede ejers Discord-DM eller godkendte serverkontekst:

- `Start udviklingsopgave: Ret kanaloprettelse.`
- `Status på udviklingsopgaven.`
- `Status opgave <kort-id>`
- `Fortsæt opgave <kort-id>: Bevar også links og danske priser.`
- `Stop opgave <kort-id>`
- `Vis ændringer for opgave <kort-id>`
- `Opret draft-PR for opgave <kort-id>`
- `Godkend udvikling <kort-id> <review-id>`
- `Afvis udvikling <kort-id> <review-id>`
- `Svar opgave <kort-id>: <svar>`, hvis Codex faktisk spørger.

Status viser formål, kort ID, arbejder/venter/afsluttet/stoppet/fejlet/ukendt, seneste relevante hændelse, autoritativ beskyttet teststatus og PR-link. Codex' egen opsummering er mærket særskilt. Flere opgaver giver en liste; ændringsinstruktioner kræver ID. Opgaven kan kun ændres i sin oprindelige ejer-/kanalkontekst og uændrede Discord-konfiguration. Stop/status har en begrænset prioritetsplads gennem eksisterende gateway-adgang og replaykontrol.

`Opret draft-PR` viser først et review med præcist opgave-ID, base-SHA, koderevision, diffhash og to minutters frist. `Godkend udvikling` forbruger det durabelt én gang. Nye instruktioner, kode, scope, base, stopgeneration, genstart eller udløb ugyldiggør et gammelt review. Ukendt publicering genforsøges ikke. Merge, release og deployment findes ikke som brohandlinger.

## Protokol og isolation

Verificeret binær: Codex CLI **0.167.0** på Linux, administrator UID 1000. Den eksisterende installation findes via `/home/administrator/.local/bin/codex`; original konfiguration og login ligger i ejerens `.codex`. Ingen oprindelige konfigurationsværdier eller tokens offentliggøres.

[Officiel App Server-dokumentation](https://developers.openai.com/codex/app-server) og den installerede binærs eksporterede JSON-schema er brugt sammen. Klienten initialiserer stdio én gang og bruger `thread/start`, `turn/start`, `turn/steer`, `turn/interrupt`, `thread/read` og `thread/resume`. Dynamiske værktøjer kræver eksplicit experimental API-opt-in. Versionen kontrolleres ved håndtrykket; ukendt version eller protokolfejl giver ingen usikker fallback.

Codex får en ny privat HOME med **kun** en privat kopi af eksisterende Codex-auth samt broens faste konfiguration. Ingen Discord-, butik-, OpenAI-API- eller GitHub-credentials, private indstillinger, SSH-agent, browserprofil, apps, plugins eller ejerens øvrige Codex-konfiguration arves. Auth er nødvendig for Codex selv; tokenværdier holdes kun i hukommelse til defensiv redaktion og i privat 0600-fil.

Native shell/unified-exec er deaktiveret, native projektadgang er read-only i en navngiven minimal permissionsprofil, og procesmiljøet er en kort whitelist. Den nødvendige Codex-værktøjsorkestrering er aktiveret: den første faktiske prøve viste, at 0.167.0 ellers svarer `code-mode host is disabled`. Det giver ikke projektkode shelladgang. Den effektive konfiguration attesteres før sessionstart. Der er ingen offentlig port eller generisk JSON-RPC-/shell-route i JARVIS.

Agentens fire dynamiske værktøjer kan liste det faste filscope, læse begrænset projekttekst, erstatte en tilladt tekstfil med forventet kildehash og køre beskyttede fokuserede tests. Genereret projektkode udføres **kun** gennem eksisterende `dockerTest`: ingen netværk, secrets, capabilities eller write-mount af arbejdsmapper. Agenten får ikke Docker-socket eller GitHub-login. Beskyttede tests læses fra den installerede, reviewede kode; agenten kan tilføje en opgavebundet testfil, men kan ikke erstatte kontrollerne. Beståede tests genbruges ved uændret diffhash.

Git-worktrees har præcis base-SHA, egen `agent/codex-<uuid>`-gren og privat arbejdsrod med eksklusiv proceslease. Git-hooks, fsmonitor og konfigurerede checkoutfiltre må ikke udføre agentkode på hosten. Filværktøjerne afviser traversal, symlinks, private filer, metadata, workflows og andre filer uden for scope. Ingen model får en generisk GitHub-metode eller sti. CLI-fallback til eksisterende GitHub-login er kun i den betroede host-transport og kræver eksplicit konfiguration; et separat begrænset `JARVIS_DEV_GITHUB_TOKEN` foretrækkes, når det findes.

## Installation og præcis aktivering

Denne opgave **installerer eller aktiverer ikke** broen i den aktive bot og merger eller udgiver ikke kandidaten. Den faktiske prøve kørte egne kortvarige udviklingsprocesser og private testmapper uden botforbindelse.

Efter separat review og aktiveringsbeslutning skal operatøren:

1. Installere den reviewede PR-kandidat i den eksisterende JARVIS-service via den normale separate installationsprocedure. Start ikke en ekstra bot.
2. Klargøre en separat udviklingsklon af samme repository, uafhængig af `/home/administrator/jarvis/current`, releases og shared-data. Klonen skal indeholde den valgte main-base og have origin til det faste repository. Broen foretager et read-only fetch af main før nye opgaver.
3. Bevare Codex 0.167.0 og dens eksisterende login; klargøre adgang til den lokale Docker-runtime og det eksisterende `node:22-alpine`-testimage for servicebrugeren. Ingen loginoplysninger skal sendes i Discord/chat.
4. Sætte de eksplicitte udviklingsstier og `JARVIS_CODEX_BRIDGE=yes` i en privat servicekonfiguration. Se [drop-in-eksempel](../../jarvis-starter/deployment/systemd/jarvis-codex-bridge.conf.example). Brug privat arbejdsrod 0700. Lad almindelige produktionscredentials blive i eksisterende JARVIS; Codex-processen arver dem ikke. Vælg enten separat udviklingstoken eller `JARVIS_CODEX_GITHUB_CLI=yes` for eksisterende host-login.
5. Genstarte den eksisterende service som særskilt aktivering og afprøve én afgrænset ejeropgave i testkanal/DM. Bekræft de danske svar, progresslevering og engangsreview på telefonen.

Worktree-/Codex-HOME indeholder sessionhistorik og nødvendig Codex-auth og skal have begrænset/krypteret backup, aldrig vedhæftes en PR. JARVIS-state indeholder job-/thread-/turn-/repo-/base-/branch-/worktree-/kontekstbinding, testhashes, kommandoreceipts, stopønske og reviews, ikke rå tokens eller læste kildefiler.

## Genstart, stop og fejl

Genstart starter ingen turn, filskrivning, test eller publicering igen. Igangværende arbejde markeres ukendt; et stopønske bevares som stop anmodet. Status med ID kan læse en gemt terminal turn uden at fortsætte arbejdet. Afsluttet og afbrudt er forskellige sluttilstande. En interrupt-ACK alene giver ikke stopped: Codex skal melde interrupted, og aktive Docker-værktøjer skal være afsluttet. Hvis turnen blev færdig før afbrydelsen, står den som afsluttet. Ingen udokumenteret provider-hangup påstås.

Native forespørgsler om shell-, secret- eller rettighedsudvidelse bliver synlige, men kan ikke godkendes til ubegrænset udførelse gennem Discord. Ejeren kan afvise dem og tilpasse opgaven. Genstart og fem minutters udløb fjerner gamle resolvers; de genbruges ikke i en ny proces. Forespørgsler om ekstra sikkerhedsscope kræver separat operatørreview.

Ved unknown, ukendt publicering, korrupt journal eller aktiv lease: inspicér den præcise opgave, gemte session, worktree og GitHub-branch/PR. Slet ikke markører eller genkør automatisk. En afbrudt server kan efterlade en isoleret testcontainer; inspicér kun den egne testinstans og dens journal før oprydning. Koden går ikke over til ubeskyttet host-kørsel, hvis Docker mangler.

## M12/M16 og bevisgrænser

Scope omfatter de eksisterende M12-kanal-/format-/medie-/opskriftsmoduler, M16 commerce-/Proshop-moduler samt de to oprindelige M18-planlægningsfiler. Server, agent, godkendelseskontrol, secrets, workflows og deployment kan ikke omskrives af agenten. UI-kode kan gennemgås, men draft-publicering kræver særskilt browserverifikation, som denne fokuserede testlane ikke kan attestere. Browser-, merchant-login- og bindende handlinger gives ikke indirekte til Codex.

Broen kan modtage og følge op på M12/M16-kodeopgaver inden for dette scope. Den lukker ikke milestones ved oprettelse af en opgave. Ejerens Discord-/iPhone-/opskriftsreview samt Proshop-login, eksplicit adressetransfer, 2900-fragt/levering og fuld checkoutaccept står fortsat åbne. Læs eksisterende acceptregister før hver konkret videre ændring.

Faktisk verificeret: installeret App Server og konto, worktree-kodeændring, samme-session-opfølgning, beskyttet Docker-test, rigtig interrupted-status, ny App Server-proces og genoptagelse af samme thread samt faktisk draft-PR gennem M18-transporten. Discord-router/gateway-adgang, dobbeltbeskeder, falske brugere, staler reviews og redaktion er kontrakttest med syntetisk Discord-transport. Ingen rigtig gateway med produktionsbottens token er startet.
