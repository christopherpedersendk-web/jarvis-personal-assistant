export class Element {
  constructor(document, tag) {
    Object.assign(this, { ownerDocument: document, tagName: tag.toUpperCase(), children: [], parentNode: null,
      dataset: {}, attributes: {}, events: new Map(), style: {}, className: '', id: '', _text: '', _value: '',
      defaultValue: '', hidden: false, disabled: false, selected: false, checked: false, open: false });
    this.classList = { contains: value => this.className.split(/\s+/).includes(value),
      toggle: (value, force) => { const values = new Set(this.className.split(/\s+/).filter(Boolean));
        if (force ?? !values.has(value)) values.add(value); else values.delete(value); this.className = [...values].join(' '); },
      add: value => this.classList.toggle(value, true), remove: value => this.classList.toggle(value, false) };
  }
  get value() { return this.tagName === 'SELECT' ? this.options.find(option => option.selected)?.value || '' : this._value; }
  set value(value) { if (this.tagName === 'SELECT') this.options.forEach(option => { option.selected = option.value === value; }); else this._value = String(value ?? ''); }
  get options() { return this.children.filter(child => child.tagName === 'OPTION'); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value ?? ''); }
  get firstElementChild() { return this.children[0] || null; }
  get nextElementSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  prepend(...nodes) { for (const node of [...nodes].reverse()) this.insertBefore(node, this.firstElementChild); }
  get isConnected() { return this.ownerDocument.body.contains(this); }
  reportValidity() { return true; }
  replaceWith(node) { this.parentNode.insertBefore(node, this); this.remove(); }
  insertBefore(node, anchor) {
    if (node === anchor) return; if (node.parentNode) node.remove();
    if (anchor && anchor.parentNode !== this) throw new Error('Invalid insertion anchor');
    this.children.splice(anchor ? this.children.indexOf(anchor) : this.children.length, 0, node); node.parentNode = this;
    if (this.tagName === 'SELECT' && !this.options.some(option => option.selected)) this.options[0].selected = true;
  }
  remove() { if (!this.parentNode) return;
    if (this.contains(this.ownerDocument.activeElement)) { this.ownerDocument.focusDetachments++; this.ownerDocument.activeElement = this.ownerDocument.body; }
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this._text = ''; this.append(...nodes); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  matches(selector) { return selector.split(',').some(part => {
    part = part.trim(); if (part.startsWith('.')) return this.classList.contains(part.slice(1));
    const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
    if (attr) { const [, key, value] = attr; const actual = key.startsWith('data-')
      ? this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] : this.attributes[key] ?? this[key];
      return value === undefined ? actual !== undefined : String(actual) === value; }
    return this.tagName.toLowerCase() === part;
  }); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(name, listener) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(listener); }
  async emit(name, target = this) { for (const listener of this.events.get(name) || []) await listener({ currentTarget: this, target, preventDefault() {} });
    if (['input', 'change'].includes(name) && this.parentNode) await this.parentNode.emit(name, target); }
  focus() { this.ownerDocument.activeElement = this; }
  reset() { for (const input of this.querySelectorAll('input,textarea,select')) {
    if (input.tagName === 'SELECT') input.options.forEach((item, index) => { item.selected = index === 0; });
    else input.value = input.defaultValue; input.checked = false;
  } }
}
