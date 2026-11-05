import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { renderedAccessibilityReport } from '../scripts/ui-accessibility.mjs';

const css = await readFile(new URL('../public/v5.css', import.meta.url), 'utf8');
const hexRgb = hex => `rgb(${hex.replace('#', '').match(/../g).map(part => parseInt(part, 16)).join(', ')})`;
function token(name) { const value = new RegExp(`--v5-${name}: (#[0-9a-f]{6})`).exec(css)?.[1]; assert.ok(value); return hexRgb(value); }
const style = (changes = {}) => ({ color: 'rgb(0, 0, 0)', backgroundColor: 'rgba(0, 0, 0, 0)',
  backgroundImage: 'none', opacity: '1', fontSize: '14px', fontWeight: '400',
  borderTopColor: 'rgb(0, 0, 0)', borderTopWidth: '1px', borderTopStyle: 'solid',
  outlineColor: 'rgb(0, 0, 0)', outlineWidth: '0px', outlineStyle: 'none', ...changes });
function element(styles, parentElement = null, options = {}) {
  return { styles: style(styles), parentElement, disabled: options.disabled === true,
    placeholder: style({ color: 'rgb(163, 186, 200)' }),
    getAttribute: name => name === 'placeholder' ? options.placeholder || null : null,
    getClientRects: () => options.hidden ? [] : [{}], matches: selector => selector === ':disabled' && options.disabled === true };
}
function report(target, kind = 'text', { focus = false } = {}) {
  const document = { activeElement: focus ? target : null, querySelector: selector => selector === '#sample' ? target : null,
    defaultView: { getComputedStyle: (node, pseudo) => pseudo === '::placeholder' ? node.placeholder : node.styles } };
  return renderedAccessibilityReport([{ name: 'sample', selector: '#sample', kind }], document).checks[0];
}

test('K1 GUI navigation retains all four visible labels and switches to four mobile columns with secondary settings', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const gui = await readFile(new URL('../public/gui.css', import.meta.url), 'utf8');
  const primary = html.match(/<div class="gui-nav-primary">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(primary, 'primary navigation is distinct from secondary settings');
  assert.deepEqual([...primary.matchAll(/class="nav-label">([^<]+)<\/span>/g)].map(match => match[1]),
    ['I dag', 'Planlægning', 'Hjem', 'Overvågninger']);
  assert.equal([...primary.matchAll(/data-tab=/g)].length, 4);
  assert.match(gui, /\.gui-nav-primary \{ display: flex; flex-direction: column;/);
  const mobile = gui.slice(gui.indexOf('@media (max-width: 767px)'));
  assert.match(mobile, /\.gui-nav-primary \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(mobile, /\.gui-nav-secondary \{ display: none; \}/);
  assert.match(html, /class="gui-mobile-settings[^"\n]*"[^>]*data-tab="settings"[^>]*aria-label="Indstillinger"/);
});

test('K5 contrast math keeps full precision and detects low-contrast text rather than rounding a pass', () => {
  assert.equal(report(element({ color: 'rgb(0, 0, 0)', backgroundColor: 'rgb(255, 255, 255)' })).textRatio, 21);
  const almost = report(element({ color: 'rgb(119, 119, 119)', backgroundColor: 'rgb(255, 255, 255)' }));
  assert.ok(almost.textRatio < 4.5); assert.ok(almost.textRatio > 4.47);
});

test('K5 palette field border, field text, placeholder and footer exceed selected contrast targets', () => {
  const page = element({ backgroundColor: 'rgb(7, 17, 30)',
    backgroundImage: 'radial-gradient(rgb(22, 67, 94), rgb(7, 17, 30))' });
  const panel = element({ backgroundImage: 'linear-gradient(rgba(18, 41, 58, 0.92), rgba(12, 29, 44, 0.91))' }, page);
  const field = element({ color: token('control-text'), backgroundColor: token('control-fill'), borderTopColor: token('control-border') }, panel, { placeholder: 'Syntetisk pladsholder' });
  const result = report(field, 'field');
  assert.ok(result.textRatio >= 4.5); assert.ok(result.placeholderRatio >= 4.5); assert.ok(result.borderRatio >= 3);
  assert.equal(result.requiresManualReview, undefined);
  const footerColor = /footer \{ color: (#[0-9a-f]{6}); \}/.exec(css)?.[1]; assert.ok(footerColor);
  assert.ok(report(element({ color: hexRgb(footerColor) }, page)).textRatio >= 4.5);
  assert.ok(report(element({ color: 'rgb(88, 123, 141)' }, element({ backgroundColor: 'rgb(7, 17, 30)' }))).textRatio < 4.5,
    'the old 11px footer palette is an actual failing control fixture');
});

test('K5 shared visible focus has a sufficient ring against the adjacent surface', () => {
  const field = element({ color: token('control-text'), backgroundColor: token('control-fill'),
    outlineColor: token('focus'), outlineWidth: '3px', outlineStyle: 'solid' }, element({ backgroundColor: 'rgb(23, 57, 75)' }));
  const focused = report(field, 'focus', { focus: true });
  assert.equal(focused.focused, true); assert.equal(focused.outlineWidth, 3); assert.equal(focused.outlineStyle, 'solid');
  assert.ok(focused.outlineRatio >= 3);
});

test('K5 computed-style report is standalone for both browser engines and flags unsupported visual evidence', () => {
  const callable = vm.runInNewContext(`(${renderedAccessibilityReport.toString()})`);
  const target = element({ backgroundImage: 'url("synthetic.png")', opacity: '0.7' }, null, { hidden: true, disabled: true });
  const document = { querySelector: selector => selector === '#sample' ? target : null, activeElement: null,
    defaultView: { getComputedStyle: node => node.styles } };
  const result = callable([{ selector: '#missing' }, { selector: '#sample', kind: 'text' }], document);
  assert.equal(result.checks[0].missing, true); assert.equal(result.checks[1].visible, false); assert.equal(result.checks[1].disabled, true);
  assert.ok(result.checks[1].requiresManualReview.length > 0);
});

test('K5 gradient endpoints alone cannot establish contrast when foreground lies between their luminance', () => {
  const target = element({ color: 'rgb(119, 119, 119)', backgroundImage: 'linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))' });
  assert.equal(report(target).textRatio, 1);
});
