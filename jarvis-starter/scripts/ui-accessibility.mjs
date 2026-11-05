// Runs unchanged in Chromium/WebKit via page.evaluate. Computed colours are
// evidence for the selected controls, not a whole-application WCAG certificate.
// Thresholds: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
// and https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
export function renderedAccessibilityReport(samples, documentRef = globalThis.document) {
  const styleOf = (element, pseudo = null) => documentRef.defaultView.getComputedStyle(element, pseudo);
  const unsupported = new Set();
  function color(value) {
    if (value === 'transparent') return [0, 0, 0, 0];
    const match = /^rgba?\(([^)]+)\)$/.exec(String(value).trim());
    if (!match) throw new Error(`Unsupported computed colour: ${value}`);
    const values = match[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (values.length < 3 || values.length > 4 || values.some(part => !Number.isFinite(part)))
      throw new Error(`Invalid computed colour: ${value}`);
    return [values[0], values[1], values[2], values[3] ?? 1];
  }
  function composite(top, bottom) {
    const alpha = top[3] + bottom[3] * (1 - top[3]);
    return [...top.slice(0, 3).map((channel, index) => alpha
      ? (channel * top[3] + bottom[index] * bottom[3] * (1 - top[3])) / alpha : 0), alpha];
  }
  function luminance(rgb) {
    const channels = rgb.slice(0, 3).map(value => value / 255).map(value => value <= 0.04045
      ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }
  function backgrounds(element) {
    if (!element) return [[255, 255, 255, 1]];
    const style = styleOf(element);
    if (Number(style.opacity) < 1) unsupported.add('ancestor opacity requires manual compositing review');
    const base = color(style.backgroundColor);
    let candidates = backgrounds(element.parentElement).map(under => composite(base, under));
    if (style.backgroundImage && style.backgroundImage !== 'none') {
      if (!/^(?:linear|radial)-gradient\(/.test(style.backgroundImage)) unsupported.add('background image is not a supported simple gradient');
      const stops = [...style.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map(match => color(match[0]));
      if (!stops.length) unsupported.add('gradient colours could not be read');
      else candidates = candidates.flatMap(under => stops.map(stop => composite(stop, under)));
    }
    return candidates;
  }
  function worstRatio(foreground, candidates) {
    // Add a conservative channel envelope of gradient/backdrop candidates. If
    // the foreground's luminance lies within the possible background interval,
    // do not claim a passing contrast from endpoint colours alone.
    const low = [0, 1, 2].map(index => Math.min(...candidates.map(item => item[index])));
    const high = [0, 1, 2].map(index => Math.max(...candidates.map(item => item[index])));
    const lower = luminance(low), upper = luminance(high);
    const foregroundLow = luminance(composite(foreground, [...low, 1]));
    const foregroundHigh = luminance(composite(foreground, [...high, 1]));
    if (foregroundLow <= upper && foregroundHigh >= lower) return 1;
    return Math.min(...[...candidates, [...low, 1], [...high, 1]].map(background => {
      const front = luminance(composite(foreground, background)); const back = luminance(background);
      return (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
    }));
  }
  const checks = samples.map(sample => {
    unsupported.clear();
    const element = documentRef.querySelector(sample.selector);
    if (!element) return { ...sample, missing: true };
    const style = styleOf(element);
    const background = backgrounds(element);
    const adjacent = backgrounds(element.parentElement);
    const result = { ...sample, visible: Boolean(element.getClientRects().length),
      focused: element === documentRef.activeElement, disabled: element.matches(':disabled'),
      fontSize: style.fontSize, fontWeight: style.fontWeight,
      textColor: style.color, textRatio: worstRatio(color(style.color), background),
      backgroundCandidates: background.map(item => item.slice(0, 3).map(value => Math.round(value))),
    };
    if (sample.kind === 'field') {
      Object.assign(result, { borderWidth: parseFloat(style.borderTopWidth), borderStyle: style.borderTopStyle,
        borderColor: style.borderTopColor, borderRatio: worstRatio(color(style.borderTopColor), [...background, ...adjacent]),
        hasPlaceholder: Boolean(element.getAttribute('placeholder')) });
      if (result.hasPlaceholder) {
        const placeholder = styleOf(element, '::placeholder');
        if (Number(placeholder.opacity) < 1) unsupported.add('placeholder opacity requires manual compositing review');
        result.placeholderColor = placeholder.color;
        result.placeholderRatio = worstRatio(color(placeholder.color), background);
      }
    }
    if (sample.kind === 'focus') Object.assign(result, {
      outlineWidth: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle,
      outlineColor: style.outlineColor, outlineRatio: worstRatio(color(style.outlineColor), adjacent),
    });
    if (unsupported.size) result.requiresManualReview = [...unsupported];
    return result;
  });
  return { method: 'computed styles; conservative alpha/gradient backdrop bounds; selected enabled controls only', checks };
}
