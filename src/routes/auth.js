const express = require('express');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { layoutTemplate } = require('../templates/layout');
const {
    isOwnerSetup,
    getOwnerHash,
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

// Setup route (first-time only)
router.get('/setup', (req, res) => {
    if (isOwnerSetup()) return res.redirect('/');

    const bodyContent = `
        <div class="setup-container">
            <h2>Set Up Your Password</h2>
            <p>This is a one-time setup. Choose a strong password to protect your site. You'll need this to publish, edit, and delete posts.</p>
            <form action="/setup" method="POST">
                <input type="password" name="password" placeholder="Choose a password" required minlength="8" autocomplete="new-password">
                <div class="password-requirements">Minimum 8 characters. Use a mix of letters, numbers, and symbols.</div>
                <input type="password" name="confirm" placeholder="Confirm password" required minlength="8" autocomplete="new-password" style="margin-top:10px;">
                <button type="submit">Set Password</button>
            </form>
        </div>
    `;

    res.send(layoutTemplate({
    title: 'Setup',
    bodyContent,
    isOwner: false,
    blogTitle: getBlogTitle()
}));
});

router.post('/setup', async (req, res) => {
    if (isOwnerSetup()) return res.redirect('/');

    const { password, confirm } = req.body;

    if (!password || password.length < 8) {
        const bodyContent = `
            <div class="setup-container">
                <h2>Set Up Your Password</h2>
                <p class="login-error">Password must be at least 8 characters.</p>
                <form action="/setup" method="POST">
                    <input type="password" name="password" placeholder="Choose a password" required minlength="8" autocomplete="new-password">
                    <div class="password-requirements">Minimum 8 characters. Use a mix of letters, numbers, and symbols.</div>
                    <input type="password" name="confirm" placeholder="Confirm password" required minlength="8" autocomplete="new-password" style="margin-top:10px;">
                    <button type="submit">Set Password</button>
                </form>
            </div>
        `;
        return res.send(layoutTemplate({
            title: 'Setup',
            bodyContent,
            isOwner: false,
            blogTitle: getBlogTitle()
        }));
    }

    if (password !== confirm) {
        const bodyContent = `
            <div class="setup-container">
                <h2>Set Up Your Password</h2>
                <p class="login-error">Passwords do not match.</p>
                <form action="/setup" method="POST">
                    <input type="password" name="password" placeholder="Choose a password" required minlength="8" autocomplete="new-password">
                    <div class="password-requirements">Minimum 8 characters. Use a mix of letters, numbers, and symbols.</div>
                    <input type="password" name="confirm" placeholder="Confirm password" required minlength="8" autocomplete="new-password" style="margin-top:10px;">
                    <button type="submit">Set Password</button>
                </form>
            </div>
        `;
        return res.send(layoutTemplate({
            title: 'Setup',
            bodyContent,
            isOwner: false,
            blogTitle: getBlogTitle()
        }));
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    fs.writeFileSync(HASH_FILE, hash, 'utf8');

    // Auto-login after setup
    const token = createSessionToken();
    res.cookie('session', token, {
        signed: true,
        httpOnly: true,
        sameSite: 'strict',
        maxAge: SESSION_MAX_AGE
    });

    console.log('Owner password set up successfully.');
    res.redirect('/');
});

// Login
router.get('/login', (req, res) => {
    if (!isOwnerSetup()) return res.redirect('/setup');
    if (req.isOwner) return res.redirect('/');

    const error = req.query.error === '1' ? '<p class="login-error">Incorrect password. Try again.</p>' : '';

    const bodyContent = `
        <div class="setup-container">
            <h2>Owner Login</h2>
            ${error}
            <form action="/login" method="POST" class="login-form">
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

    const { password } = req.body;
    const hash = getOwnerHash();

    if (!password || !hash) return res.redirect('/login?error=1');

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
    saveCopyright(text);
    res.json({ success: true, text });
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

module.exports = router;