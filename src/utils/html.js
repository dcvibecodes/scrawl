const crypto = require('crypto');

// Sanitize article HTML: only allow b, i, u, a (with href), br, p, div (converted to paragraphs)
function sanitizeArticleHtml(html) {
    if (!html) return '';
    let result = html
        // Convert <div> to <p> for consistency (browsers sometimes use divs)
        .replace(/<div><br\s*\/?><\/div>/gi, '</p><p>')
        .replace(/<\/div>\s*<div[^>]*>/gi, '</p><p>')
        .replace(/<div[^>]*>/gi, '<p>')
        .replace(/<\/div>/gi, '</p>')
        // Downgrade h1 to h2
        .replace(/<h1[^>]*>/gi, '<h2>')
        .replace(/<\/h1>/gi, '</h2>')
        // Strip all tags except allowed ones (b, i, u, s, strike, code, a, br, p, h2, h3, ol, ul, li, blockquote, hr)
        .replace(/<(?!\/?(b|i|u|s|strike|code|a|br|p|h[23]|ol|ul|li|blockquote|hr)\b)[^>]*>/gi, '')
        // Remove all attributes from allowed tags (except <a>)
        .replace(/<(b|i|u|s|strike|code|br|p|h[23]|ol|ul|li|blockquote|hr)\s[^>]*>/gi, '<$1>')
        // For <a>, keep only href attribute
        .replace(/<a\s+[^>]*href\s*=\s*"([^"]*)"[^>]*>/gi, '<a href="$1" target="_blank" rel="noopener">')
        .replace(/<a\s+[^>]*href\s*=\s*'([^']*)'[^>]*>/gi, '<a href="$1" target="_blank" rel="noopener">')
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
        .trim();
    // Ensure content is wrapped in <p> if it doesn't start with a block element
    if (result && !result.match(/^<(p|h[23]|ol|ul|blockquote|hr)/i)) {
        result = '<p>' + result + '</p>';
    }
    return result;
}

// Strip HTML tags for FTS plain text indexing.
// Block-level tags become spaces first so words on either side don't collide.
function stripHtml(html) {
    return html
        .replace(/<\/(p|h[1-6]|li|blockquote|div|ol|ul)>/gi, ' ')
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
    stripHtml,
    escapeHtml,
    formatDate,
    generateId
};