const express = require('express');
const router = express.Router();
const { layoutTemplate } = require('../templates/layout');
const { getDb } = require('../db');
const { getBlogTitle, getOwnerName, getCopyright, getSettings, saveSettings, getOwnerUser } = require('../config');
const { requireOwner } = require('../middleware/auth');
const { escapeHtml } = require('../utils/html');

// Settings page (owner only)
router.get('/settings', requireOwner, (req, res) => {
    const settings = getSettings();
    const ownerName = getOwnerName();
    const ownerUser = getOwnerUser();
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
                <button type="button" class="comment-submit-btn" onclick="saveSettings(event)">Save</button>
                <span class="settings-status" id="landingStatus"></span>
            </div>

            <!-- Owner Home -->
            <div class="settings-section">
                <h3>Owner Home Page</h3>
                <p class="settings-hint">Where you land when you open the app, instead of the public landing page.</p>
                <div class="settings-option">
                    <label>
                        <input type="radio" name="ownerHome" value="default" ${settings.ownerHome === 'default' || !settings.ownerHome ? 'checked' : ''}>
                        Same as visitors
                        <span class="settings-desc">Land on whatever home page visitors see.</span>
                    </label>
                    <label class="${settings.postsEnabled ? '' : 'settings-disabled'}">
                        <input type="radio" name="ownerHome" value="posts" ${settings.ownerHome === 'posts' ? 'checked' : ''} ${settings.postsEnabled ? '' : 'disabled'}>
                        Posts
                        <span class="settings-desc">Land directly on your posts feed, ready to write.</span>
                    </label>
                    <label class="${settings.articlesEnabled ? '' : 'settings-disabled'}">
                        <input type="radio" name="ownerHome" value="articles" ${settings.ownerHome === 'articles' ? 'checked' : ''} ${settings.articlesEnabled ? '' : 'disabled'}>
                        Articles
                        <span class="settings-desc">Land directly on your articles list, ready to write.</span>
                    </label>
                </div>
                <button type="button" class="comment-submit-btn" onclick="saveSettings(event)">Save</button>
                <span class="settings-status" id="ownerHomeStatus"></span>
            </div>

            <!-- Content -->
            <div class="settings-section">
                <h3>Content</h3>
                <p class="settings-hint">Control which sections are visible on your site.</p>
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
                <button type="button" class="comment-submit-btn" onclick="saveSettings(event)">Save</button>
                <span class="settings-status" id="contentStatus"></span>
            </div>

            <!-- Features -->
            <div class="settings-section">
                <h3>Features</h3>
                <p class="settings-hint">Toggle interactive features on your site.</p>
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
                    <label>
                        <input type="checkbox" id="contactEnabled" ${settings.contactEnabled ? 'checked' : ''}>
                        Enable contact page
                        <span class="settings-desc">Show your contact page so visitors can send you messages. Disabling hides it from the menu (messages are never deleted).</span>
                    </label>
                </div>
                <button type="button" class="comment-submit-btn" onclick="saveSettings(event)">Save</button>
                <span class="settings-status" id="featuresStatus"></span>
            </div>

            <!-- Custom Pages -->
            <div class="settings-section">
                <h3>Custom Pages <span id="customPagesCount" style="font-weight:normal;color:var(--text-muted);font-size:0.85rem;"></span></h3>
                <p class="settings-hint">Add up to 5 pages with your own content. Each appears in the menu after Home and before Articles.</p>
                <div id="customPagesList" style="margin-top:12px;"></div>
                <div id="customPagesAdd" style="margin-top:14px;">
                    <div>
                        <input type="text" id="newCustomPageName" placeholder="e.g. About" maxlength="50" class="comment-author-input" style="max-width:100%;margin-bottom:4px;">
                        <p class="settings-hint" style="margin:0;font-size:0.78rem;">This name will appear in the menu (shown lowercased).</p>
                    </div>
                    <div style="display:flex;column-gap:8px;align-items:center;margin-top:15px;">
                        <button type="button" class="comment-submit-btn" id="addCustomPageBtn" onclick="addCustomPage()">Add page</button>
                        <span style="position:relative;display:inline-flex;">
                            <button type="button" class="comment-submit-btn" id="saveCustomPagesBtn" onclick="saveCustomPages(event)">Save</button>
                            <span class="settings-status" id="customPagesStatus" style="position:absolute;left:100%;top:50%;transform:translateY(-50%);white-space:nowrap;pointer-events:none;"></span>
                        </span>
                    </div>
                </div>
            </div>

            <!-- Theme -->
            <div class="settings-section">
                <h3>Theme</h3>
                <p class="settings-hint">Pick the light look for your site — every visitor sees it. Dark mode stays available to each visitor through the menu toggle.</p>
                <div class="settings-option">
                    <label>
                        <input type="radio" name="lightTheme" value="sepia" ${(settings.lightTheme || 'sepia') === 'sepia' ? 'checked' : ''}>
                        <span style="display:inline-block;width:14px;height:14px;border-radius:50%;vertical-align:-2px;margin-right:4px;background:#f5efe6;border:1px solid var(--separator-color);"></span>
                        Sepia
                        <span class="settings-desc">Warm paper tones — the classic Scrawl default.</span>
                    </label>
                    <label>
                        <input type="radio" name="lightTheme" value="white" ${settings.lightTheme === 'white' ? 'checked' : ''}>
                        <span style="display:inline-block;width:14px;height:14px;border-radius:50%;vertical-align:-2px;margin-right:4px;background:#ffffff;border:1px solid var(--separator-color);"></span>
                        White
                        <span class="settings-desc">Clean, pure white.</span>
                    </label>
                    <label>
                        <input type="radio" name="lightTheme" value="pink" ${settings.lightTheme === 'pink' ? 'checked' : ''}>
                        <span style="display:inline-block;width:14px;height:14px;border-radius:50%;vertical-align:-2px;margin-right:4px;background:#fdf2ff;border:1px solid var(--separator-color);"></span>
                        Baby Pink
                        <span class="settings-desc">Soft pastel pink-lavender with plum text.</span>
                    </label>
                    <label>
                        <input type="radio" name="lightTheme" value="alice" ${settings.lightTheme === 'alice' ? 'checked' : ''}>
                        <span style="display:inline-block;width:14px;height:14px;border-radius:50%;vertical-align:-2px;margin-right:4px;background:#f0f8ff;border:1px solid var(--separator-color);"></span>
                        Alice Blue
                        <span class="settings-desc">Very light sky blue — airy and calm.</span>
                    </label>
                </div>
                <button type="button" class="comment-submit-btn" onclick="saveTheme()">Save</button>
                <span class="settings-status" id="themeStatus"></span>
            </div>

            <!-- Edit Title -->
            <div class="settings-section">
                <h3>Edit Title</h3>
                <p class="settings-hint">The title shown at the top of your site and in the browser tab.</p>
                <input type="text" id="settingsTitle" value="${escapeHtml(blogTitle)}" class="comment-author-input" style="max-width:100%;">
                <button type="button" class="comment-submit-btn" onclick="saveTitle()">Save</button>
                <span class="settings-status" id="titleStatus"></span>
            </div>

            <!-- Account -->
            <div class="settings-section">
                <h3>Account</h3>
                <p class="settings-hint">${ownerUser ? `Your login username is <b>${escapeHtml(ownerUser)}</b>. ` : 'No username yet — '}logging in requires this username and your password${ownerUser ? '' : ' once it\'s saved'}.</p>
                <input type="text" id="settingsUsername" value="${escapeHtml(ownerUser)}" placeholder="your-username" required minlength="3" maxlength="30" autocomplete="username" class="comment-author-input" style="max-width:100%;">
                <button type="button" class="comment-submit-btn" onclick="saveUsername()">Save</button>
                <span class="settings-status" id="usernameStatus"></span>
            </div>

            <!-- Edit Name -->
            <div class="settings-section">
                <h3>Edit Name</h3>
                <p class="settings-hint">Your display name, shown on your comments.</p>
                <input type="text" id="settingsName" value="${escapeHtml(ownerName)}" class="comment-author-input" style="max-width:100%;">
                <button type="button" class="comment-submit-btn" onclick="saveName()">Save</button>
                <span class="settings-status" id="nameStatus"></span>
            </div>

            <!-- Edit Footer -->
            <div class="settings-section">
                <h3>Edit Footer</h3>
                <p class="settings-hint">The copyright/footer text shown at the bottom of your site. You can use <b>bold</b>, <i>italic</i>, and links.</p>
                <div class="article-editor-toolbar" style="position:static;">
                    <button type="button" onclick="execFooterCmd('bold')" title="Bold"><b>B</b></button>
                    <button type="button" onclick="execFooterCmd('italic')" title="Italic"><i>I</i></button>
                    <button type="button" onclick="execFooterLink()" title="Insert link"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.71"></path></svg></button>
                </div>
                <div id="settingsFooter" class="article-content-editor footer-editor" contenteditable="true" data-placeholder="Footer text...">${copyright}</div>
                <div class="char-counter" id="footer-char-counter">0 / 2000 characters</div>
                <button type="button" class="comment-submit-btn" onclick="saveFooter()">Save</button>
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
        var contactEnabled = document.getElementById('contactEnabled');

        // Theme (light variant) — live preview on the page while choosing
        var themeRadios = document.querySelectorAll('input[name="lightTheme"]');
        themeRadios.forEach(function(radio) {
            radio.addEventListener('change', function() {
                if (this.value === 'sepia') {
                    document.documentElement.removeAttribute('data-light');
                } else {
                    document.documentElement.setAttribute('data-light', this.value);
                }
                document.documentElement.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-body').trim();
            });
        });

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

            // Owner home page options mirror the same enabled/disabled state
            var ownerPostsRadio = document.querySelector('input[name="ownerHome"][value="posts"]');
            var ownerArticlesRadio = document.querySelector('input[name="ownerHome"][value="articles"]');
            var ownerDefaultRadio = document.querySelector('input[name="ownerHome"][value="default"]');
            var ownerPostsLabel = ownerPostsRadio.closest('label');
            var ownerArticlesLabel = ownerArticlesRadio.closest('label');

            ownerPostsRadio.disabled = !postsEnabled.checked;
            ownerArticlesRadio.disabled = !articlesEnabled.checked;
            ownerPostsLabel.classList.toggle('settings-disabled', !postsEnabled.checked);
            ownerArticlesLabel.classList.toggle('settings-disabled', !articlesEnabled.checked);

            // If the owner's selected home is now disabled, fall back to "Same as visitors"
            var ownerSelected = document.querySelector('input[name="ownerHome"]:checked');
            if (ownerSelected && ownerSelected.disabled) {
                ownerDefaultRadio.checked = true;
            }
        }
        postsEnabled.addEventListener('change', updateLandingOptions);
        articlesEnabled.addEventListener('change', updateLandingOptions);
        updateLandingOptions();

        function updateMenuVisibility() {
            var showPosts = postsEnabled.checked;
            var showArticles = articlesEnabled.checked;
            var showContact = contactEnabled.checked;
            // Desktop dropdown + mobile drawer menu items
            document.querySelectorAll('[data-menu="posts"], [data-menu="archive"], [data-menu="rss-posts"]').forEach(function(el) {
                el.style.display = showPosts ? '' : 'none';
            });
            document.querySelectorAll('[data-menu="articles"], [data-menu="rss-articles"]').forEach(function(el) {
                el.style.display = showArticles ? '' : 'none';
            });
            document.querySelectorAll('[data-menu="contact"]').forEach(function(el) {
                el.style.display = showContact ? '' : 'none';
            });
        }

        // Feedback on the save button itself (matching posts/articles), leaving
        // the status span for validation errors only.
        function setStatus(id, text, isError) {
            var el = document.getElementById(id);
            if (!el) return;
            el.textContent = text;
            el.style.color = isError ? '#d96b6b' : 'var(--text-muted)';
            if (!isError) {
                setTimeout(function() { el.textContent = ''; }, 2000);
            }
        }

        function setBtn(btn, label, disabled) {
            if (btn) { btn.textContent = label; btn.disabled = !!disabled; }
        }

        function saveSettings(e) {
            var landingPage = document.querySelector('input[name="landingPage"]:checked').value;
            var ownerHome = document.querySelector('input[name="ownerHome"]:checked').value;
            var btn = (e && e.target) ? e.target : (typeof event !== 'undefined' ? event.target : null);
            var original = btn ? btn.textContent : '';
            setBtn(btn, 'Saving...', true);
            fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    landingPage: landingPage,
                    ownerHome: ownerHome,
                    postsEnabled: postsEnabled.checked,
                    articlesEnabled: articlesEnabled.checked,
                    commentsOnPostsEnabled: commentsOnPostsEnabled.checked,
                    commentsOnArticlesEnabled: commentsOnArticlesEnabled.checked,
                    contactEnabled: contactEnabled.checked
                })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    updateMenuVisibility();
                    setBtn(btn, 'Saved', false);
                }
                else { setBtn(btn, 'Failed', false); }
                setTimeout(function() { setBtn(btn, original, false); }, 2000);
            })
            .catch(function() {
                setBtn(btn, 'Failed', false);
                setTimeout(function() { setBtn(btn, original, false); }, 2000);
            });
        }
        updateMenuVisibility();

        // Theme — saves only when its own button is clicked; radio changes are preview-only
        function saveTheme() {
            var lightTheme = document.querySelector('input[name="lightTheme"]:checked').value;
            var btn = event.target;
            var original = btn ? btn.textContent : '';
            setBtn(btn, 'Saving...', true);
            fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lightTheme: lightTheme })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) { setBtn(btn, 'Saved', false); }
                else { setBtn(btn, 'Failed', false); }
                setTimeout(function() { setBtn(btn, original, false); }, 2000);
            })
            .catch(function() {
                setBtn(btn, 'Failed', false);
                setTimeout(function() { setBtn(btn, original, false); }, 2000);
            });
        }

        // Username
        function saveUsername() {
            var username = document.getElementById('settingsUsername').value.trim();
            if (!username) { setStatus('usernameStatus', 'Username cannot be empty.', true); return; }
            var btn = event.target;
            var original = btn ? btn.textContent : '';
            setBtn(btn, 'Saving...', true);
            fetch('/api/owner-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) { setBtn(btn, 'Saved', false); }
                else {
                    setBtn(btn, 'Failed', false);
                    if (data.error) setStatus('usernameStatus', data.error, true);
                }
                setTimeout(function() { setBtn(btn, original, false); }, 2000);
            })
            .catch(function() {
                setBtn(btn, 'Failed', false);
                setTimeout(function() { setBtn(btn, original, false); }, 2000);
            });
        }

        // Title
        function saveTitle() {
            var title = document.getElementById('settingsTitle').value.trim();
            if (!title) { setStatus('titleStatus', 'Title cannot be empty.', true); return; }
            var btn = event.target;
            var original = btn ? btn.textContent : '';
            setBtn(btn, 'Saving...', true);
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
                    setBtn(btn, 'Saved', false);
                }
                else { setBtn(btn, 'Failed', false); }
                setTimeout(function() { setBtn(btn, original, false); }, 2000);
            })
            .catch(function() {
                setBtn(btn, 'Failed', false);
                setTimeout(function() { setBtn(btn, original, false); }, 2000);
            });
        }

        // Name
        function saveName() {
            var name = document.getElementById('settingsName').value.trim();
            if (!name) { setStatus('nameStatus', 'Name cannot be empty.', true); return; }
            var btn = event.target;
            var original = btn ? btn.textContent : '';
            setBtn(btn, 'Saving...', true);
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
                    setBtn(btn, 'Saved', false);
                }
                else { setBtn(btn, 'Failed', false); }
                setTimeout(function() { setBtn(btn, original, false); }, 2000);
            })
            .catch(function() {
                setBtn(btn, 'Failed', false);
                setTimeout(function() { setBtn(btn, original, false); }, 2000);
            });
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
            var btn = event.target;
            var original = btn ? btn.textContent : '';
            setBtn(btn, 'Saving...', true);
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
                    setBtn(btn, 'Saved', false);
                }
                else { setBtn(btn, 'Failed', false); }
                setTimeout(function() { setBtn(btn, original, false); }, 2000);
            })
            .catch(function() {
                setBtn(btn, 'Failed', false);
                setTimeout(function() { setBtn(btn, original, false); }, 2000);
            });
        }

        // Custom Pages
        var customPagesData = ${JSON.stringify(settings.customPages || []).replace(/</g, '\\u003c')};
        var MAX_CUSTOM_PAGES = 5;
        function escapeCustomHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
        function renderCustomPages(){
            var list = document.getElementById('customPagesList');
            var countEl = document.getElementById('customPagesCount');
            var addBtn = document.getElementById('addCustomPageBtn');
            var addWrap = document.getElementById('customPagesAdd');
            if(!list) return;
            countEl.textContent = '(' + customPagesData.length + '/' + MAX_CUSTOM_PAGES + ')';
            if(customPagesData.length >= MAX_CUSTOM_PAGES){
                if(addWrap) addWrap.style.display = 'none';
            } else {
                if(addWrap) addWrap.style.display = '';
                if(addBtn) addBtn.disabled = false;
            }
            if(customPagesData.length === 0){
                list.innerHTML = '<p class="settings-hint" style="font-size:0.85rem;">No custom pages yet. Add one below.</p>';
                return;
            }
            var html = '';
            for(var i=0;i<customPagesData.length;i++){
                var p = customPagesData[i];
                var upDisabled = i===0 ? ' disabled style="opacity:0.35;cursor:not-allowed;"' : '';
                var downDisabled = i===customPagesData.length-1 ? ' disabled style="opacity:0.35;cursor:not-allowed;"' : '';
                html += '<div class="custom-pages-row">'
                    + '<div class="custom-pages-input-wrap">'
                    + '<input type="text" value="' + escapeCustomHtml(p.name) + '" data-id="' + escapeCustomHtml(p.id) + '" maxlength="50" class="comment-author-input custom-page-name-input" style="max-width:100%;">'
                    + '</div>'
                    + '<div class="custom-pages-actions">'
                    + '<a href="/p/' + escapeCustomHtml(p.id) + '" target="_blank" class="back-link">view</a>'
                    + '<a href="/p/' + escapeCustomHtml(p.id) + '/edit" class="edit-link">edit</a>'
                    + '<button type="button" class="delete-btn" onclick="deleteCustomPage(\\'' + escapeCustomHtml(p.id).replace(/\'/g, "\\'") + '\\', this)">delete</button>'
                    + '<span class="custom-pages-sort">'
                    + '<button type="button" onclick="moveCustomPage(' + i + ',-1)"' + upDisabled + ' title="Move up">&uarr;</button>'
                    + '<button type="button" onclick="moveCustomPage(' + i + ',1)"' + downDisabled + ' title="Move down">&darr;</button>'
                    + '</span>'
                    + '</div>'
                    + '</div>';
            }
            list.innerHTML = html;
        }
        function addCustomPage(){
            var input = document.getElementById('newCustomPageName');
            var name = input ? input.value.trim() : '';
            var btn = document.getElementById('addCustomPageBtn');
            if(!name){ setStatus('customPagesStatus','Name is required.',false); if(input) input.focus(); return; }
            if(customPagesData.length >= MAX_CUSTOM_PAGES){ setStatus('customPagesStatus','Maximum '+MAX_CUSTOM_PAGES+' pages.',false); return; }
            var original = btn ? btn.textContent : '';
            setBtn(btn,'Adding...',true);
            fetch('/api/custom-pages',{
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ name: name, content: '' })
            }).then(function(r){ return r.json(); }).then(function(data){
                if(data.success){
                    customPagesData.push({ id: data.id, name: name, content: '' });
                    if(input) input.value='';
                    renderCustomPages();
                    rebuildCustomPageMenus();
                    setBtn(btn, original, false);
                    setStatus('customPagesStatus','',false);
                } else {
                    setBtn(btn,'Failed',false);
                    setStatus('customPagesStatus', data.error||'Failed', false);
                    setTimeout(function(){ setBtn(btn, original, false); },2000);
                }
            }).catch(function(){
                setBtn(btn,'Failed',false);
                setTimeout(function(){ setBtn(btn, original, false); },2000);
            });
        }
        function rebuildCustomPageMenus(){
            var containers = document.querySelectorAll('#menuDropdown, #mobileMenu');
            containers.forEach(function(container){
                var existing = container.querySelectorAll('a[data-menu="custom-page"]');
                existing.forEach(function(el){ el.remove(); });
                var homeLink = container.querySelector('a[href="/"]');
                var insertAfter = homeLink;
                customPagesData.forEach(function(p){
                    var a = document.createElement('a');
                    a.href = '/p/' + p.id;
                    a.setAttribute('data-menu','custom-page');
                    a.textContent = String(p.name).toLowerCase();
                    if(insertAfter && insertAfter.nextSibling){
                        insertAfter.parentNode.insertBefore(a, insertAfter.nextSibling);
                    } else if(insertAfter){
                        insertAfter.parentNode.appendChild(a);
                    } else {
                        container.prepend(a);
                    }
                    insertAfter = a;
                });
            });
        }
        function saveCustomPages(e){
            var btn = (e && e.target) ? e.target : (typeof event !== 'undefined' ? event.target : null);
            var inputs = document.querySelectorAll('.custom-page-name-input');
            var changed = [];
            var hasEmpty = false;
            var emptyInput = null;
            inputs.forEach(function(input){
                var id = input.getAttribute('data-id');
                var newName = input.value.trim();
                var page = customPagesData.find(function(p){ return p.id===id; });
                if(!page) return;
                if(!newName){ hasEmpty = true; emptyInput = input; }
                else if(page.name !== newName){ changed.push({ id:id, newName:newName, input:input, page:page }); }
            });
            if(hasEmpty){
                setStatus('customPagesStatus','Name cannot be empty.',false);
                if(emptyInput){
                    var foundEmpty = customPagesData.find(function(p){ return p.id===emptyInput.getAttribute('data-id'); });
                    if(foundEmpty) emptyInput.value = foundEmpty.name;
                    emptyInput.focus();
                }
                return;
            }
            if(changed.length===0){ setStatus('customPagesStatus','No changes to save.',false); return; }
            var original = btn ? btn.textContent : '';
            setBtn(btn,'Saving...',true);
            var promises = changed.map(function(item){
                return fetch('/api/custom-pages/' + encodeURIComponent(item.id),{
                    method:'PUT',
                    headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({ name: item.newName })
                }).then(function(r){ return r.json().then(function(data){ return { item:item, data:data }; }); });
            });
            Promise.all(promises).then(function(results){
                var failed = results.filter(function(r){ return !r.data.success; });
                if(failed.length===0){
                    changed.forEach(function(c){ c.page.name = c.newName; });
                    rebuildCustomPageMenus();
                    setBtn(btn,'Saved',false);
                    setTimeout(function(){ renderCustomPages(); setStatus('customPagesStatus','',false); setBtn(btn, original, false); }, 800);
                } else {
                    var firstFail = failed[0];
                    setBtn(btn,'Failed',false);
                    setStatus('customPagesStatus', firstFail.data.error||'Failed', false);
                    // revert failed inputs
                    failed.forEach(function(r){ r.item.input.value = r.item.page.name; });
                    // also commit successful ones
                    results.filter(function(r){ return r.data.success; }).forEach(function(r){ r.item.page.name = r.item.newName; });
                    rebuildCustomPageMenus();
                    renderCustomPages();
                    setTimeout(function(){ setBtn(btn, original, false); },2000);
                }
            }).catch(function(){
                setBtn(btn,'Failed',false);
                setStatus('customPagesStatus','Failed',false);
                setTimeout(function(){ setBtn(btn, original, false); },2000);
            });
        }
        function deleteCustomPage(id, el){
            if(el.dataset.confirming==='true'){
                el.textContent='deleting...';
                fetch('/api/custom-pages/' + encodeURIComponent(id),{ method:'DELETE' })
                .then(function(r){ return r.json(); }).then(function(data){
                    if(data.success){
                        customPagesData = customPagesData.filter(function(p){ return p.id!==id; });
                        renderCustomPages();
                        rebuildCustomPageMenus();
                    } else { el.textContent='delete'; el.dataset.confirming=''; setStatus('customPagesStatus', data.error||'Failed', false); }
                }).catch(function(){ el.textContent='delete'; el.dataset.confirming=''; });
                return;
            }
            el.textContent='confirm?';
            el.dataset.confirming='true';
            setTimeout(function(){ if(el.dataset.confirming==='true'){ el.textContent='delete'; el.dataset.confirming=''; } },3000);
        }
        function moveCustomPage(index, dir){
            var newIndex = index + dir;
            if(newIndex<0 || newIndex>=customPagesData.length) return;
            var order = customPagesData.map(function(p){ return p.id; });
            var tmp = order[index]; order[index]=order[newIndex]; order[newIndex]=tmp;
            fetch('/api/custom-pages/reorder',{
                method:'PUT',
                headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ order: order })
            }).then(function(r){ return r.json(); }).then(function(data){
                if(data.success){
                    var moved = customPagesData.splice(index,1)[0];
                    customPagesData.splice(newIndex,0,moved);
                    renderCustomPages();
                    rebuildCustomPageMenus();
                } else { setStatus('customPagesStatus', data.error||'Failed', false); }
            }).catch(function(){ setStatus('customPagesStatus','Failed',false); });
        }
        renderCustomPages();
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
    const { landingPage, ownerHome, postsEnabled, articlesEnabled, commentsOnPostsEnabled, commentsOnArticlesEnabled, contactEnabled, lightTheme } = req.body;
    const settings = getSettings();
    if (landingPage === 'posts' || landingPage === 'articles' || landingPage === 'custom') {
        settings.landingPage = landingPage;
    }
    if (ownerHome === 'default' || ownerHome === 'posts' || ownerHome === 'articles') {
        settings.ownerHome = ownerHome;
    }
    if (typeof postsEnabled === 'boolean') settings.postsEnabled = postsEnabled;
    if (typeof articlesEnabled === 'boolean') settings.articlesEnabled = articlesEnabled;
    if (typeof commentsOnPostsEnabled === 'boolean') settings.commentsOnPostsEnabled = commentsOnPostsEnabled;
    if (typeof commentsOnArticlesEnabled === 'boolean') settings.commentsOnArticlesEnabled = commentsOnArticlesEnabled;
    if (typeof contactEnabled === 'boolean') settings.contactEnabled = contactEnabled;
    if (lightTheme === 'sepia' || lightTheme === 'white' || lightTheme === 'pink' || lightTheme === 'alice') {
        settings.lightTheme = lightTheme;
    }
    saveSettings(settings);
    res.json({ success: true });
});

module.exports = router;