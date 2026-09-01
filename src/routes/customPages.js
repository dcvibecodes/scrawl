const express = require('express');
const router = express.Router();
const { layoutTemplate } = require('../templates/layout');
const { getBlogTitle, getOwnerName, getSettings, saveSettings, MAX_CUSTOM_PAGES } = require('../config');
const { requireOwner } = require('../middleware/auth');
const { escapeHtml, sanitizeArticleHtml, extractImageRefs, generateId } = require('../utils/html');
const imageStore = require('../services/images');

function getPages() {
    const s = getSettings();
    return Array.isArray(s.customPages) ? s.customPages : [];
}

// Edit form: /p/:id/edit (owner) — must be before /p/:id
router.get('/p/:id/edit', requireOwner, async (req, res) => {
    const pages = getPages();
    const page = pages.find(function(p) { return p.id === req.params.id; });
    if (!page) return res.status(404).send('Page not found.');
    const safeName = escapeHtml(page.name || '');
    const content = page.content || '';
    const bodyContent = `
        <div style="margin-bottom:12px;">
            <label style="display:block;font-size:0.85rem;color:var(--text-muted);margin-bottom:4px;">Page name — appears in the menu (shown lowercased)</label>
            <input type="text" id="customPageName" value="${safeName}" maxlength="50" placeholder="e.g. About" class="comment-author-input" style="max-width:100%;">
        </div>
        <form id="articleForm" style="margin:0;">
            <div class="article-editor-toolbar">
                <button type="button" data-cmd="bold" onclick="execCmd('bold')" title="Bold (Ctrl+B)"><b>B</b></button>
                <button type="button" data-cmd="italic" onclick="execCmd('italic')" title="Italic (Ctrl+I)"><i>I</i></button>
                <button type="button" data-cmd="underline" onclick="execCmd('underline')" title="Underline (Ctrl+U)"><u>U</u></button>
                <button type="button" data-cmd="strikeThrough" onclick="execCmd('strikeThrough')" title="Strikethrough"><s>S</s></button>
                <button type="button" data-cmd="code" onclick="execInlineCode()" title="Inline code"><></button>
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
            <div id="article-content" class="article-content-editor" contenteditable="true" data-placeholder="Write your page content...">${content}</div>
            <div class="editor-hint">Enter = new paragraph · Shift+Enter or ↵ button = line break · Tab = indent list item · Image button, drag-drop, or paste inserts a picture</div>
            <div class="char-counter" id="article-char-counter">0 words &middot; 0 characters</div>
            <div class="publish-row" style="display:flex;gap:10px;align-items:baseline;">
                <button type="button" onclick="saveCustomPage()">Save</button>
                <a href="/p/${page.id}" class="back-link" style="margin-left:10px;">cancel</a>
            </div>
        </form>
        <script src="/article-editor.js?v=44"></script>
        <script>
        initArticleEditor({ mode: 'landing' });
        function saveCustomPage(){
            var nameEl = document.getElementById('customPageName');
            var name = nameEl ? nameEl.value.trim() : '';
            if (!name) { alert('Name is required.'); if(nameEl) nameEl.focus(); return; }
            if (typeof uploadsInFlight !== 'undefined' && uploadsInFlight > 0) { alert('Please wait for image upload to finish.'); return; }
            var btn = document.querySelector('.publish-row button');
            var content = getContent();
            btn.textContent = 'Saving...'; btn.disabled = true;
            fetch('/api/custom-pages/${page.id}', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, content: content })
            })
            .then(function(r){ return r.json(); })
            .then(function(data){
                if(data.success) window.location.href = '/p/${page.id}';
                else { btn.textContent='Save'; btn.disabled=false; alert(data.error || 'Failed to save.'); }
            })
            .catch(function(){ btn.textContent='Save'; btn.disabled=false; alert('Failed to save.'); });
        }
        </script>
    `;
    res.send(layoutTemplate({
        title: 'Edit — ' + (page.name || 'Page'),
        bodyContent,
        isOwner: true,
        pendingComments: req.pendingComments || 0,
        pendingMessages: req.pendingMessages || 0,
        blogTitle: getBlogTitle()
    }));
});

// Public page: /p/:id — mirrors custom landing: Add content button when empty, edit/delete when content exists
router.get('/p/:id', async (req, res) => {
    const pages = getPages();
    const page = pages.find(function(p) { return p.id === req.params.id; });
    if (!page) return res.status(404).send('Page not found.');
    const content = page.content || '';
    let bodyContent;
    if (content) {
        const ownerActions = req.isOwner ? `
                <div class="actions" style="margin-top:20px;">
                    <a href="/p/${page.id}/edit" class="edit-link">edit</a>
                    <a href="#" class="delete-btn" onclick="deleteCustomPageContent(this);return false;">delete</a>
                </div>
            ` : '';
        bodyContent = `
                <div class="entry" style="border-bottom:none;">
                    <div class="article-body">${sanitizeArticleHtml(content)}</div>
                    ${ownerActions}
                </div>
                ${req.isOwner ? `
                <script>
                function deleteCustomPageContent(el) {
                    if (el.dataset.confirming === 'true') {
                        el.textContent = 'deleting...';
                        fetch('/api/custom-pages/${page.id}/content', { method: 'DELETE' })
                        .then(function(r){ return r.json(); })
                        .then(function(data){ if(data.success) window.location.reload(); else { el.textContent='delete'; el.dataset.confirming=''; } })
                        .catch(function(){ el.textContent='delete'; el.dataset.confirming=''; });
                        return;
                    }
                    el.textContent = 'confirm?';
                    el.dataset.confirming = 'true';
                    setTimeout(function(){
                        if(el.dataset.confirming==='true'){ el.textContent='delete'; el.dataset.confirming=''; }
                    }, 3000);
                }
                </script>` : ''}
            `;
    } else {
        const addContentBtn = req.isOwner ? `
                <div style="margin-bottom:20px;">
                    <a href="/p/${page.id}/edit" class="btn">Add content</a>
                </div>
            ` : '';
        bodyContent = `${addContentBtn}`;
    }
    res.send(layoutTemplate({
        title: page.name || getBlogTitle(),
        bodyContent,
        isOwner: req.isOwner,
        pendingComments: req.pendingComments || 0,
        pendingMessages: req.pendingMessages || 0,
        blogTitle: getBlogTitle(),
        meta: {
            title: page.name || getBlogTitle(),
            description: (page.content || '').replace(/<[^>]*>/g, '').slice(0, 200).trim(),
            url: `${req.protocol}://${req.get('host')}/p/${page.id}`,
            type: 'article'
        }
    }));
});

// API: create
router.post('/api/custom-pages', requireOwner, async (req, res) => {
    const name = String(req.body.name || '').trim();
    const content = String(req.body.content || '');
    if (!name) return res.status(400).json({ success: false, error: 'Name is required.' });
    if (name.length > 50) return res.status(400).json({ success: false, error: 'Name must be 50 characters or less.' });
    const settings = getSettings();
    const pages = Array.isArray(settings.customPages) ? settings.customPages : [];
    if (pages.length >= MAX_CUSTOM_PAGES) return res.status(400).json({ success: false, error: 'Maximum ' + MAX_CUSTOM_PAGES + ' custom pages.' });
    const id = generateId();
    const sanitized = sanitizeArticleHtml(content);
    pages.push({ id, name: name.slice(0, 50), content: sanitized });
    settings.customPages = pages;
    saveSettings(settings);
    res.json({ success: true, id });
});

// API: reorder — must be before :id generic
router.put('/api/custom-pages/reorder', requireOwner, async (req, res) => {
    const order = req.body.order;
    if (!Array.isArray(order)) return res.status(400).json({ success: false, error: 'order must be an array of ids.' });
    const settings = getSettings();
    const pages = Array.isArray(settings.customPages) ? settings.customPages : [];
    if (order.length !== pages.length) return res.status(400).json({ success: false, error: 'Order must include all pages.' });
    const idSet = new Set(pages.map(function(p){ return p.id; }));
    for (let i = 0; i < order.length; i++) {
        if (!idSet.has(order[i])) return res.status(400).json({ success: false, error: 'Unknown id: ' + order[i] });
    }
    if (new Set(order).size !== order.length) return res.status(400).json({ success: false, error: 'Duplicate ids in order.' });
    const byId = {};
    pages.forEach(function(p){ byId[p.id] = p; });
    settings.customPages = order.map(function(id){ return byId[id]; });
    saveSettings(settings);
    res.json({ success: true });
});

// API: update
router.put('/api/custom-pages/:id', requireOwner, async (req, res) => {
    const id = req.params.id;
    const name = req.body.name !== undefined ? String(req.body.name).trim() : undefined;
    const content = req.body.content !== undefined ? String(req.body.content) : undefined;
    const settings = getSettings();
    const pages = Array.isArray(settings.customPages) ? settings.customPages : [];
    const idx = pages.findIndex(function(p){ return p.id === id; });
    if (idx === -1) return res.status(404).json({ success: false, error: 'Page not found.' });
    if (name !== undefined) {
        if (!name) return res.status(400).json({ success: false, error: 'Name is required.' });
        if (name.length > 50) return res.status(400).json({ success: false, error: 'Name must be 50 characters or less.' });
        pages[idx].name = name.slice(0, 50);
    }
    if (content !== undefined) {
        const oldContent = pages[idx].content || '';
        const sanitized = sanitizeArticleHtml(content);
        const removed = extractImageRefs(oldContent).filter(function(rid){ return extractImageRefs(sanitized).indexOf(rid) === -1; });
        pages[idx].content = sanitized;
        settings.customPages = pages;
        saveSettings(settings);
        await imageStore.gcImageRefs(removed);
        return res.json({ success: true });
    }
    settings.customPages = pages;
    saveSettings(settings);
    res.json({ success: true });
});

// API: delete
router.delete('/api/custom-pages/:id/content', requireOwner, async (req, res) => {
    const id = req.params.id;
    const settings = getSettings();
    const pages = Array.isArray(settings.customPages) ? settings.customPages : [];
    const idx = pages.findIndex(function(p){ return p.id === id; });
    if (idx === -1) return res.status(404).json({ success: false, error: 'Page not found.' });
    const removed = extractImageRefs(pages[idx].content || '');
    pages[idx].content = '';
    settings.customPages = pages;
    saveSettings(settings);
    await imageStore.gcImageRefs(removed);
    res.json({ success: true });
});

router.delete('/api/custom-pages/:id', requireOwner, async (req, res) => {
    const id = req.params.id;
    const settings = getSettings();
    const pages = Array.isArray(settings.customPages) ? settings.customPages : [];
    const idx = pages.findIndex(function(p){ return p.id === id; });
    if (idx === -1) return res.status(404).json({ success: false, error: 'Page not found.' });
    const removedContent = pages[idx].content || '';
    pages.splice(idx, 1);
    settings.customPages = pages;
    saveSettings(settings);
    await imageStore.gcImageRefs(extractImageRefs(removedContent));
    res.json({ success: true });
});

module.exports = router;
