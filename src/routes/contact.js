const express = require('express');
const router = express.Router();
const { layoutTemplate } = require('../templates/layout');
const { getDb } = require('../db');
const { getBlogTitle, getSettings } = require('../config');
const { requireOwner } = require('../middleware/auth');
const { checkRateLimit, generateSpamToken, validateSpamToken, RATE_LIMIT_MAX_CONTACT } = require('../middleware/rateLimit');
const { escapeHtml, formatDate, generateId } = require('../utils/html');

// Contact page
router.get('/contact', async (req, res) => {
    try {
        const settings = getSettings();
        if (!settings.contactEnabled) return res.status(404).send('Contact page is disabled.');

        const db = getDb();
        let messagesHTML = '';
        if (req.isOwner) {
            const messages = await db.all('SELECT * FROM messages ORDER BY timestamp DESC');
            if (messages.length > 0) {
                messagesHTML = `
                    <div style="margin-top:40px;border-top:1px solid var(--separator-color);padding-top:30px;">
                        <h2 style="font-size:1rem;color:var(--text-muted);font-weight:normal;margin-bottom:20px;">Messages (<span id="msgCount">${messages.length}</span>)</h2>
                        ${messages.map(msg => `
                            <div class="entry">
                                <div class="date" title="${new Date(msg.timestamp).toLocaleString()}">${formatDate(msg.timestamp)}</div>
                                <div style="margin-bottom:6px;">
                                    <strong style="font-size:0.9rem;">${escapeHtml(msg.name)}</strong>
                                    ${msg.email ? `<span style="font-size:0.8rem;color:var(--text-muted);margin-left:8px;">${escapeHtml(msg.email)}</span>` : ''}
                                </div>
                                ${msg.subject ? `<div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:6px;">${escapeHtml(msg.subject)}</div>` : ''}
                                <div class="content" style="margin-bottom:12px;">${escapeHtml(msg.content)}</div>
                                <div class="actions">
                                    <form action="/contact/${msg.id}/delete" method="POST" style="background:none;padding:0;margin:0;display:inline;" onsubmit="return handleDelete(this)">
                                        <button type="submit" class="delete-btn">delete</button>
                                    </form>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
            } else {
                messagesHTML = `
                    <div style="margin-top:40px;border-top:1px solid var(--separator-color);padding-top:30px;">
                        <h2 style="font-size:1rem;color:var(--text-muted);font-weight:normal;margin-bottom:20px;">Messages</h2>
                        <p class="no-entries">No messages yet.</p>
                    </div>
                `;
            }
        }

        const bodyContent = `
            <h2 style="font-size:1rem;color:var(--text-muted);font-weight:normal;margin-bottom:25px;">Contact</h2>
            <form id="contactForm" action="/contact" method="POST" style="margin:0;">
                <input type="text" name="name" placeholder="Name *" required style="margin-bottom:10px;">
                <input type="text" name="email" placeholder="Email (optional)" style="margin-bottom:10px;">
                <input type="text" name="subject" placeholder="Subject (optional)" style="margin-bottom:10px;">
                <input type="text" name="website_url" autocomplete="off" tabindex="-1" style="position:absolute;left:-9999px;opacity:0;height:0;width:0;">
                <input type="hidden" name="_token" value="${generateSpamToken()}">
                <textarea
                    id="contact-message"
                    name="content"
                    placeholder="Your message *"
                    required
                    style="min-height:100px;"
                    oninput="var s=window.scrollY;this.style.height='auto';this.style.height=this.scrollHeight+'px';window.scrollTo(0,s);"
                ></textarea>
                <div class="publish-row">
                    <button type="submit">Send Message</button>
                </div>
            </form>
            <div id="contactNotification" style="display:none;margin-top:15px;font-size:0.85rem;color:var(--text-muted);"></div>
            ${messagesHTML}
            <script>
            (function() {
                var form = document.getElementById('contactForm');
                var notification = document.getElementById('contactNotification');
                form.addEventListener('submit', function(e) {
                    e.preventDefault();
                    var btn = form.querySelector('button[type="submit"]');
                    btn.textContent = 'Sending...';
                    btn.disabled = true;
                    fetch('/contact', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                        body: JSON.stringify({
                            name: form.name.value.trim(),
                            email: form.email.value.trim(),
                            subject: form.subject.value.trim(),
                            content: form.content.value.trim(),
                            website_url: form.website_url.value,
                            _token: form._token.value
                        })
                    })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            notification.textContent = 'Message sent.';
                            notification.style.display = 'block';
                            form.reset();
                            setTimeout(function() { notification.style.display = 'none'; }, 4000);
                        } else {
                            notification.textContent = data.error || 'Failed to send message.';
                            notification.style.display = 'block';
                        }
                        btn.textContent = 'Send Message';
                        btn.disabled = false;
                    })
                    .catch(function() {
                        notification.textContent = 'Failed to send message.';
                        notification.style.display = 'block';
                        btn.textContent = 'Send Message';
                        btn.disabled = false;
                    });
                });

                // Update message count after deletion
                var msgCount = document.getElementById('msgCount');
                if (msgCount) {
                    var observer = new MutationObserver(function(mutations) {
                        for (var i = 0; i < mutations.length; i++) {
                            if (mutations[i].removedNodes.length > 0) {
                                var remaining = document.querySelectorAll('form[action^="/contact/"][action$="/delete"]').length;
                                observer.disconnect();
                                msgCount.textContent = remaining;
                                observer.observe(document.querySelector('.main-content'), { childList: true, subtree: true });
                                break;
                            }
                        }
                    });
                    observer.observe(document.querySelector('.main-content'), { childList: true, subtree: true });
                }
            })();
            </script>
        `;

        res.send(layoutTemplate({
            title: 'Contact',
            bodyContent,
            isOwner: req.isOwner,
            pendingComments: req.pendingComments || 0,
            pendingMessages: req.pendingMessages || 0,
            blogTitle: getBlogTitle()
        }));
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading contact page.');
    }
});

router.post('/contact', async (req, res) => {
    try {
        const db = getDb();
        // --- Spam Protection ---
        const honeypot = req.body.website_url;
        const spamToken = req.body._token;
        const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest';

        // Honeypot check: if filled, silently reject (pretend success)
        if (honeypot) {
            if (isAjax) return res.json({ success: true });
            return res.redirect('/contact');
        }

        // Time-based check: reject if submitted too fast
        if (!validateSpamToken(spamToken)) {
            if (isAjax) return res.status(400).json({ success: false, error: 'Please wait a moment before submitting.' });
            return res.redirect('/contact');
        }

        // Rate limiting
        const clientIp = req.ip || req.connection.remoteAddress;
        if (!checkRateLimit(clientIp, 'contact', RATE_LIMIT_MAX_CONTACT)) {
            if (isAjax) return res.status(429).json({ success: false, error: 'Too many messages. Please try again later.' });
            return res.redirect('/contact');
        }
        // --- End Spam Protection ---

        let name, email, subject, content;

        if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
            name = req.body.name;
            email = req.body.email;
            subject = req.body.subject;
            content = req.body.content;
        } else {
            name = req.body.name;
            email = req.body.email;
            subject = req.body.subject;
            content = req.body.content;
        }

        if (!name || !name.trim()) {
            if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
                return res.status(400).json({ success: false, error: 'Name is required.' });
            }
            return res.redirect('/contact');
        }

        if (!content || !content.trim()) {
            if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
                return res.status(400).json({ success: false, error: 'Message is required.' });
            }
            return res.redirect('/contact');
        }

        const id = generateId();
        const timestamp = Date.now();

        await db.run(
            'INSERT INTO messages (id, name, email, subject, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
            [id, name.trim(), email ? email.trim() : null, subject ? subject.trim() : null, content.trim(), timestamp]
        );

        if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
            return res.json({ success: true });
        }

        res.redirect('/contact');
    } catch (err) {
        console.error(err);
        if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
            return res.status(500).json({ success: false, error: 'Failed to send message.' });
        }
        res.status(500).send('Error sending message.');
    }
});

router.post('/contact/:id/delete', requireOwner, async (req, res) => {
    try {
        const db = getDb();
        await db.run('DELETE FROM messages WHERE id = ?', [req.params.id]);

        if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
            return res.json({ success: true });
        }

        res.redirect('/contact');
    } catch (err) {
        if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
            return res.status(500).json({ success: false });
        }
        res.status(500).send('Error deleting message.');
    }
});

module.exports = router;