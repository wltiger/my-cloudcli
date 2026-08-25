/**
 * Environment Flag: Is Platform
 * Indicates if the app is running in Platform mode (hosted) or OSS mode (self-hosted)
 *
 * The optional chain is what lets Node import this file. `import.meta.env` is
 * Vite's, so it is undefined under the plain `tsx --test` runner -- and because
 * every `src/utils/api.js` caller reaches this module, a bare property access
 * here made the whole store and hook layer untestable. Keep the `?.`.
 */
export const IS_PLATFORM = import.meta.env?.VITE_IS_PLATFORM === 'true';

/**
 * Environment Flag: Compact Mobile Sidebar
 * When enabled, hides the mobile Report Issue/Discord links and moves the
 * Settings entry point to the mobile header (tap the title) instead of the
 * sidebar footer, to maximize vertical space for the project list.
 */
export const COMPACT_MOBILE_SIDEBAR = import.meta.env?.VITE_COMPACT_MOBILE_SIDEBAR === 'true';
