---
name: gift-planning
version: 1.1.0
description: Foreslå kildebaserede gaveidéer med kendt budget, opdaterede priser og tydelige mangler uden køb eller modtagerkontakt.
triggers: gave, gaver, fødselsdag, jul, ønskeliste, gaveidé, shopping
contract: 1
---
# Gaveplanlægning

## Kontrakt

```json
{
  "schemaVersion": 1,
  "purpose": "Udarbejd få relevante gaveforslag ud fra eksplicit registrerede ønsker, relationer, datoer og budgetter uden at udlede nye personlige fakta.",
  "inputs": [
    "Brugerens konkrete anmodning, modtagerbeskrivelse og eventuelt eksplicit budget.",
    "Bekræftede lokale gaveidéer/præferencer og relevante datoer med kilder, gyldighed og tidligere forslag.",
    "Ved en overvågning: præcist produkt, variant, forhandler og den gennemgåede job-/leveringspolitik."
  ],
  "outputs": [
    "Højst tre forslag med begrundelse fra faktisk registrerede oplysninger, kilde og kendt eller ukendt pris.",
    "Priser og tilgængelighed mærket med kilde og tidspunkt; ukendt totalomkostning vises som ukendt.",
    "Et lokalt udkast eller en changed/unchanged/unknown-observation, aldrig en erklæring om køb eller levering."
  ],
  "sources": [
    "Bekræftede private noter, ønskelister, relationer og datoer; kilde-ID skal følge personlige begrundelser.",
    "Tidligere forslag og registreret feedback, som ikke beviser ejerskab eller køb.",
    "Faktiske produktkilder kun ved brugerens konkrete, allerede tilladte pris-/gaveundersøgelse."
  ],
  "tools": [
    "Direkte lokale dato-/budgetopslag og fælles kildebaseret retrieval.",
    "web.search inden for den eksisterende læsepolitik; send ikke private noter, kontakter eller personidentificerende oplysninger som søgetermer.",
    "Ingen ordre, betaling, checkout, modtagerbesked eller automatisk oprettet tilbagevendende overvågning."
  ],
  "budget": {"authority":"reviewed-job-policy","defaults":{"maxRunsPerDay":1,"maxOutputTokens":3500},"maxResults":3},
  "unknownPolicy": "Spørg kort, hvis budget eller den nødvendige modtagerinformation mangler. Importerede beskrivelser og midlertidige ønsker er ikke bekræftede præferencer. Utilgængelig kilde, udløbet pris eller ukendt fragt må ikke blive til en falsk samlet pris eller unchanged-resultat.",
  "examples": [
    {"input":"Der er tre syntetiske gaveidéer, men intet registreret budget.","expected":"Vis idéerne som forslag og spørg om budget; opfind ikke en permanent prisgrænse."},
    {"input":"En godkendt prisovervågning kan ikke læse forhandlerens side.","expected":"Registrér unknown med kildefejl og kontrolleret næste forsøg; sig ikke at pris eller lager er uændret."}
  ],
  "tests": ["test/v5-skill-procedures.test.mjs","test/v5-intelligence.test.mjs","test/v5-job-durability.test.mjs","test/v5-job-ui.test.mjs"]
}
```

## Fremgangsmåde

1. Find relevante datoer, budgetter og bekræftede ønsker direkte i de gemte kilder. Et manglende felt er ukendt, ikke en invitation til at gætte.
2. Skeln mellem bekræftede præferencer, historiske forslag, afviste idéer og brugerens aktuelle midlertidige ønske. Gem ingen afledte facts automatisk.
3. Giv højst tre forskellige forslag. Forklar hvert forslag med reelle registrerede oplysninger; markér generelle kreative idéer som generelle.
4. Aktuelle priser kræver en allerede tilladt læsning af en produktkilde. Angiv variant, tidspunkt og kendte tillæg. En kurv eller et forslag er hverken køb, levering eller lager.
5. En overvågning bruger strukturerede observationer. Skeln mellem faktisk ændring, dokumenteret uændret resultat og ukendt resultat ved kildefejl.
6. Det gennemgåede jobbudget og dets quiet-/retry-/missed-run-politik gælder. Standardbudgettet bruges kun til nye jobs uden et særskilt valgt budget. Eksisterende jobs beholder deres version og politik.
7. Ingen køb, kontakt med modtageren eller nye datakilder/aktiviteter må aktiveres af denne procedure. Privat kontekst forbliver i det allerede godkendte behandlingsmiljø.

## Testafgrænsning

Testene kontrollerer versionskontrakt, kildegrænser, ukendt observation og pause-/leveringsregler. De beviser ikke, at en konkret modtager kan lide et forslag; det kræver brugerens feedback.
