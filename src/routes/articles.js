const express = require('express');
const router = express.Router();
const { layoutTemplate } = require('../templates/layout');
const { getDb } = require('../db');
const { getBlogTitle, getOwnerName, getSettings } = require('../config');
const { escapeHtml, sanitizeArticleHtml, stripHtml, formatDate, generateId, extractImageRefs } = require('../utils/html');
const { requireOwner } = require('../middleware/auth');
const { renderCommentsSection } = require('../utils/comments');
const imageStore = require('../services/images');

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
                <button type="button" data-cmd="link" onclick="insertLink()" title="Insert link"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.71"></path></svg></button>
                <button type="button" onclick="editorInsertImage(this)" title="Insert image"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="m21 15-5-5L5 21"></path></svg></button>
                <button type="button" data-cmd="h2" onclick="execHeading('h2')" title="Heading 2">H2</button>
                <button type="button" data-cmd="h3" onclick="execHeading('h3')" title="Heading 3">H3</button>
                <button type="button" data-cmd="insertOrderedList" onclick="execCmd('insertOrderedList')" title="Numbered list">1.</button>
                <button type="button" data-cmd="insertUnorderedList" onclick="execCmd('insertUnorderedList')" title="Bullet list">&bull;</button>
                <button type="button" data-cmd="blockquote" onclick="execQuote()" title="Blockquote">&#8220;</button>
                <button type="button" onclick="execSeparator()" title="Horizontal rule">&#8213;</button>
                <button type="button" class="linebreak-btn" onclick="execLineBreak()" title="Line break">&#8629;</button>
                <button type="button" onclick="toggleHtmlMode()" title="HTML source mode" id="htmlModeBtn">&#60;/&#62;</button>
            </div>
            <div id="article-content" class="article-content-editor" contenteditable="true" data-placeholder="Write your article..."></div>
            <div class="editor-hint">Enter = new paragraph · Shift+Enter or ↵ button = line break · Tab = indent list item · Image button, drag-drop, or paste inserts a picture</div>
            <div class="char-counter" id="article-char-counter">0 words &middot; 0 characters</div>
            <div class="publish-row" style="display:flex;gap:10px;align-items:baseline;">
                <button type="button" onclick="submitArticle('published')">Publish</button>
                <button type="button" onclick="submitArticle('draft')" style="background:var(--separator-color);color:var(--text-main);">Save as draft</button>
                <a href="/articles" class="back-link" style="margin-left:10px;" onclick="if(!confirmCancel())return false;articleSaved=true;">cancel</a>
            </div>
        </form>
        <script src="/article-editor.js?v=40"></script>
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

        const settings = getSettings();
        const commentsSection = settings.commentsOnArticlesEnabled ? renderCommentsSection({
            targetId: article.id,
            targetType: 'article',
            comments,
            isOwner: req.isOwner,
            ownerName
        }) : '';

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

            ${commentsSection}

            <p style="margin-top:30px;"><a href="/articles" class="back-link">&larr; back to articles</a></p>
            <script>
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
                    <button type="button" data-cmd="link" onclick="insertLink()" title="Insert link"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.71"></path></svg></button>
                <button type="button" onclick="editorInsertImage(this)" title="Insert image"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="m21 15-5-5L5 21"></path></svg></button>
                    <button type="button" data-cmd="h2" onclick="execHeading('h2')" title="Heading 2">H2</button>
                    <button type="button" data-cmd="h3" onclick="execHeading('h3')" title="Heading 3">H3</button>
                    <button type="button" data-cmd="insertOrderedList" onclick="execCmd('insertOrderedList')" title="Numbered list">1.</button>
                    <button type="button" data-cmd="insertUnorderedList" onclick="execCmd('insertUnorderedList')" title="Bullet list">&bull;</button>
                    <button type="button" data-cmd="blockquote" onclick="execQuote()" title="Blockquote">&#8220;</button>
                    <button type="button" onclick="execSeparator()" title="Horizontal rule">&#8213;</button>
                <button type="button" class="linebreak-btn" onclick="execLineBreak()" title="Line break">&#8629;</button>
                <button type="button" onclick="toggleHtmlMode()" title="HTML source mode" id="htmlModeBtn">&#60;/&#62;</button>
            </div>
            <div id="article-content" class="article-content-editor" contenteditable="true" data-placeholder="Write your article...">${article.content}</div>
                <div class="editor-hint">Enter = new paragraph · Shift+Enter or ↵ button = line break · Tab = indent list item · Image button, drag-drop, or paste inserts a picture</div>
                <div class="char-counter" id="article-char-counter">0 words &middot; 0 characters</div>
                <div class="publish-row" style="display:flex;gap:10px;align-items:baseline;">
                    <button type="button" onclick="updateArticle('published')">
                        ${isDraft ? 'Publish' : 'Update'}
                    </button>
                    ${isDraft ? '<button type="button" onclick="updateArticle(\'draft\')" style="background:var(--separator-color);color:var(--text-main);">Save draft</button>' : ''}
                    <a href="/articles/${article.id}" class="back-link" style="margin-left:10px;" onclick="if(!articleSaved&&!confirm('You have unsaved changes. Discard?'))return false;articleSaved=true;">cancel</a>
                </div>
            </form>
            <script src="/article-editor.js?v=40"></script>
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

        const oldRow = await db.get('SELECT content FROM articles WHERE id = ?', [req.params.id]);
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

        // GC images removed from the article (undo-friendly: files stay until save)
        if (oldRow) {
            const removed = extractImageRefs(oldRow.content).filter(function(id) {
                return extractImageRefs(sanitizedContent).indexOf(id) === -1;
            });
            await imageStore.gcImageRefs(removed);
        }

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
        const article = await db.get('SELECT content FROM articles WHERE id = ?', [req.params.id]);
        await db.run('DELETE FROM articles WHERE id = ?', [req.params.id]);
        await db.run('DELETE FROM articles_fts WHERE id = ?', [req.params.id]);
        await db.run('DELETE FROM comments WHERE article_id = ?', [req.params.id]);

        // Free disk space: purge images that lived only in this article
        if (article) await imageStore.gcImageRefs(extractImageRefs(article.content));

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