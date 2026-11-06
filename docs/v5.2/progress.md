# OpenJarvis — kandidat efter v5.1.1

Opdateret 6. november 2026. Arbejdet fortsætter i [draft PR #15](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/pull/15), `feature/v5.2-m1-m3`.

Ejerens bekræftelse står ved magt: v5.1.1 er released, Discord-tekst virker, og rapporter leveres dertil. Main-baseline er `7037a52b0fba117d01be1a0b258672b76257475d`. Der er ikke merget, tagget, deployet eller aktiveret nye eksterne funktioner. Pakken forbliver 5.1.1 indtil særskilt releasebeslutning.

## Leveret i grenen

- **M1:** kontrol af tag/pakke/skema; rettelse af mobilbrowserens opstarts-race; offline backup af navngivne data-, konfigurations- og projektmapper; hashkontrol og isoleret gendannelse med opstart af rigtig Node-service på syntetiske data.
- **M2:** servervalideret værktøjskatalog, spærring af udskudte funktioner og gammel stemmerute uden session; konkret ejer-/revisions-/parameterbundet Nemlig-review; varige stemmereservationer og stop med server-side hangup; kontrol af hosted tools, OpenClaw og Discord-lydkald. Ressourcegrænserne er **ikke et samlet kronebudget**.
- **M3:** bevarede kilder og Maps-links i fælles research; OpenClaw-kontraktprobe; en valgfri JavaScript-browser i sandbox/container uden eget netværk. Kun offentlige læsninger efter konkret review. Den er deaktiveret som standard.
- **M4:** én aktiv madplan i Today/påmindelser og fælles værktøjssvar; historiske planer bevares uden at udløse dublerede fremmødepåmindelser.
- **M5:** valgfri Discord-stemme i én valgt serverkanal, kun ejeren, tydelig lyttemeddelelse, eksplicit start/stop, tids- og kaldgrænser. Den eksisterende bot genbruges. Funktionen er deaktiveret som standard.
- **M6:** mere præcist dansk skillvalg, tydelige integrationsfejl og en evaluator til 30 reelle dansksprogede modelopgaver med menneskelig bedømmelse, kildefingerprint og alle kritiske sikkerhedsprøver som krav.

Ingen hel milestone er erklæret færdig. De resterende acceptprøver kræver faktisk installation, en fysisk telefon, en konfigureret OpenClaw-gateway eller model-/Discord-adgang. Se [acceptregister](acceptance-register.md), [test- og driftsvejledning](operations-and-acceptance.md) og [sikkerhedsgrænser](security-boundaries.md).

## Evidens og begrænsninger

Kodecheckpoint `e0ecdaee0a68fa4d5c734d2a4005ebffb158f6f3`: **1.169 lokale Node-tests bestod**. Derefter er HTTP-/browserprøven og hukommelsesproveniens udvidet; den samlede lokale suite består nu **1.172/1.172**. Se [træbundet lokal testregistrering](local-test-result.json). Historiske 1.134/1.166/1.167-tal er ikke evidens for senere ændringer. Den aktuelle PRs commitbundne CI og artefakter er det autoritative grundlag for den udleverede kandidat.

På `fa2ffe902365f7d6b235cd0da5c089d9bd25c2d8` bestod containerisolation, Discord-stemmens Node 22/24-afhængigheder, 36 Chromium/WebKit-layoutcases og fire dybe desktop/mobilforløb. GUI-workflowets separate kontrolsmoke fejlede, fordi den stadig brugte den gamle stemmerute uden session. Denne prøve er ændret til en ægte lokal HTTP-session med syntetisk udbyder: afvisning uden session, deduplikering på tværs af ruter, stop/genstart og ugyldig gammel session efter genoptagelse. Kravet er bevaret og udvidet, ikke omgået.

Browseren kunne ikke startes i det lokale værktøjsmiljø: browserdownload fejlede, og den installerede Chromium ramte OS-restriktioner. Den blev derfor bygget og testet i CI med Docker og sandbox aktiveret. Kandidaten tilføjer også en særskilt prøve af faktiske offentlige sider gennem samme isolerede browser og DNS-pinned HTTPS-transport; resultatet fremgår af det commitbundne CI-artefakt. Live modeltest og OpenClaw-probe er kun kørt i `not_run`-tilstand; der findes ingen API-/gatewayadgang her.

## Stoppunkt og næste ejerprøve

1. Kontrollér, at alle checks til PR-hovedets præcise SHA er grønne; test kandidaten i en isoleret kopi.
2. Gennemfør fysisk iPhone-/stemmeprøve og gendannelse af en faktisk, offline installation. Syntetisk gendannelse dokumenterer ikke produktionsbackup eller systemd-konfiguration.
3. Efter særskilt aktivering i testmiljø: kør OpenClaw-kontraktproben, offentlige browserlæsninger og Discord-stemmeprøven. Kør og bedøm de 30 modelopgaver med lokalt konfigureret API-adgang.

Smart Home afventer lokal agent. Kalenderændringer, browserlogin, formularafsendelse, køb og booking er fortsat udskudt. Jarvis ejer fortsat madplan, hukommelse, rapportplanlægning og Discord-bot.
