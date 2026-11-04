# JARVIS v4.6 – privat cloud-opgradering

Denne version er udviklet til en privat Ubuntu 26.04-server med JARVIS på `127.0.0.1:8787`, Tailscale Serve og systemd. Den nye version er ikke automatisk installeret, blot fordi den er lagt på GitHub.

## 1. Sikker kodehåndtering

- GitHub-repository skal være **privat**. Commit aldrig `.env`, `data/`, projekter, tokens, restic-password, SSH-nøgler eller backupfiler.
- Brug en separat **read-only GitHub Deploy Key** til cloudserveren og registrér `github.com`-hostnøglen efter uafhængig kontrol af fingerprint. Undgå personligt GitHub-token på serveren.
- Konfigurér i JARVIS `.env`: `JARVIS_UPDATE_REPO=git@github.com:christopherpedersendk-web/jarvis-personal-assistant.git` og eventuelt `JARVIS_UPDATE_STAGING=/home/administrator/jarvis/update-staging`.
- JARVIS-processen skal fortsat køre som en almindelig ikke-privilegeret bruger. Undlad at tildele `sudo` eller tilføje den til Docker-gruppen: Docker giver i praksis adgang på root-niveau.

## 2. Staging og test

Updateren læser kun tags i formatet `vX.Y.Z`. Brug **lightweight tags** (ikke annotated tags), da versionens SHA fastlåses til Git-committet. En frigivet version bør gennemgås og tagges fra en kontrolleret release-branch.

Til isolerede tests forventes **rootless Docker** under den dedikerede ikke-privilegerede JARVIS-konto og et på forhånd downloadet `node:22-alpine` image. Staging bruger `--network none`, read-only bind mount, uprivilegeret UID, kapabilitetsbegrænsning samt hukommelses- og CPU-grænser. Brug **ikke** den normale rootful Docker-socket eller medlemskab af `docker`-gruppen til JARVIS-processen. Uden sikker rootless-containeradgang fejler staging lukket, og godkendelsesknappen kan ikke bruges. Installer og kontrollér rootless-containerdrift særskilt før aktivering.

Opdateringens tilstande er: `available` (tag fundet), `staged` (download og test bestået), `approved` (ejer har godkendt). **Aktivering kræver, at den separat installerede, root-ejede `jarvis-deploy.service` og timer er sat op korrekt.** Webprocessen kan ikke selv starte denne service.

## 2A. Sikker deployment-service – engangsopsætning

Denne proces skal udføres under et aftalt vedligeholdelsesvindue med adgang til cloududbyderens webkonsol. Behold den eksisterende v4.5-mappe og restic-backups. Kontrollér først at `/usr/bin/node`, `/usr/bin/git`, `/usr/sbin/runuser` og `jarvis-backup.service` eksisterer.

1. Opret versionslayoutet: `/home/administrator/jarvis/releases/`, `/home/administrator/jarvis/shared/` og `/home/administrator/jarvis/update-staging/`. Alle er private mapper. Flyt ikke backupfiler til GitHub.
2. Tag backup, stop JARVIS kortvarigt, og flyt de nuværende private `.env` og `data/` til `shared/.env` og `shared/data/`. Bevar ejeren `administrator`, filtilstand `600` på `.env` og adgang til data for denne bruger. Sørg for at den gamle installationsmappe kan tilbageføres ved at bevare en kopi.
3. Anbring den gennemgåede v4.6-kode som `/home/administrator/jarvis/releases/v4.6.0/jarvis-starter/`. Opret **symbolske links** fra `jarvis-starter/.env` og `jarvis-starter/data` til de to private delte stier. Opret linket `/home/administrator/jarvis/current` til `/home/administrator/jarvis/releases/v4.6.0`.
4. Ret den eksisterende `jarvis.service` til at bruge `WorkingDirectory=/home/administrator/jarvis/current/jarvis-starter` og `ExecStart=/usr/bin/node --env-file-if-exists=.env server.mjs`, stadig med `User=administrator`. Kør `systemctl daemon-reload`, start servicen og verificér Command Center, Discord og data. Rul manuelt tilbage til den oprindelige unit/mappestruktur, hvis dette fejler.
5. Kopiér **efter kodegennemgang** `scripts/deploy-release.mjs` til `/usr/local/libexec/jarvis-deploy-release.mjs`, og gør filen root-ejet og ikke-skrivbar for `administrator`. Installér `deployment/systemd/jarvis-deploy.service` og `.timer` i `/etc/systemd/system/`, ligeledes root-ejede. Lad timeren være deaktiveret indtil en test med isoleret staging er gennemført.
6. Efter afprøvning kan `jarvis-deploy.timer` aktiveres. Hvert andet minut kontrollerer den en eksplicit godkendt version. Den tager restic-backup, kontrollerer SHA og ren staging, kopierer releasen, skifter atomisk `current`-linket, genstarter JARVIS og udfører HTTP-healthcheck. Ved fejl skiftes linket tilbage og den gamle service genstartes. Resultatet registreres i `/var/lib/jarvis-deployer/last-result.json` og i `shared/data/deployment-result.json`.

**Vigtigt:** Deployeren må ikke opdateres automatisk fra GitHub. Opdateringer af root-script og systemd-units kræver fortsat en selvstændig manuel sikkerhedsgennemgang. Release-approval er en tillidserklæring til den nye applikationskode. En kompromitteret JARVIS-konto må derfor ikke kunne redigere root-ejet deployer, systemd-units, backups eller øvrige root-filer.

## 3. Cloud-migrering uden datatab

1. Kontrollér at `jarvis-backup.service` kører uden fejl og verificér mindst ét restic-snapshot, før du ændrer installationen. Foretag gerne en isoleret restore-test.
2. Behold den kørende v4.5 og dens `.env` og `data/` urørt. Udpak v4.6 i en *ny* versionsmappe under `/home/administrator/jarvis/`. Kontrollér alle filer.
3. Kopiér private data og konfiguration til den nye versionsmappe med adgangsrettigheder `600` for `.env` og `700` for data-mappen. Bevar `JARVIS_PROJECT_ROOT=/home/administrator/JARVIS-Projects`.
4. Test den nye version med `npm test`, og kontrollér `JARVIS_HOST=127.0.0.1` og `JARVIS_PORT=8787`.
5. Stop først den eksisterende service ved et aftalt vedligeholdelsesvindue, ret systemd `WorkingDirectory`/`ExecStart` til den nye mappe, kør `systemctl daemon-reload` og start servicen. Kontrollér `journalctl -u jarvis`, `curl -I http://127.0.0.1:8787`, Command Center via Tailscale og Discord.
6. Ved fejl: stop service, peg systemd tilbage til v4.5 og genstart. Gendan kun data fra backup, hvis data er blevet inkompatible eller beskadigede. Denne release introducerer ikke en tilsigtet destruktiv datamigrering.

## 4. Begrænsninger og sikkerhedsmodel

- **Ingen uovervåget førsteopsætning:** Første migration til `current`-linket og installation af root-ejet deployer foretages manuelt og kontrolleret. Derefter kan godkendte releases installeres automatisk.
- **Ingen offentlige porte:** JARVIS lytter lokalt; Tailscale Serve håndterer HTTPS på dit private tailnet. Hold UFW default-deny på almindelige offentlige interfaces.
- **Ingen udvidede rettigheder:** En kompromitteret webserver må ikke selv kunne ændre systemd units, læse restic-password eller installere vilkårlig kode som root.
- **Ingen selvtestede producentintegrationer:** Nest-dørklokke og Hue-bro hjemme kræver stadig særskilt lokal bridge og autorisation.
- Proaktive Discord-notifikationer forudsætter en aktiv Discord Gateway og tilladte DM'er. Notifikationer er best-effort og ikke en garanteret alarmkanal.
