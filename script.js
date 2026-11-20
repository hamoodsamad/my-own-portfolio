/**
 * Main Portfolio Script Entrypoint
 * Dynamically boots the modern ES6 modular architecture
 */
import('./js/main.js').catch((err) => {
  console.error('[Portfolio] Failed to load module architecture:', err);
});
