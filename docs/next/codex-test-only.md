# Ejerens test-only-opgave

Faktisk ejeropgave `75f302d8` gennem Discord oprettede og ændrede alene den godkendte opgavetest. Den kørende 5.5.3-bro fandt ingen beskyttet testkontrakt, fordi kun programfilsændringer blev brugt til kontraktvalg. Ingen Docker-test var startet ved afvisningen; journalen blev alligevel markeret unknown. Ingen PR er publiceret.

Rettelsen binder test-only-opgaven til den kanoniske kontrakt for et direkte importeret, allerede allowlistet modul. Fil-/shellrettigheder udvides ikke; manglende kontrakt starter ingen runner. Den konkrete kendte preflightafvisning bliver not_run/failed. Ubekræftede eksekveringsfejl og alle gamle unknown-kvitteringer bevares og blokerer fortsat værktøjer. Ingen automatisk journalrydning eller genforsøg.

Ejerens præcise testbytes, filsti, diffhash og base blev reproduceret i en separat repo/worktree: gammel kode afviste før runner; ny kode kørte faktisk netværksløs Docker og beskyttet kanonisk fixture med bestået resultat. Det opdaterer ikke den oprindelige produktionsopgaves testbevis. Se [liveevidens](codex-test-only-live.json) og [fokuserede tests](codex-test-only-evidence.json).

Efter en senere særskilt autoriseret installation: inspicér originalopgavens kvitteringer og ændringer før valg af et nyt eksplicit kontrolleret forløb. Slet eller nulstil ikke unknown automatisk, og lov ikke fuld ejeraccept til draft-PR på baggrund af den isolerede reproduktion. Aktivering og ejerens konkrete publiceringsreview er fortsat separate handlinger.
