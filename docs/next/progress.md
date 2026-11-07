# Udvikling efter v5.4.0

Remotegrundlag kontrolleret 7. november 2026: main og den allerede udgivne v5.4.0 peger på `5ed073367e6db86b3bb6af9aee6376a3c85fbf35`. PR #18 er historisk; arbejdet fortsætter i draft-PR #19, `feature/commerce-masterdata`. v5.3.0 og v5.4.0 ændres ikke. Pakkeversion 5.4.0 og schema 1/readableFrom 0 bevares indtil særskilt releasebeslutning. Det er derfor ikke en ny releasepakke.

Historiske 1.248 tests/seks CI-workflows gælder den tidligere kandidat, ikke denne ændring. Det første PR19-checkpoint `fdb41ae35188ee655a8d98c601404bf0e4519c38` havde fem grønne workflows; mediebygningen fejlede under offentlig FFmpeg-nøgledownload før build (TLS reset). Den eksisterende begrænsede curl-retry dækker nu også denne transportfejl; signatur og checksum er uændrede.

## Leveret

- Discord-diagnose adskiller deaktivering, manglende credential, ejer/guild og REST-permissions/rate limit. Naturlige danske kanalønsker går til samme reviewcontroller. Ingen Administrator-genvej eller automatisk aktivering. Ejerens installationsfejl er ikke erklæret løst uden liveaccept.
- Stamdata med navngivne profiler, eksplicit standard, separat faktureringsadresse, revision, rettelse/sletning og metadatahistorik. Samme private indstillingsfil (0600), ikke modelhukommelsen. UI under Indstillinger → Profil. Strukturerede chat-/Discord-DM-ændringer kræver engangsreview. Ingen persondata i delt kanal eller almindelig chathistorik.
- Indkøbsklargøring under Indstillinger → Integrationer: præcis vare/variant/sælger/mængde/pris/fragt/valuta, adresserevision, udløb og hashbundet engangsoverdragelse. Overdragelsen åbner kun varelinks til brugerens egen browser. Ingen kurv, adresseoverførsel, ordre eller betaling sendes af Jarvis.
- Separat, deaktiveret OpenClaw-produktlæser til den faste profil `jarvis-commerce`. Kun åbne/læse/lukke eget faneblad; ingen scripts, cookies, generelle værktøjer eller `/act`. Faktisk installeret OpenClaw 2026.11.1 er prøvet for konfiguration, lokal kontrolstatus, forkert credential, ukendt profil og forbudt generisk browserværktøj. Det er ikke en Chrome-/merchant-/netværkscontainmentprøve.
- Historikbaseret madplansvariation, ingrediensfamilier på tværs af titler, valgfri høj variation/favoritprioritet og eksplicit valgt/tilberedt/ikke tilberedt via UI og fælles chatværktøj. Balanceret variation bevarer kendte pris/lagerfordele. Én aktiv plan og eksisterende reviewlag bevares.
- Samlet Nemlig-søgeoversigt med ingrediensnavn og separate mængder. Identiske rene søgenavne slås op én gang pr. vareforslag. Eksisterende mængde-/kurv- og allergikontrol bevares.
- Assisteret research fra flere opskriftskilder åbner en usendt chatkladde; eksisterende opskriftsindbakke og menneskelig gennemgang genbruges. Ingen automatisk installation, masseimport eller bekræftelse af opskrifter.
- Afgrænset selvudvikling fra offentlig main-snapshot → isolerede funktionstests → ny `agent/fix-*`-gren → draft-PR med deterministisk patchversion. Kun to funktionsmoduler er skrivbare. Agentens egen kandidatgodkendelse er særskilt deaktiveret og kræver uændret SHA, alle krævede workflows/checks og uafhængigt sikkerhedsreview. Ingen merge-/tag-/deployfunktion.

Se [acceptregister](acceptance-register.md), [drift og ejerprøve](operations.md), [sikkerhedsreview](security-review.md) og [evidens](evidence.json). Hele milestones er ikke accepteret på baggrund af disse delprøver.

## Åbent

Faktisk Discord-kanalaccept, ejerinstallationens backup/restore og fysisk iPhone, rigtig modelkvalitet, godkendt isoleret browserhost med Chrome/egressprøver, merchant-login/checkout og rigtig udviklings-PR fra Jarvis mangler. Automatisk browserlogin/kurv/betalingsinitiering er ikke implementeret eller aktiveret. Disse kriterier videreføres, ikke lukkes ved en release.
