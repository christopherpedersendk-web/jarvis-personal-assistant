# JARVIS v4.6 – privat cloud-opgradering

Denne version er udviklet til en privat Ubuntu 26.04-server med JARVIS på `127.0.0.1:8787`, Tailscale Serve og systemd. Den nye version er ikke automatisk installeret, blot fordi den er lagt på GitHub.

## 1. Sikker kodehåndtering

- GitHub-repository skal være **privat**. Commit aldrig `.env`, `data/`, projekter, tokens, restic-password, SSH-nøgler eller backupfiler.
- Brug en separat **read-only GitHub Deploy Key** til cloudserveren og registrér `github.com`-hostnøglen efter uafhængig kontrol af fingerprint. Undgå personligt GitHub-token på serveren.
- Konfigurér i JARVIS `.env`: `JARVIS_UPDATE_REPO=git@github.com:christopherpedersendk-web/jarvis-personal-assistant.git` og eventuelt `JARVIS_UPDATE_STAGING=/home/administrator/jarvis/update-staging`.
- JARVIS-processen skal fortsat køre som en almindelig ikke-privilegeret bruger. Undlad at tildele `sudo` eller tilføje den til Docker-gruppen: Docker giver i praksis adgang på root-niveau.

## 2. Staging og test

Updateren læser kun tags i formatet `vX.Y.Z`. Brug **lightweight tags** (ikke annotated tags), da versionens SHA fastlåses til Git-committet. En frigivet version bør gennemgås og tagges fra en kontrolleret release-branch.

Til isolerede tests forventes Docker og et på forhånd downloadet `node:22-alpine` image. Staging bruger `--network none`, read-only bind mount, uprivilegeret UID, kapabilitetsbegrænsning samt hukommelses- og CPU-grænser. Docker er et særskilt privilegeret værktøj. I produktion bør staging-kommandoer udføres af en begrænset operatør/service, ikke ved at give JARVIS-brugeren generel adgang til Docker-daemonen.

Opdateringens tilstande er: `available` (tag fundet), `staged` (downloader og test er bestået), `approved` (ejer har godkendt). **Der er endnu ingen automatisk aktiveringsfase.** Undlad at flytte live-service eller overskrive data baseret alene på en godkendelse i brugerfladen.

## 3. Cloud-migrering uden datatab

1. Kontrollér at `jarvis-backup.service` kører uden fejl og verificér mindst ét restic-snapshot, før du ændrer installationen. Foretag gerne en isoleret restore-test.
2. Behold den kørende v4.5 og dens `.env` og `data/` urørt. Udpak v4.6 i en *ny* versionsmappe under `/home/administrator/jarvis/`. Kontrollér alle filer.
3. Kopiér private data og konfiguration til den nye versionsmappe med adgangsrettigheder `600` for `.env` og `700` for data-mappen. Bevar `JARVIS_PROJECT_ROOT=/home/administrator/JARVIS-Projects`.
4. Test den nye version med `npm test`, og kontrollér `JARVIS_HOST=127.0.0.1` og `JARVIS_PORT=8787`.
5. Stop først den eksisterende service ved et aftalt vedligeholdelsesvindue, ret systemd `WorkingDirectory`/`ExecStart` til den nye mappe, kør `systemctl daemon-reload` og start servicen. Kontrollér `journalctl -u jarvis`, `curl -I http://127.0.0.1:8787`, Command Center via Tailscale og Discord.
6. Ved fejl: stop service, peg systemd tilbage til v4.5 og genstart. Gendan kun data fra backup, hvis data er blevet inkompatible eller beskadigede. Denne release introducerer ikke en tilsigtet destruktiv datamigrering.

## 4. Begrænsninger og sikkerhedsmodel

- **Ingen zero-touch deployment endnu:** Godkendelse i JARVIS foretager ikke en installation.
- **Ingen offentlige porte:** JARVIS lytter lokalt; Tailscale Serve håndterer HTTPS på dit private tailnet. Hold UFW default-deny på almindelige offentlige interfaces.
- **Ingen udvidede rettigheder:** En kompromitteret webserver må ikke selv kunne ændre systemd units, læse restic-password eller installere vilkårlig kode som root.
- **Ingen selvtestede producentintegrationer:** Nest-dørklokke og Hue-bro hjemme kræver stadig særskilt lokal bridge og autorisation.
- Proaktive Discord-notifikationer forudsætter en aktiv Discord Gateway og tilladte DM'er. Notifikationer er best-effort og ikke en garanteret alarmkanal.
