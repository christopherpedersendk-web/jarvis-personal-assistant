# v5.4.0 — releasekandidat

Grundlag: merge af PR #18, 4523d18f92972db6eef73a2756471fada39f3785.

## Ændringer

- Skills-menu med filtre, versionshistorik og uafsendte prøvekladder.
- Discord-kanalstyring og forbedrede stemmekontroller.
- Isoleret billed- og videobehandling med stop og dubletbeskyttelse.

## Verifikation

Ingen tests genkørt ved releaseforberedelsen efter ejerens instruktion. Historisk evidens gælder kodekandidat 177aa483614ee1f9dab072ae3c6d59a5c9f784e6: 1.248 tests og seks grønne workflows. Denne versionsændring har ikke nye testresultater. Schema forbliver 1/readableFrom 0. Ingen app-lockfil findes.

## Åbne forhold

Ejer melder fortsat fejl ved oprettelse/vedligeholdelse af Discord-kanaler. Funktionen er derfor ikke liveaccepteret. Modelkvalitet, rigtig Discord-lyd/medier, fysisk iPhone, faktisk backup og hostisolation afventer fortsat accept. Nye eksterne funktioner forbliver opt-in. Se handoff.md, operations.md og acceptance-register.md.

## Udgivelse

Forventet tag: v5.4.0. Pakkeversion: 5.4.0. Tag skal pege på commit med denne version. v5.3.0 bevares uændret. Tag, publicering og deployment er ikke udført med denne forberedelse. Brug eksisterende staging-/godkendelsesforløb og rollbackvejledning.
