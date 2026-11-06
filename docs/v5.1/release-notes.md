# JARVIS v5.1.0 — releasekladde

Ikke frigivet. Versionsnummer, tag og produktion er endnu ikke ændret.
Merge er autoriseret, når alle P0/P1 samt N1/N2 og kandidatens gates er færdige.
Denne kladde er ikke en godkendelse af de åbne krav i roadmap.md.

## Implementeret på udviklingsgrenen

- Chat, Discord-tekst og webstemme får offentlige websøgninger, kildelinks,
  Google Maps-søgelinks og start af eksisterende aktive rapportjobs.
- Lange rapportinstruktioner rammer ikke længere hukommelsessøgningens
  240-tegnsgrænse. Lokale forberedelsesfejl meldes ikke som ukendt modeludfald.
- Særskilt rapportkanal på Discord, læsbare beskeddele og valgfri oprettelse
  af privat #jarvis-rapporter via ejerens indstillinger. Kanal/server valideres.
- Madplaner læses og revideres gennem samme handler i tekst, Discord og stemme;
  oprettelse af indkøbsliste er stadig et særskilt trin. Ingen automatisk ordre.
- Planlægning → Webarbejde: offentlige HTML-uddrag, undersider på godkendt
  website, engangsreview, stop og lokale bookingkladder med kilde og revision.
- Sekretærværktøjer til lokale opgaver, opfølgning og ugeoverblik.
- Varig Responses-forbrugskontrol og stopkontrol før værktøjer, også efter
  journalføring. Ukendte udfald genafspilles ikke automatisk.

## Før merge og udgivelse

Se det fulde acceptregister i roadmap.md. Særligt åbne: samlet Realtime-/ældre
stemmepolitik, generelle godkendelser, hosted-tool-/lydforbrug, live model- og
Discordprøve, serverrestore, fysisk iPhone, holdout/evaluering og seneste
semantiske CI-deadlinefejl. Ingen gate er fjernet eller tærskel sænket.

Discord-serverstemmekanal er ønsket, men endnu ikke implementeret. Webarbejde
kører ikke JavaScript, login eller formularafsendelse. Smart Home er udsat.

## Opsætning efter en godkendt deployment

Under Indstillinger → Discord: gem aktiv bot, ejerens User ID og Server ID.
Vælg en gennemgået rapportkanals ID eller vælg Opret privat #jarvis-rapporter.
Oprettelse kræver at botten kan administrere kanaler; serveradministratorer
kan se kanalen. Ved ukendt udfald: gennemgå Discord og journalen; opret ikke
blind næste kanal. Kontrollér én rapport i målkanalen og én madplansændring
fra ejerens Discord-konto. Test forsidechat og webstemme særskilt.

Ingen live opsætning, merge, tag, backup eller deployment er foretaget som del
af denne kladde. Bevar service/backup/rollback-procedurer fra eksisterende
releases og bind den endelige verifikation til det præcise release-SHA.
