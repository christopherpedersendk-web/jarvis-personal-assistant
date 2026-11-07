# Reviewbar pakke: browserkilder og kladder før handling

## Grundlag og afgrænsning

Main: 1249eba457ec866da00f3005e6a79b8d1aa8973f (PR #19). Separat draft PR #20: 54a54fb0272736896f1e106df55b9724cda2a530, diagnostik/evaluering med 11 historiske fokuserede tests. Denne pakke bygger direkte på main og kopierer ikke PR #20. Kodekandidat: 1ecdb7031369e0202b7ca729a3da2176aa556a5d. Version 5.4.0; schema 1/readableFrom 0.

Gap-analysen fandt fungerende ordrevalidering, reviewhash, manuel overdragelse, fast browserprofil og en beskyttet udviklingspipeline. Konkrete mangler var manglende kladderedigering, manglende observationsmetadata og manglende lokalt udviklingsønske/før-efter-visning. Disse dele kan forbedres uden Docker, modelcredentials eller målhost. Ingen ny dokumenteret P0 blev fundet i dette afgrænsede review; det er ikke en fuld sikkerhedsaudit.

## Implementeret

- M16.1: rediger og annullér ordrekladder med revisionskonflikter og nyt review. Afsluttede ordrer genåbnes ikke; gamle godkendelser afvises.
- M16.3: bevar offentlig browserkilde, observationstidspunkt og indholdshash; afvis ændret destination under læsningen. Cleanup og eksisterende isolation-/stopkrav bevares.
- M18.1: gem/redigér/annullér lokale udviklingsønsker med acceptkriterier før start; én start af præcis revision; vis base-SHA og før/efter-funktion, også ved blokeret sandbox.
- Eksisterende danske formularer understøtter disse forløb og bevarer input ved konflikt. Ingen parallel kodeagent, datakilde, bot eller scheduler.

## Gennemført verifikation

26 unikke fokuserede Node-tests: 10 commerce/browser-kontrakter, 14 selvudvikling, 2 routekontrakter. Nul fejl/skips. Browser, model, sandbox og GitHub-publicering er simulerede i disse kontroller. Ændrede server-/UI-filer er syntakskontrolleret; ingen ny rigtig browserrendering eller fuld HTTP-suite er påstået. Præcise filhashes i evidence.json.

Automatiske PR-triggere blev inspiceret: de brede jarvis-starter-paths starter bl.a. Dockercontainment, mediebuild og modeldownload. Udviklingscommits bruger derfor [skip ci]. Ingen workflow eller mergekontrol er fjernet. Denne fokuserede evidens gør ikke kandidaten fuldt CI-/releasegodkendt.

## Resterende produktmangler — ikke planlagte utilgængelige kørsler

Browser/shopping: automatisk produktudtræk og sammenligning, pris-/lageropdatering samt eksplicit separat faktureringsvalg er ikke udvidet. Login, session, kurv og checkout kræver en konkret verificeret butikskontrakt og testprofil; ingen generiske write-handlinger er tilføjet. Betalingsappgodkendelse og bindende ordreafsendelse er ikke udført.

Selvudvikling: rigtig model → isoleret kodekørsel → rigtig JARVIS-publiceret PR er stadig åben M18.3. Denne implementerings-PR er ikke evidens for det flow. Revisionshistorik, prioritering og chatoprettelse er ikke udvidet. Ukendt publicering blokerer fortsat nye starter indtil særskilt afklaring.

M1–M18 beholder deres betydning og åbne ejeraccept. Planlægning, fælles hukommelse, madplan/Nemlig, Discord, backup/restore og fysisk iPhone er uændret. Samme 30 danske evalueringsopgaver bevares; ingen livekørsel, score eller besparelse påstås. Smart Home afventer lokal agent.

## Ejerhandling

Review den konkrete diff og begrænsningerne. Ingen credentials eller aktivering er nødvendig for review. Målhost-/købs-/produktionsbeslutninger er særskilte; dette dokument bestiller ingen utilgængelige prøver.

## Aktuel leverance: M12/M16-kandidat 5.5.1

Ældre afgrænsninger ovenfor er historiske. Nu er PR #23 genbrugt, kanalnavnssamtale/annullering og isoleret opskriftsbilledudtræk implementeret, og Proshop har en konkret observeret anonym kurveadapter. Faktiske Discord REST-, Docker/Chromium-, decoder/model- og Proshop-kurveprøver er udført; se [saniterede resultater](m12-m16-live.json) og [acceptregister](acceptance-register.md).

Resterende arbejde er ikke blot et featureflag: autentificeret Proshop-login, eksplicit adressetransfer, postnummerbundet fragt/levering og endelig checkoutkontrakt er fortsat åbne. Native kurvedeling giver manuel overtagelse af varevalget, ikke en færdig checkout. De næste observationer kræver ejerens egen sikre butikssession og valgte adresse-/kontaktgrundlag i staging. Ingen credentials efterspørges i chat. Stop altid før betaling/bindende ordre.

Kandidat 5.5.1, schema 1/readableFrom 0; eksisterende v5.5.0-tag/release er verificeret og bevares. Ingen produktionsdeployment/aktivering. CI startes med normale PR-triggere efter gennemgang af workflows; ingen [skip ci] i kodeleverancen. Endelig merge/release afhænger af faktiske checks/review, ikke de historiske resultater.
