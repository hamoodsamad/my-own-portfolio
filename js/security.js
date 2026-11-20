/**
 * Security & Sanitization Utilities Module
 * Hardens application against Cross-Site Scripting (XSS) and protocol injection.
 */

/**
 * Escapes unsafe HTML characters to prevent XSS injection.
 * @param {string|null|undefined} str
 * @returns {string}
 */
export function escapeHTML(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validates and sanitizes dynamic URLs, permitting only safe schemes.
 * Prevents javascript:, data:text/html, vbscript:, and relative protocol abuse.
 * @param {string|null|undefined} url
 * @returns {string} Safe URL or empty string
 */
export function sanitizeUrl(url) {
  if (!url) return '';
  const str = String(url).trim();
  if (/^(https?:\/\/|mailto:|tel:|\/(?!\/)|\.\/|#)/i.test(str)) {
    return str;
  }
  return '';
}

/**
 * Validates image sources, allowing only secure http/https, relative assets, or safe data image URIs.
 * @param {string|null|undefined} url
 * @returns {string} Safe image URL or standard fallback placeholder
 */
export function sanitizeImageUrl(url) {
  if (!url) {
    return 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=900&q=80';
  }
  const str = String(url).trim();
  if (/^(https?:\/\/|\/(?!\/)|\.\/|data:image\/(png|jpeg|jpg|webp|gif);base64,)/i.test(str)) {
    return str;
  }
  return 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=900&q=80';
}

/**
 * Sanitizes plain text fields by trimming control characters.
 * @param {string|null|undefined} str
 * @returns {string}
 */
export function sanitizeText(str) {
  if (str == null) return '';
  return String(str).replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
}

export const Security = Object.freeze({
  escapeHTML,
  sanitizeUrl,
  sanitizeImageUrl,
  sanitizeText,
});
