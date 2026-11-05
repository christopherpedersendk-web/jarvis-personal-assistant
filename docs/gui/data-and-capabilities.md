# GUI: datakilder, rettigheder og kladders livscyklus

Dette dokument beskriver den implementerede GUI på den flettede v5-kodebase. Det er en kontrakt for review og videre vedligeholdelse, ikke dokumentation for en bestemt installations aktuelle forbindelser eller drift. Screenshots og syntetiske testdata beviser hverken en liveintegration, en produktpris eller en udført handling. GUI-arbejdet ændrer ikke M0–M7, releaseplanen eller integrationsrettighederne.

## Navigation og de oprindelige objekter

GUI'en flytter de eksisterende formularer og controllere i DOM. Den opretter ikke en ekstra kopi af brugerens data for en ny fane. URL'en bevarer kilde-ID'er og relevante parametre; gamle fanenavne oversættes af `JarvisNavigation`. Skift af fane er ikke en gemning, godkendelse eller ekstern handling.

| Placering | Rute og oprindeligt objekt | Formular/controller og eksisterende API |
| --- | --- | --- |
| I dag | `view=home`; dateret oversigt over eksisterende opgaver, kalender, madplan og indbakke | `gui-today.js`, `organizer.js`, samme chatpanel; `/api/dashboard`, kalendercache og de oprindelige domænekilder. Ukendt dækning tælles ikke som en tom dag. |
| Planlægning → Opgaver → Personlige | `view=plan&section=tasks&kind=personal`; `personal-task:<id>` og `follow-up:<id>` | `#personal-task-form`, `#follow-up-form`, `v5-plan.js`; `/api/personal-tasks`, `/api/follow-ups`, deres revisionsbundne handlinger og `/api/planning/simulate`. En simulering gemmer ikke automatisk en plan. |
| Planlægning → Opgaver → Agentarbejde | `view=plan&section=tasks&kind=agent`; eksisterende `task:<id>`, bortset fra monitor-kategorien | Én `#task-form` i `#task-editor-shell`, `job-policy.js`; GET/POST `/api/tasks`, PATCH `/api/tasks/:id`, POST `/api/tasks/:id/action`, `/api/skills`. Original kørselspolitik, budget, historik og revision bevares. |
| Planlægning → Opgaver → Kodeprojekter | `view=plan&section=tasks&kind=projects`; brugerens `project:<id>` | `#project-form`, `v5-projects.js`; `/api/projects` og de eksisterende udviklings-, test-, installations-, arkiv-, gendannelses- og rollback-handlinger. Disse projekter er brugerarbejde. |
| Planlægning → Kalender | `view=plan&section=calendar`; `google-calendar:<…>` | `gui-calendar.js` viser den eksisterende cache. Kalenderopsætningens oprindelige `#meal-google-calendar-form` ligger under Integrationer. |
| Planlægning → Madplan | `view=plan&section=meals`; `meal-plan:<id>`, opskrifter, husstand, lager og indkøbsforslag | `meals.js`, de oprindelige formularer og `/api/meals`, `/api/recipes`, `/api/shopping-drafts`, `/api/nemlig/*`. Gemning, genberegning, varesøgning og kurvoverførsel er adskilte handlinger. |
| Planlægning → Noter og lister | `view=plan&section=notes`; `organizer:<collectionId>:<itemId>` | `#collection-form`, `organizer.js`; `/api/organizer`, `/api/organizer/search` og samlings-/punkt-API'er. `updatedAt` bevarer det oprindelige ændringsgrundlag. |
| Hjem | `view=smart-home`; eksisterende integrationsstatus og læste Hue-/Sonos-ressourcer | `smart-home.js`; `/api/smart-home`, `/api/smart-home/hue/*`, `/api/smart-home/sonos/*`. Intet nyt integrationslag. |
| Overvågninger | `view=watches`; de samme `task:<id>` med `category: monitor` | `gui-watches.js` bruger `job-policy.js` og de samme task-API'er. Det samme editor-element flyttes mellem `#tasks-editor-host` og `#watches-editor-host`; ID, revision og ugemt tekst bevares. |

Monitorer renderes i Overvågninger og filtreres fra den almindelige agentliste. En kildeåbning nulstiller et eventuelt Aktiv/Pauset-filter og bevarer `source=task:<id>` med den valgte destination. Filtrene ændrer kun visningen.

## De seks indstillingskategorier

| Kategori | Ruteparameter `section` | Faktisk indhold og kontrakt |
| --- | --- | --- |
| Om dig og hukommelse | `profile` | `#memory-workbench`, det oprindelige præferencefelt, hukommelsespunkter og strukturerede claims. `/api/memories`, `/api/personal-claims`, `/api/preferences`. Almindelige organiser-noter kopieres ikke hertil. |
| Notifikationer | `notifications` | `#proactive-form`, briefing-/stilletidsvalg, påmindelser, Discord-levering og Pushover-felter/test. `/api/proactive`, `/api/proactive/settings`, den relevante del af `/api/settings`, `/api/notifications/test`. Ingen kanal aktiveres ved navigation. |
| Integrationer | `integrations` | Det eksisterende integrationskatalog samt Discord-, Google-, Hue- og Sonos-opsætning. `/api/integrations`, `/api/discord/settings`, Google-status/forbindelse/kalendervalg, Hue- og Sonos-indstillinger. Nest vises som ikke implementeret. AI-nøglen er serveropsætning; GUI'en opfinder ikke et redigerbart nøglefelt eller nye OAuth-rettigheder. |
| Automatiseringer | `automations` | Arbejdsinstruktioner/playbook, arbejdsgange/skills, opgaveskabeloner og den daglige kørselsgrænse. `/api/playbook`, `/api/skills`, den relevante del af `/api/settings`. Nye skabeloner bruger katalogets aktuelle version; eksisterende jobs beholder deres fastlåste skill-version. |
| System og opdateringer | `system` | Serveradresse, faktisk systemstatus, JARVIS' egne kodeforslag og updateren. `/api/settings`, `/api/system-health`, `/api/code`, `/api/updates` og `/api/updates/action`. Brugerens selvstændige kodeprojekter ligger under Planlægning. |
| Denne enhed | `device` | Den eksisterende logout-handling og lokal sessionshåndtering. Logout sletter ikke serverens brugerdata eller historik. |

`#settings-form` er fortsat én formular. Flyttede kontroller henviser til den med HTML's `form`-attribut. `scopeFields` begrænser Gem og Kassér til den aktive kategori: leveringsfelter, kørselsgrænse eller serveradresse. Controlleren sender kun ændrede felter som `{patch, expectedBasis}`. Feltets serverdigest følger med, så en ændring i en anden fane ikke stiltiende overskrives. Nøgler returneres ikke til inputfelterne; blankt nøglefelt bevarer den gemte nøgle.

## Kalender: kun læsning, dækning og cache

Den faktiske Google-implementering anmoder om `https://www.googleapis.com/auth/calendar.readonly` og eksponerer `canEdit: false`. GUI'en opretter, flytter eller sletter ingen Google-aftaler. Linket **Se i Google Kalender** åbner udbyderen til brugerens egen redigering.

GET `/api/google/calendar/cache` læser den lokale cache. Ugeskift og I dag laver denne læsning; de udløser ikke selv en ny Google-læsning. Den udtrykkelige knap **Opdater kommende aftaler fra Google** kalder det eksisterende `/api/google/calendar/events?days=14`. Forbindelse, valgt kalender, cacheudløb, forespurgt periode og dækningsinterval vurderes hver for sig. Kun `ready: true` med fuld relevant dækning tillader teksten **Ingen aftaler**. Ellers vises manglende forbindelse, udløbet login, forældede data eller ukendt dækning. Tidligere observerede aftaler kan fortsat vises med deres alder; de bliver ikke gjort aktuelle af et fejlet forsøg.

## Noter, hukommelse og strukturerede oplysninger

En almindelig note/liste er et organizer-objekt til brugerens arbejde. Et hukommelsespunkt fra `/api/memories` er en oplysning, som brugeren ønsker brugt på tværs af samtaler. Et struktureret claim fra `/api/personal-claims` har særskilt status, revision, kilde og eventuel gyldighed. Der er ingen automatisk konvertering mellem disse typer.

Hukommelsens visning bevarer kilde, kanal, udløb, historik og behovet for bekræftelse. Et foreslået claim bliver ikke bekræftet ved læsning eller søgning. Rettelse af et bekræftet claim opretter et rettelsesforslag; erstatningen kræver gennemgang af de konkrete revisioner. Arkivering fjerner et punkt fra den aktive hukommelse/søgning, men ændrer ikke tidligere samtaler eller sikkerhedskopier. Kildehenvisninger er data, ikke instruktioner, og hentes ikke automatisk blot fordi et felt indeholder dem.

## Madplan og indkøb: én oprindelig plan, særskilte handlinger

Madplanens lokale indkøbsliste er `plan.shoppingList` på det oprindelige madplanobjekt. Både visning og redigering bruger `/api/meals/plans/:id/shopping-list` med planens `expectedRevision`. Det er ikke en ny organizer-liste eller en uafhængig GUI-kopi. En indgang til den eksisterende liste skal åbne den samme plan og dens aktuelle liste.

**Gem ændringer i madplanen** gemmer retterne og markerer behovet for at beregne listen på ny. **Opret/Genberegn indkøbsliste** er et separat POST. En manuel listeændring bruger separat PUT. Den flettede upstream bevarer manuelle mængdevalg og eksplicitte udeladelser, viser ændret beregningsgrundlag og kræver relevant gennemgang før varesøgning. Planlagte rester er heller ikke registreret forbrug eller lager.

Et `shopping-draft:<id>` og et `nemlig-proposal:<id>` er efterfølgende, selvstændige backendobjekter med deres egne ID'er og revisioner. De må ikke omtales som samme ID som planen. Varesøgning, forslag, gennemgang og eksisterende revisions-/intentbundet kurvoverførsel beholder deres oprindelige trin. Layoutændringen foretager intet køb og aktiverer ikke en integration, der ikke er tilgængelig.

## Overvågninger: aktivitet, forsøg, observation og aktualitet

En overvågning bruger de eksisterende monitor-jobs. Ny overvågning åbner den fælles editor med tomme felter og monitor-kategorien; den gemmes som pauset kladde før aktivering. Pause, genoptagelse, redigering, enkeltkørsel og arkivering genbruger de eksisterende API'er, bekræftelser og `expectedRevision`.

Fire forhold vises separat: jobtilstand, seneste kontrols udfald, seneste brugbare observation og dennes aktualitet. Et nyere mislykket forsøg ændrer ikke en gammel pris til et nyt resultat. Forsøgets tidspunkt, observationens tidspunkt og tidspunktet for den seneste brugbare kontrol beholdes hver for sig. Interval/dagsplan og dansk sommertid indgår i aktualitet; ukendt tidsplan, fremtidig måling eller ændrede kriterier giver ikke en friskhedsbekræftelse.

Observationerne er modelrapporterede. En korrekt formateret HTTPS-kilde og en værdi er ikke uafhængigt bevis for, at kilden er læst. Upstreams `reviewMonitorAnswer` sammenligner kun samme præcise kilde, emne, variant, enhed og værditype. En første brugbar observation eller et ændret kildegrundlag kan derfor have en værdi og samtidig `status: unknown` for ændringen. GUI'en viser denne forskel og opfinder ikke et prisfund, en tærskeloverskridelse eller en købsmulighed ud fra fritekst.

## Hjem: tilgængelighed og bekræftede handlinger

Lokale statuslæsninger og udbyderlæsninger holdes adskilt. Polling af `/api/smart-home` og indstillinger opdaterer status. Hue-ressourcer og Sonos-grupper hentes ved brugerens eksisterende eksplicitte læsning eller Hue-parring, ikke skjult ved hver statuspolling. Manglende opsætning, forbindelsesfejl, ukendt læsning og tomt ressourceudvalg er forskellige tilstande.

Kontroller bygges fra faktisk returnerede ressourcer; en ændret bridge/husstand rydder gamle ressource-ID'er. En lysstyrke opfindes ikke, hvis den ikke er læst. En kontrol vises først som bekræftet ved et passende positivt backendresultat eller en allerede journalført, afsluttet handling. Ukendt/delvist/fejlet udfald genforsøges ikke automatisk; den eksisterende handlingsidentitet bevares. Et efterfølgende statuslæseproblem annullerer ikke en allerede bekræftet kommando. Nest forbliver **Under forberedelse** uden falske livekontroller. Test-dørklokken er eksplicit simuleret.

## Chat: én historik og eksplicit tekstkontekst

I dag og den globale **Spørg JARVIS** flytter det samme chatpanel. Der er ét beskedfelt, én kladde og én eksisterende serverhistorik. GUI'en opfinder ikke separate samtaler for hver fane. Historik hentes fra bootstrap og `/api/history`; en besked sendes gennem `/api/message`.

Brugeren kan vælge **Vedhæft kontekst**. Den synlige kontekstlabel og eventuelle kilde-ID tilføjes som eksplicit tekst foran beskeden. Det er ikke en skjult indlæsning af hele objektet eller en ny conversation-ID-kontrakt. Kontekst og tekst fastholdes som et snapshot før requesten; et senere faneskift ændrer ikke den afsendte besked. En ny kladde skrevet under behandlingen bevares. Ved uafklaret udfald låses gensendelse indtil brugerens gennemgang, fordi værktøjer kan være udført selv om det afsluttende svar mangler.

## Kladder, genindlæsning, logout og hemmeligheder

`sessionStorage` er fanens genindlæsningshjælp, ikke en servergemning, backup eller generel hemmelighedsboks. Browserens gendannelse efter lukning afhænger af browseren. De eksisterende adgangstokens i `localStorage` er autentifikationsmekanismen, ikke en del af kladdeobjekterne. Mønstergenkendelse for hemmeligheder er en begrænset screening; den garanterer ikke, at al følsom fritekst opdages.

| Controller | Navigation og reload | Logout og usikre udfald | Hemmeligheder / konkrete undtagelser |
| --- | --- | --- | --- |
| `chat-draft.js` | Samme DOM; `jarvis:v5:chat-draft` gemmer tekst, eksplicit kontekst og pending/review-markering. | Tømmer felt, kontekst og lager; generations-/ejerguard ignorerer gamle svar. Gendannet pending kræver gennemgang, ingen automatisk send. | Secret-lignende tekst/kontekst udelades fra browserlager. Tekst kan blive i feltet; før-lukning-advarsel ved kladde eller uafklaret request. |
| `app.js`: præferencer/playbook | `jarvis:v5:unsaved-text` bevarer tekst og det oprindelige `expectedText`-grundlag. Nyere indtastning overlever et afsluttet save. | Logout nulstiller felter, in-memory basis og reviewpaneler; gammel save-respons kan ikke genoprette dem. Konflikt kræver gennemgang af ny servertekst. | Både tekst og basis screenes før persist/restore. En udeladt kladde bliver i hukommelsen; sikker søsterkladde bevares. Advarsel ved ikke-gendannelig ugemt tekst. |
| `job-policy.js` | Samme form på tværs af Planlægning/Overvågninger; sessionkladde med felter, task-ID og basisrevision. | Logout rydder editor, records og skill-cache; gammel respons ignoreres. Polling ændrer ikke kladdens revision. | Kendte nøgler/tokens og ejerens token udelades fra lager og blokerer gemning som jobtekst. Advarsel ved kladde uden sikker lagring. |
| `gui-watches.js` | Visningsdata/filter i hukommelsen; editorens kladde tilhører `job-policy.js`. Ingen ekstra monitor-datastore. | Logout rydder rækker; fokuseret gammel revision bevares synligt som forældet, ikke stiltiende opgraderet. | Ingen credentialfelter eller selvstændigt browserlager. |
| `settings-drafts.js` | Separate `settings-draft:system`, `:discord`, `:proactive` under `jarvis:v5:`; kun ændrede almindelige felter og deres digests. | Logout rydder felter, basis og lager. Responses kontrolleres mod ejer/generation; den aktive kategori gemmes/kasseres særskilt. | Passwordkontroller gemmes aldrig i sessionStorage. Almindelige felter screenes. Nye hemmeligheder lever kun i DOM indtil save/reload/logout; beforeunload advarer. |
| `smart-home.js` | IP/husstands-ID og ny Sonos-nøgle er kun i den eksisterende DOM; intet kladdelager. Nyere input bevares ved save/refresh. | Logout rydder felter, ressourcer og pending-state; gamle svar ignoreres. Ved uafklaret kommando beholdes intent i den aktive session. | Ingen hemmeligheder serialiseres lokalt. Ugemte værdier/clear-valg giver før-lukning-advarsel og går tabt ved reload. |
| `organizer.js` | `jarvis:v5:organizer-drafts` bevarer oprettelse, søgetekst, omdøbning og punktredigering med oprindeligt `updatedAt`. | Logout rydder lister/kladder og hæver session; uafklaret skrivning beholdes som sådan. | Secret-lignende kladdeposter udelades; øvrige poster bevares. Ved udeladelse eller lagerfejl advares før lukning. |
| `memory-v49.js` | `memory-note-draft`, `memory-note-edits`, mode og arkivvalg under `jarvis:v5:`; original revision og uafklaret gemning bevares. | Logout rydder editor, historikvisning, kort og lager. Polling bekræfter ikke et forslag. | Mønstre og ejerens token screenes; udeladte kladder bliver i DOM og udløser relevant før-lukning-advarsel. |
| `JarvisClaims` i `v5-plan.js` | `jarvis:v5:memory-claim-draft` bevarer felter, kilde, gyldighed, basis, review og pending-state. | Logout rydder controlleren; genindlæsning udfører ingen bekræftelse. Ukendt save kræver afklaring. | Secret-lignende indhold udelades fra lager; eksisterende før-lukning-advarsel ved ikke-gendannelig kladde. |
| Personlige opgaver/opfølgning/kapacitet i `v5-plan.js` | `jarvis:v5:plan-drafts` bevarer felter, ID/revision, tidsrum og tidligere forslag. Gendannet kapacitet kræver ny manuel gennemgang/beregning. | Logout rydder formularer, resultater og lager. Kilde-/ejerguards beskytter læsninger. | Ingen credentialkontroller indgår. Denne eksisterende controller har ikke en generel secret-pattern-filter på alle fritekstfelter. Lagerfejl giver før-lukning-advarsel. |
| `meals.js` | `jarvis:v5:meal-drafts` bevarer de registrerede husstands-, præference-, lager-, opskrifts-, plan-, liste- og forslag-editorers felter med originalt record/revision. | Logout rydder formularer, kort og sessioncache. Gendannelse sender ingen mutation eller godkendelse. | OAuth-/integrationsnøgler og godkendelses-intents indgår ikke i disse kladder. Der er ikke en generel secret-pattern-filter på al opskrifts-/planfritekst. Ikke-gendannelige felter giver før-lukning-advarsel. |
| `v5-projects.js` | `jarvis:v5:project-drafts` bevarer projekt-/kodeanmodning, revision/hash og lokal handlingsafklaring; ikke filindholdet som et nyt projekt. | Logout rydder formularer/kort/lager og hæver generation. Uafklarede operationer bliver ikke automatisk gentaget. | Ingen credentialkontroller indgår; eksisterende fritekstscreening er ikke generel. Lagerfejl giver før-lukning-advarsel. |
| `system-health.js` | Ingen godkendelseskladde i sessionStorage. Status og lokal attempt-lås i hukommelsen; reload henter den vedvarende serverjournal. | Logout/sessionændring rydder privat status. Tabt HTTP-svar behandles som uafklaret indtil matchende journalresultat. | Ingen credentialfelter. Ingen gendannet klikintention eller automatisk approval. |
| `gui-calendar.js`, `gui-today.js`, `intelligence.js` og shell | Læsemodeller i hukommelsen; dato/rute/kilde i URL. Søgetekst kan ligge i den aktuelle `history.state`; shell flytter paneler uden at kopiere controllere. | Logout rydder aktuelle resultater/kontekst; søgning rydder også den aktuelle history-state. URL/browserhistorik er ikke en garanti for sikker sletning af tidligere navigation. | Ingen credentialkontroller. Søgetekstens history-state har ikke generel secretscreening; den må ikke beskrives som et credentiallager. |

## Updater: præcist reviewgrundlag og bevaret durable state machine

Upstreams nye `DurableState`, committed-only snapshots, serialiserede commits, check/stage-journaler og fail-closed adfærd er bevaret. Manglende verificeret lager, `publicationUnknown`, aktiv handling eller uafklaret stage giver ikke en aktiv godkendelsesknap. Et tabt HTTP-svar regnes ikke automatisk som en afvist handling. Isolerede test-/checkout-/sti-/containerkrav er fortsat backendens ansvar og er ikke omgået af GUI'en.

HTTP-kontrakten for POST `/api/updates/action` er:

- Søgning: `{action: 'check'}`.
- Hentning/test: `{action: 'stage', version, expectedSha}` for den gennemgåede tilgængelige kandidat.
- Godkendelse: `{action: 'approve', version, expectedSha, expectedTestedAt}` for den gennemgåede, aktuelt testede kandidat.

Serveren kræver eksisterende version/SHA-grundlag for stage/approve. GUI'en viser den konkrete version, fulde SHA og testtid før godkendelse. `UpdateManager.approve(version, expectedSha, expectedTestedAt)` validerer det ekstra testtidspunkt **inde i samme serialiserede durable commit** som upstreams versions-, SHA-, test-, pakke- og schema-kontrol. Et ændret testtidspunkt giver 409 uden godkendelsesmutation. Dermed kan et nyt testresultat på samme SHA ikke erstatte det gennemgåede resultat ubemærket. Ældre interne kald uden tredje argument bevarer upstream-kompatibiliteten; den nye GUI sender altid tidspunktet.

Godkendt er ikke det samme som installeret. HTTP-handlingen deployer ikke processen; faktisk installation tilhører den eksisterende særskilte deploy-tjeneste. GUI-implementeringen tilføjer ingen OAuth-scope, backendrettighed, købsret, produktionsudrulning eller automatisk merge.

## Kilder og verificeringens grænse

Kontrakten kan spores til `jarvis-starter/public/gui-navigation.js`, `gui-shell.js`, `app.js`, `chat-draft.js`, `settings-drafts.js`, `job-policy.js`, `gui-watches.js`, `smart-home.js`, `system-health.js`, `organizer.js`, `memory-v49.js`, `v5-plan.js`, `v5-projects.js`, `meals.js`, `gui-calendar.js`, `gui-today.js` og `intelligence.js`; backendgrænserne findes i `server.mjs`, `google-calendar.mjs`, `monitor-observation.mjs`, `task-engine.mjs`, `meal-planner.mjs` og `update-manager.mjs`.

Målrettede Node-/DOM-kontrakttests kontrollerer blandt andet delt editor, versionsbundet handling, ændret kildegrundlag, gamle observationer, kladders forventede tekst, sessionguards og hemmelighedsudeladelse. De beviser ikke faktisk CSS-layout, skærmlæseroplevelse, mobilkeyboard eller provider-/deployadfærd i brugerens installation. Browser- og CI-resultater samt resterende manuelle checks føres i de øvrige review-/verifikationsdokumenter; denne kontrakt hævder ingen livekørsel.
