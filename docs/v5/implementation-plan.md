# JARVIS v5.0.0 – implementeringsplan

Kilde: JARVIS_v5_0_0_Plan_og_teknisk_overdragelse.docx, ejerens dokument af4. november2026. Hele A–L, R01–R13, M0–M7 og afsnit5–6 er læst og styrer ønsket adfærd. Observeret kode og faktisk udførte tests styrer påstandene om nuværende adfærd. Alle P0/P1 skal være løst og verificeret før release; ingen scope-reduktion eller mellemliggende4.x-release er aftalt.

## Tilladelse og baseline

M0–M6 omfatter isoleret udvikling, syntetiske tests, lokale commits og den eksisterende udviklingsgren/draft PR. Merge til main, stabilt tag/release og produktion er tre særskilte M7-beslutninger. Ingen reelle Nemlig-writes, nye recurringjobs, kontorettigheder, eksterne persondataindeks, kalenderwrites, kontakt, ordre eller betaling.

Baseline v4.9.1 og main blev verificeret til **6b2b0736a32e0968d5db233512672d197b4885f7**, root-træ **3de6cd0accb7f5c637835b55ca0049276b5ab08b**, app-træ **900407cb571c6a82e3a5131077455c540876d457**. Oprindeligt149/149 tests. Historisk v4.9.0 og øvrige tags bevares. De24 historiske Nemlig-Python-tests er ikke ny kandidatverifikation.

Det oprindelige dirty worktree bevares. Arbejdet fortsætter i jarvis-v5-resume/feature/v5-resume, remote feature/v5-foundation og draft PR #7. Lokal Git-historik er rekonstrueret; udgiv kun identiske trees mod faktisk remote-parent via Git Data API, aldrig force-push. Appkrav er Node>=22.6.0; lokal Node24.22.1 og faktisk CI Node22.23.4 dokumenteres hver for sig.

## Milepæle og acceptporte

| Milepæl | Leverance | Krævet evidens |
|---|---|---|
| M0 | Baseline, arkitektur, P0/P1 og R-register | SHA/tree, oprindelige tests,69-rækkers matrix, repræsentativ førmåling |
| M1 | Lager/settings/kladder/handlinger/godkendelser | R01–R06 og sikkerhedsregression under fejlindsprøjtning |
| M2 | Fælles revision/kilde/fejlkontrakt, journal og kø | Serialisering, genstart, cancellation, sandfærdig readiness; JSON-/SQLite-beslutning |
| M3 | Uafhængig hukommelse og generel planlægning; sager/procedurer/jobs | ≥80 danske spørgsmål/≥90 % kilde@5 med ægte semantik; ≥30 forskellige planlægningsscenarier; policy- og recoverytests |
| M4 | Husstand, opskrift, aftensmad, lager og indkøb | Samlet redigerbart workflow med syntetiske integrationer, nul utilsigtede writes |
| M5 | Dansk navigation, fælles editorer, kilder og kladder | Begge browsermotorer/størrelser, keyboard/fokus, reflow/kontrast og manuelle kontroller |
| M6 | Reviewbar kandidat, migration/restore/performance | Præcis kandidatbinding, regressions-/integrations-/browserbevis og udført manuel accept |
| M7 | Merge, stabil release, produktion | Tre separate ejerbeslutninger; administratorreview, ingen genvej i rettigheder |

Milepæle fortsættes ved teknisk opfyldte kriterier; manglende manuel kontrol blokerer accept, ikke uafhængig sikker implementering. Aktuelle resultater og næste præcise handling står i progress.md.

## Arkitektur og grænser

- Modulær monolit med gradvis frontendopdeling; ingen unødvendig serviceopdeling.
- JSON/skema1 med én serialiseret skriver, copy-on-write, fsync og privat recoveryjournal beholdes på målt grundlag. To filrenames eller to pakkemappeflytninger er ikke én atomisk transaktion. Ukendt publicering spærrer yderligere writes.
- Ægte lokal multilingual-E5 er opt-in med faste modelassets/runtime-lock og inkrementelt indeks; lokal lexical fallback er tilgængelig. Intet automatisk download eller eksternt indeks.
- Nemlig: faktisk ejerklik på Overfør til Nemlig, engangsintention bundet til revision/gennemgået forslag, add-only og bevarede andre kurvelinjer. Model, Discord, tale, skills/jobs kan ikke skabe klikket. Lokale checks er ikke ekstern atomicitet.
- Google er read-only; ukendt kalender er ikke fri kapacitet eller husstandsfremmøde. Import/modeltekst er data, ikke tilladelser eller bekræftede fakta.
- Aftensmad, eksplicit husstand, bekræftet lager og simple reservationer. Planlagt mad/restemad/kurv er ikke forbrug, køb, levering eller lager.
- Fuld Sonos OAuth, batteri-Nest-events, Home bridge, Google Tasks/kalenderwrites og browserbooking er P2. Eksisterende Home-funktioner og ærlig status bevares.

## Dokumenter og arbejdsform

Kravmatrixen forbinder alle56 A–L og13 R-fund med placering, test, prioritet, milepæl og status. decisions.md begrunder væsentlige valg; verification.md og rå evidence bevarer også fejlresultater. migration-and-rollback.md afgrænser recovery, manual-acceptance.md bevarer ukørte manuelle checks, release-notes.md og release-proposal.md må ikke beskrive udviklingskode som frigivet.

Brug fokuserede ændringer, syntetiske data og separat konfiguration. Et dokumenteret kodefund er ikke dokumentation for en brugerhændelse. Ingen testcase, kvalitetsgrænse eller relevant scope reduceres for at få grønt.
