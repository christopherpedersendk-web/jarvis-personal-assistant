# Eksterne OpenClaw-/Codex-rødder

Genbrug `scripts/backup-bundle.mjs` og eksisterende krypteret restic. Ingen ny scheduler eller automatisk serviceændring.

`runtime-mapping.example.json` viser de navngivne rødder på den observerede host. Gennemgå de faktiske stier og tilføj alle eksterne projekt-/data-/konfigurationsmapper. `selectedFiles` vælger enkelte regulære konfigurationsfiler uden at kopiere hele `/etc` eller ejerens komplette Codex-home. Hver fil får et entydigt lokalt navn i bundlen; originalstier bevares kun i det private manifest. Symlinks, traversal, dubletter, blandet directory/selectedFiles og konfigurationsfiler over 2 MB afvises. Backup/restore overskriver aldrig et eksisterende mål.

Bundlen er en privat offlinekopi, ikke kryptering. Den indeholder credentials og eventuelle sessionscookies. Bevar 0700/0600, gem aldrig bundlen i GitHub/releaseartefakter, og lad eksisterende restic kryptere den. `--service-stopped` er en operatørbekræftelse: stop JARVIS, Codex-skrivere og andre relevante skrivere gennem særskilt autoriseret drift før brug. Flaget må aldrig sættes alene for at få en test til at bestå.

```sh
node jarvis-starter/scripts/backup-bundle.mjs backup /sikker/gennemgaaet-mapping.json /privat/nyt-bundle --service-stopped
node jarvis-starter/scripts/backup-bundle.mjs restore /privat/nyt-bundle /privat/nyt-restoremaal --service-stopped
```

Restore udpakker navngivne rødder i et nyt mål; det installerer ingen service og omskriver ingen produktionsfiler. Brug et isoleret mål til gennemgang af absolute worktree-/repo-/service-stier før genstart. Genstart må ikke genafspille kodeændringer, publicering eller gamle godkendelser. Uafklarede job skal fortsat være ukendte/stop anmodet efter de eksisterende regler.

Den faktiske ekstra restic-snapshotprøve i docs/next/runtime-backup-evidence.json læste kun de ekstra runtimekonfigurationer og kodeagentmapper. Den stoppede ikke produktionsbotten og er ikke en konsistent offlinebackup af hele det aktive appdatalager. Den ændrede heller ikke den automatiske backupplan. Disse acceptgrænser skal bevares.
