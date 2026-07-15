// Stub for the "server-only" package in the vitest environment. Next.js's
// own bundler replaces this package with a no-op when code runs in a
// server context and with a throwing version in client bundles; vitest
// has neither context, so it needs an explicit alias (see vitest.config.ts)
// to avoid every server-only-guarded module under test throwing on import.
export {};
