const { getDb } = require('../db');

// Pending counts for owner (comments + messages)
async function pendingCounts(req, res, next) {
    req.pendingComments = 0;
    req.pendingMessages = 0;
    if (req.isOwner) {
        const db = getDb();
        if (db) {
            try {
                const { c: pc } = await db.get('SELECT COUNT(*) AS c FROM comments WHERE is_owner = 0 AND approved = 0');
                req.pendingComments = pc;
                const { c: pm } = await db.get('SELECT COUNT(*) AS c FROM messages');
                req.pendingMessages = pm;
            } catch (e) {}
        }
    }
    next();
}

module.exports = {
    pendingCounts
};