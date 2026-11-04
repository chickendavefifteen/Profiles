// The demo uses Contributor xhigh even when a saved profile selected a local model.
process.env.PROFILES_DEMO_MODE ??= '1';
await import('../server.mjs');
