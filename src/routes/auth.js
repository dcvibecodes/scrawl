const express = require('express');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { layoutTemplate } = require('../templates/layout');
const {
    isOwnerSetup,
    getOwnerHash,
    getOwnerUser,
    saveOwnerUser,
    isValidUsername,
    normalizeUsername,
    getBlogTitle,
    saveBlogTitle,
    saveCopyright,
    getOwnerName,
    saveOwnerName,
    HASH_FILE,
    BCRYPT_ROUNDS,
    SESSION_MAX_AGE
} = require('../config');
const { createSessionToken, requireOwner } = require('../middleware/auth');
const { sanitizeFooterHtml, escapeHtml } = require('../utils/html');

// Setup route (first-time only)
const setupFormHtml = (errorHtml, prevUsername) => `
        <div class="setup-container">
            <h2>Set Up Your Site</h2>
            <p>This is a one-time setup. Choose a username and a strong password to protect your site. You'll need these to publish, edit, and delete posts.</p>
            ${errorHtml}
            <form action="/setup" method="POST">
                <input type="text" name="username" placeholder="Choose a username" required minlength="3" maxlength="30" pattern="[A-Za-z0-9-]{3,30}" title="3-30 characters: letters, numbers, dashes only" autocomplete="username" value="${escapeHtml(prevUsername || '')}">
                <div class="password-requirements">Username: 3–30 characters — letters, numbers, or dashes (stored lowercase).</div>
                <input type="password" name="password" placeholder="Choose a password" required minlength="8" autocomplete="new-password">
                <div class="password-requirements">Minimum 8 characters. Use a mix of letters, numbers, and symbols.</div>
                <input type="password" name="confirm" placeholder="Confirm password" required minlength="8" autocomplete="new-password" style="margin-top:10px;">
                <button type="submit">Set Up Site</button>
            </form>
        </div>
    `;

router.get('/setup', (req, res) => {
    if (isOwnerSetup()) return res.redirect('/');

    res.send(layoutTemplate({
        title: 'Setup',
        bodyContent: setupFormHtml('', ''),
        isOwner: false,
        blogTitle: getBlogTitle()
    }));
});

router.post('/setup', async (req, res) => {
    if (isOwnerSetup()) return res.redirect('/');

    const { username, password, confirm } = req.body;
    const normalizedUser = normalizeUsername(username);

    const sendError = (errorHtml) => res.send(layoutTemplate({
        title: 'Setup',
        bodyContent: setupFormHtml(errorHtml, normalizedUser),
        isOwner: false,
        blogTitle: getBlogTitle()
    }));

    if (!password || password.length < 8) {
        return sendError('<p class="login-error">Password must be at least 8 characters.</p>');
    }
    if (password !== confirm) {
        return sendError('<p class="login-error">Passwords do not match.</p>');
    }
    if (!isValidUsername(normalizedUser)) {
        return sendError('<p class="login-error">Username must be 3–30 characters using only letters, numbers, or dashes.</p>');
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    fs.writeFileSync(HASH_FILE, hash, 'utf8');
    saveOwnerUser(normalizedUser);

    // Auto-login after setup
    const token = createSessionToken();
    res.cookie('session', token, {
        signed: true,
        httpOnly: true,
        sameSite: 'strict',
        maxAge: SESSION_MAX_AGE
    });

    console.log('Owner account set up successfully.');
    res.redirect('/');
});

// Login
router.get('/login', (req, res) => {
    if (!isOwnerSetup()) return res.redirect('/setup');
    if (req.isOwner) return res.redirect('/');

    const ownerUser = getOwnerUser();
    const hasUsername = !!ownerUser;
    const error = req.query.error === '1'
        ? `<p class="login-error">${hasUsername ? 'Incorrect username or password. Try again.' : 'Incorrect password. Try again.'}</p>`
        : '';

    const bodyContent = `
        <div class="setup-container">
            <h2>Owner Login</h2>
            ${error}
            <form action="/login" method="POST" class="login-form">
                ${hasUsername ? '<input type="text" name="username" placeholder="Username" required autocomplete="username">' : ''}
                <input type="password" name="password" placeholder="Enter your password" required autocomplete="current-password">
                <button type="submit">Login</button>
            </form>
            <p style="margin-top:15px;"><a href="/" class="back-link">&larr; back to posts</a></p>
        </div>
    `;

        res.send(layoutTemplate({
        title: 'Login',
        bodyContent,
        isOwner: false,
        blogTitle: getBlogTitle()
    }));
});

router.post('/login', async (req, res) => {
    if (!isOwnerSetup()) return res.redirect('/setup');

    const { username, password } = req.body;
    const hash = getOwnerHash();
    const expectedUser = getOwnerUser();

    if (!password || !hash) return res.redirect('/login?error=1');
    if (expectedUser && normalizeUsername(username) !== expectedUser) return res.redirect('/login?error=1');

    const match = await bcrypt.compare(password, hash);
    if (!match) return res.redirect('/login?error=1');

    const token = createSessionToken();
    res.cookie('session', token, {
        signed: true,
        httpOnly: true,
        sameSite: 'strict',
        maxAge: SESSION_MAX_AGE
    });

    res.redirect('/');
});

// Logout
router.get('/logout', (req, res) => {
    res.clearCookie('session');
    res.redirect('/');
});

router.post('/api/blog-title', requireOwner, (req, res) => {

    const title = String(req.body.title || '').trim();

    if (!title) {
        return res.status(400).json({
            success: false
        });
    }

    saveBlogTitle(title);

    res.json({
        success: true,
        title
    });
});

router.post('/api/copyright', requireOwner, (req, res) => {
    const text = String(req.body.text || '').trim();
    const sanitized = sanitizeFooterHtml(text);
    saveCopyright(sanitized);
    res.json({ success: true, text: sanitized });
});

router.post('/api/owner-name', requireOwner, (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) {
        return res.status(400).json({ success: false, error: 'Name is required.' });
    }
    saveOwnerName(name);
    res.json({ success: true, name });
});

router.get('/api/owner-name', requireOwner, (req, res) => {
    res.json({ success: true, name: getOwnerName() });
});

// Save username API (owner only)
router.post('/api/owner-user', requireOwner, (req, res) => {
    const normalized = normalizeUsername(req.body.username);
    if (!isValidUsername(normalized)) {
        return res.status(400).json({ success: false, error: 'Use 3–30 characters: letters, numbers, or dashes.' });
    }
    try {
        saveOwnerUser(normalized);
        res.json({ success: true, username: normalized });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

module.exports = router;