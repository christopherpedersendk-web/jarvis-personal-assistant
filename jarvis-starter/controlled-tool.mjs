// Capture the generation before any awaited journal write. A stop/resume
// during durable admission must not authorize the previously queued action.
export async function invokeControlledTool({ control, journal, mutatingTools, call, args, handler, channel }) {
  const scope = control.current();
  control.assertAllowed(scope);
  const guarded = (...parameters) => {
    control.assertAllowed(scope);
    return handler(...parameters);
  };
  if (!mutatingTools.has(call.name)) return guarded(call.name, args, { channel });
  return journal.invoke(call, args, guarded, channel);
}
