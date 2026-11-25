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
  let str = String(url).trim();
  if (/^javascript:|^vbscript:|^data:(?!image\/)/i.test(str)) {
    return '';
  }
  // Auto-prepend https:// for bare domains (e.g. real-time-chats-gamma.vercel.app or luxora-watches-azure.vercel.app)
  if (!/^(https?:\/\/|mailto:|tel:|\/(?!\/)|\.\/|#)/i.test(str)) {
    str = 'https://' + str;
  }
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
    return 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=1400&q=92';
  }
  const str = String(url).trim();
  if (/^(https?:\/\/|\/(?!\/)|\.\/|data:image\/(png|jpeg|jpg|webp|gif);base64,)/i.test(str)) {
    return enhanceImageUrl(str);
  }
  return 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=1400&q=92';
}

/**
 * Enhances remote CDN image URLs (such as Unsplash) for crisp Retina/HD display quality.
 * Leaves relative local assets and base64 data URIs untouched.
 * @param {string} url
 * @returns {string}
 */
export function enhanceImageUrl(url) {
  if (!url || !/^https:\/\/images\.unsplash\.com\//i.test(url)) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('auto', 'format');
    parsed.searchParams.set('fit', 'crop');
    parsed.searchParams.set('w', '1400');
    parsed.searchParams.set('q', '92');
    return parsed.toString();
  } catch {
    return url;
  }
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
  enhanceImageUrl,
  sanitizeText,
});
