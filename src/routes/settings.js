const express = require('express');
const router = express.Router();
const { layoutTemplate } = require('../templates/layout');
const { getDb } = require('../db');
const { getBlogTitle, getOwnerName, getCopyright, getSettings, saveSettings } = require('../config');
const { requireOwner } = require('../middleware/auth');
const { escapeHtml } = require('../utils/html');

// Settings page (owner only)
router.get('/settings', requireOwner, (req, res) => {
    const settings = getSettings();
    const ownerName = getOwnerName();
    const blogTitle = getBlogTitle();
    const copyright = getCopyright();

    const bodyContent = `
        <div class="settings-container">
            <h2 style="font-size:1rem;font-weight:normal;color:var(--text-muted);margin-bottom:20px;">Settings</h2>

            <!-- Landing Page -->
            <div class="settings-section">
                <h3>Landing Page</h3>
                <p class="settings-hint">Choose what visitors see when they visit your site's home page.</p>
                <div class="settings-option">
                    <label class="${settings.postsEnabled ? '' : 'settings-disabled'}">
                        <input type="radio" name="landingPage" value="posts" ${settings.landingPage === 'posts' ? 'checked' : ''} ${settings.postsEnabled ? '' : 'disabled'}>
                        Posts
                        <span class="settings-desc">Short, quick thoughts with no title. Published instantly to your feed.</span>
                    </label>
                    <label class="${settings.articlesEnabled ? '' : 'settings-disabled'}">
                        <input type="radio" name="landingPage" value="articles" ${settings.landingPage === 'articles' ? 'checked' : ''} ${settings.articlesEnabled ? '' : 'disabled'}>
                        Articles
                        <span class="settings-desc">Long-form writing with titles, rich formatting, and draft support.</span>
                    </label>
                    <label>
                        <input type="radio" name="landingPage" value="custom" ${settings.landingPage === 'custom' ? 'checked' : ''}>
                        Custom
                        <span class="settings-desc">A single landing page of your own content, shown as your home page.</span>
                    </label>
                </div>
                <div class="settings-option">
                    <label>
                        <input type="checkbox" id="postsEnabled" ${settings.postsEnabled ? 'checked' : ''}>
                        Enable posts
                        <span class="settings-desc">Show your quick posts feed. Disabling hides posts from the menu and home page.</span>
                    </label>
                    <label>
                        <input type="checkbox" id="articlesEnabled" ${settings.articlesEnabled ? 'checked' : ''}>
                        Enable articles
                        <span class="settings-desc">Show your long-form articles. Disabling hides articles from the menu and home page.</span>
                    </label>
                </div>
                <div class="settings-option">
                    <label>
                        <input type="checkbox" id="commentsOnPostsEnabled" ${settings.commentsOnPostsEnabled ? 'checked' : ''}>
                        Enable comments on posts
                        <span class="settings-desc">Allow readers to comment on your posts. Disabling hides the comment link and discussion section.</span>
                    </label>
                    <label>
                        <input type="checkbox" id="commentsOnArticlesEnabled" ${settings.commentsOnArticlesEnabled ? 'checked' : ''}>
                        Enable comments on articles
                        <span class="settings-desc">Allow readers to comment on your articles. Disabling hides the discussion section.</span>
                    </label>
                </div>
            </div>

            <!-- Edit Title -->
            <div class="settings-section">
                <h3>Edit Title</h3>
                <p class="settings-hint">The title shown at the top of your site and in the browser tab.</p>
                <input type="text" id="settingsTitle" value="${escapeHtml(blogTitle)}" class="comment-author-input" style="max-width:100%;">
                <button type="button" class="comment-submit-btn" onclick="saveTitle()">Save Title</button>
                <span class="settings-status" id="titleStatus"></span>
            </div>

            <!-- Edit Name -->
            <div class="settings-section">
                <h3>Edit Name</h3>
                <p class="settings-hint">Your display name, shown on your comments.</p>
                <input type="text" id="settingsName" value="${escapeHtml(ownerName)}" class="comment-author-input" style="max-width:100%;">
                <button type="button" class="comment-submit-btn" onclick="saveName()">Save Name</button>
                <span class="settings-status" id="nameStatus"></span>
            </div>

            <!-- Edit Footer -->
            <div class="settings-section">
                <h3>Edit Footer</h3>
                <p class="settings-hint">The copyright/footer text shown at the bottom of your site. You can use <b>bold</b>, <i>italic</i>, and links.</p>
                <div class="article-editor-toolbar" style="position:static;">
                    <button type="button" onclick="execFooterCmd('bold')" title="Bold"><b>B</b></button>
                    <button type="button" onclick="execFooterCmd('italic')" title="Italic"><i>I</i></button>
                    <button type="button" onclick="execFooterLink()" title="Insert link">&#128279;</button>
                </div>
                <div id="settingsFooter" class="article-content-editor footer-editor" contenteditable="true" data-placeholder="Footer text...">${copyright}</div>
                <div class="char-counter" id="footer-char-counter">0 / 2000 characters</div>
                <button type="button" class="comment-submit-btn" onclick="saveFooter()">Save Footer</button>
                <span class="settings-status" id="footerStatus"></span>
            </div>

            <!-- Export -->
            <div class="settings-section">
                <h3>Export</h3>
                <p class="settings-hint">Download all your content as Markdown.</p>
                <a href="/api/export" class="btn btn-outline">Export Content</a>
            </div>

            <p style="margin-top:30px;"><a href="/" class="back-link">&larr; back to home</a></p>
        </div>

        <script>
        // Landing page settings
        var landingRadios = document.querySelectorAll('input[name="landingPage"]');
        var postsEnabled = document.getElementById('postsEnabled');
        var articlesEnabled = document.getElementById('articlesEnabled');
        var commentsOnPostsEnabled = document.getElementById('commentsOnPostsEnabled');
        var commentsOnArticlesEnabled = document.getElementById('commentsOnArticlesEnabled');

        function updateLandingOptions() {
            var postsRadio = document.querySelector('input[name="landingPage"][value="posts"]');
            var articlesRadio = document.querySelector('input[name="landingPage"][value="articles"]');
            var customRadio = document.querySelector('input[name="landingPage"][value="custom"]');
            var postsLabel = postsRadio.closest('label');
            var articlesLabel = articlesRadio.closest('label');

            postsRadio.disabled = !postsEnabled.checked;
            articlesRadio.disabled = !articlesEnabled.checked;
            postsLabel.classList.toggle('settings-disabled', !postsEnabled.checked);
            articlesLabel.classList.toggle('settings-disabled', !articlesEnabled.checked);

            // If the currently selected option is now disabled, force custom
            var selected = document.querySelector('input[name="landingPage"]:checked');
            if (selected && selected.disabled) {
                customRadio.checked = true;
            }
        }
        postsEnabled.addEventListener('change', updateLandingOptions);
        articlesEnabled.addEventListener('change', updateLandingOptions);
        updateLandingOptions();

        function updateMenuVisibility() {
            var showPosts = postsEnabled.checked;
            var showArticles = articlesEnabled.checked;
            // Desktop dropdown + mobile drawer menu items
            document.querySelectorAll('[data-menu="posts"], [data-menu="archive"], [data-menu="rss-posts"]').forEach(function(el) {
                el.style.display = showPosts ? '' : 'none';
            });
            document.querySelectorAll('[data-menu="articles"], [data-menu="rss-articles"]').forEach(function(el) {
                el.style.display = showArticles ? '' : 'none';
            });
        }

        function setStatus(id, text, isError) {
            var el = document.getElementById(id);
            if (!el) return;
            el.textContent = text;
            el.style.color = isError ? '#d96b6b' : 'var(--text-muted)';
            if (!isError) {
                setTimeout(function() { el.textContent = ''; }, 2000);
            }
        }

        function saveSettings() {
            var landingPage = document.querySelector('input[name="landingPage"]:checked').value;
            setStatus('settingsStatus', 'Saving...');
            fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    landingPage: landingPage,
                    postsEnabled: postsEnabled.checked,
                    articlesEnabled: articlesEnabled.checked,
                    commentsOnPostsEnabled: commentsOnPostsEnabled.checked,
                    commentsOnArticlesEnabled: commentsOnArticlesEnabled.checked
                })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    updateMenuVisibility();
                    setStatus('settingsStatus', 'Saved');
                }
                else { setStatus('settingsStatus', 'Failed', true); }
            })
            .catch(function() { setStatus('settingsStatus', 'Failed', true); });
        }
        updateMenuVisibility();

        // Title
        function saveTitle() {
            var title = document.getElementById('settingsTitle').value.trim();
            if (!title) { setStatus('titleStatus', 'Title cannot be empty.', true); return; }
            setStatus('titleStatus', 'Saving...');
            fetch('/api/blog-title', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: title })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    // Update the header title and browser tab in real time
                    var blogTitleEl = document.getElementById('blogTitle');
                    if (blogTitleEl) blogTitleEl.textContent = data.title;
                    document.title = data.title;
                    setStatus('titleStatus', 'Saved');
                }
                else { setStatus('titleStatus', 'Failed', true); }
            })
            .catch(function() { setStatus('titleStatus', 'Failed', true); });
        }

        // Name
        function saveName() {
            var name = document.getElementById('settingsName').value.trim();
            if (!name) { setStatus('nameStatus', 'Name cannot be empty.', true); return; }
            setStatus('nameStatus', 'Saving...');
            fetch('/api/owner-name', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    // Update any owner comment author names in real time
                    document.querySelectorAll('.comment-author').forEach(function(el) {
                        if (el.dataset.isOwner === 'true') el.textContent = data.name;
                    });
                    setStatus('nameStatus', 'Saved');
                }
                else { setStatus('nameStatus', 'Failed', true); }
            })
            .catch(function() { setStatus('nameStatus', 'Failed', true); });
        }

        // Footer
        var footerEditor = document.getElementById('settingsFooter');
        var footerCounter = document.getElementById('footer-char-counter');
        var FOOTER_MAX = 2000;

        function resizeFooter() {
            var s = window.scrollY;
            footerEditor.style.height = 'auto';
            footerEditor.style.height = footerEditor.scrollHeight + 'px';
            window.scrollTo(0, s);
        }

        function updateFooterCount() {
            var text = footerEditor.innerText || '';
            var chars = text.length;
            footerCounter.textContent = chars + ' / ' + FOOTER_MAX + ' characters';
            if (chars > FOOTER_MAX) {
                footerCounter.style.color = '#d96b6b';
            } else {
                footerCounter.style.color = '';
            }
        }
        footerEditor.addEventListener('input', function() {
            var text = footerEditor.innerText || '';
            if (text.length > FOOTER_MAX) {
                // Trim to the limit
                var sel = window.getSelection();
                var range = sel.getRangeAt(0);
                var node = range.startContainer;
                var offset = range.startOffset;
                // Remove extra characters
                var trimmed = text.slice(0, FOOTER_MAX);
                footerEditor.innerText = trimmed;
                // Restore cursor to end
                var newRange = document.createRange();
                newRange.selectNodeContents(footerEditor);
                newRange.collapse(false);
                sel.removeAllRanges();
                sel.addRange(newRange);
            }
            resizeFooter();
            updateFooterCount();
        });
        resizeFooter();
        updateFooterCount();

        function execFooterCmd(cmd) {
            document.execCommand(cmd, false, null);
            updateFooterCount();
        }
        function execFooterLink() {
            var url = prompt('Enter link URL:');
            if (url) document.execCommand('createLink', false, url);
            updateFooterCount();
        }
        function saveFooter() {
            var el = document.getElementById('settingsFooter');
            var text = el.innerHTML;
            setStatus('footerStatus', 'Saving...');
            fetch('/api/copyright', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    // Update the rendered footer in real time
                    var footerEl = document.querySelector('.site-footer');
                    if (footerEl) footerEl.innerHTML = data.text;
                    setStatus('footerStatus', 'Saved');
                }
                else { setStatus('footerStatus', 'Failed', true); }
            })
            .catch(function() { setStatus('footerStatus', 'Failed', true); });
        }

        // Save settings button
        var saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'comment-submit-btn';
        saveBtn.textContent = 'Save Settings';
        saveBtn.style.marginTop = '10px';
        saveBtn.addEventListener('click', saveSettings);
        document.querySelector('.settings-section').appendChild(saveBtn);
        var settingsStatus = document.createElement('span');
        settingsStatus.className = 'settings-status';
        settingsStatus.id = 'settingsStatus';
        saveBtn.parentNode.appendChild(settingsStatus);
        </script>
    `;

    res.send(layoutTemplate({
        title: 'Settings',
        bodyContent,
        isOwner: true,
        pendingComments: req.pendingComments || 0,
        pendingMessages: req.pendingMessages || 0,
        blogTitle: getBlogTitle()
    }));
});

// Save settings API (owner only)
router.post('/api/settings', requireOwner, (req, res) => {
    const { landingPage, postsEnabled, articlesEnabled, commentsOnPostsEnabled, commentsOnArticlesEnabled } = req.body;
    const settings = getSettings();
    if (landingPage === 'posts' || landingPage === 'articles' || landingPage === 'custom') {
        settings.landingPage = landingPage;
    }
    if (typeof postsEnabled === 'boolean') settings.postsEnabled = postsEnabled;
    if (typeof articlesEnabled === 'boolean') settings.articlesEnabled = articlesEnabled;
    if (typeof commentsOnPostsEnabled === 'boolean') settings.commentsOnPostsEnabled = commentsOnPostsEnabled;
    if (typeof commentsOnArticlesEnabled === 'boolean') settings.commentsOnArticlesEnabled = commentsOnArticlesEnabled;
    saveSettings(settings);
    res.json({ success: true });
});

module.exports = router;