const express = require('express');
const router = express.Router();
const { layoutTemplate } = require('../templates/layout');
const { getDb } = require('../db');
const { getBlogTitle, getOwnerName } = require('../config');
const { escapeHtml, sanitizeArticleHtml, stripHtml, formatDate, generateId } = require('../utils/html');
const { requireOwner } = require('../middleware/auth');
const { generateSpamToken } = require('../middleware/rateLimit');

// List articles
router.get('/articles', async (req, res) => {
    try {
        const db = getDb();
        const filter = req.isOwner ? (req.query.filter || 'all') : 'published';
        let articles;
        if (filter === 'drafts') {
            articles = await db.all("SELECT * FROM articles WHERE status = 'draft' ORDER BY timestamp DESC");
        } else if (filter === 'published') {
            articles = await db.all("SELECT * FROM articles WHERE status = 'published' ORDER BY timestamp DESC");
        } else {
            articles = await db.all('SELECT * FROM articles ORDER BY timestamp DESC');
        }

        // Group by year
        const grouped = {};
        for (const article of articles) {
            const year = new Date(article.timestamp).getFullYear().toString();
            if (!grouped[year]) grouped[year] = [];
            grouped[year].push(article);
        }

        const years = Object.keys(grouped).sort((a, b) => b - a);

        let listHTML = '';
        if (articles.length === 0) {
            listHTML = '<p class="no-entries">No articles yet.</p>';
        } else {
            for (const year of years) {
                listHTML += `<h2 class="article-year-heading">${year}</h2>`;
                for (const article of grouped[year]) {
                    const draftBadge = article.status === 'draft' ? '<span class="draft-badge">draft</span>' : '';
                    const ownerActions = req.isOwner ? `
                        <div class="article-list-actions">
                            <a href="/articles/${article.id}/edit" class="edit-link">edit</a>
                            ${article.status === 'published' ? `<form action="/articles/${article.id}/unpublish" method="POST" style="background:none;padding:0;margin:0;display:inline;" onsubmit="return handleUnpublish(this)">
                                <button type="submit" class="unpublish-btn">unpublish</button>
                            </form>` : ''}
                            <form action="/articles/${article.id}/delete" method="POST" style="background:none;padding:0;margin:0;display:inline;" onsubmit="return handleDelete(this)">
                                <button type="submit" class="delete-btn">delete</button>
                            </form>
                        </div>
                    ` : '';
                    listHTML += `
                        <div class="article-list-item">
                            <div class="article-list-title">
                                <a href="/articles/${article.id}">${escapeHtml(article.title)}</a>
                                ${draftBadge}
                            </div>
                            ${ownerActions}
                        </div>
                    `;
                }
            }
        }

        const newArticleBtn = req.isOwner ? `
            <div style="margin-bottom:30px;">
                <a href="/articles/new" class="btn">New Article</a>
            </div>
        ` : '';

        const filterBar = req.isOwner ? `
            <div style="margin-bottom:20px;font-size:0.85rem;display:flex;align-items:center;gap:0;">
                <a href="/articles" class="article-filter-link${filter === 'all' ? ' active' : ''}">all</a>
                <span class="article-list-separator">&middot;</span>
                <a href="/articles?filter=published" class="article-filter-link${filter === 'published' ? ' active' : ''}">published</a>
                <span class="article-list-separator">&middot;</span>
                <a href="/articles?filter=drafts" class="article-filter-link${filter === 'drafts' ? ' active' : ''}">drafts</a>
                <span style="flex:1;"></span>
                <span class="article-toggle-options" id="toggleOptions" onclick="toggleArticleOptions()">show options</span>
            </div>
        ` : '';

        const bodyContent = `
            ${newArticleBtn}
            ${filterBar}
            ${listHTML}
            ${req.isOwner ? '<script>function toggleArticleOptions(){var els=document.querySelectorAll(".article-list-actions");var items=document.querySelectorAll(".article-list-item");var btn=document.getElementById("toggleOptions");var showing=btn.textContent==="hide options";els.forEach(function(el){if(showing)el.classList.remove("visible");else el.classList.add("visible")});items.forEach(function(el){if(showing)el.classList.remove("options-visible");else el.classList.add("options-visible")});btn.textContent=showing?"show options":"hide options"}</script>' : ''}
        `;

        res.send(layoutTemplate({
            title: 'Articles',
            bodyContent,
            isOwner: req.isOwner,
            pendingComments: req.pendingComments || 0,
            pendingMessages: req.pendingMessages || 0,
            blogTitle: getBlogTitle()
        }));
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading articles.');
    }
});

// New article form
router.get('/articles/new', requireOwner, (req, res) => {
    const now = new Date();
    const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const bodyContent = `
        <form id="articleForm" style="margin:0;">
            <input type="text" id="article-title" name="title" placeholder="Article title" required style="font-size:1.2rem;font-weight:600;margin-bottom:10px;">
            <div style="margin-bottom:10px;">
                <input type="date" id="article-date" value="${today}" style="padding:8px 0;background:var(--bg-body);color:var(--text-main);border:none;border-bottom:1px solid var(--separator-color);font-family:inherit;font-size:0.85rem;outline:none;">
            </div>
            <div class="article-editor-toolbar">
                <button type="button" data-cmd="bold" onclick="execCmd('bold')" title="Bold (Ctrl+B)"><b>B</b></button>
                <button type="button" data-cmd="italic" onclick="execCmd('italic')" title="Italic (Ctrl+I)"><i>I</i></button>
                <button type="button" data-cmd="underline" onclick="execCmd('underline')" title="Underline (Ctrl+U)"><u>U</u></button>
                <button type="button" data-cmd="strikeThrough" onclick="execCmd('strikeThrough')" title="Strikethrough"><s>S</s></button>
                <button type="button" data-cmd="code" onclick="execInlineCode()" title="Inline code">&lt;&gt;</button>
                <button type="button" data-cmd="link" onclick="insertLink()" title="Insert link">&#128279;</button>
                <button type="button" data-cmd="h2" onclick="execHeading('h2')" title="Heading 2">H2</button>
                <button type="button" data-cmd="h3" onclick="execHeading('h3')" title="Heading 3">H3</button>
                <button type="button" data-cmd="insertOrderedList" onclick="execCmd('insertOrderedList')" title="Numbered list">1.</button>
                <button type="button" data-cmd="insertUnorderedList" onclick="execCmd('insertUnorderedList')" title="Bullet list">&bull;</button>
                <button type="button" data-cmd="blockquote" onclick="execQuote()" title="Blockquote">&#8220;</button>
                <button type="button" onclick="execSeparator()" title="Horizontal rule">&#8213;</button>
                <button type="button" class="linebreak-btn" onclick="execLineBreak()" title="Line break">&#8629;</button>
            </div>
            <div id="article-content" class="article-content-editor" contenteditable="true" data-placeholder="Write your article..."></div>
            <div class="editor-hint">Enter = new paragraph · Shift+Enter or ↵ button = line break · Tab = indent list item</div>
            <div class="char-counter" id="article-char-counter">0 words &middot; 0 characters</div>
            <div class="publish-row" style="display:flex;gap:10px;align-items:baseline;">
                <button type="button" onclick="submitArticle('published')">Publish</button>
                <button type="button" onclick="submitArticle('draft')" style="background:var(--separator-color);color:var(--text-main);">Save as draft</button>
                <a href="/articles" class="back-link" style="margin-left:10px;" onclick="if(!confirmCancel())return false;articleSaved=true;">cancel</a>
            </div>
        </form>
        <script src="/article-editor.js"></script>
        <script>initArticleEditor({ mode: 'new' });</script>
    `;

    res.send(layoutTemplate({
        title: 'New Article',
        bodyContent,
        isOwner: true,
        pendingComments: req.pendingComments || 0,
        pendingMessages: req.pendingMessages || 0,
        blogTitle: getBlogTitle()
    }));
});

// Create article (API)
router.post('/articles', requireOwner, async (req, res) => {
    try {
        const db = getDb();
        const { title, content, status, date } = req.body;
        if (!title || !content) {
            return res.status(400).json({ success: false, error: 'Title and content required.' });
        }

        const id = generateId();
        const sanitizedContent = sanitizeArticleHtml(content);
        const articleStatus = status === 'draft' ? 'draft' : 'published';
        // Support backdated articles
        const timestamp = date ? new Date(date + 'T12:00:00').getTime() : Date.now();

        await db.run(
            'INSERT INTO articles (id, title, content, timestamp, status) VALUES (?, ?, ?, ?, ?)',
            [id, title.trim(), sanitizedContent, timestamp, articleStatus]
        );
        await db.run(
            'INSERT INTO articles_fts (id, title, content) VALUES (?, ?, ?)',
            [id, title.trim(), stripHtml(sanitizedContent)]
        );

        res.json({ success: true, id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Failed to create article.' });
    }
});

// View single article
router.get('/articles/:id', async (req, res) => {
    try {
        const db = getDb();
        const article = await db.get('SELECT * FROM articles WHERE id = ?', [req.params.id]);
        if (!article) return res.status(404).send('Article not found.');

        // Only owner can see drafts
        if (article.status === 'draft' && !req.isOwner) {
            return res.status(404).send('Article not found.');
        }

        // Fetch comments for this article
        let comments;
        if (req.isOwner) {
            comments = await db.all('SELECT * FROM comments WHERE article_id = ? ORDER BY timestamp ASC', [article.id]);
        } else {
            comments = await db.all('SELECT * FROM comments WHERE article_id = ? AND approved = 1 ORDER BY timestamp ASC', [article.id]);
        }

        const ownerName = getOwnerName();

        // Build threaded comments HTML
        function buildCommentTree(comments, parentId = null, depth = 0) {
            const children = comments.filter(c => c.parent_id === parentId);
            if (children.length === 0) return '';
            let html = '';
            for (const comment of children) {
                const isApproved = comment.approved === 1;
                const fadedClass = !isApproved ? ' comment-pending' : '';
                const approveBtn = (req.isOwner && !isApproved) ? `<a href="#" class="comment-approve-btn" onclick="approveComment(this, '${comment.id}');return false;">approve</a>` : '';
                const deleteBtn = req.isOwner ? `<a href="#" class="comment-delete-btn" onclick="deleteComment(this, '${comment.id}');return false;">delete</a>` : '';
                const pendingBadge = (!isApproved && req.isOwner) ? '<span class="comment-pending-badge">pending</span>' : '';
                const replyBtn = `<a href="#" class="comment-reply-btn" onclick="showReplyForm('${comment.id}');return false;">reply</a>`;
                const connector = depth > 0 ? '<div class="comment-connector"></div>' : '';
                // Use current owner name for owner comments
                const displayName = comment.is_owner ? (ownerName || comment.author) : comment.author;
                html += `
                    <div class="comment-item${fadedClass}" data-id="${comment.id}" data-parent="${comment.parent_id || ''}" style="margin-left:${Math.min(depth, 4) * 24}px;">
                        ${connector}
                        <div class="comment-bubble">
                            <div class="comment-header">
                                <span class="comment-author">${escapeHtml(displayName)}</span>
                                ${pendingBadge}
                                <span class="comment-date">${formatDate(comment.timestamp)}</span>
                            </div>
                            <div class="comment-body">${escapeHtml(comment.content)}</div>
                            <div class="comment-actions">
                                ${replyBtn}
                                ${approveBtn}
                                ${deleteBtn}
                            </div>
                        </div>
                        <div class="reply-form-container" id="reply-form-${comment.id}" style="display:none;"></div>
                    </div>
                `;
                html += buildCommentTree(comments, comment.id, depth + 1);
            }
            return html;
        }

        const commentsHtml = buildCommentTree(comments);

        const dateStr = formatDate(article.timestamp);
        const fullDate = new Date(article.timestamp).toLocaleString();
        const draftBadge = (article.status === 'draft' && req.isOwner) ? ' <span class="draft-badge">draft</span>' : '';

        const ownerActions = req.isOwner ? `
            <a href="/articles/${article.id}/edit" class="edit-link">edit</a>
            <form action="/articles/${article.id}/delete" method="POST" style="background:none;padding:0;margin:0;display:inline;" onsubmit="return handleDelete(this)">
                <button type="submit" class="delete-btn">delete</button>
            </form>
        ` : '';

        const bodyContent = `
            <article>
                <h1 class="article-title">${escapeHtml(article.title)}${draftBadge}</h1>
                <div class="article-meta" title="${fullDate}">${dateStr}</div>
                <div class="article-body">${article.content}</div>
                <div class="actions" style="margin-top:20px;">
                    <a href="/articles/${article.id}" class="permalink" title="Permalink">#</a>
                    <span class="copy-link" onclick="copyArticleText(this)">copy text</span>
                    <span class="copy-link" onclick="copyArticleLink(this)">copy link</span>
                    <button type="button" class="share-btn" onclick="shareArticle()">share</button>
                    ${ownerActions}
                </div>
            </article>

            <!-- Comments Section -->
            <div class="comments-section" style="margin-top:40px;">
                <div style="font-size:1.01rem;color:var(--text-muted);margin-bottom:16px;">Discussion</div>
                <div class="comment-form-wrapper" id="mainCommentForm">
                    <div class="comment-form-row">
                        <input type="text" id="commentAuthor" placeholder="Your name" class="comment-author-input" autocomplete="off" ${req.isOwner && ownerName ? `value="${escapeHtml(ownerName)}" readonly style="opacity:0.6;cursor:default;"` : ''}>
                    </div>
                    <input type="text" id="commentWebsite" autocomplete="off" tabindex="-1" style="position:absolute;left:-9999px;opacity:0;height:0;width:0;">
                    <input type="hidden" id="commentToken" value="${generateSpamToken()}">
                    <div class="comment-form-row">
                        <textarea id="commentContent" placeholder="Write a comment..." class="comment-textarea"></textarea>
                    </div>
                    <div class="char-counter" id="comment-char-counter">0 words &middot; 0 characters</div>
                    ${req.isOwner ? '' : '<div class="comment-hint" style="font-size:0.7rem;color:var(--text-muted);opacity:0.5;margin-bottom:10px;">Comments cannot be edited after posting.</div>'}
                    <div class="comment-form-row" style="display:flex;gap:15px;align-items:baseline;">
                        <button type="button" class="comment-submit-btn" id="mainSubmitBtn" onclick="submitComment(null)">Post</button>
                        <span class="comment-status" id="commentStatus"></span>
                    </div>
                </div>
                <div class="comments-thread" id="commentsThread">
                    ${commentsHtml}
                </div>
            </div>

            <p style="margin-top:30px;"><a href="/articles" class="back-link">&larr; back to articles</a></p>
            <script>
            // Load saved discuss-as name from localStorage and auto-resize comment textarea
            (function() {
                ${req.isOwner ? '' : `var saved = localStorage.getItem('scrawl_discuss_as');
                if (saved) {
                    var el = document.getElementById('commentAuthor');
                    if (el && !el.readOnly) el.value = saved;
                }`}
                // Attach auto-resize to comment textarea (same behavior as post textarea)
                var commentBox = document.getElementById('commentContent');
                if (commentBox) {
                    function resizeComment() {
                        var s = window.scrollY;
                        commentBox.style.height = 'auto';
                        commentBox.style.height = commentBox.scrollHeight + 'px';
                        window.scrollTo(0, s);
                    }
                    commentBox.addEventListener('input', resizeComment);

                    // Word and character counter
                    var commentCounter = document.getElementById('comment-char-counter');
                    function updateCommentCount() {
                        var text = commentBox.value;
                        var chars = text.length;
                        var words = text.trim() === '' ? 0 : text.trim().split(/\\s+/).length;
                        commentCounter.textContent = words + ' words \\u00b7 ' + chars + '/2000 characters';
                    }
                    commentBox.addEventListener('input', updateCommentCount);
                    updateCommentCount();
                }
            })();

            function showReplyForm(parentId) {
                // Hide main comment form
                document.getElementById('mainCommentForm').style.display = 'none';

                // Remove any existing open reply forms
                document.querySelectorAll('.reply-form-container').forEach(function(el) {
                    el.style.display = 'none';
                    el.innerHTML = '';
                });
                var container = document.getElementById('reply-form-' + parentId);
                var saved = ${req.isOwner && ownerName ? JSON.stringify(ownerName) : "localStorage.getItem('scrawl_discuss_as') || ''"};
                var readonlyAttr = ${req.isOwner && ownerName ? "'readonly style=\"opacity:0.6;cursor:default;\"'" : "''"};
                var hint = ${req.isOwner ? "''" : "'<div style=\"font-size:0.7rem;color:var(--text-muted);opacity:0.5;margin-bottom:10px;\">Comments cannot be edited after posting.</div>'"};
                container.innerHTML = '<div class="comment-form-wrapper reply-form">' +
                    '<div class="comment-form-row"><input type="text" class="comment-author-input reply-author" placeholder="Your name" value="' + escapeAttr(saved) + '" ' + readonlyAttr + ' autocomplete="off"></div>' +
                    '<input type="text" class="reply-website" autocomplete="off" tabindex="-1" style="position:absolute;left:-9999px;opacity:0;height:0;width:0;">' +
                    '<div class="comment-form-row"><textarea class="comment-textarea reply-content" placeholder="Write a reply..."></textarea></div>' +
                    '<div class="char-counter reply-char-counter">0 words \\u00b7 0/2000 characters</div>' +
                    hint +
                    '<div class="comment-form-row" style="display:flex;gap:15px;align-items:baseline;">' +
                    '<button type="button" class="comment-submit-btn reply-submit-btn" onclick="submitComment(' + "'" + parentId + "'" + ')">Post</button>' +
                    '<a href="#" class="comment-action-link comment-cancel-link" onclick="cancelReply(' + "'" + parentId + "'" + ');return false;">cancel</a>' +
                    '<span class="comment-status reply-status"></span></div></div>';
                container.style.display = 'block';
                // Attach counter to reply textarea
                var replyBox = container.querySelector('.reply-content');
                var replyCounter = container.querySelector('.reply-char-counter');
                function updateReplyCount() {
                    var text = replyBox.value;
                    var chars = text.length;
                    var words = text.trim() === '' ? 0 : text.trim().split(/\\s+/).length;
                    replyCounter.textContent = words + ' words \\u00b7 ' + chars + '/2000 characters';
                }
                replyBox.addEventListener('input', updateReplyCount);
                replyBox.focus();
            }

            function cancelReply(parentId) {
                var container = document.getElementById('reply-form-' + parentId);
                container.style.display = 'none';
                container.innerHTML = '';
                // Show main comment form again
                document.getElementById('mainCommentForm').style.display = '';
            }

            function escapeAttr(str) {
                return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            }

            function submitComment(parentId) {
                var author, content, statusEl, btn, honeypot;
                if (parentId) {
                    var container = document.getElementById('reply-form-' + parentId);
                    author = container.querySelector('.reply-author').value.trim();
                    content = container.querySelector('.reply-content').value.trim();
                    statusEl = container.querySelector('.reply-status');
                    btn = container.querySelector('.reply-submit-btn');
                    honeypot = container.querySelector('.reply-website') ? container.querySelector('.reply-website').value : '';
                } else {
                    author = document.getElementById('commentAuthor').value.trim();
                    content = document.getElementById('commentContent').value.trim();
                    statusEl = document.getElementById('commentStatus');
                    btn = document.getElementById('mainSubmitBtn');
                    honeypot = document.getElementById('commentWebsite') ? document.getElementById('commentWebsite').value : '';
                }

                if (!author) { statusEl.textContent = 'Please enter your name.'; statusEl.style.color = '#d96b6b'; var s=statusEl;setTimeout(function(){s.textContent='';},2000); return; }
                if (!content) { statusEl.textContent = 'Please write a comment.'; statusEl.style.color = '#d96b6b'; var s=statusEl;setTimeout(function(){s.textContent='';},2000); return; }

                // Save name to localStorage (no expiry) — only for non-owner
                ${req.isOwner ? '' : "localStorage.setItem('scrawl_discuss_as', author);"}

                // Show posting state
                var originalText = btn.textContent;
                btn.textContent = 'Posting...';
                statusEl.textContent = '';

                fetch('/api/comments', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        article_id: '${article.id}',
                        parent_id: parentId || null,
                        author: author,
                        content: content,
                        website_url: honeypot,
                        _token: document.getElementById('commentToken') ? document.getElementById('commentToken').value : ''
                    })
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        ${req.isOwner ? `
                        // Owner: reload immediately to show the comment
                        window.location.reload();
                        ` : `
                        statusEl.textContent = 'Your comment will be reviewed by the owner before publishing.';
                        statusEl.style.color = 'var(--text-muted)';
                        btn.textContent = originalText;
                        if (parentId) {
                            var container = document.getElementById('reply-form-' + parentId);
                            container.querySelector('.reply-content').value = '';
                            var rc = container.querySelector('.reply-char-counter');
                            if (rc) rc.textContent = '0 words \\u00b7 0/2000 characters';
                        } else {
                            document.getElementById('commentContent').value = '';
                            var cc = document.getElementById('comment-char-counter');
                            if (cc) cc.textContent = '0 words \\u00b7 0/2000 characters';
                        }
                        `}
                    } else {
                        statusEl.textContent = data.error || 'Failed to post comment.';
                        statusEl.style.color = '#d96b6b';
                        btn.textContent = originalText;
                    }
                })
                .catch(function() {
                    statusEl.textContent = 'Failed to post comment.';
                    statusEl.style.color = '#d96b6b';
                    btn.textContent = originalText;
                });
            }

            ${req.isOwner ? `
            function approveComment(el, id) {
                el.textContent = 'approving...';
                fetch('/api/comments/' + id + '/approve', { method: 'POST' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        var item = el.closest('.comment-item');
                        item.classList.remove('comment-pending');
                        var badge = item.querySelector('.comment-pending-badge');
                        if (badge) badge.remove();
                        el.remove();
                    }
                })
                .catch(function() { el.textContent = 'approve'; });
            }
            function deleteComment(el, id) {
                if (el.dataset.confirming === 'true') {
                    el.textContent = 'deleting...';
                    fetch('/api/comments/' + id, { method: 'DELETE' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            // Find all descendants recursively using data-parent
                            function findDescendants(parentId) {
                                var ids = [parentId];
                                document.querySelectorAll('.comment-item[data-parent="' + parentId + '"]').forEach(function(child) {
                                    ids = ids.concat(findDescendants(child.dataset.id));
                                });
                                return ids;
                            }
                            var allIds = findDescendants(id);
                            allIds.forEach(function(cid) {
                                var item = document.querySelector('.comment-item[data-id="' + cid + '"]');
                                if (item) {
                                    item.style.transition = 'opacity 0.2s ease, max-height 0.2s ease, margin 0.2s ease, padding 0.2s ease';
                                    item.style.opacity = '0';
                                    setTimeout(function() { item.style.maxHeight = '0'; item.style.marginBottom = '0'; item.style.paddingBottom = '0'; item.style.overflow = 'hidden'; }, 50);
                                    setTimeout(function() { item.remove(); }, 250);
                                }
                            });
                        }
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
            ` : ''}

            function copyArticleText(el) {
                var body = document.querySelector('.article-body');
                var text = body ? body.innerText : '';
                navigator.clipboard.writeText(text).then(function() {
                    el.textContent = 'copied';
                    setTimeout(function() { el.textContent = 'copy text'; }, 2000);
                }).catch(function() {
                    el.textContent = 'failed';
                    setTimeout(function() { el.textContent = 'copy text'; }, 2000);
                });
            }
            function copyArticleLink(el) {
                navigator.clipboard.writeText(window.location.href).then(function() {
                    el.textContent = 'copied';
                    setTimeout(function() { el.textContent = 'copy link'; }, 2000);
                }).catch(function() {
                    el.textContent = 'failed';
                    setTimeout(function() { el.textContent = 'copy link'; }, 2000);
                });
            }
            function shareArticle() {
                if (navigator.share) {
                    navigator.share({
                        title: ${JSON.stringify(article.title).replace(/</g, '\\u003c')},
                        url: window.location.href
                    }).catch(function() {});
                } else {
                    copyArticleLink(document.querySelector('.share-btn'));
                }
            }
            </script>
        `;

        res.send(layoutTemplate({
            title: article.title,
            bodyContent,
            isOwner: req.isOwner,
            pendingComments: req.pendingComments || 0,
            pendingMessages: req.pendingMessages || 0,
            blogTitle: getBlogTitle(),
            meta: {
                title: article.title,
                description: stripHtml(article.content).substring(0, 200).trim(),
                url: `${req.protocol}://${req.get('host')}/articles/${article.id}`,
                type: 'article',
                publishedTime: new Date(article.timestamp).toISOString(),
                author: getOwnerName() || getBlogTitle()
            }
        }));
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading article.');
    }
});

// Edit article form
router.get('/articles/:id/edit', requireOwner, async (req, res) => {
    try {
        const db = getDb();
        const article = await db.get('SELECT * FROM articles WHERE id = ?', [req.params.id]);
        if (!article) return res.status(404).send('Article not found.');

        const artDate = new Date(article.timestamp);
        const articleDate = artDate.getFullYear() + '-' + String(artDate.getMonth() + 1).padStart(2, '0') + '-' + String(artDate.getDate()).padStart(2, '0');
        const isDraft = article.status === 'draft';

        const bodyContent = `
            <form id="articleForm" style="margin:0;">
                <input type="text" id="article-title" name="title" placeholder="Article title" required value="${escapeHtml(article.title)}" style="font-size:1.2rem;font-weight:600;margin-bottom:10px;">
                <div style="margin-bottom:10px;">
                    <input type="date" id="article-date" value="${articleDate}" style="padding:8px 0;background:var(--bg-body);color:var(--text-main);border:none;border-bottom:1px solid var(--separator-color);font-family:inherit;font-size:0.85rem;outline:none;">
                </div>
                <div class="article-editor-toolbar">
                    <button type="button" data-cmd="bold" onclick="execCmd('bold')" title="Bold (Ctrl+B)"><b>B</b></button>
                    <button type="button" data-cmd="italic" onclick="execCmd('italic')" title="Italic (Ctrl+I)"><i>I</i></button>
                    <button type="button" data-cmd="underline" onclick="execCmd('underline')" title="Underline (Ctrl+U)"><u>U</u></button>
                    <button type="button" data-cmd="strikeThrough" onclick="execCmd('strikeThrough')" title="Strikethrough"><s>S</s></button>
                    <button type="button" data-cmd="code" onclick="execInlineCode()" title="Inline code">&lt;&gt;</button>
                    <button type="button" data-cmd="link" onclick="insertLink()" title="Insert link">&#128279;</button>
                    <button type="button" data-cmd="h2" onclick="execHeading('h2')" title="Heading 2">H2</button>
                    <button type="button" data-cmd="h3" onclick="execHeading('h3')" title="Heading 3">H3</button>
                    <button type="button" data-cmd="insertOrderedList" onclick="execCmd('insertOrderedList')" title="Numbered list">1.</button>
                    <button type="button" data-cmd="insertUnorderedList" onclick="execCmd('insertUnorderedList')" title="Bullet list">&bull;</button>
                    <button type="button" data-cmd="blockquote" onclick="execQuote()" title="Blockquote">&#8220;</button>
                    <button type="button" onclick="execSeparator()" title="Horizontal rule">&#8213;</button>
                    <button type="button" class="linebreak-btn" onclick="execLineBreak()" title="Line break">&#8629;</button>
                </div>
                <div id="article-content" class="article-content-editor" contenteditable="true" data-placeholder="Write your article...">${article.content}</div>
                <div class="editor-hint">Enter = new paragraph · Shift+Enter or ↵ button = line break · Tab = indent list item</div>
                <div class="char-counter" id="article-char-counter">0 words &middot; 0 characters</div>
                <div class="publish-row" style="display:flex;gap:10px;align-items:baseline;">
                    <button type="button" onclick="updateArticle('published')">
                        ${isDraft ? 'Publish' : 'Update'}
                    </button>
                    ${isDraft ? '<button type="button" onclick="updateArticle(\'draft\')" style="background:var(--separator-color);color:var(--text-main);">Save draft</button>' : ''}
                    <a href="/articles/${article.id}" class="back-link" style="margin-left:10px;" onclick="if(!articleSaved&&!confirm('You have unsaved changes. Discard?'))return false;articleSaved=true;">cancel</a>
                </div>
            </form>
            <script src="/article-editor.js"></script>
            <script>initArticleEditor({ mode: 'edit', articleId: '${article.id}', isDraft: ${isDraft} });</script>
        `;

        res.send(layoutTemplate({
            title: 'Edit Article',
            bodyContent,
            isOwner: true,
            pendingComments: req.pendingComments || 0,
            pendingMessages: req.pendingMessages || 0,
            blogTitle: getBlogTitle()
        }));
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading edit page.');
    }
});

// Update article (API)
router.put('/articles/:id', requireOwner, async (req, res) => {
    try {
        const db = getDb();
        const { title, content, status, date } = req.body;
        if (!title || !content) {
            return res.status(400).json({ success: false, error: 'Title and content required.' });
        }

        const sanitizedContent = sanitizeArticleHtml(content);
        const articleStatus = status === 'draft' ? 'draft' : 'published';

        if (date) {
            const timestamp = new Date(date + 'T12:00:00').getTime();
            await db.run(
                'UPDATE articles SET title = ?, content = ?, status = ?, timestamp = ? WHERE id = ?',
                [title.trim(), sanitizedContent, articleStatus, timestamp, req.params.id]
            );
        } else {
            await db.run(
                'UPDATE articles SET title = ?, content = ?, status = ? WHERE id = ?',
                [title.trim(), sanitizedContent, articleStatus, req.params.id]
            );
        }
        await db.run(
            'UPDATE articles_fts SET title = ?, content = ? WHERE id = ?',
            [title.trim(), stripHtml(sanitizedContent), req.params.id]
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Failed to update article.' });
    }
});

// Delete article
router.post('/articles/:id/delete', requireOwner, async (req, res) => {
    try {
        const db = getDb();
        await db.run('DELETE FROM articles WHERE id = ?', [req.params.id]);
        await db.run('DELETE FROM articles_fts WHERE id = ?', [req.params.id]);
        await db.run('DELETE FROM comments WHERE article_id = ?', [req.params.id]);

        if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
            return res.json({ success: true });
        }

        res.redirect('/articles');
    } catch (err) {
        if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
            return res.status(500).json({ success: false });
        }
        res.status(500).send('Error deleting article.');
    }
});

// Unpublish article (set status to draft)
router.post('/articles/:id/unpublish', requireOwner, async (req, res) => {
    try {
        const db = getDb();
        await db.run("UPDATE articles SET status = 'draft' WHERE id = ?", [req.params.id]);

        if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
            return res.json({ success: true });
        }

        res.redirect('/articles');
    } catch (err) {
        if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
            return res.status(500).json({ success: false });
        }
        res.status(500).send('Error unpublishing article.');
    }
});

module.exports = router;