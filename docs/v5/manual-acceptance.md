# Manuel acceptliste – JARVIS v5.0.0

Ingen af punkterne nedenfor er godkendt alene på baggrund af Node-tests. Brug **syntetiske data** først. Notér enhed, browser, dato, kandidat-SHA, resultater og eventuelle skærmbilleder i `verification.md`.

Automatiseret browser-evidens (ikke fysisk accept): GitHub Actions `41944996605`, app-hash `bf87ea86`, 240 Node-tests og fire Chromium/WebKit-workflows grønne; 16 syntetiske skærmbilleder i artifact `13378367690`. Kryds kun de manuelle punkter af efter de faktiske kontroller.

## Browser og grænseflade

- [ ] Chromium 1390 × 950: I dag, Plan, Mad, Viden, Hjem, Projekter, Indstillinger; beskedfelt og mikrofon synlige uden uventet scroll.
- [ ] Chromium 390 × 844: I dag, Plan, Mad, Viden, Mere; Hjem/Projekter/Indstillinger i Mere.
- [ ] WebKit 1390 × 950: samme funktioner og navigation.
- [ ] WebKit 390 × 844: samme funktioner og navigation.
- [ ] Tilbage/frem, genindlæsning og direkte `?view=...&source=...` åbner præcis kilde/dato og bevarer returvej.
- [ ] Ugemte tekster, strukturerede ingredienser, fokus og redigeringsstatus bevares ved polling, import og skift af faner.
- [ ] Tastatur alene, fokusmarkering, 200 % zoom, 390 px bredde, kontrast og forståelige fejl/konflikter.
- [ ] Kontroller, at den originale mikrofonstyring stadig fungerer efter konkret klik.

## Arbejdsgange uden eksterne handlinger

- [ ] Opret/ret personlig opgave og vis kapacitetskonflikt ved manglende kalenderdækning.
- [ ] Opret/bekræft/ret/arkivér personlig oplysning; ukendt eller modstridende viden må ikke lyde sikker.
- [ ] Opret og afslut opfølgningssag; afprøv fejlet kilde og de synlige genforsøgsregler uden at aktivere nye reelle gentagne job.
- [ ] Redigér familierytme, undtagelser, portionsfaktorer og bekræftet lager. Kalendertekst må ikke ændre fremmøde.
- [ ] Importér opskrift; kontroller kildemateriale, instruktioner og manuel godkendelse før genbrug.
- [ ] Redigér, lås, byt og regenerér madplan; bevar manuelle ekstravarer.
- [ ] Brug en **syntetisk** Nemlig-adapter til at kontrollere revision, ejerklik, eksisterende varelinjer, ukendt delvis fejl og intet checkout.

## Fysiske enheder og drift

- [ ] Fysisk iPhone/Safari: læsbarhed, tastatur, fokus, scroll, sikkerhedsforbehold, stemmestart.
- [ ] Fysisk desktop: mus/tastatur, 200 % zoom, kildehistorik, drafts og kontrast.
- [ ] Administrator: verificér faktisk backup/restore, skemakompatibilitet, rollback-blokering og driftsmålinger før installationsgodkendelse.
- [ ] Gennemgå dataprivathed, tilgængelige rettigheder, udløbet Google-login, Discord resume og ukendt Nemlig-udfald under sikre testforhold.

**M7 kræver mindst tre selvstændige beslutninger:** flet til `main`, opret stabilt `v5.0.0`-tag/release, installér i produktion. En manuel kontrol må ikke aktiveres som et reelt køb, job, kalenderændring eller eksternt datakald alene fordi den findes på listen.
