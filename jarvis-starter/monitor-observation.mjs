// The model provides source observations; deterministic code compares them.
// Missing/unreadable sources and first-time measurements are never "no change".
export function reviewMonitorAnswer(answer, previousObservation = null) {
  let extracted;
  try {
    extracted = JSON.parse(answer);
  } catch {
    return { summary: String(answer || '').slice(0, 1600) || 'Kilden gav intet læsbart svar.',
      observation: { status: 'unknown', subject: 'Overvågning', source: 'Ikke verificeret' } };
  }
  const data = extracted?.observation;
  const summary = typeof extracted?.summary === 'string' ? extracted.summary.slice(0, 18000) : 'Observation uden dansk sammendrag.';
  if (!data || typeof data !== 'object' || typeof data.subject !== 'string' ||
      !data.subject.trim() || typeof data.source !== 'string' ||
      !/^https:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/i.test(data.source) ||
      (typeof data.value !== 'string' && (typeof data.value !== 'number' || !Number.isFinite(data.value))))
    return { summary: `${summary} Kildens indhold kan ikke verificeres; status er ukendt.`,
      observation: { status: 'unknown', subject: String(data?.subject || 'Overvågning').slice(0, 240), source: 'Ikke verificeret' } };
  const subject = data.subject.slice(0, 240);
  const variant = typeof data.variant === 'string' ? data.variant.slice(0, 240) : '';
  const unit = typeof data.unit === 'string' ? data.unit.slice(0, 40) : '';
  const validPrevious = previousObservation && /^https:\/\//.test(previousObservation.source || '') &&
    previousObservation.subject === subject && previousObservation.variant === variant &&
    previousObservation.unit === unit && previousObservation.value !== null;
  const status = !validPrevious ? 'unknown' : previousObservation.value === data.value ? 'unchanged' : 'changed';
  return { summary: status === 'unknown' ? `${summary} Første verificerbare sammenligningspunkt; ændring endnu ikke afgjort.` : summary,
    observation: { status, subject, variant, unit, value: data.value, source: data.source } };
}
