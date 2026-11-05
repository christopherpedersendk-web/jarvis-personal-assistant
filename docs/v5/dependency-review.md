# Valgfri lokal modelruntime — afhængigheder og fejlisolation

## Faktisk fund, ikke en brugerhændelse

CI42015140734 testede remote `6892cf3dcbbd9dd3bf98a2286c7970017572bab9`, mergecommit `878e65725553bfb9561efc00c8a49c69ac9a7a19`, app-træ `c1f9272923d57bc1083ea646e1c67f98b6a0d121` på Node22.23.4.

- `npm audit --json --omit=dev` fandt to højt klassificerede pakker: `sharp` og den direkte afhængighed `@huggingface/transformers`, som arver fundet. Det er ikke nødvendigvis to uafhængige sårbarheder. Rapporten indeholder tre advisories for sharps billedbiblioteker.
- Rå rapport og det faktisk installerede træ er bevaret i `evidence/dependency-audit-6892cf3d.json`. LockfileSHA var `b0131e9c27262f9aaadddd68f74a2ee5eacd9e2234cf923a22b9402a345d093f`. Artifact13408074628 ZIP SHA256: `4e3d62817cf95c4f33cd06a4bd11c9d10a1b67fa76834d4f3890ce8e058b6f46`.
- Gate fejlede korrekt. Intet fund er undertrykt, og `npm audit fix --force` er ikke kørt.

## Målrettet rettelse og faktisk ny CI

Den eksisterende tekstencoder fastholdes på Transformers.js3.8.1 og samme multilingual-E5-modelrevision, filhashes, pooling og prefix. Den valgfrie runtimes manifest har en eksplicit `sharp: 0.35.5` override. Det begrænser ændringen til den berørte afhængighed i stedet for den major-opgradering, auditværktøjet foreslog.

Vedligeholderens [librsvg-advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w) angiver 0.35.5 som rettet version. [Release0.35.5](https://github.com/lovell/sharp/releases/tag/v0.35.5) og taggets [package.json](https://github.com/lovell/sharp/blob/v0.35.5/package.json) er gennemgået; Nodekravet er `>=20.9.0` og skærper ikke JARVIS' `>=22.6.0`. Øvrige auditreferencer: [libvips](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) og [libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).

Dette er en ændring uden for den oprindelige transitive versionsrange, så kompatibilitet **skal måles**, ikke antages. JARVIS' encoder tager kun afgrænsede tekststrenge; det er ikke en generel billedparser. At billedinput ikke tilbydes, bruges dog ikke til at ignorere installerede høje sårbarheder.

[CI42016975993](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42016975993), remote `2f94679d0e5d800fb3623134e7368bb69c77f178`, mergecommit `212712a8e142dd7b2255783022f3e45f9821ccfe`, app-træ `b519b67f04ccbdf90a7d8971ac28934f689876eb` gennemførte den faktiske rettede runtime på Node22.23.4/npm10.9.9:

- Ægte lokal hybrid: **75/80 =93,75 %**, samme uændrede datasæt og model. Alle16 sikkerhedsspørgsmål, korrektion, glemning og timeoutfallback bestod; nul ugyldige kildelækager. Fuld rapport med96 cases: `evidence/2f94679d-semantic-evaluation.json`.
- Faktisk audit: **0 fund** i alle npm-kategorier; exit0 og komplet installeret inventarliste i `evidence/2f94679d-dependency-audit.json`. Nul auditfund er ikke en garanti for fravær af alle sårbarheder.
- ManifestSHA256 `a9fb4f4c9dd5c29ade576bc9c3d6d71f1f1deb92bc23c593dc36b72a9f11db73`; lockSHA256 `2d53dd39d9f29bf50d65d5310bbd34670fee3b454dc52cac88bb181c424057ab`. Artifact13409856667 download/ZIP verificeret mod SHA256 `3eaf2c28ade6bef1bcf325c38509195c738cfbf4602aaa76c95ef461e3789a10`.
- Alle80 låste pakkeentries er gennemgået for version, offentlig `registry.npmjs.org`-tarball og SHA-512-integritet; ingen links/private kilder. Den uændrede lockfil er nu inkluderet i næste kandidat, og CI bruger **`npm ci --prefix local-semantic-runtime`**. Den næste samlede kandidat skal selv genkøre install/audit/modelporten; dette resultat må ikke tilskrives senere ændringer.

Ingen automatisk runtime- eller modelinstallation i produktion. Reelt persondataindeks, eksterne processorer, modeldownload og administratorens driftsændringer er separate eksplicitte valg.

## Native fejl og procesgrænse

Samme CI's modelevaluering afsluttede med en native `Napi::Error`, exit134, før en komplet rapport blev skrevet. De verificerede modelbytes var klargjort, men den præcise native udløser er ikke bevist. Dette er et tilgængelighedsfund, ikke en måling af retrievalkvaliteten.

Node-workertråde deler proces med deres vært. Derfor flyttes encoderen til en separat, ejet childproces med privat IPC, afgrænsede requests, tømt credential-/preloadmiljø og kun den konkrete lokale modelmappe. Et childexit eller signal afviser de aktuelle/ventende semantiske reads; den samme request gentages ikke automatisk. Aktuel lokal ordsøgning forbliver tilgængelig, og en senere forespørgsel kan forsøge igen.

Dette er **fejlisolation, ikke en OS-sandbox**. Fjernmodeller/cache/download er deaktiveret i runtimekonfigurationen, og encoderens fetch/WebSocket er spærret. Ingen ændring i konto-, Docker- eller sudo-rettigheder. Native allokeringer er ikke hårdt RAM-begrænset af Nodes512 MiB JS-heapgrænse. CI rapporterer derfor både hovedproces-RSS og modelprocessens særskilte RSS; summen af samplede peaks er ikke et samtidigt peak eller en produktionsgaranti. Administratoren skal separat vurdere service-memorygrænser og core-dump-politik før en produktionstilslutning.

Transport/fault-tests bruger eksplicit syntetiske vektorer og rigtige childprocesser med exit134, fatal signal, timeout, credentialfravær og senere recovery. De må aldrig tælles som den ægte modeltest. Den rettede native runtime gennemførte den særskilte ægte CI ovenfor, men det beviser ikke den præcise årsag til det historiske native crash.

Den nye måling registrerede parentpeak95.199.232 B og særskilt childpeak674.295.808 B; sum af samplede peaks769.495.040 B, ikke samtidigt peak. Varm retrievalp95 var44,288 ms; standard1500 ms-koldfristen gav lexical fallback efter1535,236 ms og senere varm hybrid. Disse syntetiske tal og native RAM-forbehold skal med i administratorens isolerede kapacitetskontrol.
