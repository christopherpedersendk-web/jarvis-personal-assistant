# JARVIS v4.8.0 – personlig kalender og madplanlægning

**Status:** Udviklingsversion til code review og test. Oprettelse af kode/PR aktiverer ingen konto, opdaterer ingen produktionskurv og deployer ikke denne version.

## Hvad er nyt

| Funktion | Data og rettigheder | Handlinger |
|---|---|---|
| Personlig madhukommelse | Brugeren angiver husstandsstørrelse, kost, ingredienser der skal undgås, budgetmål og lager. Gemmes lokalt i `state.json`. | Kan ændres i Mad & indkøb og genfindes via lokal kildebevidst søgning. Ingen automatisk udledning af allergier fra chat. |
| Meal Planner | Ni illustrative basisretter; 1–7 dage, skalering til husstand og fradrag for oplyst lager. | Laver en redigerbar kladde og indkøbsliste. Ingen opdigtede priser eller indkøb. Budget er et mål, ikke en verificeret udgift. |
| Google Kalender | OAuth2 authorization code, PKCE/state, offline refresh-token og `https://www.googleapis.com/auth/calendar.readonly`. | Viser højst 100 kommende aftaler på 1–14 dage. Madplanen kan frivilligt vælge hurtige retter på dage med aftaler. Ingen kalenderændringer. |
| Nemlig.com MCP | Valgfri lokal stdio-adapter til `kraenhansen/nemlig-mcp`. Lukket som standard. | Søg varer, læs begrænset kurv, opret forslag. Kun gennemgået og godkendt forslag kan opdatere den eksisterende kurv. **Ingen bestilling eller betaling.** |

## Hvordan Nemlig-godkendelse fungerer

1. JARVIS søger efter faktiske produkt-ID'er via den lokale Nemlig MCP. Et produkt skal være set i en søgning højst 30 minutter før forslag.
2. JARVIS læser kurvens eksisterende antal, opbygger et forslag med **forhøjelser** (ingen reduktion/fjernelse), absolutte slutantal, basket-fingerprint og 15 minutters udløb. Det er kun en lokal kladde.
3. Brugeren åbner **Mad & indkøb**, ser hvert produkt med gammel, ekstra og ny mængde, skriver præcist `OPDATER NEMLIG-KURV` og trykker særskilt på godkendelsesknappen. Sessionen kræver eksisterende JARVIS-login.
4. Før ændringen kontrolleres den aktuelle kurv på Nemlig. Er den anderledes end ved forslaget, afvises ændringen. Ellers gemmes status `applying` **før** det eksterne kald. Sådan kan samme forslag ikke automatisk genbruges efter afbrudt forbindelse.
5. Kun `set_basket_quantities` bliver kaldt med allerede beregnede absolutte antal. Ved delvis eller ukendt succes vises en advarsel, og et nyt forslag kræver ny søgning, læsning og godkendelse. Ingen automatisk retries fra JARVIS.

Sikkerhedsafgrænsning: Den generiske MCP-klient tager ikke tool-navne eller kommandoer fra modellen. Dens eneste tilladte værktøjer er `search_products`, `get_product_details`, `get_basket` og `set_basket_quantities`; den sidste metode er udelukkende tilgængelig gennem godkendelsesfunktionen. JARVIS har ikke adgang til `set_basket_quantity`, ordrehistorik, checkout, betalingskort, ordreafgivelse eller generiske URL-kald i dette modul. Google Kalender har ingen skrivemetoder. Chat- og stemmeværktøjer har **ingen** kurvgodkendelsesfunktion.

**Begrænsning:** Nemlig MCP er tredjepartskode over en udokumenteret API. Nemlig kan ændre adfærd, priser, produktfelter og adgangsregler. `set_basket_quantities` kan delvist gennemføre batchen; kontroller altid den rigtige kurv på nemlig.com. Fysisk allergen-/ingrediensegnethed skal også kontrolleres selv. Appen gennemfører aldrig køb.

## Google Kalender – manuel første opsætning

1. Opret et eget Google Cloud-projekt og OAuth-klient af typen *Web application*. Aktiver Google Calendar API, vælg korrekt samtykkeskærm og tilføj **kun** read-only scope. En testbruger kan være nødvendig, hvis appen ikke er publiceret.
2. Tilføj din præcise private HTTPS Tailscale-adresse som autoriseret redirect URI, afsluttet med `/api/google/calendar/callback` (eksempel: `https://DIN-PRIVATE-HOST.tailnet.ts.net/api/google/calendar/callback`). Brug aldrig en offentlig port til JARVIS.
3. Sæt `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` og `GOOGLE_OAUTH_REDIRECT_URI` i den eksisterende private `shared/.env` (rettigheder 0600). Genstart derefter JARVIS. **Indsæt ikke koderne i chat, GitHub eller PR.**
4. Åbn JARVIS → **Mad & indkøb → Forbind Google Kalender**, gennemgå Googles samtykke med scope `calendar.readonly`, og godkend. JARVIS gemmer kun refresh-token i eksisterende `data/private-settings.json` (0600). API-status returnerer aldrig token. Vælg *Afbryd forbindelsen* for at fjerne lokalt gemt token; du kan også tilbagekalde adgangen på din Google-konto.

OAuth-kontrol: en éngangstilstand med PKCE udløber efter ti minutter og forbruges efter første callback. Aftalernes titel, start- og sluttid bruges kun på en autoriseret forespørgsel; ingen deltagere, beskrivelser, lokationer eller videolinks returneres. Kun om en dato er travl kan indgå i en gemt madplan. OAuth-start kræver JARVIS' bearer-login; callback er i stedet beskyttet af den korte OAuth-tilstand.

## Nemlig MCP – manuel første opsætning

1. Gennemgå upstream-koden og licens, sikkerhed og Nemligs gældende vilkår. **Fastlås en gennemgået commit** for [`kraenhansen/nemlig-mcp`](https://github.com/kraenhansen/nemlig-mcp). Den er ikke vendoreret i JARVIS-koden.
2. På Ubuntu-serveren: installer `uv` og Python 3.11+, klon upstream i en separat privat mappe, checkout den fastlåste commit, og kør `uv sync --frozen`. Verificer upstream med `uv run pytest` og `uv run python tests/smoke_stdio.py` uden produktionscredentials, før adgang aktiveres. Kontrollér at `command -v uv` giver en absolut sti. JARVIS starter derefter adapteren med `uv run --no-sync --offline`, så nye Python-afhængigheder ikke installeres under en kurvhandling.
3. Gem Nemlig-legitimationsoplysninger **uden for repoet** i `/home/administrator/.config/nemlig/login.json` som `{"username":"...","password":"..."}` med `chmod 600` og ejer `administrator`. Alternativt `NEMLIG_USER`/`NEMLIG_PASS` i privat `shared/.env` (aldrig i chat). Del ikke filen i nogen fejlrapport.
4. Tilføj følgende til `shared/.env` (tilpas de **absolutte** stier):

   ```ini
   NEMLIG_ENABLE_LIVE=yes
   NEMLIG_MCP_DIR=/home/administrator/private-nemlig-mcp
   NEMLIG_MCP_UV=/home/administrator/.local/bin/uv
   ```

5. Genstart JARVIS. I **Mad & indkøb**, kontrollér MCP-status, prøv en **læsebaseret produktsøgning**, gennemgå derefter kurvforslaget. Første virkelige kurvændring bør være én ufarlig vare og kun udføres efter din særskilte godkendelse.

Sæt `NEMLIG_ENABLE_LIVE=no` og genstart, hvis du vil deaktivere integrationen igen. Ikke-konfigureret betyder **ingen** login, ingen netværkskald og ingen kurvændring. **Risiko:** upstream-kode kører i v4.8 som den samme OS-bruger som JARVIS. Kildekoden og afhængigheder skal derfor gennemgås før aktivering. En senere hardening kan isolere MCP i et separat, mindst privilegeret service-user-/container-miljø. Det er ikke påstået implementeret her.

## Deployment og verifikation

1. Gennemgå denne featurebranches pull request og `npm test` (offline, syntetiske kurv- og OAuth-data) samt GitHub Actions' Chromium-test i desktop og mobil. Der foretages ikke automatisk Nemlig-login i tests. Godkend ikke PR'en, hvis sikkerhedskravene ovenfor ikke er opfyldt.
2. Merge efter review og opret derefter et **nyt, præcist** `v4.8.0`-tag på den gennemgåede commit. Undgå at genbruge tags.
3. Brug eksisterende Auto-Update Manager → **Søg efter version → Hent og test → Godkend testet version**. Den eksisterende systemd deployer, shared-data, restic-backup, healthcheck og rollback bevares.
4. Kontrollér live `jarvis.service`, HTTP 200 på loopback, version 4.8.0, Discord og System Health, ny Mad & indkøb-fane, lokal personlig søgning og uændrede private data. Først efter dette sættes eventuelle tredjepartsadgange op.

## Næste iterationer

- Udvid opskriftsbiblioteket til verificerede danske opskriftskilder, målret faktiske tidsbudgetter og brug oplyste præferencer uden at gætte.
- Varematchning af madplanens samlede ingredienser med produktkataloget, varestørrelser og dokumenterede priser, med manuelt valg ved tvivl. Ingen automatisk kurvgodkendelse.
- Valgfri særskilt privilegiegrænse for Nemlig subprocess og lokal embeddings/RAG efter særskilt tilvalg.
- Kalenderoprettelse/ændringer er **ikke** omfattet af v4.8 og skal designes med nye scopes og separat godkendelse, hvis det nogensinde ønskes.
