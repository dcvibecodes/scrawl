(function() {
    // ===== Shared article editor logic (used by both /articles/new and /articles/:id/edit) =====

    var articleSaved = false;
    var editorMode = 'new';
    var editorArticleId = null;
    var editorIsDraft = false;
    var htmlMode = false;
    var htmlTextarea = null;
    var htmlBtn = null;

    // Safari throws on this command — wrap in try/catch so the whole script doesn't crash
    try {
        document.execCommand('defaultParagraphSeparator', false, 'p');
    } catch (e) {}

    function getEditor() {
        return document.getElementById('article-content');
    }

    // Ensure text is always inside a <p> block for proper paragraph behavior
    function setupKeydown() {
        var editor = getEditor();
        editor.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && e.shiftKey) {
                // Shift+Enter: insert line break
                e.preventDefault();
                if (!document.execCommand('insertLineBreak', false, null)) {
                    document.execCommand('insertHTML', false, '<br><br>');
                }
            } else if (e.key === 'Enter' && !e.shiftKey) {
                // If content is bare text (not inside a block element), wrap it first
                var sel = window.getSelection();
                if (sel.rangeCount) {
                    var node = sel.anchorNode;
                    var isInsideBlock = false;
                    while (node && node !== editor) {
                        if (node.nodeType === 1 && /^(P|H[1-6]|DIV|BLOCKQUOTE|LI)$/.test(node.tagName)) {
                            isInsideBlock = true;
                            break;
                        }
                        node = node.parentNode;
                    }
                    if (!isInsideBlock && editor.textContent.trim()) {
                        e.preventDefault();
                        document.execCommand('formatBlock', false, '<p>');
                        // Now insert a new paragraph
                        document.execCommand('insertParagraph', false, null);
                    }
                }
            } else if (e.key === 'Tab') {
                // Tab inside a list: indent (create sub-list)
                var sel = window.getSelection();
                if (sel.rangeCount) {
                    var node = sel.anchorNode;
                    while (node && node !== editor) {
                        if (node.nodeType === 1 && node.tagName === 'LI') {
                            e.preventDefault();
                            if (e.shiftKey) {
                                document.execCommand('outdent', false, null);
                            } else {
                                document.execCommand('indent', false, null);
                            }
                            break;
                        }
                        node = node.parentNode;
                    }
                }
            }
        });
        editor.addEventListener('input', function() {
            var text = editor.textContent.trim();
            if (!text) {
                editor.classList.add('is-empty');
            } else {
                editor.classList.remove('is-empty');
            }
        });
    }

    // Edit mode: wrap old bare content in <p> tags (old articles stored with <br>)
    function wrapBareContent() {
        var editor = getEditor();
        var html = editor.innerHTML.trim();
        if (html && html !== '<br>' && !html.match(/^<(p|h[1-6]|div|blockquote|ol|ul)/i)) {
            editor.innerHTML = '<p>' + html + '</p>';
        }
    }

    window.execCmd = function(cmd) {
        document.execCommand(cmd, false, null);
        getEditor().focus();
        updateToolbarState();
    };

    window.execHeading = function(tag) {
        var editor = getEditor();
        // Check if currently in this heading — if so, toggle off to normal paragraph
        var block = getCurrentBlock();
        if (block && block.tagName === tag.toUpperCase()) {
            document.execCommand('formatBlock', false, '<p>');
        } else {
            document.execCommand('formatBlock', false, '<' + tag + '>');
        }
        editor.focus();
        updateToolbarState();
    };

    window.execQuote = function() {
        var block = getCurrentBlock();
        if (block && block.tagName === 'BLOCKQUOTE') {
            document.execCommand('formatBlock', false, '<p>');
        } else {
            document.execCommand('formatBlock', false, '<blockquote>');
        }
        getEditor().focus();
        updateToolbarState();
    };

    window.execLineBreak = function() {
        var editor = getEditor();
        editor.focus();
        if (!document.execCommand('insertLineBreak', false, null)) {
            document.execCommand('insertHTML', false, '<br><br>');
        }
    };

    window.execSeparator = function() {
        var editor = getEditor();
        editor.focus();
        document.execCommand('insertHTML', false, '<hr><p><br></p>');
    };

    window.execInlineCode = function() {
        var editor = getEditor();
        var sel = window.getSelection();
        if (sel.rangeCount > 0) {
            var range = sel.getRangeAt(0);
            // Check if already inside a <code> element
            var node = sel.anchorNode;
            while (node && node !== editor) {
                if (node.nodeType === 1 && node.tagName === 'CODE') {
                    // Unwrap: replace <code> with its text content
                    var text = document.createTextNode(node.textContent);
                    node.parentNode.replaceChild(text, node);
                    // Re-select the text
                    var newRange = document.createRange();
                    newRange.selectNodeContents(text);
                    sel.removeAllRanges();
                    sel.addRange(newRange);
                    updateToolbarState();
                    return;
                }
                node = node.parentNode;
            }
            // Wrap selection in <code>
            if (!range.collapsed) {
                var code = document.createElement('code');
                range.surroundContents(code);
                sel.removeAllRanges();
                var newRange = document.createRange();
                newRange.selectNodeContents(code);
                sel.addRange(newRange);
            }
        }
        editor.focus();
        updateToolbarState();
    };

    function getCurrentBlock() {
        var sel = window.getSelection();
        if (!sel.rangeCount) return null;
        var node = sel.anchorNode;
        var editor = getEditor();
        while (node && node !== editor) {
            if (node.nodeType === 1 && /^(H2|H3|BLOCKQUOTE|DIV|P)$/.test(node.tagName)) return node;
            node = node.parentNode;
        }
        return null;
    }

    function updateToolbarState() {
        var toolbar = document.querySelector('.article-editor-toolbar');
        if (!toolbar) return;
        var buttons = toolbar.querySelectorAll('button[data-cmd]');
        buttons.forEach(function(btn) {
            var cmd = btn.getAttribute('data-cmd');
            var active = false;
            if (cmd === 'bold') active = document.queryCommandState('bold');
            else if (cmd === 'italic') active = document.queryCommandState('italic');
            else if (cmd === 'underline') active = document.queryCommandState('underline');
            else if (cmd === 'strikeThrough') active = document.queryCommandState('strikeThrough');
            else if (cmd === 'code') {
                var sel = window.getSelection();
                if (sel.rangeCount > 0) {
                    var node = sel.anchorNode;
                    var editor = getEditor();
                    while (node && node !== editor) {
                        if (node.nodeType === 1 && node.tagName === 'CODE') { active = true; break; }
                        node = node.parentNode;
                    }
                }
            }
            else if (cmd === 'insertOrderedList') active = document.queryCommandState('insertOrderedList');
            else if (cmd === 'insertUnorderedList') active = document.queryCommandState('insertUnorderedList');
            else if (cmd === 'h2' || cmd === 'h3') {
                var block = getCurrentBlock();
                active = block && block.tagName === cmd.toUpperCase();
            }
            else if (cmd === 'blockquote') {
                var block = getCurrentBlock();
                active = block && block.tagName === 'BLOCKQUOTE';
            }
            else if (cmd === 'link') {
                var sel = window.getSelection();
                if (sel.rangeCount > 0) {
                    var node = sel.anchorNode;
                    var editor = getEditor();
                    while (node && node !== editor) {
                        if (node.tagName === 'A') { active = true; break; }
                        node = node.parentNode;
                    }
                }
            }
            if (active) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    }

    // Update toolbar state on selection change
    document.addEventListener('selectionchange', function() {
        var editor = getEditor();
        if (editor && editor.contains(document.activeElement) || editor.contains(window.getSelection().anchorNode)) {
            updateToolbarState();
        }
    });

    // Keyboard shortcuts
    getEditor().addEventListener('keydown', function(e) {
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'b' || e.key === 'B') { e.preventDefault(); execCmd('bold'); }
            else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); execCmd('italic'); }
            else if (e.key === 'u' || e.key === 'U') { e.preventDefault(); execCmd('underline'); }
        }
    });

    window.insertLink = function() {
        var sel = window.getSelection();
        var anchor = null;
        if (sel.rangeCount > 0) {
            var node = sel.anchorNode;
            while (node && node !== getEditor()) {
                if (node.tagName === 'A') { anchor = node; break; }
                node = node.parentNode;
            }
        }
        if (anchor) {
            var action = prompt('Current URL: ' + anchor.href + '\n\nEdit URL or clear the field and press OK to remove the link:', anchor.href);
            if (action === null) return; // cancelled
            if (action.trim() === '') {
                // Remove the link, keep the text
                while (anchor.firstChild) anchor.parentNode.insertBefore(anchor.firstChild, anchor);
                anchor.parentNode.removeChild(anchor);
            } else {
                anchor.href = action.trim();
            }
        } else {
            var url = prompt('Enter URL:');
            if (url) {
                document.execCommand('createLink', false, url);
            }
        }
        getEditor().focus();
    };

    // Strip external styling on paste, preserving only allowed formatting and structure
    function setupPaste() {
        getEditor().addEventListener('paste', function(e) {
            e.preventDefault();
            var html = e.clipboardData.getData('text/html');
            var text = e.clipboardData.getData('text/plain');
            if (html) {
                // Parse the HTML and strip styling while preserving structure
                var temp = document.createElement('div');
                temp.innerHTML = html;
                // Remove all style attributes, class attributes, and font/span wrappers
                temp.querySelectorAll('[style]').forEach(function(el) { el.removeAttribute('style'); });
                temp.querySelectorAll('[class]').forEach(function(el) { el.removeAttribute('class'); });
                temp.querySelectorAll('[color]').forEach(function(el) { el.removeAttribute('color'); });
                temp.querySelectorAll('[face]').forEach(function(el) { el.removeAttribute('face'); });
                temp.querySelectorAll('[size]').forEach(function(el) { el.removeAttribute('size'); });
                // Unwrap font and span tags (keep their content)
                temp.querySelectorAll('font, span').forEach(function(el) {
                    while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
                    el.parentNode.removeChild(el);
                });
                // Strip disallowed tags but keep content (everything except b, i, u, a, br, p, div, h1-h3, ol, ul, li, blockquote)
                var allowed = ['B','I','U','A','BR','P','DIV','H1','H2','H3','OL','UL','LI','BLOCKQUOTE'];
                temp.querySelectorAll('*').forEach(function(el) {
                    if (allowed.indexOf(el.tagName) === -1) {
                        while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
                        el.parentNode.removeChild(el);
                    }
                });
                // Remove all remaining attributes except href on <a>
                temp.querySelectorAll('*').forEach(function(el) {
                    var attrs = Array.from(el.attributes);
                    attrs.forEach(function(attr) {
                        if (!(el.tagName === 'A' && attr.name === 'href')) {
                            el.removeAttribute(attr.name);
                        }
                    });
                });
                document.execCommand('insertHTML', false, temp.innerHTML);
            } else if (text) {
                // Plain text paste: double newlines become paragraphs, single become <br>
                var escaped = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                var paragraphs = escaped.split(/\r\n\r\n|\n\n|\r\r/);
                var htmlText;
                if (paragraphs.length > 1) {
                    htmlText = paragraphs.map(function(p) {
                        return '<p>' + p.replace(/\r\n|\r|\n/g, '<br>') + '</p>';
                    }).join('');
                } else {
                    htmlText = escaped.replace(/\r\n|\r|\n/g, '<br>');
                }
                document.execCommand('insertHTML', false, htmlText);
            }
        });
    }

    // Toggle between visual (contenteditable) and HTML source mode
    window.toggleHtmlMode = function() {
        var editor = getEditor();
        if (!htmlTextarea) {
            htmlTextarea = document.createElement('textarea');
            htmlTextarea.className = 'article-content-editor html-source-editor';
            htmlTextarea.placeholder = 'Paste or edit HTML here...';
            editor.parentNode.insertBefore(htmlTextarea, editor.nextSibling);
        }
        var toolbar = document.querySelector('.article-editor-toolbar');
        var counter = document.getElementById('article-char-counter');
        var hint = document.querySelector('.editor-hint');
        if (!htmlMode) {
            // Switch to HTML mode: copy current content into textarea
            htmlTextarea.value = editor.innerHTML;
            editor.style.display = 'none';
            htmlTextarea.style.display = 'block';
            htmlMode = true;
            if (htmlBtn) htmlBtn.classList.add('active');
            // Gray out formatting buttons, hide counter & hint (not applicable in HTML mode)
            if (toolbar) toolbar.classList.add('html-mode');
            if (counter) counter.style.display = 'none';
            if (hint) hint.style.display = 'none';
            htmlTextarea.focus();
        } else {
            // Switch back to visual mode: put textarea content back into editor
            editor.innerHTML = htmlTextarea.value;
            htmlTextarea.style.display = 'none';
            editor.style.display = '';
            htmlMode = false;
            if (htmlBtn) htmlBtn.classList.remove('active');
            // Restore toolbar, counter & hint
            if (toolbar) toolbar.classList.remove('html-mode');
            if (counter) counter.style.display = '';
            if (hint) hint.style.display = '';
            editor.focus();
        }
    };

    function getContent() {
        if (htmlMode && htmlTextarea) {
            return htmlTextarea.value.trim();
        }
        return getEditor().innerHTML.trim();
    }

    function getTextContent() {
        if (htmlMode && htmlTextarea) {
            // Strip tags for the "content required" check
            var div = document.createElement('div');
            div.innerHTML = htmlTextarea.value;
            return div.textContent.trim();
        }
        return getEditor().textContent.trim();
    }

    // Expose these on window so inline scripts (e.g. landing page saveLanding) can call them
    window.getContent = getContent;
    window.getTextContent = getTextContent;

    window.confirmCancel = function() {
        var title = document.getElementById('article-title').value.trim();
        var content = getTextContent();
        if (title || content) {
            return confirm('You have unsaved changes. Discard?');
        }
        return true;
    };

    function hasUnsavedChanges() {
        if (articleSaved) return false;
        var title = document.getElementById('article-title').value.trim();
        var content = getTextContent();
        return !!(title || content);
    }

    // In edit mode, clicking a hyperlink inside the composer should edit the link,
    // not navigate to it. Place the caret in the link so the toolbar link button
    // can edit/remove it. This also prevents the browser from following the link.
    function setupLinkClick() {
        var editor = getEditor();
        editor.addEventListener('click', function(e) {
            var link = e.target.closest && e.target.closest('a');
            if (!link || !editor.contains(link)) return;
            e.preventDefault();
            e.stopPropagation();
            var sel = window.getSelection();
            var range = document.createRange();
            range.selectNodeContents(link);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            editor.focus();
            updateToolbarState();
        }, true);
    }

    function setupUnsavedChanges() {
        window.addEventListener('beforeunload', function(e) {
            if (hasUnsavedChanges()) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
        document.addEventListener('click', function(e) {
            var link = e.target.closest('a');
            if (!link || !link.href) return;
            // Clicks on links inside the composer are handled by setupLinkClick and
            // should not be treated as navigation away from the editor.
            var editor = getEditor();
            if (editor && editor.contains(link)) return;
            if (link.getAttribute('href') === '#') return;
            if (link.onclick && link.getAttribute('onclick') && link.getAttribute('onclick').indexOf('confirmCancel') !== -1) return;
            if (hasUnsavedChanges()) {
                if (!confirm('You have unsaved changes. Discard?')) {
                    e.preventDefault();
                    e.stopPropagation();
                } else {
                    articleSaved = true;
                }
            }
        }, true);
    }

    function setupCounter() {
        var editor = getEditor();
        var counter = document.getElementById('article-char-counter');
        function updateArticleCount() {
            var text = editor.innerText || '';
            var chars = text.length;
            var words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
            counter.textContent = words + ' words \u00b7 ' + chars + ' characters';
        }
        editor.addEventListener('input', updateArticleCount);
        updateArticleCount();
    }

    // New article: POST to /articles
    window.submitArticle = function(status) {
        var title = document.getElementById('article-title').value.trim();
        var content = getContent();
        var dateVal = document.getElementById('article-date').value;
        if (!title) { alert('Title is required.'); return; }
        if (!getTextContent()) { alert('Content is required.'); return; }
        articleSaved = true;
        var btn = event.target;
        btn.textContent = status === 'draft' ? 'Saving...' : 'Publishing...';
        btn.disabled = true;
        var body = { title: title, content: content, status: status };
        if (dateVal) body.date = dateVal;
        fetch('/articles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) window.location.href = '/articles/' + data.id;
            else { articleSaved = false; alert('Failed to save article.'); btn.disabled = false; btn.textContent = status === 'draft' ? 'Save as draft' : 'Publish'; }
        })
        .catch(function() { articleSaved = false; alert('Failed to save article.'); btn.disabled = false; btn.textContent = status === 'draft' ? 'Save as draft' : 'Publish'; });
    };

    // Edit article: PUT to /articles/:id
    window.updateArticle = function(status) {
        var title = document.getElementById('article-title').value.trim();
        var content = getContent();
        var dateVal = document.getElementById('article-date').value;
        if (!title) { alert('Title is required.'); return; }
        if (!getTextContent()) { alert('Content is required.'); return; }
        articleSaved = true;
        var btn = event.target;
        var publishLabel = editorIsDraft ? 'Publishing...' : 'Updating...';
        btn.textContent = status === 'draft' ? 'Saving...' : publishLabel;
        btn.disabled = true;
        var body = { title: title, content: content, status: status };
        if (dateVal) body.date = dateVal;
        fetch('/articles/' + editorArticleId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) window.location.href = '/articles/' + editorArticleId;
            else { articleSaved = false; alert('Failed to update article.'); btn.disabled = false; btn.textContent = editorIsDraft ? 'Publish' : 'Update'; }
        })
        .catch(function() { articleSaved = false; alert('Failed to update article.'); btn.disabled = false; btn.textContent = editorIsDraft ? 'Publish' : 'Update'; });
    };

    // Init: called by the page with { mode: 'new' } or { mode: 'edit', articleId, isDraft }
    window.initArticleEditor = function(options) {
        editorMode = options.mode || 'new';
        editorArticleId = options.articleId || null;
        editorIsDraft = !!options.isDraft;
        htmlBtn = document.getElementById('htmlModeBtn');
        // Safety net: if the HTML button is missing from the DOM, create it
        if (!htmlBtn) {
            var toolbar = document.querySelector('.article-editor-toolbar');
            if (toolbar) {
                htmlBtn = document.createElement('button');
                htmlBtn.type = 'button';
                htmlBtn.id = 'htmlModeBtn';
                htmlBtn.title = 'HTML source mode';
                htmlBtn.innerHTML = '&#60;/&#62;';
                htmlBtn.onclick = function() { toggleHtmlMode(); };
                toolbar.appendChild(htmlBtn);
            }
        }
        if (editorMode === 'edit') {
            wrapBareContent();
        }
        setupKeydown();
        setupPaste();
        setupLinkClick();
        setupUnsavedChanges();
        setupCounter();
    };
})();