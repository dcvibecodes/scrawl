const express = require('express');
const router = express.Router();
const { layoutTemplate } = require('../templates/layout');
const { getDb } = require('../db');
const { getBlogTitle, getOwnerName } = require('../config');
const { requireOwner } = require('../middleware/auth');
const { checkRateLimit, validateSpamToken, RATE_LIMIT_MAX_COMMENTS } = require('../middleware/rateLimit');
const { escapeHtml, formatDate, generateId } = require('../utils/html');

// Submit a comment (public)
router.post('/api/comments', async (req, res) => {
    try {
        const db = getDb();
        // --- Spam Protection (skip for owner) ---
        if (!req.isOwner) {
            const honeypot = req.body.website_url;
            const spamToken = req.body._token;

            // Honeypot check: if filled, silently fake success
            if (honeypot) {
                return res.json({ success: true, id: 'blocked' });
            }

            // Time-based check: reject if submitted too fast
            if (!validateSpamToken(spamToken)) {
                return res.status(400).json({ success: false, error: 'Please wait a moment before submitting.' });
            }

            // Rate limiting
            const clientIp = req.ip || req.connection.remoteAddress;
            if (!checkRateLimit(clientIp, 'comments', RATE_LIMIT_MAX_COMMENTS)) {
                return res.status(429).json({ success: false, error: 'Too many comments. Please try again later.' });
            }
        }
        // --- End Spam Protection ---

        const { article_id, parent_id, author, content } = req.body;
        if (!article_id || !author || !content) {
            return res.status(400).json({ success: false, error: 'Article ID, author, and content are required.' });
        }
        if (content.length > 2000) {
            return res.status(400).json({ success: false, error: 'Comment must be 2000 characters or fewer.' });
        }

        // Verify article exists and is published
        const article = await db.get('SELECT id, status FROM articles WHERE id = ?', [article_id]);
        if (!article || (article.status !== 'published' && !req.isOwner)) {
            return res.status(404).json({ success: false, error: 'Article not found.' });
        }

        // If parent_id is specified, verify it exists
        if (parent_id) {
            const parent = await db.get('SELECT id FROM comments WHERE id = ?', [parent_id]);
            if (!parent) {
                return res.status(400).json({ success: false, error: 'Parent comment not found.' });
            }
        }

        const id = generateId();
        const timestamp = Date.now();
        // Owner's comments are auto-approved and flagged
        const approved = req.isOwner ? 1 : 0;
        const isOwnerComment = req.isOwner ? 1 : 0;
        // Use the stored owner name for owner comments
        const authorName = req.isOwner ? (getOwnerName() || author.trim()) : author.trim();

        await db.run(
            'INSERT INTO comments (id, article_id, parent_id, author, content, timestamp, approved, is_owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [id, article_id, parent_id || null, authorName, content.trim(), timestamp, approved, isOwnerComment]
        );

        res.json({ success: true, id, isOwner: req.isOwner });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Failed to post comment.' });
    }
});

// Approve a comment (owner only)
router.post('/api/comments/:id/approve', requireOwner, async (req, res) => {
    try {
        const db = getDb();
        await db.run('UPDATE comments SET approved = 1 WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Failed to approve comment.' });
    }
});

// Delete a comment (owner only)
router.delete('/api/comments/:id', requireOwner, async (req, res) => {
    try {
        const db = getDb();
        // Recursively find all descendant comment IDs
        async function getDescendants(parentId) {
            const children = await db.all('SELECT id FROM comments WHERE parent_id = ?', [parentId]);
            let ids = [parentId];
            for (const child of children) {
                const childIds = await getDescendants(child.id);
                ids = ids.concat(childIds);
            }
            return ids;
        }
        const allIds = await getDescendants(req.params.id);
        const placeholders = allIds.map(() => '?').join(',');
        await db.run(`DELETE FROM comments WHERE id IN (${placeholders})`, allIds);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Failed to delete comment.' });
    }
});

// Owner comments management page
router.get('/comments', requireOwner, async (req, res) => {
    try {
        const db = getDb();
        const comments = await db.all(`
            SELECT c.*, a.title as article_title
            FROM comments c
            LEFT JOIN articles a ON c.article_id = a.id
            WHERE c.is_owner = 0 AND c.approved = 0
            ORDER BY c.timestamp DESC
        `);

        const ownerName = getOwnerName();
        let commentsListHtml = '';
        if (comments.length === 0) {
            commentsListHtml = '<p class="no-entries">No comments pending approval.</p>';
        } else {
            for (const comment of comments) {
                commentsListHtml += `
                    <div class="comment-mgmt-item" data-id="${comment.id}">
                        <div class="comment-mgmt-meta">
                            <strong>${escapeHtml(comment.author)}</strong> on <a href="/articles/${comment.article_id}">${escapeHtml(comment.article_title || 'Unknown article')}</a> &middot; ${formatDate(comment.timestamp)}
                        </div>
                        <div class="comment-mgmt-body">${escapeHtml(comment.content)}</div>
                        <div class="comment-mgmt-actions">
                            <a href="#" class="approve-btn" onclick="mgmtApprove(this, '${comment.id}');return false;">approve</a>
                            <a href="#" class="delete-btn" onclick="mgmtDelete(this, '${comment.id}');return false;">delete</a>
                        </div>
                    </div>
                `;
            }
        }

        const bodyContent = `
            <h2 style="font-size:1rem;font-weight:normal;color:var(--text-muted);margin-bottom:20px;">Comments</h2>
            <div class="comments-management-list">
                ${commentsListHtml}
            </div>
            <script>
            function slideUp(el) {
                el.style.transition = 'opacity 0.2s ease, max-height 0.2s ease, margin 0.2s ease, padding 0.2s ease';
                el.style.opacity = '0';
                setTimeout(function() { el.style.maxHeight = '0'; el.style.marginBottom = '0'; el.style.paddingBottom = '0'; el.style.paddingTop = '0'; el.style.overflow = 'hidden'; }, 50);
                setTimeout(function() { el.remove(); }, 250);
            }
            function mgmtApprove(link, id) {
                link.textContent = 'approving...';
                fetch('/api/comments/' + id + '/approve', { method: 'POST' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        var item = link.closest('.comment-mgmt-item');
                        slideUp(item);
                    }
                })
                .catch(function() { link.textContent = 'approve'; });
            }
            function mgmtDelete(link, id) {
                if (link.dataset.confirming === 'true') {
                    link.textContent = 'deleting...';
                    fetch('/api/comments/' + id, { method: 'DELETE' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            var item = link.closest('.comment-mgmt-item');
                            slideUp(item);
                        }
                    })
                    .catch(function() { link.textContent = 'delete'; link.dataset.confirming = ''; });
                    return;
                }
                link.textContent = 'confirm?';
                link.dataset.confirming = 'true';
                setTimeout(function() {
                    if (link.dataset.confirming === 'true') {
                        link.textContent = 'delete';
                        link.dataset.confirming = '';
                    }
                }, 3000);
            }
            </script>
        `;

        res.send(layoutTemplate({
            title: 'Comments',
            bodyContent,
            isOwner: true,
            pendingComments: req.pendingComments || 0,
            pendingMessages: req.pendingMessages || 0,
            blogTitle: getBlogTitle()
        }));
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading comments.');
    }
});

module.exports = router;