# Opfølgning efter JARVIS v5.0.0

Status pr. 5. november 2026: v5.0.0 er merged og udgivet fra `f52b871e2e767c6a6ba2db50016fa2e4c2e19dee`. Ejeren har oplyst, at versionen er opdateret. Ældre udsagn om “M7 ikke udført” i kandidatdokumenterne beskriver tiden før udgivelsen og er ikke den aktuelle releasestatus. Produktionslogs og faktisk kørende serverrevision er ikke indlæst i denne fejlretning.

## Rapporterede fejl og rettelse

### Discord svarer ikke

Ejeren har præciseret, at webchat virker. Den delte chat-/modelkode ændres derfor ikke på grundlag af den oprindelige, bredere fejlbeskrivelse.

Kodefund:

- Gatewayen bad altid om serverbeskeder og det privilegerede Message Content-intent, også når kun direkte beskeder var konfigureret. DM-opsætning beder nu kun om DIRECT_MESSAGES. En eksplicit Server ID bevarer de nødvendige serverintents.
- Beskeder kunne filtreres fra på User ID, Server ID eller tomt indhold uden en forklaring i brugerfladen. Integrationsstatus viser nu seneste modtagelse og afvisningsgrund samt sidste leverede svar. Adgangen er fortsat begrænset til den konfigurerede ejer/server.
- En fejl under assistentens behandling gav intet svar. Den sender nu én fast fejlbesked, når levering af et almindeligt svar endnu ikke er forsøgt. Et allerede påbegyndt eller tvetydigt svar genforsøges ikke; handlingens ukendte udfald og deduplikering bevares. Et tomt modelsvar er en fejl, ikke en falsk succes.
- ID-felter og token normaliseres ved start, så indledende/afsluttende mellemrum ikke medfører falsk mismatch. Diagnostik indeholder ikke indgående beskedtekst eller upstream-fejlindhold.

Det er konkrete kodefejl og forbedringer, men uden live logs kan den enkelte årsag til ejerens tavse bot ikke fastslås. Efter installation: send en ufarlig direkte testbesked, og læs **Indstillinger → Integrationer → Discord**. “Afsender matcher ikke” kræver ejerens User ID; “server matcher ikke” kræver korrekt Server ID. Ingen modtagelse peger på forbindelse/Discord-opsætning. “Behandling” og “levering” skelnes i status; serverchat kræver også Message Content Intent og adgang til kanalen/Send Messages. En driftsprøve skal vise et faktisk svar og ingen dobbelt handling efter genforbindelse.

### Madplan: én plan ad gangen, kort ugeoverblik

Den tidligere visning renderede op til fem komplette planer efter hinanden med alle dagseditorer åbne. Den nye viser én valgt plan. Historik vælges i en liste; den slettes ikke. Dublerede plan-ID'er bliver ikke til ekstra kort. Kun den valgte plan og bevarede ugemte kladder renderes, så en stor historik ikke giver hundredvis af skjulte editorer på telefonen.

Hver dag vises som dato, ret, portioner og eventuel lås. Tryk på dagen for at redigere. Husstand, opskrifter og øvrige værktøjer kan foldes ud efter behov. Kildelinks åbner fortsat den præcise plan/dag. Ugemte rettelser, konfliktkontrol, fokus og portionsberegninger bevares ved polling, skift mellem planer og genindlæsning.

## Manglende milestones og anbefalet rækkefølge

| Prioritet | Milestone | Resterende arbejde / afslutningskriterium |
|---|---|---|
| P1 – nu | Stabilisering efter release | Installér den gennemgåede rettelse; verificér et faktisk Discord-svar og én redigerbar madplan på telefonen. De to rapporterede fejl er ikke lukkede i drift alene ved grønne syntetiske tests. |
| M6 – dokumentér accept | Fysisk iPhone og desktop | Safari/skærmtastatur, faktisk zoom, mikrofon/tale, navigation og kladdebevaring. Browserautomation er gennemført for v5-kandidaten; fysisk accept er ikke dokumenteret. |
| M6 – dokumentér drift | Administratorens gendannelse og drift | Kontroller backup/restore, genstart, private indstillinger, Discordjournal, medier/projekter og den faktiske servicekonfiguration i et isoleret restore-miljø. Den tidligere syntetiske restore dækkede ikke hele dette miljø. |
| P2 – næste funktionsrelease | Sonos | Fuld OAuth og tokenfornyelse samt reelle afspilnings-/kontrolprøver. Eksisterende funktioner er ikke bevis på et færdigt OAuth-flow. |
| P2 | Google Nest | Batteriringeklokke-/kamerahændelser og brugbare notifikationer; verificér faktisk eventlevering. |
| P2 | Home Assistant / Google Home | Den udskudte bridge og samlet kontrol-/statusflow. |
| P2 | Google Kalender og Tasks | Skriveadgang, eksplicit brugerhandling og korrekt håndtering af konflikter/fejl. Nuværende kalenderlæsning er ikke skrivning. |
| P2 | Browserhandlinger og bookinger | Browserautomation med konkret gennemgang/godkendelse og pålidelig kvittering; undgå gentagelse ved ukendt udfald. |
| Optimering | Søgekvalitet og performance | Gennemgå de fem misses i 80-spørgsmålsprøven, og profilér retrieval/durable writes. v5 nåede 93,75 % mod kravet 90 %, men enkelte operationer var langsommere end v4.9.1. Det er forbedringsarbejde, ikke en udokumenteret ny releaseblokering. |

M0–M5's implementerede funktioner skal ikke genopføres som manglende blot fordi ældre matricefelter siger “samlet CI afventes”. Den samlede v5-kandidat havde 990 Node-tests, 36 GUI-scenarier og fire dybe browserforløb bestået. Hukommelse, generel planlægning, husstand/madplan, kladder og den nye navigation er leveret; ovenstående vedrører de rapporterede regressioner, udestående fysisk/driftsaccept og eksplicit udskudt funktionalitet.

## Verifikation af denne rettelse

- Lokal Node 24: **996/996 tests bestået**, nul fejl eller skips.
- Heraf målrettet Discord/madplan: **57/57 bestået**.
- Browserregression: afventer GitHub Actions på den publicerede kandidat. Den dybe test åbner dagseditorer gennem deres faktiske summary-kontrol og kontrollerer én synlig plan samt kompakt standardvisning.
- Faktisk Discord-konto, fysisk telefon og produktion er ikke testet her. Ingen ny release, merge eller installation er udført af denne rettelse.

Kilder: [implementeringsplanens P2-afgrænsning](implementation-plan.md), [samlet v5-verifikation](../gui/verification.md), [manuel acceptliste](manual-acceptance.md) samt ejerens fejlrapport/præcisering efter opdateringen.
