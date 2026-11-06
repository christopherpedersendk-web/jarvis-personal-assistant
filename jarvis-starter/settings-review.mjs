import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const FIELDS = Object.freeze({
  settings: ['maxRunsPerDay', 'remindersEnabled', 'discordAlertsEnabled', 'httpsUrl', 'pushToken', 'pushUser'],
  discord: ['enabled', 'token', 'userId', 'guildId', 'reportChannelId'],
  proactive: ['dailyEnabled', 'weeklyEnabled', 'discordEnabled', 'dailyTime', 'weeklyTime', 'quietStart', 'quietEnd'],
});
const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const invalid = message => { const error = new Error(message); error.status = 400; error.code = 'VALIDATION_ERROR'; throw error; };

export function checkedHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 500) invalid('HTTPS-adressen skal være tekst på højst 500 tegn.');
  const trimmed = value.trim(); if (!trimmed) return '';
  let url; try { url = new URL(trimmed); } catch { invalid('Angiv en gyldig HTTPS-adresse.'); }
  if (url.protocol !== 'https:' || url.username || url.password || /\s/.test(trimmed))
    invalid('HTTPS-adressen skal bruge https:// og må ikke indeholde brugernavn eller adgangskode.');
  return trimmed;
}

/** Field-level optimistic review. Per-process HMAC avoids exposing a raw secret
 * or its guessable unkeyed hash. Restart invalidates old review tokens safely.
 * This object never stores credentials; callers pass current values INSIDE the
 * same serialized read–modify–write transaction as publication.
 */
export class SettingsReview {
  constructor(key = randomBytes(32)) { this.key = key; }
  digest(scope, field, value) { return createHmac('sha256', this.key).update(JSON.stringify([scope, field, value])).digest('hex'); }
  basis(scope, values) {
    if (!FIELDS[scope]) invalid('Ukendt indstillingsområde.');
    // Wrapper objects let the ordinary secret-key redactor remain strict.
    return Object.fromEntries(FIELDS[scope].map(field => [field, { digest: this.digest(scope, field, values[field]) }]));
  }
  patch(scope, current, input) {
    const allowed = FIELDS[scope];
    if (!allowed || !object(input) || !object(input.patch) || !object(input.expectedBasis)) invalid('Indstillingsændringen mangler patch og gennemgået grundlag.');
    if (Object.keys(input).some(key => !['patch', 'expectedBasis'].includes(key))) invalid('Indstillingsændringen indeholder ukendte felter.');
    const fields = Object.keys(input.patch), expected = Object.keys(input.expectedBasis);
    if (!fields.length || fields.length > allowed.length || fields.some(field => !allowed.includes(field)) ||
        fields.length !== expected.length || expected.some(field => !fields.includes(field))) invalid('Godkend præcis de felter, der ændres.');
    for (const field of fields) {
      const supplied = input.expectedBasis[field];
      if (!object(supplied) || Object.keys(supplied).join() !== 'digest' || typeof supplied.digest !== 'string' || !/^[0-9a-f]{64}$/.test(supplied.digest))
        invalid('Et felt mangler gyldigt gennemgået grundlag.');
      if (!timingSafeEqual(Buffer.from(supplied.digest, 'hex'), Buffer.from(this.digest(scope, field, current[field]), 'hex'))) {
        const error = new Error('Et ændret felt har fået et nyt grundlag. Hent indstillingerne og gennemgå konflikten; ingen af dine ændringer er gemt.');
        error.code = 'REVISION_CONFLICT'; error.status = 409; throw error;
      }
    }
    const patch = { ...input.patch };
    for (const field of fields) {
      const value = patch[field];
      if (['remindersEnabled', 'discordAlertsEnabled', 'enabled', 'dailyEnabled', 'weeklyEnabled', 'discordEnabled'].includes(field)) {
        if (typeof value !== 'boolean') invalid('Tilvalg skal være eksplicit ja eller nej.');
      } else if (['dailyTime', 'weeklyTime', 'quietStart', 'quietEnd'].includes(field)) {
        if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) invalid('Tidspunktet skal være HH:MM i Europe/Copenhagen.');
      } else if (field === 'maxRunsPerDay') {
        if (!Number.isInteger(value) || value < 1 || value > 100) invalid('Daglig grænse skal være mellem 1 og 100.');
      } else if (field === 'httpsUrl') patch[field] = checkedHttpsUrl(value);
      else if (['pushToken', 'pushUser', 'token'].includes(field)) {
        if (typeof value !== 'string' || !value.trim() || value.length > (field === 'token' ? 300 : 200)) invalid('En ny nøgle skal være udfyldt og have gyldig længde. Et tomt nøglefelt betyder uændret.');
        patch[field] = value.trim();
      } else if (typeof value !== 'string' || value.length > 25) invalid('Ugyldigt Discord-ID.');
    }
    return patch;
  }
}
