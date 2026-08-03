const crypto = require('crypto');
const { getSessionSecret, SESSION_MAX_AGE } = require('../config');

function isAuthenticated(req) {
    const token = req.signedCookies && req.signedCookies.session;
    if (!token) return false;
    // Token format: timestamp:hmac
    const parts = token.split(':');
    if (parts.length !== 2) return false;
    const [timestamp, hmac] = parts;
    const age = Date.now() - parseInt(timestamp, 10);
    if (isNaN(age) || age > SESSION_MAX_AGE || age < 0) return false;
    // Verify HMAC (guard length first: timingSafeEqual throws on mismatched
    // lengths, which would 500 every page for anyone with a corrupted cookie)
    const expected = crypto.createHmac('sha256', getSessionSecret()).update(timestamp).digest('hex');
    const received = Buffer.from(hmac, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (received.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(received, expectedBuf);
}

function createSessionToken() {
    const timestamp = Date.now().toString();
    const hmac = crypto.createHmac('sha256', getSessionSecret()).update(timestamp).digest('hex');
    return timestamp + ':' + hmac;
}

// Make auth status available to all route handlers
function attachAuthStatus(req, res, next) {
    req.isOwner = isAuthenticated(req);
    next();
}

// Auth guard middleware for write operations
function requireOwner(req, res, next) {
    if (!req.isOwner) {
        return res.status(403).send('Forbidden. You must be logged in as the owner.');
    }
    next();
}

module.exports = {
    isAuthenticated,
    createSessionToken,
    attachAuthStatus,
    requireOwner
};