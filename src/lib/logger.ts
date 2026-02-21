/**
 * Geliştirme logları – production'da (NODE_ENV=production) sessiz
 */
const isDev =
  typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

export const logger = {
  log: (...args: unknown[]) => {
    if (isDev) console.log(...args);
  },
  warn: (...args: unknown[]) => {
    if (isDev) console.warn(...args);
  },
  error: (...args: unknown[]) => {
    console.error(...args);
  },
};
