---
name: personal-follow-up
version: 1.1.0
description: Gennemgå vedvarende opfølgningssager med kilder, næste kontrol og stopbetingelser uden automatisk ekstern kontakt.
triggers: følg op, opfølgning, husk mig, påmind, næste skridt, afventer, deadline, opgaver
contract: 1
---
# Personlig opfølgning

## Kontrakt

```json
{
  "schemaVersion": 1,
  "purpose": "Foreslå kildebaserede næste skridt i registrerede opfølgningssager og skeln mellem observation, brugerbeslutning og faktisk udført handling.",
  "inputs": [
    "Et konkret emne eller en eksisterende opfølgningssags ID og revision.",
    "Registrerede kilder, status, næste kontrol, stopbetingelser, observationer og brugerbeslutninger.",
    "Eventuelle opgaver med faktiske frister, afhængigheder og låste valg samt jobbets gennemgåede politik."
  ],
  "outputs": [
    "Højst tre realistiske næste forslag med kilde-ID, aktuelt grundlag og tydelig skelnen mellem planlagt og afsluttet.",
    "Forslag til næste kontrol eller afslutning, som ikke skriver en ny beslutning på brugerens vegne.",
    "Synlig unknown-status ved en utilgængelig kilde, uafklaret handling eller manglende frist."
  ],
  "sources": [
    "Vedvarende lokale opfølgningssager og deres kildehistorik.",
    "Bekræftede lokale oplysninger, personlige opgaver, noter, projektstatus og indbakke.",
    "Eksterne observationskilder kun når den konkrete kilde og læseaktivitet allerede er valgt af brugeren."
  ],
  "tools": [
    "Read-only opslag på den præcise sag/opgave og dens revision; ingen automatisk markering som gennemført.",
    "Lokale ændringsforslag må først gemmes via den eksisterende brugerhandling og revisionskontrol.",
    "web.search kun ved eksisterende læsetilladelse; ingen e-mail, invitation, kalenderændring eller kontakt til andre."
  ],
  "budget": {"authority":"reviewed-job-policy","defaults":{"maxRunsPerDay":1,"maxOutputTokens":2500},"maxResults":3},
  "unknownPolicy": "En overskredet dato er kun en forfalden opgave, når en faktisk opgavefrist findes. Lukket sag må ikke genåbnes uden brugerbeslutning. Udløbet eller tilbagevist information udelukkes fra fakta. Fejlet kilde er unknown, og ukendt handling er ikke grundlag for automatisk gentagelse.",
  "examples": [
    {"input":"En syntetisk sag afventer svar og har næste kontrol i morgen.","expected":"Vis næste kontrol og registreret kilde; kontakt ingen og opret ingen ekstern kalenderaftale."},
    {"input":"En tidligere afsluttet sag nævnes i en ny importeret tekst.","expected":"Bevar lukket status. Importen er et nyt kildeforslag, ikke en brugerbeslutning om at genåbne sagen."}
  ],
  "tests": ["test/v5-skill-procedures.test.mjs","test/v5-intelligence.test.mjs","test/v5-server.test.mjs","test/v5-job-policy.test.mjs"]
}
```

## Fremgangsmåde

1. Find den konkrete sag/opgave direkte. Vis registreret status og revision. Hvis sagen ikke findes, sig det og giv højst et forslag til en ny sag.
2. Læs kilder, observationer og tidligere beslutninger hver for sig. En modelvurdering eller import må ikke blive et bekræftet personligt faktum.
3. Kontrollér stopbetingelser før næste skridt. Afsluttede og arkiverede sager forbliver afsluttede; automatiske jobs må ikke genåbne dem.
4. Beregn ikke kapacitet ud fra manglende kalenderdata. Bevar låste opgaver og giv en konkret forklaring, hvis frister eller afhængigheder ikke kan opfyldes.
5. Foreslå højst tre næste trin. En ændret kontroltid, ny observation eller afslutning skal være et separat, revisionsbundet lokalt valg. Beskeder til andre er udkast, aldrig leverede beskeder.
6. Anvend jobbets faktiske version, parametre, tidszone, budget og retry-/pausepolitik. Nye jobs starter som pausede kladder; læsning af proceduren aktiverer intet.
7. Stop og spørg kort ved manglende nødvendig information. Midlertidige læsefejl må kun prøves igen efter motorens afgrænsede politik; ukendte eksterne udfald gentages aldrig blindt.

## Testafgrænsning

Testene verificerer kontrakt, versionsbinding, vedvarende sagsstatus og revisionsgrænser. Teksteksempler er specifikationer til gennemgang, ikke udførte personlige handlinger eller en generel modelkvalitetsmåling.
