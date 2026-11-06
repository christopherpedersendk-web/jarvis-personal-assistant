// Capture the generation before any awaited journal write. A stop/resume
// during durable admission must not authorize the previously queued action.
export async function invokeControlledTool({ control, journal, mutatingTools, call, args, handler, channel }) {
  const scope = control.current();
  control.assertAllowed(scope);
  const guarded = (...parameters) => {
    control.assertAllowed(scope);
    return handler(...parameters);
  };
  if (!mutatingTools.has(call.name)) {
    const result = await guarded(call.name, args, { channel });
    // A slow read from an old generation must not feed a resumed conversation.
    control.assertAllowed(scope);
    return result;
  }
  return journal.invoke(call, args, guarded, channel);
}
