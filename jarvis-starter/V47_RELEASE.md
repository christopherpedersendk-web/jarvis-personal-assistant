# JARVIS v4.7.0 · personlig intelligens (releaseforberedelse)

## Formål og scope

**Prioritet 1 – Proaktiv personlig sekretær:** Værdifulde daglige og ugentlige overblik, opfølgning på faktiske handlinger, datoer og projektstatus samt valgfri proaktiv Discord-DM. Der må ikke opfindes begivenheder, priser, deadlines eller udførte handlinger.

**Prioritet 3 – Command Center 2.0:** Chat-first layout, sektionerne *I dag*, *Næste 7 dage*, *Kræver opmærksomhed*, gennemsigtig kildevisning, færdighedskatalog og proaktive indstillinger.

**Teknologisk forberedelse:** Lokal retrieval med mulighed for senere semantisk adapter; versionsstyrede skill-dokumenter; standardiserede integrationskapabiliteter og hændelseskontrakt. Smart Home Bridge og egentlige Google/Home Assistant OAuth-integrationer hører til en senere release og er ikke aktiverede her.

## Designbeslutninger inspireret af andre assistenter

| Inspiration | Princip | JARVIS v4.7 |
|---|---|---|
| [OpenClaw Memory Search](https://docs.openclaw.ai/concepts/memory-search) | Separer søgebare hukommelseskilder fra sessioner; gør indeksering af samtaler eksplicit | Kun gemte noter, fakta, opgaver og projekter indekseres; ingen chattranskripter eller nøgler |
| [OpenClaw Skills](https://docs.openclaw.ai/tools/skills) | Separate SKILL.md-procedurer med struktureret metadata | Tre indbyggede, allowlistede read-only skills og katalog |
| [Letta Memory Blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks) | Små, beskrevne, kontrollerede memoryblokke frem for én stor prompt | Langtidshukommelse og kilder kan hentes relevansbaseret; brugerens varige præferencer forbliver eksplicitte |
| [OpenAI Retrieval](https://developers.openai.com/api/docs/guides/retrieval) | Hybrid keyword/semantic retrieval og source-aware RAG kan udvides med vektorsøgning | Vægtet lokal nøgleordssøgning nu; et eventuelt embeddings-adapter skal opt-in og må kun rangordne allerede tilladte dokumenter |
| [Home Assistant Calendar Entity](https://developers.home-assistant.io/docs/core/entity/calendar) | Tydelige datointervaller, entiteter og rettigheder for integrationer | `integration-catalog.mjs` deklarerer kapabiliteter uden at påstå forbindelse; normaliseret eventkontrakt til kommende adaptere |

## Komponenter

- `personal-knowledge.mjs`: dynamisk privat dokumentkatalog og vægtet lokal keyword-retrieval med typede kilde-ID'er. Ingen sekundær persisted indeks, ingen embedding-forbrug, ingen scanning af `.env`, disk eller chatlog. `searchHybrid` er en passiv kontrakt for en *fremtidig* semantic scorer. Den er ikke slået til.
- `skills-registry.mjs` og `skills/*/SKILL.md`: read-only indbyggede instruktioner. Filer læses kun fra en statisk allowlist, valideres og kan ikke være symlinks. Brugerskrevne noter bliver ikke til udførbare skills.
- `proactive-planner.mjs`: kun bevisbaserede facts fra organiseringsdata, faktiske task-statusser, indbakke og godkendelseskø. Dagligt tidspunkt 07:30 og ugentligt søndag 18:00 Europe/Copenhagen; 2-timers tidsvindue, stilleperiode 22:00–07:00, deduplikeringsnøgle pr. dato/periode, atomisk persistens af inbox/markør før valgfri DM, højst én markør pr. briefingtype per dag. Ingen OpenAI API-kald for disse overblik.
- `integration-catalog.mjs`: eksplorativ kapabilitetsoversigt og begrænset eventformat. Viser eksisterende opsætningsstatus uden at returnere tokens. Ingen generisk API til at eksekvere integrationers handlinger.
- API: `POST /api/knowledge/search`, `GET /api/skills`, `GET /api/integrations`, `GET /api/proactive`, `POST /api/proactive/settings` er alle bag eksisterende bearer-autentifikation. `GET /api/dashboard` inkluderer agenda/leveringshistorik. Tekstchat og realtime-stemmechat kan kalde read-only retrievalværktøjet.
- UI: samtale før statuspaneler; tre nye agenda-kort; **Viden & skills**-fane; proaktive indstillinger.

## Privatliv og sikkerhed

1. JARVIS sender ikke personlige dokumenter til et nyt embeddings-API i v4.7. Søgning er lokal. Relevante søgeresultater kan dog stadig sendes til den allerede konfigurerede OpenAI chatmodel, når brugeren aktivt chatter – som i tidligere versioner.
2. Dags- og ugebriefinger genereres deterministisk, uden nye betalte modelkald. Ingen skjulte handlinger, betalinger, kalenderændringer eller tredjepartsbeskeder.
3. Den nye Discord-indstilling er `false` som standard; den kræver desuden, at den eksisterende `discordAlertsEnabled` er slået til. Discord beskeder går kun til den eksisterende ejers DM. Ingen andre notifikationer ændres af stilleperiodens nye indstillinger.
4. Indbakke og deduplikeringslog ligger i eksisterende `data/state.json` (`settings.proactive` og `proactiveDigests`). Ingen ny migration eller database kræves.
5. Kun releasens tre versionsstyrede skills læses af runtime. De kan ikke importere biblioteker eller udføre kode. Redigerbare playbooks forbliver adskilt.
6. Integrationskataloget afslører hverken Sonos-/Discord-/Hue-tokens, private endpoints, billeder eller webcamdata. OAuth og scopes skal designes og godkendes, før en adapter forbindes.

## Test og installation (ingen direkte liveændringer ved oprettelse af denne branch)

1. Gennemgå feature-branchen og dens pull request. Kør `npm test` (inkl. realistiske datoer, DST, kildefakta og autoriserede endpoints). Kør også `node --check server.mjs` og UI-scripts.
   Den særskilte GitHub Actions-workflow `.github/workflows/v47-visual.yml` starter desuden en syntetisk lokal JARVIS-server i en midlertidig CI-runner og tester reelt Chromium-layout i desktop- og mobilbredde, videnssøgning, skills, integrationskort og indstillinger. Skærmbilleder gemmes som `jarvis-v47-ui-screenshots` i workflowkørslen. **Release bør afvente bestået browser-smoke og visuel gennemgang af billederne.** Playwright installeres kun i CI; ikke på produktionsserveren.
2. Merge først efter review til den releasebranch, som ligger bag opdateringsflowet. Opret først da et **nyt, unikt** `v4.7.0`-tag på præcis den gennemgåede commit. Overvåg de eksisterende GitHub-deployrettigheder; ingen force push eller genbrug af gamle tags.
3. Åbn privat JARVIS via Tailscale. Vælg **System Health → Søg efter version → Hent og test**. Bekræft `v4.7.0` og den præcise testede commit. Vælg derefter **Godkend testet version**.
4. Den eksisterende `jarvis-deploy.timer` installerer kun en godkendt, testet commit. Dens root-ejede service tager lokal restic-backup, skifter `current`-symlink, genstarter og foretager healthcheck; mislykket healthcheck ruller tilbage.
5. Bekræft `node -p "require('/home/administrator/jarvis/current/jarvis-starter/package.json').version"`, `sudo systemctl is-active jarvis`, `curl -I http://127.0.0.1:8787`, Discord DM og de nye skærme. Undgå at kopiere `.env` eller data manuelt; de eksisterende sikre symlinks bevares.

## Åbne punkter til v4.8

- Semantisk retrieval/embeddings med **brugerens eksplicitte opt-in**, valgfri lokalt embeddingsmodel, dataklassifikation, opt-out af kilder, synlig indeksering og sletning.
- Faktiske Google Kalender-/Tasks-forbindelser med OAuth-scopes og synkroniserede entitets-ID'er; særskilt godkendelse af alle eksterne ændringer.
- Valgfri Home Assistant Bridge for Hue/Nest/Sonos via lokalnet eller godkendt privat tunnel, normaliserede hændelser og klare actionscopes.
- Automatiske evalueringscases for retrieval-precision, hallucinering, fejlagtig konflikt mellem noter samt deduplikering ved process crashes.
