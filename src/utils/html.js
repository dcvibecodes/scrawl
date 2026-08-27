const crypto = require('crypto');

// Only images uploaded through /api/images qualify — uuid filename, known ext.
const IMAGE_SRC_OK = /^\/images\/[a-f0-9-]{36}\.(?:png|jpg|jpeg|webp|gif)$/;

// Collect the image ids referenced by a content HTML string (for GC).
function extractImageRefs(html) {
    const refs = [];
    const re = /\/images\/([a-f0-9-]{36})\.(?:png|jpg|jpeg|webp|gif)/g;
    let m;
    const s = String(html || '');
    while ((m = re.exec(s)) !== null) refs.push(m[1]);
    return [...new Set(refs)];
}

// Sanitize article HTML: only allow b, i, u, a (with href), br, p, div (converted to paragraphs)
function sanitizeArticleHtml(html) {
    if (!html) return '';

    // Tokenize uploaded images first: only our own /images/<uuid>.<ext> srcs survive,
    // everything else (external, javascript:, tag-bearing junk) is dropped outright.
    // Tokens are immune to every strip/cleanup pass below and rehydrated at the end.
    const imageTokens = [];
    let result = String(html).replace(/<img\b[^>]*>/gi, (tag) => {
        const src = (tag.match(/\ssrc\s*=\s*"([^"]*)"/i) || tag.match(/\ssrc\s*=\s*'([^']*)'/i) || [])[1];
        if (!src || !IMAGE_SRC_OK.test(src)) return '';
        const alt = (tag.match(/\salt\s*=\s*"([^"]*)"/i) || tag.match(/\salt\s*=\s*'([^']*)'/i) || [])[1] || '';
        const token = `\u0001IMG${imageTokens.length}\u0001`;
        imageTokens.push(`<img src="${src}" alt="${escapeHtml(alt)}">`);
        return token;
    });

    result = result
        // Remove editor-only artifacts that must never be persisted (defense in depth
        // even though getContent() now strips them client-side before saving).
        .replace(/<span\b[^>]*class="figure-delete"[^>]*>[\s\S]*?<\/span>/gi, '')
        // Convert <div> to <p> for consistency (browsers sometimes use divs)
        .replace(/<div><br\s*\/?><\/div>/gi, '</p><p>')
        .replace(/<\/div>\s*<div[^>]*>/gi, '</p><p>')
        .replace(/<div[^>]*>/gi, '<p>')
        .replace(/<\/div>/gi, '</p>')
        // Downgrade h1 to h2
        .replace(/<h1[^>]*>/gi, '<h2>')
        .replace(/<\/h1>/gi, '</h2>')
        // Strip all tags except allowed ones (b, i, u, s, strike, code, a, br, p, h2, h3, ol, ul, li, blockquote, hr, figure, figcaption)
        .replace(/<(?!\/?(b|i|u|s|strike|code|a|br|p|h[23]|ol|ul|li|blockquote|hr|figure|figcaption)\b)[^>]*>/gi, '')
        // Remove all attributes from allowed tags (except <a>)
        .replace(/<(b|i|u|s|strike|code|br|p|h[23]|ol|ul|li|blockquote|hr|figure|figcaption)\s[^>]*>/gi, '<$1>')
        // For <a>, keep only href attribute (target="_blank" is added client-side for external links only)
        .replace(/<a\s+[^>]*href\s*=\s*"([^"]*)"[^>]*>/gi, '<a href="$1">')
        .replace(/<a\s+[^>]*href\s*=\s*'([^']*)'[^>]*>/gi, '<a href="$1">')
        // Remove any remaining attributes on <a> that didn't match
        .replace(/<a(?!\s+href)[^>]*>/gi, '<a>')
        // Clean up empty paragraphs (but keep <p><br></p> as intentional spacing)
        .replace(/<p>\s*<\/p>/gi, '')
        // Remove <p> wrapping around block elements (headings, lists, blockquotes, hr)
        .replace(/<p>\s*(<h[23]>)/gi, '$1')
        .replace(/(<\/h[23]>)\s*<\/p>/gi, '$1')
        .replace(/<p>\s*(<[ou]l>)/gi, '$1')
        .replace(/(<\/[ou]l>)\s*<\/p>/gi, '$1')
        .replace(/<p>\s*(<blockquote>)/gi, '$1')
        .replace(/(<\/blockquote>)\s*<\/p>/gi, '$1')
        .replace(/<p>\s*(<hr>)\s*<\/p>/gi, '$1')
        .replace(/<p>\s*(<hr>)/gi, '$1')
        .replace(/(<hr>)\s*<\/p>/gi, '$1')
        .replace(/<p>\s*(<figure>)/gi, '$1')
        .replace(/(<\/figure>)\s*<\/p>/gi, '$1')
        // Rehydrate images and treat a lone figure as a block element
        .replace(/\u0001IMG(\d+)\u0001/g, (m, i) => imageTokens[i] || '')
        // Leftover "×" text nodes inside figures from old saves where the overlay
        // leaked through sanitization (the span was stripped but its "×" remained).
        .replace(/(<figure><img[^>]*>)\s*[×x]\s*(<\/figure>)/gi, '$1$2')
        // Empty captions occupy no space — remove them entirely
        .replace(/<figcaption>\s*<\/figcaption>/gi, '')
        // Stray placeholder paragraphs from the drag bug (image dragged, caption left as <p>)
        .replace(/<\/figure>\s*<p>\s*Add a caption \(optional\)\s*<\/p>/gi, '</figure>')
        .trim();
    // Ensure content is wrapped in <p> if it doesn't start with a block element
    if (result && !result.match(/^<(p|h[23]|ol|ul|blockquote|hr|figure)/i)) {
        result = '<p>' + result + '</p>';
    }
    return result;
}

// Strip HTML tags for FTS plain text indexing.
// Block-level tags become spaces first so words on either side don't collide.
function stripHtml(html) {
    return html
        .replace(/<\/(p|h[1-6]|li|blockquote|div|ol|ul|figure|figcaption)>/gi, ' ')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<hr\s*\/?>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
}

// Sanitize footer HTML: only allow b, i, em, strong, a (with href)
function sanitizeFooterHtml(html) {
    if (!html) return '';
    return String(html)
        // Strip all tags except allowed ones
        .replace(/<(?!\/?(b|i|em|strong|a)\b)[^>]*>/gi, '')
        // Remove attributes from b/i/em/strong
        .replace(/<(b|i|em|strong)\s[^>]*>/gi, '<$1>')
        // For <a>, keep only href attribute
        .replace(/<a\s+[^>]*href\s*=\s*"([^"]*)"[^>]*>/gi, '<a href="$1" target="_blank" rel="noopener">')
        .replace(/<a\s+[^>]*href\s*=\s*'([^']*)'[^>]*>/gi, '<a href="$1" target="_blank" rel="noopener">')
        .replace(/<a(?!\s+href)[^>]*>/gi, '<a>')
        .trim();
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatDate(timestamp) {
    return new Date(timestamp).toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric'
    });
}

function generateId() {
    try {
        return crypto.randomUUID();
    } catch {
        return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
    }
}

module.exports = {
    sanitizeArticleHtml,
    sanitizeFooterHtml,
    stripHtml,
    escapeHtml,
    formatDate,
    generateId,
    extractImageRefs
};
