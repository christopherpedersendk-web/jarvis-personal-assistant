// The model supplies observations; deterministic code compares only the same
// exact source and measurement basis. A well-shaped URL/value is not independent
// evidence that a source was actually read, and a changed source is not no change.
function observationFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const text = (field, max, required = false) => {
    const item = value[field];
    if (!required && item === undefined) return '';
    return typeof item === 'string' && item.length <= max && (!required || item.trim()) ? item : null;
  };
  const subject = text('subject', 240, true), variant = text('variant', 240), unit = text('unit', 40);
  const source = text('source', 1000, true);
  if (subject === null || variant === null || unit === null || source === null ||
      !/^https:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/i.test(source)) return null;
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null;
  } catch { return null; }
  const data = value.value;
  if (!(typeof data === 'number' && Number.isFinite(data)) &&
      !(typeof data === 'string' && data.trim() && data.length <= 240)) return null;
  // Do not normalize away URL paths, variants, query strings or value types.
  // A conservative new baseline is safer than inventing source equivalence.
  return { subject, variant, unit, value: data, source };
}

function unavailable(summary, subject = 'Overvågning') {
  return { summary: `Status er ukendt: Kildegrundlaget mangler eller kan ikke bruges til sammenligning. ${summary}`.slice(0, 18000),
    observation: { status: 'unknown', subject: typeof subject === 'string' && subject.trim() ? subject.slice(0, 240) : 'Overvågning',
      value: null, source: 'Ikke verificeret' } };
}

export function reviewMonitorAnswer(answer, previousObservation = null) {
  let extracted;
  try { extracted = JSON.parse(answer); }
  catch { return unavailable(String(answer || '').slice(0, 1600) || 'Kilden gav intet læsbart svar.'); }
  const summary = typeof extracted?.summary === 'string' ? extracted.summary.slice(0, 18000) : 'Observation uden dansk sammendrag.';
  const current = observationFields(extracted?.observation);
  // An explicit unknown hint can only make the result safer. Model-provided
  // changed/unchanged labels never establish a comparison or override it.
  if (!current || extracted.observation.status === 'unknown') return unavailable(summary, extracted?.observation?.subject);

  const previous = observationFields(previousObservation);
  let reason = '';
  if (!previous) reason = 'Status er ukendt: Der er endnu intet brugbart tidligere sammenligningspunkt for den angivne kilde.';
  else if (previous.source !== current.source)
    reason = 'Status er ukendt: Kildereferencen er ændret siden sidste observation. Værdier fra forskellige kilder sammenlignes ikke automatisk.';
  else if (['subject', 'variant', 'unit'].some(key => previous[key] !== current[key]) || typeof previous.value !== typeof current.value)
    reason = 'Status er ukendt: Sammenligningsgrundlaget (emne, variant, enhed eller værditype) er ændret.';
  const status = reason ? 'unknown' : previous.value === current.value ? 'unchanged' : 'changed';
  return { summary: reason ? `${reason} ${summary}`.slice(0, 18000) : summary,
    observation: { status, ...current } };
}
