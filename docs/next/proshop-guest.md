# Eksplicit Proshop-gæstekontakt

Ejeren har valgt gæstecheckout og privat udfyldning/valg i Stamdata. Det er et forløbsvalg, ikke samtykke til at sende persondata.

Koden genbruger handelskladde, privat profil, revisioner, sessionsfil, transaktioner og fælles stop. I et særskilt stagingmiljø kræver gæsteforløbet `JARVIS_COMMERCE=yes`, `JARVIS_PROSHOP_CART=yes` og det nye `JARVIS_PROSHOP_GUEST=yes`. Sidstnævnte er OFF som standard og er ikke aktiveret i produktion. Den native OpenClaw-produktlæser er fortsat en separat læsefunktion uden cookies og skriveadgang.

Efter en faktisk verificeret Sandberg 3298156-kurv vælges profil og samme leverings-/faktureringsadresse eksplicit i privat indkøbsvisning. Review læser kurv og den observerede gæsteformular, viser præcis kontaktinformation og sender intet. Afsendelse binder opgave/ordre, vare/variant/antal/sælger/pris, profilrevision, formularstruktur og stopgeneration. Review udløber efter to minutter. En ændring, genstart eller stop kræver nyt review. Kun den observerede formular med 13 felter kan sendes én gang; intet generisk submit, login, telefonopslag, betaling eller ordreafsendelse findes.

Cookies forbliver i privat sessionsfil, og adresse/kontakt/token gemmes ikke i delt ordrestatus. Et ukendt skriveudfald forbliver ukendt og blokerer gentagelse. Butikkens svar registreres som kontakt sendt, aldrig som accepteret checkout eller klar overtagelse.

Evidensen i proshop-guest-evidence.json skelner mellem faktisk formularobservation, simulerede HTTPS/controller-tests og rigtige browsertests med syntetisk API. Kontaktaccept, næste leverings-/betalingstrin, endelig pris/levering til 2900 og sikker overtagelse af samme gæstesession er fortsat uimplementeret eller uverificeret. M16 er ikke lukket. Ingen personoplysninger er sendt, og ingen produktion er ændret.
