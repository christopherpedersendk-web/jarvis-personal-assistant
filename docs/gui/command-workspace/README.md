# Kommandocenter: implementeret redesign

## Grundlag og analyse

Basen er main `7758d9491105c06792ae8f22831609017c633d7c`, pakke 5.5.4. Analysen er baseret på kode og DOM-integration, ikke en brugerundersøgelse eller visuel browserinspektion.

Observerede problemer i koden:
- `commerce.js` monterede ordrekladder under Indstillinger → Integrationer.
- `self-development.js` monterede udviklingsarbejde under Indstillinger → System.
- Global stopkontrol var placeret sammen med teknisk administration.
- Forsiden havde ingen direkte genveje til shopping og udvikling.

Designet bruger en lys, afdæmpet grøn/grå palet, typografisk hierarki og eksisterende komponenter. Kommandoinput og hverdagsarbejde prioriteres; tekniske tal ligger fortsat i indstillinger. Mobilnavigation er en ombrydelig topnavigation frem for en fast bundbjælke med syv destinationer, så tastatur og formularer ikke dækkes af den.

## Funktionskort

| Funktion | Placering |
|---|---|
| Chat, stemme, opgaver for i dag, beslutninger | Overblik |
| Globalt stop, genoptag og faktisk forbrug | Stop og forbrugsstatus, over hovedindholdet |
| Personlige opgaver, agentjob, projekter | Planlægning → Opgaver |
| Kalender og kapacitet | Planlægning → Kalender |
| Madplan, opskrifter, indkøbslister, Nemlig | Planlægning → Madplan |
| Noter og lister | Planlægning → Noter og lister |
| Offentlig læsning og bookingkladder | Planlægning → Webarbejde |
| Produktsøgning, sammenligning, ordrekladder | Indkøb |
| JARVIS-udviklingsønsker, ændringer, test og PR | Udvikling |
| Separate kodeprojekter | Planlægning → Opgaver → Kodeprojekter; genvej fra Udvikling |
| Smart Home | Hjem |
| Overvågningsjob | Overvågninger |
| Hukommelse, stamdata, forbindelser, skills, notifikationer, system og gamle kodeforslag | Eksisterende sektioner under Indstillinger |
| Søgning og chat fra andre sider | Eksisterende globale dialoger |

De nye sider bruger eksisterende commerce-/self-development-handlers og API'er. Ingen erstatningsdata er indbygget. Begrænsninger og OFF-flags bevares. Formularer flyttes ikke ved navigation; DOM-identitet og kladder bevares. Eksempelknapper udfylder kun et tomt beskedfelt og sender aldrig automatisk. Global stopknap flyttes med sine eksisterende event handlers, så kontrol og status bruger samme backendkontrakt.

## Verifikation

En fokuseret DOM-integrationskørsel med jsdom og en faktisk lokal JARVIS-server er bestået. Serveren bruger en ny midlertidig datamappe, syntetisk adgangskode og ingen providercredentials. Ingen eksterne integrationer eller modelkald blev aktiveret.

Kontrollen verificerer:
- Bootstrap/login mod backend og levering af de nye JS/CSS-assets.
- Commerce og selvudvikling monteres på deres egne destinationer.
- Kommandoforslag overskriver ikke beskedkladder.
- Navigation bevarer ordreformularens feltidentitet og værdi.
- Faktisk global stophandling via backend og returneret stopstatus.
- Fejlet beskedafsendelse bevarer kladden ved manglende modelopsætning.
- Madplan, noter og hukommelse er fortsat tilgængelige.
- Ingen uventede JavaScript-runtimefejl i denne kørsel.

Kørsel (testafhængigheden installeres særskilt og ændrer ikke produktionsafhængigheder):

```bash
npm install --prefix /tmp/jarvis-ui-test jsdom@31.0.0 --no-audit --no-fund
JARVIS_TEST_JSDOM=/tmp/jarvis-ui-test/node_modules/jsdom node --test jarvis-starter/scripts/verify-workspace.cjs
```

Visuel browserkontrol blev forsøgt, men lokal Chromium kunne ikke starte pga. en miljøbegrænsning på sockets; cloudbrowseren havde ikke adgang til localhost. Screenshots, viewport-overflow, faktisk fokusvisning/kontrast og touch/skærmtastatur er derfor ikke verificeret. Der er ingen screenshots i denne leverance. DOM-tests beviser ikke visuel kvalitet.

Faktiske forløb med modelbesvarelse, opgaveopfølgning, godkendelser, madplanredigering og PR-resultater er ikke nyverificeret i denne ændring. Deres eksisterende handlers bevares. Ingen fuld regression eller historiske testantal overføres til kandidaten.

## Staging og rollback

- Checkout PR'ens konkrete SHA i en separat stagingkopi med separat datamappe og port.
- Start eksisterende `npm start`; de nye assets er tilføjet serverens eksplicitte statiske allowlist.
- Brug testdata og behold eksterne skrivefunktioner OFF.
- Før accept: browserkontrollér telefon/desktop, overlay-fokus, kladder, stop, madplanredigering, handelsreview og udviklingsforløb med relevante tilgængelige integrationer.
- Rollback: stop stagingprocessen og skift kodekopien tilbage til basen ovenfor. Ingen datamigration er tilføjet. Produktionsinstallation og eksisterende data er ikke ændret.

PR'en er draft indtil visuel kontrol og de resterende relevante brugerforløb er verificeret. M12–M18 lukkes ikke af et redesign.
