// Shared boundary for user material, integration errors, exports and model
// inputs. Existing stored documents are not silently deleted or rewritten.
const SECRET_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,})\b|\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|$)|\bAuthorization\s*["']?\s*:\s*["']?Bearer\s+[^\s"']+|\b(?:api[_ -]?key|api-nøgle|password|passwd|adgangskode|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|NEMLIG_PASS)\s*["']?\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,"'}]+)/giu;
const SECRET_KEYS = /^(?:api[_-]?key|password|passwd|refresh[_-]?token|access[_-]?token|client[_-]?secret|applicationKey|sonosToken|pushToken|pushUser)$/iu;

export function containsSecret(value) {
  SECRET_PATTERN.lastIndex = 0;
  const found = SECRET_PATTERN.test(String(value || ''));
  SECRET_PATTERN.lastIndex = 0;
  return found;
}

export function redactSecrets(value, exactSecrets = []) {
  const known = exactSecrets.filter(secret => typeof secret === 'string' && secret.length >= 6);
  const text = input => {
    let result = input;
    for (const secret of known) result = result.split(secret).join('[hemmelighed skjult]');
    SECRET_PATTERN.lastIndex = 0;
    return result.replace(SECRET_PATTERN, '[hemmelighed skjult]');
  };
  const visit = input => {
    if (typeof input === 'string') return text(input);
    if (Array.isArray(input)) return input.map(visit);
    if (!input || typeof input !== 'object') return input;
    return Object.fromEntries(Object.entries(input).map(([key, item]) =>
      [key, SECRET_KEYS.test(key) && typeof item === 'string' && item ? '[hemmelighed skjult]' : visit(item)]));
  };
  return visit(value);
}

export function rejectSecrets(value) {
  if (containsSecret(typeof value === 'string' ? value : JSON.stringify(value)))
    throw new Error('Gem ikke adgangskoder, tokens eller API-nøgler som personlig viden eller instruktioner.');
}
