const { PIXEL_AVATAR_SVG } = require('./avatar');
const { escapeHtml, formatDate } = require('./html');
const { generateSpamToken } = require('../middleware/rateLimit');

// Renders the full comments section (Discussion header, form, thread, and JS)
// for either an article or a post. targetType is 'article' or 'post'.
function renderCommentsSection({ targetId, targetType, comments, isOwner, ownerName }) {
    const targetField = targetType === 'post' ? 'post_id' : 'article_id';

    // Build threaded comments HTML
    function buildCommentTree(comments, parentId = null, depth = 0) {
        const children = comments.filter(c => c.parent_id === parentId);
        if (children.length === 0) return '';
        let html = '';
        for (const comment of children) {
            const isApproved = comment.approved === 1;
            const fadedClass = !isApproved ? ' comment-pending' : '';
            const approveBtn = (isOwner && !isApproved) ? `<a href="#" class="comment-approve-btn" onclick="approveComment(this, '${comment.id}');return false;">approve</a>` : '';
            const deleteBtn = isOwner ? `<a href="#" class="comment-delete-btn" onclick="deleteComment(this, '${comment.id}');return false;">delete</a>` : '';
            const pendingBadge = (!isApproved && isOwner) ? '<span class="comment-pending-badge">pending</span>' : '';
            const replyBtn = `<a href="#" class="comment-reply-btn" onclick="showReplyForm('${comment.id}');return false;">reply</a>`;
            const connector = depth > 0 ? '<div class="comment-connector"></div>' : '';
            const displayName = comment.is_owner ? (ownerName || comment.author) : comment.author;
            html += `
                <div class="comment-item${fadedClass}" data-id="${comment.id}" data-parent="${comment.parent_id || ''}" style="margin-left:${Math.min(depth, 4) * 24}px;">
                    ${connector}
                    <div class="comment-bubble">
                        <div class="comment-header">
                            <span class="comment-avatar">${PIXEL_AVATAR_SVG}</span>
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
    const hasComments = comments.length > 0;

    return `
        <!-- Comments Section -->
        <div class="comments-section" style="margin-top:40px;">
            ${hasComments ? '' : `
            <div class="no-comments-prompt" id="noCommentsPrompt">
                No comments yet. <a href="#" onclick="showCommentForm();return false;">Be the first to comment.</a>
            </div>
            `}
            <div id="discussionArea" style="${hasComments ? '' : 'display:none;'}">
                <div style="font-size:1.01rem;color:var(--text-muted);margin-bottom:16px;">Discussion</div>
                <div class="comment-form-wrapper" id="mainCommentForm">
                    <div class="comment-form-row">
                        <input type="text" id="commentAuthor" placeholder="Your name" class="comment-author-input" autocomplete="off" ${isOwner && ownerName ? `value="${escapeHtml(ownerName)}" readonly style="opacity:0.6;cursor:default;"` : ''}>
                    </div>
                    <input type="text" id="commentWebsite" autocomplete="off" tabindex="-1" style="position:absolute;left:-9999px;opacity:0;height:0;width:0;">
                    <input type="hidden" id="commentToken" value="${generateSpamToken()}">
                    <div class="comment-form-row">
                        <textarea id="commentContent" placeholder="Write a comment..." class="comment-textarea"></textarea>
                    </div>
                    <div class="char-counter" id="comment-char-counter">0 words &middot; 0 characters</div>
                    ${isOwner ? '' : '<div class="comment-hint" style="font-size:0.7rem;color:var(--text-muted);opacity:0.5;margin-bottom:10px;">Comments cannot be edited after posting.</div>'}
                    <div class="comment-form-row" style="display:flex;gap:15px;align-items:baseline;">
                        <button type="button" class="comment-submit-btn" id="mainSubmitBtn" onclick="submitComment(null)">Post</button>
                        <span class="comment-status" id="commentStatus"></span>
                    </div>
                </div>
                <div class="comments-thread" id="commentsThread">
                    ${commentsHtml}
                </div>
            </div>
        </div>

        <script>
        function showCommentForm() {
            var prompt = document.getElementById('noCommentsPrompt');
            if (prompt) prompt.style.display = 'none';
            var area = document.getElementById('discussionArea');
            if (area) area.style.display = '';
            var box = document.getElementById('commentContent');
            if (box) box.focus();
        }
        // Load saved discuss-as name from localStorage and auto-resize comment textarea
        (function() {
            ${isOwner ? '' : `var saved = localStorage.getItem('scrawl_discuss_as');
            if (saved) {
                var el = document.getElementById('commentAuthor');
                if (el && !el.readOnly) el.value = saved;
            }`}
            var commentBox = document.getElementById('commentContent');
            if (commentBox) {
                function resizeComment() {
                    var s = window.scrollY;
                    commentBox.style.height = 'auto';
                    commentBox.style.height = commentBox.scrollHeight + 'px';
                    window.scrollTo(0, s);
                }
                commentBox.addEventListener('input', resizeComment);

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
            document.getElementById('mainCommentForm').style.display = 'none';
            document.querySelectorAll('.reply-form-container').forEach(function(el) {
                el.style.display = 'none';
                el.innerHTML = '';
            });
            var container = document.getElementById('reply-form-' + parentId);
            var saved = ${isOwner && ownerName ? JSON.stringify(ownerName) : "localStorage.getItem('scrawl_discuss_as') || ''"};
            var readonlyAttr = ${isOwner && ownerName ? "'readonly style=\"opacity:0.6;cursor:default;\"'" : "''"};
            var hint = ${isOwner ? "''" : "'<div style=\"font-size:0.7rem;color:var(--text-muted);opacity:0.5;margin-bottom:10px;\">Comments cannot be edited after posting.</div>'"};
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
            document.getElementById('mainCommentForm').style.display = '';
        }

        function escapeAttr(str) {
            return str.replace(/&/g,'\u0026amp;').replace(/"/g,'\u0026quot;').replace(/</g,'\u0026lt;').replace(/>/g,'\u0026gt;');
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

            ${isOwner ? '' : "localStorage.setItem('scrawl_discuss_as', author);"}

            var originalText = btn.textContent;
            btn.textContent = 'Posting...';
            statusEl.textContent = '';

            fetch('/api/comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ${targetField}: '${targetId}',
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
                    ${isOwner ? `
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

        ${isOwner ? `
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
        </script>
    `;
}

module.exports = { renderCommentsSection };