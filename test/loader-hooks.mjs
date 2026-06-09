// Resolve hook (see test/loader.mjs): when a relative ".js" import can't be
// found, retry it as the ".ts" source. Leaves every other specifier untouched.

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.js') && (specifier.startsWith('.') || specifier.startsWith('/'))) {
    try {
      return await nextResolve(specifier, context);
    } catch (err) {
      if (err?.code === 'ERR_MODULE_NOT_FOUND') {
        return nextResolve(specifier.slice(0, -3) + '.ts', context);
      }
      throw err;
    }
  }
  return nextResolve(specifier, context);
}
