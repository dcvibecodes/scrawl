const crypto = require('crypto');

// --- Spam Protection ---
// In-memory rate limiter
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_CONTACT = 3; // max 3 contact messages per hour per IP
const RATE_LIMIT_MAX_COMMENTS = 5; // max 5 comments per hour per IP
const SPAM_TIME_THRESHOLD = 3000; // minimum 3 seconds between form render and submit

// Clean up expired rate limit entries every 10 minutes.
// unref() lets tests exit cleanly; production keeps running via the HTTP server.
setInterval(() => {
    const now = Date.now();
    for (const [key, data] of rateLimitStore) {
        if (now - data.windowStart > RATE_LIMIT_WINDOW) {
            rateLimitStore.delete(key);
        }
    }
}, 10 * 60 * 1000).unref();

function checkRateLimit(ip, action, max) {
    const key = `${ip}:${action}`;
    const now = Date.now();
    let entry = rateLimitStore.get(key);
    if (!entry || (now - entry.windowStart > RATE_LIMIT_WINDOW)) {
        entry = { windowStart: now, count: 0 };
    }
    entry.count++;
    rateLimitStore.set(key, entry);
    return entry.count <= max;
}

// Generate a time-based token (embedded in forms, verified on submit)
function generateSpamToken() {
    const timestamp = Date.now().toString(36);
    const noise = crypto.randomBytes(8).toString('hex');
    return `${timestamp}.${noise}`;
}

function validateSpamToken(token) {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const timestamp = parseInt(parts[0], 36);
    if (isNaN(timestamp)) return false;
    const elapsed = Date.now() - timestamp;
    // Must be at least 3 seconds old, and no older than 24 hours
    return elapsed >= SPAM_TIME_THRESHOLD && elapsed <= 24 * 60 * 60 * 1000;
}

module.exports = {
    checkRateLimit,
    generateSpamToken,
    validateSpamToken,
    RATE_LIMIT_MAX_CONTACT,
    RATE_LIMIT_MAX_COMMENTS
};