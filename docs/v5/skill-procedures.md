# H1 · Versionerede JARVIS-procedurer

Status: implementeret og lokalt testet. Dette er appens gennemgåede procedurer, ikke installation af ChatGPT-skills. Ingen procedureopdatering aktiverer jobs, integrationer, datakilder eller nye tilladelser.

## Versioner og uændret historik

De fire oprindelige `jarvis-starter/skills/<id>/SKILL.md` er bevaret byte-for-byte som version **1.0.0**. Nye versioner ligger separat i `skills/<id>/versions/1.1.0/SKILL.md`. Det lukkede manifest indlæser kun disse otte kendte filer; vilkårlige filer eller eksterne skills bliver ikke automatisk registreret.

| Procedure | Aktuel version | Standard for nyt job uden eget budget | Indholdsgrænse |
| --- | --- | --- | --- |
| `daily-briefing` | 1.1.0 | 1 kørsel pr. UTC-døgn, 3.500 outputtokens | 5 prioriterede punkter |
| `personal-follow-up` | 1.1.0 | 1 kørsel pr. UTC-døgn, 2.500 outputtokens | 3 næste forslag |
| `gift-planning` | 1.1.0 | 1 kørsel pr. UTC-døgn, 3.500 outputtokens | 3 gaveforslag |
| `meal-planning` | 1.1.0 | 1 kørsel pr. UTC-døgn, 3.500 outputtokens | 7 aftensmåltider |

Et eksisterende job beholder præcist skill-ID, version, hash, parametre og politik. Et manuelt valgt jobbudget bevares. Nye briefing-/gaveskabeloner vælger den aktuelle version og viser dens budget før gemning som **pauset job**. Den kompilerede 1.1.0-fallback er bundet til denne release og testes mod registry-manifestet; den er ikke en ubundet `latest`-alias. Et generisk job uden procedurevalg får ikke automatisk en vilkårlig procedure.

UI og read-only-detailruten skelner eksplicit mellem aktuel og historisk version. Både 1.0.0 og 1.1.0 kan åbnes præcist. En ukendt eller tvetydig version bliver ikke erstattet med den nyeste. Kontekstvalg til en ny samtale bruger kun den aktuelle version af hver relevant procedure og indsætter kun hele proceduretekster inden for kontekstgrænsen.

## Den hashbundne kontrakt

Hver 1.1.0-procedure indeholder en valideret JSON-kontrakt i selve Markdown-bodyen: formål, input, output, kilder, værktøjsgrænser, jobbudgetstandarder, ukendtpolitik, syntetiske eksempler og eksisterende testreferencer. Kontrakten er afledt af den fulde body og er immutable i det indlæste bundle. Klienternes detailkopier kan ikke ændre registry.

Hashformatet er fortsat SHA-256 af `JSON.stringify({name,version,permissions,body})`. Ændringer i kontrakt eller fremgangsmåde ændrer dermed samme hash, som et job bindes til. Historiske bindingshashes er:

| Historisk procedure 1.0.0 | Jobindholdshash |
| --- | --- |
| `daily-briefing` | `0a10aae12055772e6e9d27027b477947d78f6c6f4f86f874f8bcbbd8eb3eeb83` |
| `personal-follow-up` | `848d095c5925ea16f56666789305c055d77c05ecdf75d3c52cefb50a28fafa68` |
| `gift-planning` | `e557de0883037b052fbbad7720441224ab658ab768bb7d3e2c6641f174c6383c` |
| `meal-planning` | `b73afe2040ae2ccf63cd96fc1b54fb90fed5f040fbeacd8d8e0534c62d6a00cc` |

`test/v5-skill-procedures.test.mjs` indeholder desuden uafhængigt fastlåste SHA-256-værdier for alle fire originale filer. De må ikke opdateres for at godkende en in-place-omskrivning; en ny procedure kræver en ny version.

## Tilladelser og budget

Kontrakten beskriver proceduren, men er ikke en tilladelseskilde. Registry fastholder `existing-authorized-tools-only`, og baggrundsjob fastholder deres eksisterende snævre læsetilladelse. At en madprocedure beskriver den samlede brugerrejse, giver ikke et baggrundsjob lokale skriveværktøjer, adgang til owner-click, ordre, betaling eller checkout.

Jobmotoren håndhæver faktisk kørsels-/outputbudget. Procedurekontraktens `maxResults` er en specificeret indholdsgrænse til modellen, ikke en ekstra teknisk tilladelse eller dokumentation for, at alle modelsvar overholder grænsen. De øvrige deterministiske grænser håndhæves og testes i de respektive domænemoduler. Ukendt kapacitet, fejlede læsninger og uafklarede eksterne handlinger bliver aldrig til dokumenteret fritid, `unchanged` eller en automatisk gentagelsesgodkendelse.

## Verifikation og opfølgning

Fokuserede commands:

```sh
node --test test/v5-skill-procedures.test.mjs test/v5-skills-review.test.mjs \
  test/v5-job-policy.test.mjs test/v5-job-ui.test.mjs \
  test/v5-intelligence-catalog-ui.test.mjs test/v5-settings-http.test.mjs \
  test/v47-personal-intelligence.test.mjs test/server.test.mjs
```

Testene omfatter byte-/hashbevarelse, begge præcise versioner, gamle jobs efter ny registry-indlæsning, standarder kontra eksplicitte budgetter, uændrede tilladelser, ingen automatisk aktivering, malformed kontrakt, templatevalg, historisk redigering og rigtige HTTP-routes med syntetisk netværksblokering.

Det er kontrakt-, bindings- og domænetest; ikke en fuld statistisk evaluering af alle tænkelige modelsvar. Browsermatrix og fysisk iPhone/desktop-afprøvning er selvstændig releaseevidens og skal bindes til den endelige kandidat. En senere ændring oprettes som en ny separat versionsfil, manifestet udvides, og alle tidligere jobbindinger bevares.
