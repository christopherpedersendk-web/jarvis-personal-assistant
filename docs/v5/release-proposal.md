# Forslag til separat M7-beslutning – JARVIS v5.0.0

**Status: udviklingskandidat til gennemgang; ikke accepteret, flettet, udgivet eller installeret.** Ingen af nedenstående handlinger er autoriseret af dette dokument.

## Kandidat og faktisk bevis

- Udgangspunkt: eksisterende tag `v4.9.1` = `6b2b0736a32e0968d5db233512672d197b4885f7`. Historiske tags er uberørte.
- Udviklingsgren: `feature/v5-foundation`, [draft-PR #7](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/pull/7) mod `main`.
- Seneste **testede applikationskode**: GitHub-commit `f19c85d695b87cc7f7c93f609afa3cc756de3df2`; mappeindholdshash `jarvis-starter` = `bf87ea8604223ed4ec401ddbd781d55c945203ea`.
- Pakkeversion `5.0.0`, uafhængigt dataskema `1`, krævet Node `>=22.6.0`.
- [CI-kørsel `41944996605`](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41944996605): **240/240 Node-tests**, Chromium og WebKit i både 1390×950 og 390×844 **grønne**. [16 syntetiske skærmbilleder](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41944996605/artifacts/13378367690).
- Eventuelle senere dokumentationsrettelser må ikke forveksles med nytestet applikationskode. Verificér igen, at mappeindholdshashen er uændret, før et godkendt tag peger på et endeligt commit.

## Forhindringer for fuld accept

1. **B3:** Rigtig lokal dansk semantisk embeddingmodel og uafhængig top-5 ≥90 %-måling mangler. 80/80 syntetiske leksikale svar er ikke tilstrækkelig dokumentation.
2. **M1/M2:** Hele rækken af ældre tilstandsmutationer er ikke flyttet bag samme durable transaktionsgrænse; ikke alt baggrundsarbejde går gennem den fælles begrænsede kø.
3. **K4:** Ældre hukommelsesredigering og den nye påstandseditor er endnu ikke fuldt samlet.
4. **M5/M6:** Fysisk iPhone/Safari, desktop, 200 % zoom, tastatur/fokus, kontrast, præcise kildelinks og fulde husstands-/Nemlig-gennemgange afventer manuelle kontrollanter.
5. **M6:** Administratorens isolerede gendannelsesprøve og endelige gennemgang af migration, rettigheder og rollback er ikke udført. Kø-/ekstern ventetid samt virkelig modelbelastning er ikke repræsentativt målt.

Se `requirements-matrix.md` for hver P0/P1-acceptbetingelse. **M6 er ikke fuldt accepteret**, selv om den automatiske browser- og regressionskontrol er grøn.

## Foreslået rækkefølge for særskilt autoriserede handlinger

1. **Kodegennemgang og accept:** Ejer/reviewere gennemgår PR, åbne krav, manuelle kontrolpunkter, databeskyttelse og tidligere migrationstest. Luk eller accepter eksplicit eventuelle restbegrænsninger, inden der anmodes om merge.
2. **Beslutning A – merge:** Bed om særskilt godkendelse til at flette den præcise gennemgåede kandidat til `main`. Verificér HEAD, testresultat og uændret app-hash straks før merge.
3. **Beslutning B – stabil release:** Efter godkendt merge bedes særskilt om et **letvægts** `v5.0.0`-tag og GitHub release på den faktisk testede og godkendte SHA. Den dokumenterede deployer forventer stabil `vX.Y.Z`; intet prerelease-tag antages understøttet.
4. **Beslutning C – installation:** Først efter separat ejer- og administratorgodkendelse skal root-ejede deployscripts, serviceopsætning og en rigtig backup/restore-/skematest gennemgås. Ukendt eller delvist Nemlig-resultat må ikke genkøres automatisk; alle persondata forbliver i produktion.

**Rollbackbeholdning:** Kode-rollback til v4.9.1 efter dataskema 1-migration er blokeret af sikkerhedsgrunden; en gammel backup må ikke overskrive nyere brugerændringer uden konkret valg. Se `migration-and-rollback.md` for procedure og begrænsninger.
