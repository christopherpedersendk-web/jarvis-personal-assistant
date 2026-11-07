# Fortsat udvikling efter v5.4.0

Grundlag: main/release v5.4.0, 5ed073367e6db86b3bb6af9aee6376a3c85fbf35. Schema 1/readableFrom 0. Historiske M1–M14 bevares i docs/v5.4; de er ikke lukket af releasen.

## Aktuel delændring

Discord-kanalstyring: særskilt diagnose af featureflag, botstatus, credential, ejer og guild. Diagnosen fremgår af eksisterende integrationskorts fejl/statusfelt. Ingen automatisk aktivering. 401/403/404/429 har konkrete forklaringer; ingen retries tilføjet. Naturlige anmodninger med “Kan du oprette en kanal der hedder …” går gennem samme reviewhandler.

Verifikation: 24 fokuserede tests består (discord-channels og v5-settings-http), nul fejl/skips. Live Discord ikke udført: ingen godkendt testserver eller botcredential. Root cause på installationen er derfor fortsat ukendt; deaktiveret flag er en mulig årsag, ikke en dokumenteret driftsdiagnose.

## Acceptregister

| ID | Status | Evidens | Næste handling |
|---|---|---|---|
| M12.4 diagnose/kommandoer | verificeret | discord-channels.mjs, integration-catalog.mjs, server.mjs; 24 fokuserede tests | Ejerprøve med faktisk konfiguration og permissions |
| M12.3 live kanaler | blokeret | Ingen faktisk mutation | Godkendt testserver og sikkert konfigureret botadgang |
| M15 stamdata | ikke startet | private-settings.json kan genbruges; ingen ny datalagring | Valideret revisionsbundet arkiv, API, UI og chatreview |
| M16 browserhandel | under implementering | Officiel OpenClaw browserdokumentation læst; ingen browserrettighed udvidet | Afklar faktisk kontrakt og separate skriverettigheder; checkout-fixtures og betalingshandoff |
| M17 madplansvariation/Nemlig | ikke startet | shopping-planner søger allerede ingredient.name; gentagelsesvalg i meal-planner bruger stabile ID-tiebreaks | Reproducer navne med indlejret mængde, aggregér og adskil søgenavn/mængde; historikbaseret variationsrangering |
| M18 selvudvikling | ikke startet | Eksisterende kodeagent og releaseflow bevares | Afgrænset worktree/PR-flow, SHA-bundet godkendelse og separat deploymenttjeneste |

Åbne kodeopgaver er ikke erklæret blokerede af manglende liveadgang. Browser/handel, stamdata, madplan og selvudvikling er endnu ikke leveret. Ingen køb, merge, tag eller deployment i denne udviklingsgren.

Rollback af denne delændring: revert commit; ingen state-migration og ingen ændrede featureflags. Test: slå eksisterende kanalflag til i separat testinstallation, prøv naturlig oprettelse, verificér review før write; slå flag fra og kontrollér den konkrete forklaring i integrationsoversigten.
