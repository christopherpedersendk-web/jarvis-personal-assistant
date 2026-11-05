# JARVIS v5.0.0 – udviklingskandidat til gennemgang

**Ikke accepteret som endelig release, ikke flettet, ikke udgivet og ikke installeret.** Alle P0/P1 skal lukkes og verificeres før release. Se progress.md for præcis senest testet revision; nye arbejdsændringer arver ikke historiske testresultater.

## Funktioner og forbedringer

- Dansk **I dag · Plan · Mad og indkøb · Min viden · Hjem · Projekter · Indstillinger**. Desktopsidebar og mobil I dag/Plan/Mad/Viden/Mere med reelle URL'er og tilbage/frem. I dag prioriterer chat, mikrofon og få relevante forhold; historik og normale driftsdetaljer er samlet under en lukket fold. Kritiske driftsproblemer er stadig synlige.
- Personlig hukommelse adskiller forslag, bekræftet, midlertidig, konflikt, planlagt/udført, historisk og ugyldig viden. Direkte dato-/statusopslag kombineres med lokal tekstsøgning og valgfri ægte semantik. Kilder og korrektioner bevares, og ugyldige fakta fjernes straks fra aktuel retrieval.
- Én synlig hukommelsesindgang understøtter både eksisterende noter og strukturerede oplysninger. Legacy-noter får faktisk revisionshistorik på samme post; strukturerede oplysninger bruger særskilte korrektionsforslag med eksplicit bekræftelse. Ældre historik opfindes ikke. Arkivvisning er read-only og er ikke aktuelle personlige fakta.
- Generel planlægning virker uden mad/indkøb. Personlige opgaver, kalenderaftaler og automatiske jobs har forskellige modeller. Varighed/usikkerhed, frist, tidsvinduer, afhængigheder, buffere og låse valideres deterministisk; manglende kapacitet står som ukendt. Selektiv genplanlægning bevarer upåvirkede manuelle valg og forklarer umulige planer.
- Vedvarende opfølgningssager, strukturerede observationer og eksplicit retry/pause-/missed-run-politik. Fire versionerede procedurer1.1.0 indeholder formål, input/output, kilder, værktøjsgrænser og budget. Gamle1.0.0-filer og jobbindinger er bevaret; nye jobskabeloner gemmes pauserede.
- Husstand med eksplicit standard, gentagen rytme, datoundtagelser, gæster, ferie/fravær, alder/kontroldato og portionsfaktorer. Read-only kalendercache vises med dækning og alder uden at gætte fremmøde.
- Varig opskriftsindbakke med originalmateriale, kilder, revision, ingrediens-/enhedsgennemgang og fejl/genoptagelse. Importer ændrer ikke brugerens fakta eller tilladelser.
- Redigerbar aftensmadsuge, låse, byt/flyt, egne retter, spring over og regenerering. Prisoverslag bruger kun faktisk gemte, friske kompatible prisobservationer; ukendte beløb vises som ukendte. Planlagt restemad bevarer kilde/mål/originalvalg og regner ingredienser én gang.
- Manuelle indkøbsmængder og nul-/udeladelsesvalg overlever genberegning. Ændret behov/lager/kostgrundlag bevarer valget men kræver synlig gennemgang. Valgt, nyt beregnet og tidligere grundlag vises; en eksplicit revisionsbundet handling kan vende tilbage til den beregnede mængde.
- Fælles ingrediens- og kostregler i måltider, priser og varematch. “ris” matcher ikke “frisk basilikum”; aliases deler relevante kostkrav, og et label kan ikke tilsidesætte ingredienskonflikter. Ingen opfundne stykvægte eller sammenblanding af rå/kogt/drænet vægt.
- Nemlig kræver det faktiske ejerklik på **Overfør til Nemlig**, bundet til det gennemgåede forslag/revision. Klikket er tilstrækkeligt; ingen ekstra frase. Kun add-only med bevarede andre kurvelinjer. Delvise/ukendte udfald bliver ikke blindt gentaget.
- Serialiseret revision-aware lagring, atomic publication af enkelte filer, recoverable private/public-journal og durable actionudfald uafhængigt af slutmodelsvar. Kendt fejl giver ikke falsk succes; ukendt publicering spærrer videre writes. Køer er afgrænsede, og ventende arbejde kan annulleres.
- Kladdetekst, fokus, kilde og captured revision bevares gennem polling/navigation/import/reload. Gem/fejl/konflikt/stale/ukendt er vedvarende tilstande, ikke kortvarige toastbeskeder.
- Projektændringer/tests/pakker/recovery er bundet til præcise revisioner og komplette kildehashes. Npm kræver reviewet offentlig lockv3, exact pakkesæt, isoleret config, scripts-off staging og bevaret tidligere node_modules. Denne snævrere installationskontrakt og manuelt recoverybehov står i subprocess-safety.md.
- Discord overvåger ACK og server-heartbeats, reconnect/resume og varig dedup. Integrationsstatus adskiller konfigureret, verificeret, forældet, udløbet login og utilgængelig.
- Opdateringsjournalen beskytter også godkendelser mod diskfejl, samtidighed og afbrudt staging. Det faktisk viste tag/SHA bindes til handlingen; skjulte ignorerede testfiler, symlinks og ændret checkoutgrundlag kan ikke tælle som testet Git-indhold. Ukendt udfald låser nye handlinger og kræver kontrol.
- I dags tre lokale kort forbinder aktuelle personlige opgaver/opfølgninger, eksplicit husstand/måltider og tidsstemplet kalendercache. Præcise kalenderkilder åbner kun samme gemte observation; gammel eller ufuldstændig dækning er ikke fri tid. Historiske monitorændringer erstatter ikke et nyere ukendt resultat.
- Gennemgåede opskrifters præcise trin kan hentes i de fælles web-/Discord-/talekontrakter. Manglende eller uafklaret materiale opfindes ikke. Hukommelsens kategori og gyldighed følger den faktiske modelkontekst, så en bekræftet plan ikke bliver til en udført handling.

## Evidens og begrænsninger

Senest publicerede runtimecheckpoint2f94679d/appb519b67f bestod **674/674 Node22-tests**, faktisk lokal hybrid **75/80 =93,75 %** på80 relevante+16 sikkerhedsspørgsmål og dependency-audit med0 fund. De samme fem søgemisses er bevaret; top-5-kildegenfinding er ikke garanti for alle genererede svar. Fuld rå evidence og præcise hashes står i verification.md og dependency-review.md.

Den samlede efterfølgende UI-/historik-/G1/G3-/procedure-/pakkeslice kræver sin egen fulde test og fire browserforløb. Et historisk grønt browserresultat er ikke accept af den aktuelle kandidat. Fysisk iPhone/desktop, faktisk zoom/mikrofon og administratorens isolerede restore-/runtimegennemgang er fortsat åbne.

Lokal semantik er valgfri og kræver et eksplicit valg af installation/konfiguration; uden den bruges lexical fallback. Native model-RAM ligger ud over JS-heapgrænsen. JSON forudsætter én appskriver, og flerfils-/pakkepublicering er recoverable, ikke samlet atomisk. Arkivering fjerner aktuelle retrievalkilder, ikke nødvendigvis private backups. Se migration-and-rollback.md før enhver data-/kodegendannelse.

## Uændrede produktgrænser

Ingen nye reelle jobs, eksterne persondataindeks, produktionstilslutninger eller kontorettigheder er aktiveret. Planlægning, redigering, polling og vareopslag giver nul kurveskrivninger. Modeller, Discord, tale og skills/jobs kan ikke simulere ejerklikket. Ordre, checkout og betaling findes ikke.

Google Kalender forbliver read-only; kalendertekst beviser ikke husstandsfremmøde. Planlagt mad, overførsel til kurv og planlagte rester beviser ikke forbrug, køb, levering eller lager. Lokal revision er ikke en atomisk transaktion hos Nemlig.

Eksisterende Home-funktioner bevares. Fuld Sonos OAuth, batteri-Nest-events, Home bridge, Google Tasks/kalenderwrites og browserbooking er separat P2. Ingen v4.9.2/v4.10/v4.11-mellemrelease eller ændring af historiske tags er foretaget.
