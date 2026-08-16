const express = require('express');
const router = express.Router();
const { layoutTemplate } = require('../templates/layout');
const { getDb } = require('../db');
const { isOwnerSetup, getBlogTitle, getOwnerName, getSettings, saveSettings } = require('../config');
const { requireOwner } = require('../middleware/auth');
const { escapeHtml, stripHtml, formatDate, generateId, sanitizeArticleHtml } = require('../utils/html');
const { ENTRY_AVATAR } = require('../utils/avatar');
const { renderCommentsSection } = require('../utils/comments');

const PAGE_SIZE = 50;

function renderEntries(entries, isOwner) {
    if (entries.length === 0) {
        return '<p class="no-entries">Nothing here yet.</p>';
    }
    const settings = getSettings();
    const showCommentLink = settings.commentsOnPostsEnabled;
    return entries.map(entry => {
        const dateStr = formatDate(entry.timestamp);
        const fullDate = new Date(entry.timestamp).toLocaleString();
        const safeContent = escapeHtml(entry.content);

        const SNIPPET_LENGTH = 280;
        const isLong = entry.content.length > SNIPPET_LENGTH;

        const snippetContent = isLong
            ? escapeHtml(entry.content.slice(0, SNIPPET_LENGTH)) + '...'
            : safeContent;

        const expandableClass = isLong ? ' expandable-content' : '';

        const ownerActions = isOwner ? `
                    <a href="/edit/${entry.id}" class="edit-link">edit</a>
                    <form action="/delete/${entry.id}" method="POST" style="background:none;padding:0;margin:0;display:inline;" onsubmit="return handleDelete(this)">
                        <button type="submit" class="delete-btn">delete</button>
                    </form>` : '';

        return `
            <div class="entry">
                ${ENTRY_AVATAR}
                <div class="date" title="${fullDate}">${dateStr}</div>
                <div class="content${expandableClass}"
                data-expanded="false"
                data-full="${entry.content
                .replace(/&/g, '\u0026amp;')
                .replace(/"/g, '\u0026quot;')
                .replace(/</g, '\u0026lt;')
                .replace(/>/g, '\u0026gt;')}">${snippetContent}</div>
                <div class="actions">
                    <a href="/post/${entry.id}" class="permalink" title="Permalink">#</a>
                    <span class="copy-link" onclick="copyPermalink(this, '${entry.id}')">copy text</span>
                    <span class="copy-link" onclick="copyPostLink(this, '${entry.id}')">copy link</span>
                    ${showCommentLink ? `<a href="/post/${entry.id}" class="copy-link">comment</a>` : ''}
                    ${ownerActions}
                </div>
            </div>
        `;
    }).join('');
}

// Helper to get archive list for filter dropdowns
async function getArchives() {
    const db = getDb();
    return await db.all(`
        SELECT strftime('%Y', timestamp / 1000, 'unixepoch') AS year,
            strftime('%m', timestamp / 1000, 'unixepoch') AS month,
               COUNT(*) AS count
        FROM entries
        GROUP BY year, month
        ORDER BY year DESC, month DESC
    `);
}

// --- Main Routes ---

// Render the posts feed (used by both / and /posts)
async function renderPostsFeed(req, res) {
    const db = getDb();
    const searchQuery = req.query.q || '';
    let entries;
    let hasMore = false;
    let articleResults = [];

    const offset = parseInt(req.query.offset || '0', 10);

    if (searchQuery) {
        const words = searchQuery.trim()
            .replace(/["""*\-+(){}[\]^~:]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 0);

        if (words.length === 0) {
            entries = [];
        } else {
            const formattedQuery = words.map(w => '"' + w.replace(/"/g, '') + '"*').join(' AND ');
            entries = await db.all(`
                SELECT entries.*
                FROM entries
                JOIN entries_fts ON entries.id = entries_fts.id
                WHERE entries_fts.content MATCH ?
                ORDER BY entries_fts.rank
            `, [formattedQuery]);

            articleResults = await db.all(`
                SELECT articles.*, snippet(articles_fts, 2, '', '', '…', 32) AS snippet
                FROM articles
                JOIN articles_fts ON articles.id = articles_fts.id
                WHERE articles_fts MATCH ?
                AND articles.status = 'published'
                ORDER BY articles_fts.rank
            `, [formattedQuery]);
        }
    } else {
        entries = await db.all(
            'SELECT * FROM entries ORDER BY timestamp DESC LIMIT ? OFFSET ?',
            [PAGE_SIZE, offset]
        );
        const totalPosts = await db.get('SELECT COUNT(*) AS count FROM entries');
        hasMore = offset + PAGE_SIZE < totalPosts.count;
    }

    const entriesHTML = renderEntries(entries, req.isOwner);

    let publishSection;
    if (req.isOwner) {
        publishSection = `
            <form action="/add" method="POST">
                <textarea
                    id="main-publish-box"
                    name="content"
                    placeholder="Write something..."
                    required
                    oninput="var s=window.scrollY;this.style.height='auto';this.style.height=this.scrollHeight+'px';window.scrollTo(0,s);"
                ></textarea>
                <script>
                document.addEventListener('DOMContentLoaded', function() {
                    var el = document.getElementById('main-publish-box');
                    if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
                });
                </script>
                <div class="char-counter" id="char-counter">0 words &middot; 0 characters</div>
                <div class="shortcut-hint">Shortcuts: <kbd>N</kbd> = new post &middot; <kbd>/</kbd> = search</div>
                <div class="publish-row">
                    <button type="submit">Post</button>
                </div>
            </form>
        `;
    } else {
        publishSection = '';
    }

    const bodyContent = `
        ${publishSection}
        ${searchQuery ? `<p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:20px;">${entries.length + articleResults.length} result${(entries.length + articleResults.length) !== 1 ? 's' : ''} for "${escapeHtml(searchQuery)}"</p>` : ''}
        ${searchQuery && articleResults.length > 0 ? `
            <div style="margin-bottom:25px;">
                <h3 style="font-size:0.85rem;color:var(--text-muted);font-weight:normal;margin-bottom:12px;">Articles</h3>
                ${articleResults.map(a => {
                    const excerpt = (a.snippet || stripHtml(a.content).slice(0, 160)).trim();
                    return `
                    <div class="entry">
                        <div class="date">${formatDate(a.timestamp)}</div>
                        <div class="content"><a href="/articles/${a.id}" style="color:var(--text-main);text-decoration:none;font-weight:600;">${escapeHtml(a.title)}</a></div>
                        ${excerpt ? `<div class="search-snippet">${escapeHtml(excerpt)}</div>` : ''}
                    </div>
                `;
                }).join('')}
            </div>
            ${entries.length > 0 ? '<h3 style="font-size:0.85rem;color:var(--text-muted);font-weight:normal;margin-bottom:12px;">Posts</h3>' : ''}
        ` : ''}
        <div id="entries">${searchQuery && entries.length === 0 ? '' : entriesHTML}</div>
        ${(!searchQuery && hasMore) ? `
        <div style="text-align:center;margin:30px 0;">
            <a href="/posts?offset=${offset + 50}" class="btn">
                Load More
            </a>
        </div>
        ` : ''}

        <script>
            var publishBox = document.getElementById('main-publish-box');
            var charCounter = document.getElementById('char-counter');
            if (publishBox && charCounter) {
                publishBox.addEventListener('input', function() {
                    var text = this.value;
                    var chars = text.length;
                    var words = text.trim() === '' ? 0 : text.trim().split(/\\s+/).length;
                    charCounter.textContent = words + ' words \\u00b7 ' + chars + ' characters';
                });
            }

            document.addEventListener('keydown', function(e) {
                var tag = e.target.tagName.toLowerCase();
                if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
                if (e.key === 'n' || e.key === 'N') {
                    e.preventDefault();
                    var box = document.getElementById('main-publish-box');
                    if (box) box.focus();
                }
            });

            if (publishBox) {
                var postNavigating = false;
                window.addEventListener('beforeunload', function(e) {
                    if (!postNavigating && publishBox.value.trim()) {
                        e.preventDefault();
                        e.returnValue = '';
                    }
                });
                document.addEventListener('click', function(e) {
                    var link = e.target.closest('a');
                    if (!link || !link.href) return;
                    if (link.getAttribute('href') === '#') return;
                    if (publishBox.value.trim()) {
                        if (!confirm('You have unsaved changes. Discard?')) {
                            e.preventDefault();
                            e.stopPropagation();
                        } else {
                            postNavigating = true;
                        }
                    }
                }, true);
            }
        </script>
    `;

    res.send(layoutTemplate({
        title: getBlogTitle(),
        bodyContent,
        isOwner: req.isOwner,
        blogTitle: getBlogTitle(),
        searchQuery,
        pendingComments: req.pendingComments || 0,
        pendingMessages: req.pendingMessages || 0,
        showRandom: true,
        meta: {
            title: getBlogTitle(),
            description: (getOwnerName() ? getOwnerName() + ' — ' : '') + 'A personal publishing space for quick posts and long-form articles.',
            url: `${req.protocol}://${req.get('host')}/`,
            type: 'website'
        }
    }));
}

// Home page — renders the configured landing page
router.get('/', async (req, res) => {
    if (!isOwnerSetup()) return res.redirect('/setup');
    const settings = getSettings();

    if (settings.landingPage === 'articles' && settings.articlesEnabled) {
        return res.redirect('/articles');
    }
    if (settings.landingPage === 'custom') {
        const db = getDb();
        const content = settings.customLandingContent || '';
        let bodyContent;
        if (content) {
            // Content exists: render as an entry with edit/delete below (mirroring posts/articles)
            const ownerActions = req.isOwner ? `
                <div class="actions" style="margin-top:20px;">
                    <a href="/landing/edit" class="edit-link">edit</a>
                    <a href="#" class="delete-btn" onclick="deleteLanding(this);return false;">delete</a>
                </div>
            ` : '';
            bodyContent = `
                <div class="entry" style="border-bottom:none;">
                    <div class="article-body">${sanitizeArticleHtml(content)}</div>
                    ${ownerActions}
                </div>
                ${req.isOwner ? `
                <script>
                function deleteLanding(el) {
                    if (el.dataset.confirming === 'true') {
                        el.textContent = 'deleting...';
                        fetch('/api/landing/delete', { method: 'POST' })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) { window.location.reload(); }
                            else { el.textContent = 'delete'; el.dataset.confirming = ''; }
                        })
                        .catch(function() { el.textContent = 'delete'; el.dataset.confirming = ''; });
                        return;
                    }
                    el.textContent = 'confirm?';
                    el.dataset.confirming = 'true';
                    setTimeout(function() {
                        if (el.dataset.confirming === 'true') {
                            el.textContent = 'delete';
                            el.dataset.confirming = '';
                        }
                    }, 3000);
                }
                </script>
                ` : ''}
            `;
        } else {
            // No content: show "Add content" button on top, blank page to visitors
            const addContentBtn = req.isOwner ? `
                <div style="margin-bottom:20px;">
                    <a href="/landing/edit" class="btn">Add content</a>
                </div>
            ` : '';
            bodyContent = `${addContentBtn}`;
        }
        return res.send(layoutTemplate({
            title: getBlogTitle(),
            bodyContent,
            isOwner: req.isOwner,
            blogTitle: getBlogTitle(),
            pendingComments: req.pendingComments || 0,
            pendingMessages: req.pendingMessages || 0,
            meta: {
                title: getBlogTitle(),
                description: (getOwnerName() ? getOwnerName() + ' — ' : '') + 'A personal publishing space for quick posts and long-form articles.',
                url: `${req.protocol}://${req.get('host')}/`,
                type: 'website'
            }
        }));
    }
    // Default: posts feed
    return renderPostsFeed(req, res);
});

// Posts feed (always shows posts, regardless of landing page setting)
router.get('/posts', async (req, res) => {
    if (!isOwnerSetup()) return res.redirect('/setup');
    const settings = getSettings();
    if (!settings.postsEnabled) return res.status(404).send('Posts are disabled.');
    return renderPostsFeed(req, res);
});

router.get('/random', async (req, res) => {
    try {
        const db = getDb();
        const entry = await db.get('SELECT id FROM entries ORDER BY RANDOM() LIMIT 1');
        if (!entry) return res.redirect('/');
        res.redirect('/post/' + entry.id);
    } catch (err) {
        res.status(500).send('Error fetching random post.');
    }
});

router.get('/post/:id', async (req, res) => {
    try {
        const db = getDb();
        const entry = await db.get('SELECT * FROM entries WHERE id = ?', [req.params.id]);
        if (!entry) return res.status(404).send('Post not found.');

        const dateStr = formatDate(entry.timestamp);
        const fullDate = new Date(entry.timestamp).toLocaleString();
        const safeContent = escapeHtml(entry.content);

        const ownerActions = req.isOwner ? `
                    <a href="/edit/${entry.id}" class="edit-link">edit</a>
                    <form action="/delete/${entry.id}" method="POST" style="background:none;padding:0;margin:0;display:inline;" onsubmit="return handleDelete(this)">
                        <button type="submit" class="delete-btn">delete</button>
                    </form>` : '';

        // Fetch comments for this post
        let comments;
        if (req.isOwner) {
            comments = await db.all('SELECT * FROM comments WHERE post_id = ? ORDER BY timestamp ASC', [entry.id]);
        } else {
            comments = await db.all('SELECT * FROM comments WHERE post_id = ? AND approved = 1 ORDER BY timestamp ASC', [entry.id]);
        }

        const settings = getSettings();
        const commentsSection = settings.commentsOnPostsEnabled ? renderCommentsSection({
            targetId: entry.id,
            targetType: 'post',
            comments,
            isOwner: req.isOwner,
            ownerName: getOwnerName()
        }) : '';

        const bodyContent = `
            <div class="entry" style="border-bottom:none;">
                ${ENTRY_AVATAR}
                <div class="date" title="${fullDate}">${dateStr}</div>
                <div class="content">${safeContent}</div>
                <div class="actions">
                    <a href="/post/${entry.id}" class="permalink" title="Permalink">#</a>
                    <span class="copy-link" onclick="copyPermalink(this, '${entry.id}')">copy text</span>
                    <span class="copy-link" onclick="copyPostLink(this, '${entry.id}')">copy link</span>
                    ${ownerActions}
                </div>
            </div>
            ${commentsSection}
            <p style="margin-top:30px;"><a href="/" class="back-link">&larr; back</a></p>
        `;

        res.send(layoutTemplate({
            title: 'Post',
            bodyContent,
            isOwner: req.isOwner,
            pendingComments: req.pendingComments || 0,
            pendingMessages: req.pendingMessages || 0,
            blogTitle: getBlogTitle(),
            showRandom: true,
            meta: {
                title: getBlogTitle(),
                description: entry.content.substring(0, 200).trim(),
                url: `${req.protocol}://${req.get('host')}/post/${entry.id}`,
                type: 'article',
                publishedTime: new Date(entry.timestamp).toISOString(),
                author: getOwnerName() || getBlogTitle()
            }
        }));
    } catch (err) {
        res.status(500).send('Error fetching post.');
    }
});

router.get('/archive/year/:year', async (req, res) => {
    try {
        const db = getDb();
        const { year } = req.params;
        const entries = await db.all(`
            SELECT * FROM entries
            WHERE strftime('%Y', timestamp / 1000, 'unixepoch') = ?
            ORDER BY timestamp DESC
        `, [year]);

        const entriesHTML = renderEntries(entries, req.isOwner);

        const bodyContent = `
            <h2 style="margin-top:10px;margin-bottom:25px;font-size:1rem;color:var(--text-muted);font-weight:normal;">
                Showing entries from ${year}
                <a href="/archive" class="back-link" style="margin-left:15px;">back to archive</a>
            </h2>
            <div id="entries">${entriesHTML}</div>
        `;

        res.send(layoutTemplate({
            title: 'Archive - ' + year,
            bodyContent,
            isOwner: req.isOwner,
            pendingComments: req.pendingComments || 0,
            pendingMessages: req.pendingMessages || 0,
            blogTitle: getBlogTitle(),
            showRandom: true
        }));
    } catch (err) {
        res.status(500).send('Error fetching year archive.');
    }
});

router.get('/archive/month/:month', async (req, res) => {
    try {
        const db = getDb();
        const { month } = req.params;
        const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const monthName = monthNames[parseInt(month, 10) - 1] || month;

        const entries = await db.all(`
            SELECT * FROM entries
            WHERE strftime('%m', timestamp / 1000, 'unixepoch') = ?
            ORDER BY timestamp DESC
        `, [month]);

        const entriesHTML = renderEntries(entries, req.isOwner);

        const bodyContent = `
            <h2 style="margin-top:10px;margin-bottom:25px;font-size:1rem;color:var(--text-muted);font-weight:normal;">
                Showing entries from ${monthName}
                <a href="/archive" class="back-link" style="margin-left:15px;">back to archive</a>
            </h2>
            <div id="entries">${entriesHTML}</div>
        `;

        res.send(layoutTemplate({
            title: 'Archive - ' + monthName,
            bodyContent,
            isOwner: req.isOwner,
            pendingComments: req.pendingComments || 0,
            pendingMessages: req.pendingMessages || 0,
            blogTitle: getBlogTitle(),
            showRandom: true
        }));
    } catch (err) {
        res.status(500).send('Error fetching month archive.');
    }
});

router.get('/archive/:year/:month', async (req, res) => {
    try {
        const db = getDb();
        const { year, month } = req.params;
        const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const monthName = monthNames[parseInt(month, 10) - 1] || month;

        const entries = await db.all(`
            SELECT * FROM entries
            WHERE strftime('%Y', timestamp / 1000, 'unixepoch') = ?
            AND strftime('%m', timestamp / 1000, 'unixepoch') = ?
            ORDER BY timestamp DESC
        `, [year, month]);

        const entriesHTML = renderEntries(entries, req.isOwner);

        const bodyContent = `
            <h2 style="margin-top:10px;margin-bottom:25px;font-size:1rem;color:var(--text-muted);font-weight:normal;">
                Showing entries from ${monthName} ${year}
                <a href="/archive" class="back-link" style="margin-left:15px;">back to archive</a>
            </h2>
            <div id="entries">${entriesHTML}</div>
        `;

        res.send(layoutTemplate({
            title: 'Archive - ' + monthName + ' ' + year,
            bodyContent,
            isOwner: req.isOwner,
            pendingComments: req.pendingComments || 0,
            pendingMessages: req.pendingMessages || 0,
            blogTitle: getBlogTitle(),
            showRandom: true
        }));
    } catch (err) {
        res.status(500).send('Error fetching archive.');
    }
});

// --- Archive Index ---

router.get('/archive', async (req, res) => {
    try {
        const db = getDb();
        const archives = await getArchives();
        const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        const { count: totalPosts } = await db.get(
            'SELECT COUNT(*) AS count FROM entries'
        );
        let archiveHTML = '';
        let currentYear = null;

        for (const a of archives) {
            if (a.year !== currentYear) {
                if (currentYear !== null) archiveHTML += '</div>';
                currentYear = a.year;
                archiveHTML += `<div style="margin-bottom:25px;">
                    <h2 style="font-size:1.1rem;margin-bottom:10px;font-weight:600;">${a.year}</h2>`;
            }
            const monthName = monthNames[parseInt(a.month, 10) - 1];
            archiveHTML += `<div style="margin-bottom:6px;">
                <a href="/archive/${a.year}/${a.month}" class="back-link" style="font-size:0.95rem;">${monthName}</a>
                <span style="color:var(--text-muted);font-size:0.8rem;margin-left:8px;">(${a.count} post${a.count !== 1 ? 's' : ''})</span>
            </div>`;
        }
        if (currentYear !== null) archiveHTML += '</div>';

        if (archives.length === 0) {
            archiveHTML = '<p class="no-entries">No posts yet.</p>';
        }

        const bodyContent = `
            <h2 style="font-size:1rem;color:var(--text-muted);font-weight:normal;margin-bottom:25px;">
                Post Archive <span style="font-size:0.9rem;color:var(--text-muted);opacity:0.75;">(${totalPosts} posts)</span>
            </h2>
            ${archiveHTML}
        `;

        res.send(layoutTemplate({
            title: 'Post Archive',
            bodyContent,
            isOwner: req.isOwner,
            pendingComments: req.pendingComments || 0,
            pendingMessages: req.pendingMessages || 0,
            blogTitle: getBlogTitle(),
            showRandom: true
        }));
    } catch (err) {
        res.status(500).send('Error fetching archive index.');
    }
});

// --- Protected Write Routes ---

router.get('/edit/:id', requireOwner, async (req, res) => {
    try {
        const db = getDb();
        const entry = await db.get('SELECT * FROM entries WHERE id = ?', [req.params.id]);
        if (!entry) return res.status(404).send('Post not found.');

        const bodyContent = `
            <div class="edit-container">
                <form action="/edit/${entry.id}" method="POST" style="margin:0;">
                    <textarea
                        id="edit-box"
                        name="content"
                        required
                        oninput="var s=window.scrollY;this.style.height='auto';this.style.height=this.scrollHeight+'px';window.scrollTo(0,s);"
                    >${escapeHtml(entry.content)}</textarea>
                    <script>
                    document.addEventListener('DOMContentLoaded', function() {
                        var el = document.getElementById('edit-box');
                        if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
                    });
                    </script>
                    <div class="char-counter" id="edit-char-counter">0 words &middot; 0 characters</div>
                    <div class="publish-row" style="display:flex;gap:10px;align-items:baseline;">
                        <button type="submit" onclick="this.textContent='Updating...';this.disabled=true;this.closest('form').requestSubmit();">Update</button>
                        <a href="/post/${entry.id}" class="back-link" style="margin-left:10px;">cancel</a>
                    </div>
                </form>
            </div>
            <script>
            document.addEventListener('DOMContentLoaded', function() {
                attachAutoResize('edit-box');
                var editBox = document.getElementById('edit-box');
                var editCounter = document.getElementById('edit-char-counter');
                var originalContent = editBox.value;
                function updateCount() {
                    var text = editBox.value;
                    var chars = text.length;
                    var words = text.trim() === '' ? 0 : text.trim().split(/\\s+/).length;
                    editCounter.textContent = words + ' words \\u00b7 ' + chars + ' characters';
                }
                editBox.addEventListener('input', updateCount);
                updateCount();

                function hasUnsavedChanges() {
                    return editBox.value !== originalContent;
                }
                var editNavigating = false;
                // Prevent the beforeunload warning when submitting the update form
                var editForm = document.querySelector('form[action^="/edit/"]');
                if (editForm) {
                    editForm.addEventListener('submit', function() {
                        editNavigating = true;
                    });
                }
                window.addEventListener('beforeunload', function(e) {
                    if (!editNavigating && hasUnsavedChanges()) {
                        e.preventDefault();
                        e.returnValue = '';
                    }
                });
                document.addEventListener('click', function(e) {
                    var link = e.target.closest('a');
                    if (!link || !link.href) return;
                    if (link.getAttribute('href') === '#') return;
                    if (hasUnsavedChanges()) {
                        if (!confirm('You have unsaved changes. Discard?')) {
                            e.preventDefault();
                            e.stopPropagation();
                        } else {
                            editNavigating = true;
                        }
                    }
                }, true);
            });
            </script>
        `;

        res.send(layoutTemplate({
            title: 'Edit Post',
            bodyContent,
            isOwner: true,
            pendingComments: req.pendingComments || 0,
            pendingMessages: req.pendingMessages || 0,
            blogTitle: getBlogTitle()
        }));
    } catch (err) {
        res.status(500).send('Error loading edit page.');
    }
});

router.post('/edit/:id', requireOwner, async (req, res) => {
    try {
        const db = getDb();
        const { content } = req.body;
        await db.run('UPDATE entries SET content = ? WHERE id = ?', [content, req.params.id]);
        await db.run('UPDATE entries_fts SET content = ? WHERE id = ?', [content, req.params.id]);
        res.redirect('/post/' + req.params.id);
    } catch (err) {
        res.status(500).send('Error updating post.');
    }
});

router.post('/add', requireOwner, async (req, res) => {
    try {
        const db = getDb();
        const id = generateId();
        const content = req.body.content;
        const timestamp = Date.now();

        await db.run('INSERT INTO entries (id, content, timestamp) VALUES (?, ?, ?)', [id, content, timestamp]);
        await db.run('INSERT INTO entries_fts (id, content) VALUES (?, ?)', [id, content]);

        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error saving post.');
    }
});

// Custom landing page editor (owner only) — uses the article composer
router.get('/landing/edit', requireOwner, async (req, res) => {
    const settings = getSettings();
    const content = settings.customLandingContent || '';
    const bodyContent = `
        <form id="articleForm" style="margin:0;">
            <div class="article-editor-toolbar">
                <button type="button" data-cmd="bold" onclick="execCmd('bold')" title="Bold (Ctrl+B)"><b>B</b></button>
                <button type="button" data-cmd="italic" onclick="execCmd('italic')" title="Italic (Ctrl+I)"><i>I</i></button>
                <button type="button" data-cmd="underline" onclick="execCmd('underline')" title="Underline (Ctrl+U)"><u>U</u></button>
                <button type="button" data-cmd="strikeThrough" onclick="execCmd('strikeThrough')" title="Strikethrough"><s>S</s></button>
                <button type="button" data-cmd="code" onclick="execInlineCode()" title="Inline code"><></button>
                <button type="button" data-cmd="link" onclick="insertLink()" title="Insert link">&#128279;</button>
                <button type="button" data-cmd="h2" onclick="execHeading('h2')" title="Heading 2">H2</button>
                <button type="button" data-cmd="h3" onclick="execHeading('h3')" title="Heading 3">H3</button>
                <button type="button" data-cmd="insertOrderedList" onclick="execCmd('insertOrderedList')" title="Numbered list">1.</button>
                <button type="button" data-cmd="insertUnorderedList" onclick="execCmd('insertUnorderedList')" title="Bullet list">&bull;</button>
                <button type="button" data-cmd="blockquote" onclick="execQuote()" title="Blockquote">&#8220;</button>
                <button type="button" onclick="execSeparator()" title="Horizontal rule">&#8213;</button>
                <button type="button" class="linebreak-btn" onclick="execLineBreak()" title="Line break">&#8629;</button>
                <button type="button" onclick="toggleHtmlMode()" title="HTML source mode" id="htmlModeBtn">&#60;/&#62;</button>
            </div>
            <div id="article-content" class="article-content-editor" contenteditable="true" data-placeholder="Write your landing page content...">${content}</div>
            <div class="editor-hint">Enter = new paragraph · Shift+Enter or ↵ button = line break · Tab = indent list item</div>
            <div class="char-counter" id="article-char-counter">0 words &middot; 0 characters</div>
            <div class="publish-row" style="display:flex;gap:10px;align-items:baseline;">
                <button type="button" onclick="saveLanding()">Save</button>
                <a href="/" class="back-link" style="margin-left:10px;">cancel</a>
            </div>
        </form>
        <script src="/article-editor.js"></script>
        <script>
        initArticleEditor({ mode: 'landing' });
        function saveLanding() {
            var btn = document.querySelector('.publish-row button');
            var content = getContent();
            btn.textContent = 'Saving...';
            btn.disabled = true;
            fetch('/api/landing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: content })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) { window.location.href = '/'; }
                else { btn.textContent = 'Save'; btn.disabled = false; alert('Failed to save.'); }
            })
            .catch(function() { btn.textContent = 'Save'; btn.disabled = false; alert('Failed to save.'); });
        }
        </script>
    `;
    res.send(layoutTemplate({
        title: 'Edit Landing Page',
        bodyContent,
        isOwner: true,
        pendingComments: req.pendingComments || 0,
        pendingMessages: req.pendingMessages || 0,
        blogTitle: getBlogTitle()
    }));
});

// Save custom landing content (owner only)
router.post('/api/landing', requireOwner, (req, res) => {
    const { content } = req.body;
    const settings = getSettings();
    settings.customLandingContent = String(content || '');
    saveSettings(settings);
    res.json({ success: true });
});

// Delete custom landing content (owner only)
router.post('/api/landing/delete', requireOwner, (req, res) => {
    const settings = getSettings();
    settings.customLandingContent = '';
    saveSettings(settings);
    res.json({ success: true });
});

router.post('/delete/:id', requireOwner, async (req, res) => {
    try {
        const db = getDb();
        await db.run('DELETE FROM entries WHERE id = ?', [req.params.id]);
        await db.run('DELETE FROM entries_fts WHERE id = ?', [req.params.id]);

        if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
            return res.json({ success: true });
        }

        res.redirect('/');
    } catch (err) {
        if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
            return res.status(500).json({ success: false });
        }

        res.status(500).send('Error deleting post.');
    }
});

module.exports = router;