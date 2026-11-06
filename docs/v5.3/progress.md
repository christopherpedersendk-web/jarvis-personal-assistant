# OpenJarvis M7–M10 — udviklingskandidat

Baseline kontrolleret 6. november 2026: main og tag `v5.2.1` peger på
`a991408da3ab505f3ce3c18c04c4858350086849`, pakke 5.2.1, schema 1/readableFrom 0.
PR #15 er merged; PR #16 rettede versionsmetadata. Den separate GUI-PR #9 er ikke ændret.
Historiske v5.2-testtal er ikke evidens for denne gren. Pakken forbliver 5.2.1;
der oprettes ikke release/tag/deployment eller produktionsaktivering her.

## Implementeret

- M7: separat, versionsfastlåst OpenClaw-runtime/plugin; ingen kopieret upstream-kode.
  En lokal researchgateway holder operator-tokenet uden for Jarvis. Kun det faste
  web_search-input er tilladt; ingen WebSocket/admin/session/proxy-vej.
  Startup validerer rigtig config og afprøver forbudte værktøjer, før researchporten åbnes.
  Runtime 2026.11.1 og kontrakt v1 kontrolleres før søgning. Legacy bevares eksplicit
  som `legacy-unverified`, så fungerende installationer ikke ændres automatisk.
- M8: én servervalgt researchkontrakt for chat, Discord og stemme. Rapportforberedelse
  bruger samme backend ved OpenJarvis-aktivering; kun korte offentlige søgeord sendes
  til gatewayen. Kilder gemmes sammen med provider-response-ID og tilføjes også ved
  genoptagelse. Ingen automatisk fallback til hosted search.
- M9: fire versionsstyrede researchprocedurer (restaurant/aktivitet, briefing,
  produkt/pris, opskrift). De er vejledning under eksisterende rettigheder, ikke nye
  plugins eller grant-mekanismer. Eksisterende isolerede browser/review genbruges
  uændret. OpenClaws browser/web_fetch er afvist ved faktisk runtime-test.
- M10: samme 30 danske opgaver kan køres som baseline og hybrid med samme model,
  dataset- og kodefingerprint, med faktiske svar, journal, state, forbrug og varighed.
  Sammenligningsværktøjet kræver begge menneskeligt bedømte prøver og kritiske tests.
  Ingen kode fjernes på baggrund af manglende kvalitetsmålinger.
- Sikkerhed: efter offentlig research blokerer fælles dispatcher mutationer i samme
  turn/stemmesession. Researchhistorik vises, men genbruges ikke som modelkontekst.
- Rettelse: ukendte OpenClaw-tokenværdier registreres som null, ikke målt nul.
- Rettelse fundet mod rigtig runtime: HTTP 200 med `details.kind=error` afvises.

## Evidens og begrænsninger

Se acceptregister, operations.md og evidence.json. Lokal komplet suite bestod 1.206 prøver, inklusive researchens serverstyrede
mutationsspærre. Den endelige kandidats træbinding registreres i evidence.json.
Installeret OpenClaw validerede config og afviste exec/browser/web_fetch/cron/
sessions_spawn med 404 samt forkert credential med 401. Offentlig søgning gav
provider_error; ingen kilder og ingen researchaccept. Fejlen er bevaret i evidens.
CI afprøver også offentlig søgning uden credentials; dette er en reel acceptprøve,
ikke en mock eller automatisk godkendt skip.

Der er ingen OpenAI-testcredential, live Discord-adgang, fysisk iPhone eller faktisk
installationsbackup i dette miljø. De to 30-opgavekørsler er `not_run`, uden score.
M1–M6's uafsluttede kriterier fortsætter; ejerens tidligere Discord-/releasebekræftelser
står ved magt, men lukker ikke andre prøver. Ingen hel milestone er færdigmeldt.
