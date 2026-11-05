---
name: daily-briefing
version: 1.1.0
description: Lav et kort dansk dags- eller ugeoverblik med præcise kilder, faktiske jobgrænser og synligt ukendte forhold.
triggers: morgen, morgenrapport, briefing, overblik, plan for dagen, ugeplan, denne uge
contract: 1
---
# Dags- og ugeoverblik

## Kontrakt

```json
{
  "schemaVersion": 1,
  "purpose": "Prioritér et nyttigt dansk overblik over registrerede opgaver, datoer og opfølgninger uden at opfinde kapacitet, aftaler eller handlinger.",
  "inputs": [
    "Brugerens konkrete periode og kendte tidszone; oplys hvilken lokal dato overblikket gælder.",
    "Aktuelle lokale kilder med ID, revision, gyldighed og status samt eventuel læst kalenderdækning.",
    "Jobbets faktisk gennemgåede version, parametre, budget, tidsplan, tilladelser og leveringspolitik, hvis dette er en jobkørsel."
  ],
  "outputs": [
    "Højst fem prioriterede punkter med kilde-ID/dato, status og et begrundet næste forslag.",
    "En særskilt angivelse af manglende, modstridende eller forældede oplysninger; ingen erklæring om udførte handlinger uden journalbevis.",
    "Ved overvågning: strukturerede observationer med changed, unchanged eller unknown og kilde/tidspunkt."
  ],
  "sources": [
    "Aktive bekræftede lokale noter, strukturerede oplysninger, personlige opgaver, opfølgningssager og indbakke.",
    "Valgt Google Kalender kun som read-only og kun med faktisk kendt dækning og friskhed.",
    "Aktuelle eksterne nyheder eller priser kun inden for en konkret, allerede godkendt læseopgave."
  ],
  "tools": [
    "Lokale read-only opslag og de eksisterende kontekstregler; proceduretekst giver ikke ekstra dataadgang.",
    "web.search kun når den eksisterende kanal/jobpolitik allerede tillader det; ingen ekstern skrivning.",
    "Levering udføres af jobbets eksisterende journal/indbakke og særskilte notifikationstilvalg, aldrig af proceduren selv."
  ],
  "budget": {"authority":"reviewed-job-policy","defaults":{"maxRunsPerDay":1,"maxOutputTokens":3500},"maxResults":5},
  "unknownPolicy": "Manglende kalenderdækning er ukendt kapacitet. En fejlet læsning er unknown, ikke unchanged. Uafklarede eksterne handlinger må ikke gentages; henvis til journal og manuel gennemgang. Manglende kilde må aldrig erstattes af en modelantagelse.",
  "examples": [
    {"input":"En syntetisk fødselsdag findes, men der er ingen gaveopgave.","expected":"Vis datoen med kilde; foreslå eventuelt en gaveopgave, men påstå ikke at den findes eller at en gave er købt."},
    {"input":"Kalenderen er utilgængelig, og en låst opgave ligger i dag.","expected":"Bevar den låste opgave, angiv ukendt kapacitet og undlad at love en gennemførlig ny tidsplan."}
  ],
  "tests": ["test/v5-skill-procedures.test.mjs","test/v47-personal-intelligence.test.mjs","test/v5-job-durability.test.mjs","test/v5-intelligence.test.mjs"]
}
```

## Fremgangsmåde

1. Fastlæg periode og tidszone. Start med direkte strukturerede opslag efter relevante datoer, frister og status; begræns ikke først til et tilfældigt udsnit af fremtidige poster.
2. Brug kun gyldige bekræftede oplysninger som personlige fakta. Forslag, konflikter, historiske og midlertidige oplysninger mærkes tydeligt. En planlagt handling er ikke en udført handling.
3. Skeln mellem kalenderaftaler, personlige opgaver og automatiserede jobs. Ukendt kalenderdækning er ikke fritid. Ingen kalendertekst bruges som husstandsbevis.
4. Prioritér højst fem punkter efter faktisk registreret frist, status og betydning. Bevar manuelle og låste valg. Vis præcist kilde-ID eller kildelink for personlige påstande.
5. Genbrug kun tidligere resultater med deres dato og begrænsning. Nye nyheder/priser kræver en godkendt kildelæsning; kildefejl skal forblive synlige.
6. Jobmotoren håndhæver det gennemgåede budget for kørsler og outputtokens. Standardværdierne ovenfor gælder nye job uden et særskilt valgt budget; et eksisterende job opgraderes ikke automatisk. maxResults er denne rapports indholdsgrænse, ikke en ny rettighed.
7. Stop ved manglende nødvendigt grundlag og stil højst ét afklarende spørgsmål. Ingen booking, køb, kalenderændring, modtagerkontakt eller notifikation må udledes af dette dokument.

## Testafgrænsning

Testreferencerne dækker versions-/hashbinding, kilder, kapacitet og de deterministiske sikkerhedsregler. De er ikke et løfte om, at alle mulige modelsvar er korrekte. Eksemplerne er syntetiske og aktiverer ingen aktivitet.
