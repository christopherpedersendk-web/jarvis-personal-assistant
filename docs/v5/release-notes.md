# JARVIS v5.0.0 – kandidat til gennemgang

**Status: udviklingskandidat. Ikke flettet, udgivet eller installeret.**

## Det nye

- **I dag, Plan, Mad og indkøb, Min viden, Hjem, Projekter og Indstillinger** med sidepanel på computer og fem punkter på mobil. Eksisterende chat og mikrofon er bevaret.
- **Personlige opgaver** er adskilt fra kalenderaftaler og automatiske baggrundsjob. Varighed, frister, afhængigheder, tilladte tidsrum og låste valg kan gemmes med revision. Kapacitetsforslag opretter ikke kalenderaftaler og antager aldrig, at ukendt kalender betyder ledig tid.
- **Personlige oplysninger** har kilder, forslag, egen bekræftelse, gyldighed, rettelser og konflikter. Ubekræftede, forældede eller modstridende oplysninger bruges ikke som sikre fakta. Der findes lokal tekstsøgning med kildehenvisninger.
- **Opfølgningssager og tilbagevendende kontrol** med næste tjek, stopbetingelse, tydelige observationer, afgrænsede genforsøg og synlig fejlstatus.
- **Husstand og aftensmad** med flerugers rytme, dato-undtagelser, justerbare børneportioner, gennemgåede opskrifter, bekræftet lager, reservationer, låsbare madplaner, retbytte og bevarede manuelle tilføjelser.
- **Nemlig** kræver fortsat det faktiske ejerklik på *Overfør til Nemlig*. Klikforløbet bruger nu en tidsbegrænset engangsintention knyttet til det præcise forslag og revisionen. Kun tilføjelse til eksisterende kurv er mulig; ingen bestilling eller betaling.
- **Mere driftssikkerhed** med serialiserede private indstillinger, atomisk JSON-publicering, bevaring af handlingers udfald, begrænset kø og genoptagelig Discord-forbindelse. Seneste udviklingsændring beskytter desuden almindelige liste-, hukommelses- og opgaveredigeringer mod synlige, ugyldige ændringer efter kendte diskfejl; hvis en skrivning kan være publiceret uden bekræftet diskvarighed, viser JARVIS ukendt lagerstatus og stopper yderligere gemninger.
- **Google Kalender** er fortsat kun læsning, med valgt kalender-ID, registreret dækningsperiode og ærlig status ved udløbet login.

## Uændrede grænser

- Ingen nye reelle tilbagevendende job eller eksterne processer er aktiveret.
- Ingen nye eksterne tjenester må indeksere personlige oplysninger uden et særskilt tilvalg.
- Ingen kurvskrivning foregår ved planlægning, opdatering, vareopslag eller polling.
- Kurvoverførsel beviser hverken køb, levering eller, at varerne findes i hjemmet.
- Et lokalt revisionscheck kan ikke sikre en atomisk transaktion mod ændringer direkte på Nemlig.
- Kalendertekst bruges ikke som bevis for, hvem der spiser hjemme.
- Eksisterende Hue, Sonos og øvrige Home-funktioner bevares; udvidet OAuth/Home-bro, kalender- og kontaktoprettelse er fortsat udsat.

## Det, der **ikke** er færdigt

- En rigtig lokal dansk semantisk embeddingmodel mangler. De 80 syntetiske danske søgeprøver gav **80/80 korrekt kilde i top fem**, men målingen dækker kun det lokale leksikale indeks og er ikke dokumentation for semantiske omskrivninger.
- Chromium og WebKit er gennemført på begge krævede skærmstørrelser i syntetisk CI, **grønt på commit `f19c85d` (run `41944996605`) med den endelige danske mikrotypografi**. **Fysiske enheder og udvidet tilgængelighedskontrol mangler fortsat.**
- Fysisk iPhone og computer, tastatur, fokus, zoom, kontrast, kilderuter og komplet mad/Nemlig-gennemgang kræver manuel kontrol.
- Den gamle og den nye visning til personlige hukommelsesoplysninger er endnu ikke fuldt samlet til én editor; dele af indstillinger og hjem-status mangler harmonisering.
- Baggrundsjob, projekt-/filsystemændringer og indstillinger fordelt på flere filer bruger endnu ikke alle den samme fulde persistensgrænse. For store P0/P1-acceptkrav i `requirements-matrix.md` står derfor fortsat som *delvist* eller *afventer*. Den nye M1-forbedring afventer ny, præcis CI-evidens før endelig kandidatstatus.

Se `verification.md`, `requirements-matrix.md` og `migration-and-rollback.md` før en releasebeslutning.
