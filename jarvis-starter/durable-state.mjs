import { AsyncLocalStorage } from 'node:async_hooks';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** One serial local commit boundary. Readers see the last committed snapshot,
 * never another request's draft. Domain objects keep a stable root reference;
 * each callback must obtain records by ID again, not retain mutable references.
 * Network work belongs between transactions, not inside these callbacks.
 */
export class DurableState {
  constructor({ initial, write, normalize = () => {} }) {
    this.current = structuredClone(initial);
    this.write = write;
    this.normalize = normalize;
    this.context = new AsyncLocalStorage();
    this.tail = Promise.resolve();
    this.sealed = false;
    this.uncertain = false;
    this.lastSavedAt = null;
    this.lastError = null;
    const active = () => {
      const transaction = this.context.getStore();
      if (transaction && !transaction.active) throw new Error('En afsluttet lagringstransaktion må ikke genbruges.');
      return transaction;
    };
    const view = () => active()?.draft || this.current;
    this.state = new Proxy({}, {
      get: (_target, key) => view()[key],
      has: (_target, key) => key in view(),
      ownKeys: () => Reflect.ownKeys(view()),
      getOwnPropertyDescriptor: (_target, key) => Object.hasOwn(view(), key)
        ? { value: view()[key], writable: true, enumerable: true, configurable: true } : undefined,
      set: (_target, key, value) => {
        const transaction = active();
        if (!transaction && this.sealed) throw new Error('Ændring kræver en lokal lagringstransaktion.');
        (transaction?.draft || this.current)[key] = value;
        return true;
      },
      deleteProperty: (_target, key) => {
        const transaction = active();
        if (!transaction && this.sealed) throw new Error('Sletning kræver en lokal lagringstransaktion.');
        return delete (transaction?.draft || this.current)[key];
      },
    });
  }

  async initialize() {
    this.normalize(this.current);
    await this.write(JSON.stringify(this.current, null, 2), []);
    this.current = freeze(this.current);
    this.sealed = true;
    this.lastSavedAt = new Date().toISOString();
  }

  save() {
    const transaction = this.context.getStore();
    if (!transaction?.active) throw new Error('Gemning kræver en aktiv lagringstransaktion.');
    transaction.requested = true;
    return Promise.resolve();
  }

  stageFile(name, contents, publish) {
    const transaction = this.context.getStore();
    if (!transaction?.active) throw new Error('Konfiguration kræver en aktiv lagringstransaktion.');
    if (transaction.files.some(file => file.name === name)) throw new Error('Konfigurationsfilen er allerede ændret i transaktionen.');
    transaction.files.push({ name, contents, publish });
    transaction.requested = true;
  }

  transact(_keys, action) {
    const inherited = this.context.getStore();
    if (inherited) {
      if (!inherited.active) return Promise.reject(new Error('Afsluttet lagringstransaktion.'));
      // Nested domain calls share the outer commit. A caller may catch an
      // inner error, but must not accidentally publish that failed draft.
      // Rollback-only is deliberately simpler than nested mutable savepoints.
      return Promise.resolve().then(action).catch(error => {
        if (!inherited.rollbackOnly) inherited.rollbackError = error;
        inherited.rollbackOnly = true;
        throw error;
      });
    }
    const operation = this.tail.then(async () => {
      if (this.uncertain) throw new Error('Lagerets seneste udfald er ukendt. Genstart og kontrollér lageret før nye ændringer.');
      const transaction = { active: true, draft: structuredClone(this.current), requested: false, files: [] };
      return this.context.run(transaction, async () => {
        try {
          const result = await action();
          if (transaction.rollbackOnly) throw transaction.rollbackError;
          const before = JSON.stringify(this.current);
          const changed = JSON.stringify(transaction.draft) !== before;
          if (changed && !transaction.requested) throw new Error('Ændringen mangler en eksplicit gemning.');
          if (!changed && transaction.files.length === 0) return result;
          this.normalize(transaction.draft);
          transaction.draft.stateRevision = (this.current.stateRevision || 0) + 1;
          const snapshot = JSON.stringify(transaction.draft, null, 2);
          try { await this.write(snapshot, transaction.files); }
          catch (error) {
            if (error?.statePublished || error?.code === 'STATE_TRANSACTION_UNKNOWN') {
              this.uncertain = true;
              // Only adopt a complete known publication. A partially applied
              // multi-file write requires offline recovery, not guessed state.
              if (error?.statePublished) {
                this.current = freeze(transaction.draft);
                // Keep the original storage error even if publishing runtime
                // configuration also fails. Both cases require recovery.
                try { this.publishRuntime(transaction.files); } catch { /* already latched */ }
              }
            }
            throw error;
          }
          this.current = freeze(transaction.draft);
          this.publishRuntime(transaction.files);
          this.lastSavedAt = new Date().toISOString();
          this.lastError = null;
          return result;
        } catch (error) {
          this.lastError = { at: new Date().toISOString(), code: error?.code || 'STATE_WRITE_FAILED' };
          throw error;
        } finally { transaction.active = false; }
      });
    });
    this.tail = operation.catch(() => {});
    return operation;
  }

  publishRuntime(files) {
    let cause;
    for (const file of files) {
      try { file.publish?.(); } catch (error) { cause ||= error; }
    }
    if (cause) {
      this.uncertain = true;
      const error = new Error('Ændringen er gemt, men runtime-konfigurationen kunne ikke opdateres. Genstart og kontrollér lageret før nye ændringer.', { cause });
      error.code = 'STATE_RUNTIME_PUBLICATION_FAILED';
      error.statePublished = true;
      throw error;
    }
  }

  snapshot() { return { ready: !this.uncertain, lastSavedAt: this.lastSavedAt,
    lastError: this.lastError, revision: this.current.stateRevision || 0 }; }
}
