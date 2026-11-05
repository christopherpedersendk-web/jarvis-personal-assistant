// Standalone domain fallback. The application injects its shared durable-state
// coordinator instead, so unrelated domains do not have separate write locks.
// Callbacks contain local mutations and save() only: never network/file effects.
export function createJobTransitions(state) {
  let tail = Promise.resolve();
  let publicationUncertain = false;
  return (keys, action) => {
    const operation = tail.then(async () => {
      if (publicationUncertain) {
        const error = new Error('Lagerets sidste publicering er uafklaret. Genstart og kontrollér data, før arbejdet fortsætter.');
        error.code = 'STATE_DURABILITY_UNKNOWN';
        throw error;
      }
      const before = keys.map(key => [key, structuredClone(state[key])]);
      try { return await action(); }
      catch (error) {
        if (error?.statePublished === true) publicationUncertain = true;
        else for (const [key, value] of before) {
          if (value === undefined) delete state[key];
          else state[key] = value;
        }
        throw error;
      }
    });
    tail = operation.catch(() => {});
    return operation;
  };
}
