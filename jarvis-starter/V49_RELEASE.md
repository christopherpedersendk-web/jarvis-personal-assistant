# JARVIS v4.9.0 – reviewkandidat

Status: udviklingsversion på særskilt branch. Ikke en frigivet eller installeret produktionsrelease. Merge, tag og deployment kræver efterfølgende brugerreview og den eksisterende godkendelsesproces.

## De seks leverancer

1. **Familiekalender og husstand.** Standardantal voksne og børn med alder og redigerbar portionsfaktor samt dagsvise undtagelser. Temaer: hverdag, børnevenlig, vegansk, vegetarisk, date, fest og hurtig. Dage uden hjemmemåltid kan springes over. Oplysninger registreres eksplicit; JARVIS udleder ikke familieforhold eller tilstedeværelse af kalenderaftalers tekst.
2. **Redigerbar madplan.** Først et forslag uden anvendelig indkøbsliste. Brugeren kan ændre retter, portioner, ingredienser og dage. Dernæst oprettes og redigeres indkøbslisten. Ændringer øger revisionen og ugyldiggør efterfølgende forslag.
3. **Opskriftshukommelse.** Tekst og links kan gemmes i brugerfladen. Discord accepterer eksplicit “Gem opskrift:” med tekst, link eller op til tre PNG/JPEG/WebP-billeder. Kilde og dato følger opskriften. Alt importeres som uverificeret udkast; kun gennemgåede opskrifter indgår i planlægning og personlig søgning.
4. **Intelligent indkøbsforslag.** Madplanens beregnede portioner og pantry kombineres med læsning af Nemlig-sortiment og kurv. Verificerbare pakningsstørrelser omsættes til hele pakker. Kendte varer i kurven fratrækkes; tvetydige pakninger og kostoplysninger kræver gennemgang. Forslaget kan redigeres før overførsel.
5. **Bedre personlig hukommelse.** Kategori, kilde, revision, dato, valgfrit udløb, rettelser og arkivering. Modelgenererede hukommelsespunkter forbliver forslag indtil ejerens bekræftelse. Rettet tekst erstatter den gamle i aktiv retrieval. Foreslåede, udløbne og arkiverede punkter bruges ikke som personlige fakta.
6. **Mere intelligent planlægning.** Dokumenterede næste skridt fra manglende husstandsoplysninger, ikke-gennemgåede opskrifter, ændrede planer, forældede lister og kurvforslag indgår i eksisterende dags-/ugeoverblik. Hvert forslag har forklaring og kilde. Dette er lokal, regel- og afhængighedsbaseret planlægning og forbedret tekst-retrieval – ikke en ny embeddingsmodel eller ubegrænset autonom agent.

## Arbejdsgang og rettigheder

Husstand/temaer → redigerbart madplansforslag → opret og ret indkøbsliste → beregn og ret indkøbsforslag med Nemlig-varer → gennemgå kurvforslag → **Overfør til Nemlig**.

- Der sker ingen ekstern kurvændring under forslag, redigering, søgning eller kalenderlæsning.
- Ét bevidst klik på Overfør til Nemlig er godkendelsen. Ingen tekstfrase skal indtastes. Klikket er bundet til forslagets ID og revision.
- Der tilføjes kun de gennemgåede mængder til eksisterende varer. Ingen tømning eller fjernelse af kurvvarer.
- Forslag udløber efter 15 minutter. Ændret plan, opskrift, indkøbsforslag eller kurv kræver et nyt/ajourført forslag.
- Fast MCP-allowlist: search_products, get_product_details, get_basket og den separat beskyttede set_basket_quantities. Modellen har ingen overførsels- eller godkendelsesfunktion. Ingen checkout, betaling, ordreafgivelse eller ændring af levering.
- En overførsel markeres enkeltanvendelig på disk før skrivning. Ukendt/delvist resultat eller genstart giver ingen automatisk gentagelse. Kontroller altid Nemlig ved usikkert resultat.
- Nemlig MCP tilbyder ikke en atomisk sammenlign-og-skriv-operation. Der er et lille restvindue for samtidige ændringer på Nemligs website efter sidste kurvlæsning. Undgå parallel redigering under overførsel; dette er ikke en transaktionsgaranti.

## Google Kalender og familiedage

Eksisterende read-only OAuth-forbindelse bevares. Der oprettes/ændres ingen Google-aftaler. Ved tilvalg prioriterer madplanen hurtige retter, når faktiske tidsbestemte aftaler overlapper kl. 16–20 dansk tid. Flerdages heldagsaftaler tæller som et groft travlhedssignal; end-dato er eksklusiv. Enkeltstående heldagsnoter/fødselsdage tæller ikke automatisk som aftensmadskonflikt. Aftaler markeret ledig ignoreres.

Kun det faktisk læste 14-dagesvindue må bruges, og ufuldstændig paginering afvises. En aftensmad i dag kan ligge delvist før læsetidspunktet; vælg i så fald i morgen eller planlæg uden kalenderhensyn. Ingen kalendertekst gemmes i madplanen. Husstandens tilstedeværelse kommer fra særskilt registrering, ikke fra kalenderinferens. Gentagne samværs-/turnusregler og tovejsfamiliekalendersynkronisering er ikke implementeret.

## Opskriftsindtag og databehandling

- HTTPS-links læses som data uden login, cookies eller afvikling af scripts. DNS-opslag valideres og fastlåses til offentlige adresser; alle redirects kontrolleres igen. Størrelse, MIME, antal og tid er begrænset.
- Statiske Recipe JSON-LD-data forsøges udtrukket. Loginbeskyttede, dynamiske, blokerede eller ukendte sider bevares ærligt som links til manuel gennemgang; ingen omgåelse af adgangsbegrænsninger.
- Discord-billeder tillades kun fra validerede CDN-attachment-adresser med matchende kanal-/attachment-ID, MIME og billedsignatur. Maksimalt 3 billeder à 2 MB. Signerede downloadadresser lagres ikke i opskriftsmetadata.
- Mediefiler gemmes privat under den fælles datamappe med mappe-/filrettigheder 0700/0600; ingen offentlig filroute. Autentificeret visning leverer kun den valgte opskrifts mediefil.
- Hvis OpenAI-nøglen er konfigureret, kan gemt opskriftstekst/billeder sendes til den eksisterende OPENAI_TEXT_MODEL til struktureret udtræk. Anmodningen har ingen tools, personlig hukommelse eller credentials i input og bruger store:false. Ingen ny model eller API-nøgle vælges automatisk. Almindelige Discord-billeder uden eksplicit gemmekommando importeres ikke.
- Udtrækkeren kan ikke bekræfte opskrifter eller ændre rettigheder. Titel, kosttype, tid, grundportioner og ingredienser kan rettes før bekræftelse. Ukendte eller delvist aflæste mængder skal gennemgås.
- Portionsfaktorer er praktiske, redigerbare køkkenestimater. Opskrifter og varematches er ikke ernærings-, børnesikkerheds- eller allergigarantier. Kontroller varedeklarationer; kendte åbenlyse konflikter filtreres, manglende oplysninger er ikke bevis på egnethed.

## Migration, drift og rollback

- Ingen nye runtime-npm-afhængigheder. Node 22.6+ og eksisterende uv/Nemlig-opsætning anvendes; ingen installation/download fra MCP under en indkøbsforespørgsel.
- Eksisterende credentials, Nemlig-login, OAuth-refresh-token, Discord-ownerbegrænsning og opt-in til notifikationer bevares.
- Nye felter i state.json: mealHousehold, recipes, shoppingDrafts samt revisions-/kildedata på minder, planer og kurvforslag. De indlæses ved genstart.
- Tidligere madplaners lister bevares som legacyShoppingList, men kræver ny gennemgang/generering. Ukendt fordeling mellem voksne og børn bliver ikke opdigtet ved migration.
- Arkivering betyder ikke permanent sletning: rå opskriftsfiler, separate samtaler og backups bevares. Rettede/arkiverede data bruges ikke i aktiv retrieval; gamle samtaler kan stadig indeholde tidligere tekst.
- Pantry er brugerregistreret beholdning. Der foretages ingen fysisk lagerkontrol, automatisk lageroptælling eller automatisk nedskrivning efter et måltid.
- Eksisterende plan-/forslagsgrænser bevares. Gem hele den fælles datamappe inkl. opskriftsmedier i backup. Ved rollback af kode til v4.8 skal en tilhørende datakopi vurderes: den ældre loader kender ikke de nye felter og kan overskrive dem ved næste lagring. Gendan ikke backup automatisk over nyere brugerændringer.

## Verifikation før release

Automatiske tests er syntetiske og må ikke bruge rigtige Google-/Discord-/Nemlig-konti, klientdata, tokens eller personbilleder. Kør npm test og GitHub-browserjobbet; gennemgå desktop-/mobilskærmbilleder. Ekstern billedudtrækning og autentificerede integrationer kræver senere ejerens afgrænsede smoke test.

Manuel acceptcheckliste:

- Registrer fx 2 voksne og 2 børn med forskellig portionsfaktor; ændr en dag til date og en anden til ingen hjemme. Kontrollér portioner og ingrediensmængder, også efter genstart.
- Opret et forslag, byt en ret og ret portionerne. Bekræft at ingen indkøbsliste/kurv ændres, før næste trin vælges. En rettelse skal blokere et gammelt kurvforslag.
- Gem tekst, et offentligt opskriftslink og et billede via ejerens Discord. Kontrollér kilde, oprindeligt materiale, udkaststatus, rettelser og genbrug efter bekræftelse. Ukendt kilde skal være et link, ikke en opdigtet komplet opskrift.
- Registrer pantry og gennemgå Nemlig-match, pakningsstørrelser, antal, undgå-ingredienser og prisforbehold. Test et tvetydigt match og en ændret kurv; ingen liveoverførsel før dit klik.
- Gem/ret et hukommelsespunkt, bekræft et model-forslag og arkivér et andet. Søg efter den gamle tekst; bekræft at aktive resultater følger rettelser/arkivering. Separate historik/backups må ikke beskrives som slettet.
- Kontrollér planlægningsforslagenes kilde/forklaring. Afprøv opt-in/stilletid uden at aktivere ekstra notifikationer.
- Bevar et lokalt restorepunkt, afslut review og brug derefter særskilt release-tag → staging → tests → ejergodkendelse. Ingen automatisk frigivelse fra denne udviklingsbranch.

## Primære integrationsreferencer

- Nemlig MCP: https://github.com/kraenhansen/nemlig-mcp
- Discord attachments: https://docs.discord.com/developers/resources/message#attachment-object
- Discord signerede CDN-links: https://docs.discord.com/developers/reference#signed-attachment-cdn-urls
- OpenAI billedinput: https://developers.openai.com/api/docs/guides/images-vision
- OpenAI struktureret output: https://developers.openai.com/api/docs/guides/structured-outputs
