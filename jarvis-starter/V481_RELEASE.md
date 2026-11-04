# JARVIS v4.8.1 – Nemlig-godkendelse med ét klik

**Status:** Versionsforslag til gennemgang og test. Ingen konto-, kurv- eller produktionsændringer foretages ved oprettelse af denne kode.

## Ændring

Efter at ejeren har set et konkret Nemlig-kurvforslag med varenavn, eksisterende antal, antal der tilføjes og nyt antal, er ét bevidst klik på **Overfør til Nemlig** tilstrækkelig godkendelse. Den tidligere ekstra indtastning af `OPDATER NEMLIG-KURV` er fjernet.

## Uændrede sikkerhedsgrænser

- Det kræver fortsat en gyldig JARVIS-session med adgangstoken at kalde godkendelses-endpointet.
- En godkendelse er specifik for ét forslag og kræver eksplicit `approved: true` i anmodningen fra knappen; manglende eller falsk værdi afvises.
- Forslag udløber efter 15 minutter og afvises, hvis Nemlig-kurven har ændret sig siden forslaget blev oprettet.
- Forslaget markeres som anvendt **før** eksterne kurvændringer; dobbeltklik eller genforsøg må ikke gentage opdateringen.
- Kun foreslåede tilføjelser opdaterer absolutte antal. Ingen eksisterende varer fjernes.
- Ingen AI-værktøjer kan godkende forslag, og der findes ingen ordre- eller betalingsfunktion.
- Usikker eller delvis succes kræver nyt forslag og ny godkendelse; ingen automatisk gentagelse af kurvændringen.

## Verifikation og deployment

Kør `npm test` og den eksisterende syntetiske browser-CI før review og release. Efter godkendt review kan v4.8.1 frigives med nyt, præcist `v4.8.1`-tag og den eksisterende JARVIS staging-/godkendelsesproces. Nemlig-loginoplysninger og personlige kurvdata må ikke indgå i tests eller GitHub.
