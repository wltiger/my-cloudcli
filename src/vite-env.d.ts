/// <reference types="vite/client" />

/**
 * Installed package version, injected by Vite's `define` at build time.
 * Read it through `APP_VERSION` in `@/shared/constants`, which also covers
 * runners such as `tsx` that do not apply Vite's define replacement.
 */
declare const __APP_VERSION__: string;

// Build identifiers injected by Vite's `define` (see vite.config.js).
declare const __GIT_SHA__: string;
declare const __BUILD_TIME__: string;
