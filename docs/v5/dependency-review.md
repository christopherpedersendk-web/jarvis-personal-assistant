# Valgfri lokal modelruntime — afhængigheder og fejlisolation

## Faktisk fund, ikke en brugerhændelse

CI42015140734 testede remote `6892cf3dcbbd9dd3bf98a2286c7970017572bab9`, mergecommit `878e65725553bfb9561efc00c8a49c69ac9a7a19`, app-træ `c1f9272923d57bc1083ea646e1c67f98b6a0d121` på Node22.23.4.

- `npm audit --json --omit=dev` fandt to højt klassificerede pakker: `sharp` og den direkte afhængighed `@huggingface/transformers`, som arver fundet. Det er ikke nødvendigvis to uafhængige sårbarheder. Rapporten indeholder tre advisories for sharps billedbiblioteker.
- Rå rapport og det faktisk installerede træ er bevaret i `evidence/dependency-audit-6892cf3d.json`. LockfileSHA var `b0131e9c27262f9aaadddd68f74a2ee5eacd9e2234cf923a22b9402a345d093f`. Artifact13408074628 ZIP SHA256: `4e3d62817cf95c4f33cd06a4bd11c9d10a1b67fa76834d4f3890ce8e058b6f46`.
- Gate fejlede korrekt. Intet fund er undertrykt, og `npm audit fix --force` er ikke kørt.

## Målrettet rettelse under afprøvning

Den eksisterende tekstencoder fastholdes på Transformers.js3.8.1 og samme multilingual-E5-modelrevision, filhashes, pooling og prefix. Den valgfrie runtimes manifest har en eksplicit `sharp: 0.35.5` override. Det begrænser ændringen til den berørte afhængighed i stedet for den major-opgradering, auditværktøjet foreslog.

Vedligeholderens [librsvg-advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w) angiver 0.35.5 som rettet version. [Release0.35.5](https://github.com/lovell/sharp/releases/tag/v0.35.5) og taggets [package.json](https://github.com/lovell/sharp/blob/v0.35.5/package.json) er gennemgået; Nodekravet er `>=20.9.0` og skærper ikke JARVIS' `>=22.6.0`. Øvrige auditreferencer: [libvips](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) og [libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).

Dette er en ændring uden for den oprindelige transitive versionsrange, så kompatibilitet **skal måles**, ikke antages. JARVIS' encoder tager kun afgrænsede tekststrenge; det er ikke en generel billedparser. At billedinput ikke tilbydes, bruges dog ikke til at ignorere installerede høje sårbarheder.

Før RC:

1. Installer kun i den isolerede CI, gem den præcise nye lockfil og inventarliste, og kræv audit uden høje/kritiske fund.
2. Gennemgå lockfilens versions-, integrity- og offentlige registryreferencer. Commit den og brug `npm ci`, ikke fortsat flydende resolution.
3. Gentag den uændrede ægte modelmåling med80 relevante og16 sikkerhedsspørgsmål, ≥90 % hybrid-kilde@5, korrektion, invalid-fact-udelukkelse og timeoutfallback.
4. Bind endelig rapport, manifest, lockfil og app-træ. Ingen automatisk runtime- eller modelinstallation i produktion.

## Native fejl og procesgrænse

Samme CI's modelevaluering afsluttede med en native `Napi::Error`, exit134, før en komplet rapport blev skrevet. De verificerede modelbytes var klargjort, men den præcise native udløser er ikke bevist. Dette er et tilgængelighedsfund, ikke en måling af retrievalkvaliteten.

Node-workertråde deler proces med deres vært. Derfor flyttes encoderen til en separat, ejet childproces med privat IPC, afgrænsede requests, tømt credential-/preloadmiljø og kun den konkrete lokale modelmappe. Et childexit eller signal afviser de aktuelle/ventende semantiske reads; den samme request gentages ikke automatisk. Aktuel lokal ordsøgning forbliver tilgængelig, og en senere forespørgsel kan forsøge igen.

Dette er **fejlisolation, ikke en OS-sandbox**. Fjernmodeller/cache/download er deaktiveret i runtimekonfigurationen, og encoderens fetch/WebSocket er spærret. Ingen ændring i konto-, Docker- eller sudo-rettigheder. Native allokeringer er ikke hårdt RAM-begrænset af Nodes512 MiB JS-heapgrænse. CI rapporterer derfor både hovedproces-RSS og modelprocessens særskilte RSS; summen af samplede peaks er ikke et samtidigt peak eller en produktionsgaranti. Administratoren skal separat vurdere service-memorygrænser og core-dump-politik før en produktionstilslutning.

Transport/fault-tests bruger eksplicit syntetiske vektorer og rigtige childprocesser med exit134, fatal signal, timeout, credentialfravær og senere recovery. De må aldrig tælles som den ægte modeltest. Native kompatibilitet og rettet dependencylock afventer ny CI.
