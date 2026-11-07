# Sikkerhedsreview af den afgrænsede kandidat

Trusler: Discord-fremmede, injektion fra produkter/opskrifter, persondata i delt chat, race/replay af reviews, ændret pris/adresse, browseradgang til internt netværk, ondsindet modelkode, falsk CI og ukendt effekt efter netværksbrud.

Kontroller:

- Eksisterende serverauth/Discord-ejer/guild og fælles mutationjournal bevares. Stamdata kræver eksplicit indtastning, lukket feltskema, revision, kort review, privat kanal og engangsforbrug. Stop/restart ugyldiggør reviews. Ingen betalingsfelter, PII i modelhistorik eller browserstorage.
- Adressefingerprint og global arkivrevision bindes til ordreforslaget med variant, sælger, beløb, fragt, valuta, betalingsmetode, provider-generation og udløb. Enhver relevant ændring/restart/stop afviser gammel overdragelse. Samtidige dubletter giver højst én overdragelse. Ingen eksterne writes eksisterer i denne lane.
- Offentlig produktlæser er særskilt opt-in og fast origin/profil/API. Ukendt åbning/lukning giver fejl; ingen automatisk retry/fallback. Webindhold er kun tekstdata og bliver ikke opgaveautoritet eller stamdata. Native OpenClaw SSRF-indstillinger erstatter ikke netværksisolation; egressaccept mangler, funktionen skal forblive OFF indtil faktisk hosttest.
- Selvudvikling henter kun public repo-filer, ikke ejerdata/hukommelse. Modelkode køres kun i eksisterende Docker-sandbox uden netværk. Én af to filstier må ændres; packageversion ændres deterministisk uden dependencies/scripts/schema. Workflows, agent, policy, tests og produktionsinstallation kan ikke vælges som mål. GitHub-transporten tillader kun ny agentgren og draft-PR, aldrig main/merge/release/deploy. Unknown kan ikke genstartes automatisk.
- Agentgodkendelse er særskilt OFF og revalideres mod præcis SHA/version/CI/security. Et dokument eller en model kan ikke udstede security-check. Uafhængigt beskyttet review og token/branch protection mangler faktisk installationsaccept. Der er ingen automatisk deploymentslutning, som kan stole blindt på journalens approval.

Regressioner bevarer forkert ejer, replay, ændrede parametre, revisionskonflikter, credentials/protectedfields, redirect, cleanup, stop/restart, forbudte kodefiler og manglende CI/security. Modellens forståelse, rigtig Discord/voice, merchantflow, livecheckout og faktisk isolation er ikke dokumenteret af disse fixtures.

## Officielle kontrakter læst 7. november 2026

- OpenClaw: https://docs.openclaw.ai/tools/browser/configuration , https://docs.openclaw.ai/tools/browser-control , https://docs.openclaw.ai/tools/browser/agent-tools . Faktisk package 2026.11.1 og installeret source/doc er brugt til native kontraktprobe. Ingen store interne moduler er kopieret.
- Proshop: https://www.proshop.dk/handelsbetingelser.htm og https://www.proshop.dk/Betaling.htm dokumenterer MobilePay/PayPal; konkret tilgængelighed, pris/fee og ordrebindingspunkt skal bekræftes i det faktiske checkout. Vipps er ikke antaget understøttet.
- Amazon: https://www.aboutamazon.de/news/amazon-prime-und-shopping/paypal-ratenzahlung-amazon og https://www.paypal.com/de/cshelp/article/was-ist-die-paypal-ratenzahlung-bei-amazon-help1372 . Særligt rater i DE/AT er ikke generel dansk PayPal-walletcheckout. Kandidaten tilbyder kun manuel metode hos Amazon og initierer ikke lån.
- Vipps MobilePay: https://developer.vippsmobilepay.com/docs/APIs/epayment-api/api-guide/operations/create/ og https://developer.vippsmobilepay.com/docs/knowledge-base/redirects/ . Merchant skaber faktisk redirect; redirect alene beviser ikke betaling. Ingen merchantadgang foreligger, og intet betalingslink opfindes.
- Opskriftsresearch peger på https://www.arla.dk/opskrifter/ , https://www.valdemarsro.dk/ og https://madensverden.dk/ . Ingen automatisk kopiering af hele sites eller paywalladgang.

Releasens historiske sikkerhedsgrænser i docs/v5.2–v5.4 består. Login, kurv, bindende ordre og betalingsinitiering kræver nyt snævert skriverettighedsreview og særskilt ejerinstruktion før rigtige transaktioner.
