# N4: offentlige webkilder og lokale bookingkladder

> Historisk v5.1-grundlag. Den aktuelle status efter released v5.1.1 findes i [v5.2-acceptregisteret](../v5.2/acceptance-register.md). Nyere kode og ejerbekræftelser har forrang.

Implementeringsstatus 6. november 2026. Første afgrænsede N4-fase på
`feature/v5.1.0`, som svar på ejerens prioritering af browserarbejde og sikkerhed.

## Brugerflow

Åbn **Planlægning → Webarbejde**. Godkend et præcist website, eksempelvis
`https://restaurant.dk`. Angiv en offentlig sidesti og gennemgå det normaliserede
link. Bekræft én læsning inden to minutter. Se kildeuddraget, og opret eventuelt
en lokal bookingkladde med egne ønsker. Kladden kan redigeres eller slettes.
Uddraget viser nu op til 20 unikke links til offentlige undersider på samme origin.
Et valg udfylder kun URL-feltet; hver ny hentning kræver et nyt engangsreview.
Eksterne links, søgeparametre, fragmenter og executable URLs medtages ikke.
Den er altid **Ikke sendt**. Åbn selv kilden for at kontakte stedet.

Der er ingen forudgodkendte websites og ingen netværkskald ved forhåndsvisning.
Første adapter henter statisk HTML over HTTPS. Den kører ikke en rigtig
JavaScript-browser, logger ikke ind og udleder ikke ledige tider. Dynamiske
websites kan give et ufuldstændigt eller tomt uddrag. Ingen side bliver sendt
til modellen, og funktionen er endnu ikke tilgængelig gennem Discord eller stemme.

## Sikkerhedsgrænser og evidens

| Trussel | Kontrol og konkret evidens | Begrænsning |
|---|---|---|
| Website forsøger at aktivere værktøjer eller gemme hukommelse | Eget HTTP-domæne i `server.mjs`; ingen browserfunktion i `assistant-tools.mjs`; `indexPersonalKnowledge` medtager ikke webdata. `v51-browser-workspace.test.mjs` og HTTP-prøven verificerer isolation. | Teksten kan stadig vildlede brugeren. Den markeres uverificeret; der loves ingen generel detektion af prompt injection. |
| Adgang til cloudmetadata, LAN eller DNS-rebinding | Genbrug af `recipe-fetch.mjs`: alle DNS-adresser skal være offentlige, valgt adresse bindes til TLS-forbindelsen, hver redirect genvalideres. N4 tillader kun samme origin. | Senere Chromium må ikke få en alternativ, ukontrolleret netværksvej. |
| Ejerens læsetilladelse ændres eller genbruges | Durable engangsintent med ejeridentitet, URL, konfigurationsrevision, proces-ID, stopgeneration og to minutters udløb. Forbruget gemmes før netværk. Samtidige klik giver højst ét kald. | Dette er kun autorisation til en offentlig GET, ikke en generel godkendelse til at handle. |
| Uafklaret udfald, stop eller genstart | Ingen retry. Forbrugt intent kan aldrig genkøres. Afbrudt `reading` vises som `unknown` efter restart. Stop/revoke/cancel afbryder DNS/HTTPS; gammel generation må ikke publicere et sent svar. | Et allerede afsendt GET kan have nået websitet. Stop kan ikke trække det tilbage. |
| Secrets og persondata | Ingen cookies, Authorization, referer, browserprofil eller proxy fra miljøet. URLs med login, query eller fragment afvises. Kendte secrets og mønstre fjernes fra uddrag; credentials i kladder afvises. | Brugeren skal vælge offentlige links; et ukendt hemmeligt link i en sidesti kan ikke altid genkendes. |
| XSS eller ressourceforbrug | Kun `textContent`, ingen HTML-indsættelse, scripts/iframes udføres ikke. Monoton HTML-scanning; 500 KB, 10 sekunder, 12.000 teksttegn, højst to samtidige læsninger og 50/dag. | HTML-uddrag er ikke en nøjagtig visuel gengivelse eller bevis for synligt indhold. |
| Gammel kilde eller overskrevet kladde | Kildehash, URL og læsetid; nye kladder kræver tilgængelig kilde under 24 timer. `expectedRevision` ved ret/slet. UI beholder tekst ved fejl og afviser sene svar efter logout. | Tilgængelighed/pris kan ændres med det samme; dette er en forberedelse, aldrig en reservation. |

Der gemmes højst ti uddrag, og uddrag over 24 timer returneres ikke i UI.
Læsningernes metadata beholdes i op til to døgn ved næste oprydning; højst
150 records og 20 samtidige forhåndsvisninger. Højst 20 kladder. Ingen automatisk
sletning af kladder; brugeren kan slette dem. Historiske backupkopier følger
den eksisterende backupretention. Der er ingen nye pakkeafhængigheder.

## Releasekrav og næste arkitekturtrin

- Den første fase kræver grøn fuld Node-suite, pinned Chromium-CI ved 390/1280 px,
  reelle offentlige læseprøver og fysisk iPhone-accept. Lokale syntetiske tests
  erstatter ikke de sidste tre prøver.
- Før automatisk webresearch: separat modelkontekst med kun godkendte
  læsefunktioner og faste trin-/omkostningsgrænser. Webmateriale må ikke give
  adgang til den generelle assistents lokale eller eksterne skriveværktøjer.
- Før JavaScript/login: separat kortlivet browserproces og profil, kontrolleret
  egress for **alle** forbindelser, ingen adgang til hostfiler, secretmiljø,
  downloads, service workers eller interne adresser. Test sessionudløb,
  popup/iframe/websocket/redirect og ejerens login-overdragelse.
- Før formularafsendelse: separat capability, fuld forhåndsvisning af modtager,
  felter og konsekvens, engangsgodkendelse bundet til præcis handling/revision,
  durable udførelsesjournal og afklaring af ukendt kvittering uden replay.
  Læsningens engangsintent må aldrig accepteres som denne godkendelse.
- Betaling, bindende ordre og udvidet Smart Home er fortsat deaktiverede som
  nye handlemuligheder. N2's ældre stemme-/Realtime-huller forbliver releasekrav.

Verifikation: `test/v51-browser-workspace.test.mjs`,
`test/v51-browser-http.test.mjs`, `test/v51-browser-ui.test.mjs` og udvidelsen af
`scripts/v51-control-smoke.mjs`. Netværksfixtures er kun i de isolerede testprocesser;
applikationen har ingen produktionsindstilling, som slår SSRF-kontrollen fra.
