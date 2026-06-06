// Side-effect module: filter the harmless `punycode` deprecation (DEP0040)
// emitted by google-auth-library's transitive node-fetch@2 -> whatwg-url -> tr46
// chain, which require()s Node's deprecated punycode builtin.
//
// This must be imported FIRST in the CLI entry point: ES module imports are
// evaluated in order, so installing the override here — before the google-auth
// import is evaluated — is the only way to catch a warning emitted during that
// import's own load. All other warnings pass through untouched, and the reusable
// core in src/sync is never affected.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = typeof rest[0] === 'object' && rest[0] ? rest[0].code : rest[1];
  if (code === 'DEP0040' || String(warning).includes('punycode')) return;
  emitWarning(warning, ...rest);
};
