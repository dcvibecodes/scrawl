const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
let db;

// --- Auth Config ---
const DATA_DIR = path.join(__dirname, 'data');
const HASH_FILE = path.join(DATA_DIR, 'owner.hash');
const SECRET_FILE = path.join(DATA_DIR, 'session.secret');
const BCRYPT_ROUNDS = 12;
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSessionSecret() {
    if (!fs.existsSync(SECRET_FILE)) {
        const secret = crypto.randomBytes(64).toString('hex');
        fs.writeFileSync(SECRET_FILE, secret, 'utf8');
    }
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
}

function isOwnerSetup() {
    return fs.existsSync(HASH_FILE);
}

function getOwnerHash() {
    if (!fs.existsSync(HASH_FILE)) return null;
    return fs.readFileSync(HASH_FILE, 'utf8').trim();
}

function isAuthenticated(req) {
    const token = req.signedCookies && req.signedCookies.session;
    if (!token) return false;
    // Token format: timestamp:hmac
    const parts = token.split(':');
    if (parts.length !== 2) return false;
    const [timestamp, hmac] = parts;
    const age = Date.now() - parseInt(timestamp, 10);
    if (isNaN(age) || age > SESSION_MAX_AGE || age < 0) return false;
    // Verify HMAC
    const expected = crypto.createHmac('sha256', getSessionSecret()).update(timestamp).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'));
}

function createSessionToken() {
    const timestamp = Date.now().toString();
    const hmac = crypto.createHmac('sha256', getSessionSecret()).update(timestamp).digest('hex');
    return timestamp + ':' + hmac;
}

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(getSessionSecret()));
app.use(express.static(path.join(__dirname, 'public')));

// Make auth status available to all route handlers
app.use((req, res, next) => {
    req.isOwner = isAuthenticated(req);
    next();
});

// Auth guard middleware for write operations
function requireOwner(req, res, next) {
    if (!req.isOwner) {
        return res.status(403).send('Forbidden. You must be logged in as the owner.');
    }
    next();
}

// Initialize Database
async function initDatabase() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR);
    }

    db = await open({
        filename: path.join(DATA_DIR, 'microblog.db'),
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        )
    `);

    await db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
            id UNINDEXED,
            content
        )
    `);

    console.log('SQLite Database and FTS5 Search Index ready.');
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function generateId() {
    try {
        return crypto.randomUUID();
    } catch {
        return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
    }
}

function formatDate(timestamp) {
    return new Date(timestamp).toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric'
    });
}

function renderEntries(entries, isOwner) {
    if (entries.length === 0) {
        return '<p class="no-entries">Nothing here yet.</p>';
    }
    return entries.map(entry => {
        const dateStr = formatDate(entry.timestamp);
        const fullDate = new Date(entry.timestamp).toLocaleString();
        const safeContent = escapeHtml(entry.content);

        const ownerActions = isOwner ? `
                    <a href="/edit/${entry.id}" class="edit-link">edit</a>
                    <form action="/delete/${entry.id}" method="POST" style="background:none;padding:0;margin:0;display:inline;" onsubmit="return handleDelete(this)">
                        <button type="submit" class="delete-btn">delete</button>
                    </form>` : '';

        return `
            <div class="entry">
                <div class="date" title="${fullDate}">${dateStr}</div>
                <div class="content">${safeContent}</div>
                <div class="actions">
                    <a href="/post/${entry.id}" class="permalink" title="Permalink">#</a>
                    <span class="copy-link" onclick="copyPermalink(this, '${entry.id}')">copy</span>
                    ${ownerActions}
                </div>
            </div>
        `;
    }).join('');
}

function renderTopFilters(archives, selectedYear, selectedMonth) {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const years = [...new Set(archives.map(a => a.year))].sort((a, b) => b - a);
    const months = ["01","02","03","04","05","06","07","08","09","10","11","12"];

    let yearOptions = '<option value="">All Years</option>';
    years.forEach(y => {
        yearOptions += `<option value="${y}" ${selectedYear === y ? 'selected' : ''}>${y}</option>`;
    });

    let monthOptions = '<option value="">All Months</option>';
    months.forEach(m => {
        const monthName = monthNames[parseInt(m, 10) - 1];
        monthOptions += `<option value="${m}" ${selectedMonth === m ? 'selected' : ''}>${monthName}</option>`;
    });

    let clearLink = '';
    if (selectedYear || selectedMonth) {
        clearLink = '<a href="/" class="clear-search">Clear Filters</a>';
    }

    return `
        <div class="filter-bar">
            <select id="filter-year" aria-label="Filter by Year">${yearOptions}</select>
            <select id="filter-month" aria-label="Filter by Month">${monthOptions}</select>
            <button type="button" onclick="applyFilters()" class="filter-submit-btn">Filter</button>
            ${clearLink}
        </div>
    `;
}


const sharedStyles = `
    * { box-sizing: border-box; }
    html { width: 100%; overflow-x: hidden; }
    :root {
        --bg-body: #ffffff;
        --bg-card: #ffffff;
        --text-main: #333333;
        --text-muted: #666666;
        --separator-color: #eeeeee;
    }
    [data-theme="dark"] {
        --bg-body: #0f0f0f;
        --bg-card: #0f0f0f;
        --text-main: #e5e5e5;
        --text-muted: #999999;
        --separator-color: #1a1a1a;
    }
    html, body { overflow-x: hidden; overscroll-behavior-x: none; width: 100%; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 20px auto; padding: 0 16px; background: var(--bg-body); color: var(--text-main); -webkit-font-smoothing: antialiased; letter-spacing: -0.01em; }
    img, textarea, input, select, button { max-width: 100%; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; padding-bottom: 10px; }
    .header-controls { display: flex; align-items: center; line-height: 1; }
    .theme-toggle { background: none !important; border: none; color: var(--text-muted); text-decoration: none; padding: 0; cursor: pointer; font-size: 0.85rem; font-weight: normal; transition: color 0.2s ease; line-height: 1; }
    .theme-toggle:hover { color: var(--text-main); }
    .container { width: 100%; max-width: 100%; margin-top: 20px; }
    .main-content { width: 100%; max-width: 100%; }
    form, .edit-container, .search-container { background: var(--bg-card); padding: 0; margin-bottom: 30px; max-width: 100%; }
    textarea {
        width: 100%;
        max-width: 100%;
        min-height: 50px;
        padding: 12px 0;
        background: var(--bg-body);
        color: var(--text-main);
        border: none;
        border-bottom: 1px solid var(--separator-color);
        font-family: inherit;
        font-size: 1rem;
        outline: none;
        resize: none;
        overflow-y: hidden;
        display: block;
    }
    input[type="text"], input[type="password"] { width: 100%; max-width: 100%; padding: 12px 0; background: var(--bg-body); color: var(--text-main); border: none; border-bottom: 1px solid var(--separator-color); font-family: inherit; font-size: 1rem; outline: none; }
    .filter-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 30px; padding-bottom: 5px; max-width: 100%; }
    .filter-bar select { background: var(--bg-body); color: var(--text-main); border: 1px solid var(--separator-color); padding: 6px 12px; border-radius: 12px; font-family: inherit; font-size: 0.9rem; outline: none; cursor: pointer; }
    button, .btn, .filter-submit-btn { background: #000000; color: #ffffff; border: none; cursor: pointer; font-weight: bold; text-decoration: none; display: inline-block; transition: opacity 0.2s; }
    button, .btn { padding: 10px 20px; border-radius: 20px; font-size: 0.9rem; margin-top: 15px; }
    .filter-submit-btn { padding: 6px 14px; border-radius: 12px; font-size: 0.85rem; margin-top: 0 !important; }
    button:hover, .btn:hover, .filter-submit-btn:hover { opacity: 0.8; }
    [data-theme="dark"] button, [data-theme="dark"] .btn, [data-theme="dark"] .filter-submit-btn { background: #ffffff; color: #000000; }
    .search-form { display: flex; align-items: center; gap: 8px; width: 100%; }
    .search-form input[type="text"] { flex: 1; min-width: 0; }
    .search-form .search-icon-btn { margin-top: 0; }
    .entry { background: var(--bg-card); padding: 0; padding-bottom: 25px; margin-bottom: 25px; border-bottom: 1px solid var(--separator-color); max-width: 100%; }
    .entry:last-child { border-bottom: none; }
    .date { font-size: 0.75rem; color: var(--text-muted); opacity: 0.75; margin-bottom: 12px; }
    .actions { display: flex; gap: 15px; align-items: baseline; justify-content: flex-end; }
    .content { white-space: pre-wrap; line-height: 1.6; font-size: 1.05rem; margin-bottom: 12px; }
    .edit-link { color: var(--text-muted); text-decoration: none; font-weight: normal; font-size: 0.85rem; transition: color 0.2s ease; }
    .edit-link:hover { color: var(--text-main); }
    .delete-btn { background: none !important; color: #d96b6b; border: none; padding: 0; margin: 0; font-size: 0.85rem; font-weight: normal; cursor: pointer; appearance: none; -webkit-appearance: none; }
    .delete-btn:hover { color: #ff7a7a; }
    [data-theme="dark"] .delete-btn { background: none !important; color: #d96b6b; }
    .cancel-btn { background: none; color: var(--text-muted); margin-left: 15px; font-weight: normal; text-decoration: none; transition: color 0.2s ease; }
    .cancel-btn:hover { color: var(--text-main); text-decoration: underline; }
    .clear-search { font-size: 0.9rem; color: var(--text-muted); text-decoration: none; margin-left: 5px; font-weight: normal; }
    .random-link { color: var(--text-muted); text-decoration: none; font-size: 0.85rem; font-weight: normal; transition: color 0.2s ease; }
    .random-link:hover { color: var(--text-main); }
    .header-separator { color: var(--text-muted); opacity: 0.5; margin: 0 6px; user-select: none; }
    .back-link { color: var(--text-muted); text-decoration: none; font-weight: normal; font-size: 0.9rem; transition: color 0.2s ease; }
    .back-link:hover { color: var(--text-main); }
    .no-entries { text-align: center; color: var(--text-muted); margin-top: 20px; }
    .permalink { color: var(--text-muted); text-decoration: none; font-size: 0.85rem; font-weight: normal; opacity: 0.5; }
    .permalink:hover { opacity: 1; }
    .copy-link { color: var(--text-muted); text-decoration: none; font-size: 0.85rem; font-weight: normal; cursor: pointer; transition: color 0.2s ease; }
    .copy-link:hover { color: var(--text-main); }
    .char-counter { font-size: 0.7rem; color: var(--text-muted); opacity: 0.6; margin-top: 4px; text-align: right; }
    .shortcut-hint { font-size: 0.7rem; color: var(--text-muted); opacity: 0.5; margin-top: 8px; margin-bottom: 10px; }
    .search-icon-btn { background: none !important; border: none !important; padding: 0; margin: 0; color: var(--text-muted); cursor: pointer; opacity: 0.6; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .search-icon-btn svg { width: 18px; height: 18px; display: block; }
    .search-icon-btn:hover { opacity: 1; }
    [data-theme="dark"] .search-icon-btn { background: none !important; color: var(--text-muted); }
    .back-to-top { position: fixed; right: 16px; bottom: 20px; color: var(--text-main); text-decoration: none; font-size: 1.1rem; opacity: 0; transition: opacity 0.2s ease; z-index: 1000; cursor: pointer; user-select: none; }
    .back-to-top.visible { opacity: 0.6; }
    .back-to-top:hover { opacity: 1; }
    .auth-link { color: var(--text-muted); text-decoration: none; font-size: 0.85rem; font-weight: normal; transition: color 0.2s ease; }
    .auth-link:hover { color: var(--text-main); }
    .login-form { margin-bottom: 30px; }
    .login-form input[type="password"] { margin-bottom: 10px; }
    .login-error { color: #d96b6b; font-size: 0.85rem; margin-bottom: 10px; }
    .locked-publish { opacity: 0.4; pointer-events: none; user-select: none; }
    .locked-publish textarea { cursor: not-allowed; }
    .login-prompt { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 20px; }
    .login-prompt a { color: var(--text-muted); text-decoration: underline; }
    .login-prompt a:hover { color: var(--text-main); }
    .setup-container { max-width: 400px; width: 100%; margin: 40px auto; padding: 0 4px; }
    .setup-container h2 { font-size: 1.1rem; margin-bottom: 20px; }
    .setup-container p { font-size: 0.9rem; color: var(--text-muted); margin-bottom: 20px; line-height: 1.5; }
    .password-requirements { font-size: 0.75rem; color: var(--text-muted); margin-top: 5px; opacity: 0.7; }
    @media (max-width: 400px) {
        .header-controls { gap: 0; }
        .header-separator { margin: 0 4px; }
    }
`;

const layoutTemplate = ({ title, bodyContent, isOwner }) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="manifest" href="/manifest.json">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="Microblog">
    <meta name="theme-color" content="#1a1a1a">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
    <style>${sharedStyles}</style>
    <script>(function(){var t=localStorage.getItem('theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');})()</script>
</head>
<body>
    <header>
        <h1><a href="/" style="color:inherit;text-decoration:none;">Microblog</a></h1>
        <div class="header-controls">
            <a href="/random" class="random-link">Random</a>
            <span class="header-separator">&middot;</span>
            ${isOwner
                ? '<a href="/logout" class="auth-link">Logout</a>'
                : '<a href="/login" class="auth-link">Login</a>'
            }
            <span class="header-separator">&middot;</span>
            <a href="#" id="themeToggle" class="theme-toggle">Dark</a>
            <script>(function(){var b=document.getElementById('themeToggle');if(b&&document.documentElement.getAttribute('data-theme')==='dark')b.textContent='Light';})()</script>
        </div>
    </header>
    <div class="container">
        <main class="main-content">${bodyContent}</main>
    </div>
    <a href="#" id="backToTop" class="back-to-top" aria-label="Back to top">&uarr;</a>
    <script>
    (function(){
        // Theme toggle
        var toggleBtn = document.getElementById('themeToggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function(e) {
                e.preventDefault();
                var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
                if (isDark) {
                    document.documentElement.removeAttribute('data-theme');
                    toggleBtn.textContent = 'Dark';
                    localStorage.setItem('theme', 'light');
                } else {
                    document.documentElement.setAttribute('data-theme', 'dark');
                    toggleBtn.textContent = 'Light';
                    localStorage.setItem('theme', 'dark');
                }
            });
        }

        // Copy post text
        window.copyPermalink = function(el, id) {
            var entry = el.closest('.entry');
            var content = entry ? entry.querySelector('.content') : null;
            var text = content ? content.textContent : '';
            navigator.clipboard.writeText(text).then(function() {
                el.textContent = 'copied';
                setTimeout(function() { el.textContent = 'copy'; }, 2000);
            }).catch(function() {
                el.textContent = 'failed';
                setTimeout(function() { el.textContent = 'copy'; }, 2000);
            });
        };

        // Filter navigation
        window.applyFilters = function() {
            var year = document.getElementById('filter-year').value;
            var month = document.getElementById('filter-month').value;
            if (!year && !month) { window.location.href = '/'; return; }
            if (year && month) { window.location.href = '/archive/' + year + '/' + month; }
            else if (year) { window.location.href = '/archive/year/' + year; }
            else if (month) { window.location.href = '/archive/month/' + month; }
        };

        // Textarea auto-resize
        window.attachAutoResize = function(id) {
            var el = document.getElementById(id);
            if (!el) return;
            function resize() {
                el.style.height = 'auto';
                el.style.overflowY = 'hidden';
                el.style.height = el.scrollHeight + 'px';
            }
            el.addEventListener('input', resize);
            el.addEventListener('paste', function() { setTimeout(resize, 0); });
            requestAnimationFrame(resize);
            window.addEventListener('load', resize);
            resize();
        };

        // Publishing button feedback
        var addForms = document.querySelectorAll('form[action="/add"]');
        addForms.forEach(function(form) {
            form.addEventListener('submit', function() {
                var btn = form.querySelector('button[type="submit"]');
                if (btn) { btn.textContent = 'Publishing...'; btn.disabled = true; }
            });
        });

        // Update Post button feedback
        var editForms = document.querySelectorAll('form[action^="/edit/"]');
        editForms.forEach(function(form) {
            form.addEventListener('submit', function() {
                var btn = form.querySelector('button[type="submit"]');
                if (btn) { btn.textContent = 'Updating...'; btn.disabled = true; }
            });
        });

        // Delete handler with feedback
        window.handleDelete = function(form) {
            if (!confirm('Delete this post?')) return false;
            var btn = form.querySelector('.delete-btn');
            if (btn) { btn.textContent = 'deleting...'; btn.disabled = true; }
            var entry = form.closest('.entry');
            if (entry) { entry.style.opacity = '0.5'; entry.style.transition = 'opacity 0.3s ease'; }
            return true;
        };

        // Filter button feedback
        var origApplyFilters = window.applyFilters;
        window.applyFilters = function() {
            var btn = document.querySelector('.filter-submit-btn');
            if (btn) { btn.textContent = 'Filtering...'; btn.disabled = true; }
            origApplyFilters();
        };

        // Search button feedback
        var searchForms = document.querySelectorAll('.search-form');
        searchForms.forEach(function(form) {
            form.addEventListener('submit', function() {
                var btn = form.querySelector('.search-icon-btn');
                if (btn) { btn.style.opacity = '1'; }
            });
        });

        // Back to top
        var backToTop = document.getElementById('backToTop');
        if (backToTop) {
            window.addEventListener('scroll', function() {
                if (window.scrollY > 500) { backToTop.classList.add('visible'); }
                else { backToTop.classList.remove('visible'); }
            });
            backToTop.addEventListener('click', function(e) {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        }

        // Service Worker
        if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js'); }
    })();
    </script>
</body>
</html>
`;

// Helper to get archive list for filter dropdowns
async function getArchives() {
    return await db.all(`
        SELECT strftime('%Y', timestamp / 1000, 'unixepoch') AS year,
            strftime('%m', timestamp / 1000, 'unixepoch') AS month,
               COUNT(*) AS count
        FROM entries
        GROUP BY year, month
        ORDER BY year DESC, month DESC
    `);
}

// --- Auth Routes ---

// Setup route (first-time only)
app.get('/setup', (req, res) => {
    if (isOwnerSetup()) return res.redirect('/');

    const bodyContent = `
        <div class="setup-container">
            <h2>Set Up Your Password</h2>
            <p>This is a one-time setup. Choose a strong password to protect your microblog. You'll need this to publish, edit, and delete posts.</p>
            <form action="/setup" method="POST">
                <input type="password" name="password" placeholder="Choose a password" required minlength="8" autocomplete="new-password">
                <div class="password-requirements">Minimum 8 characters. Use a mix of letters, numbers, and symbols.</div>
                <input type="password" name="confirm" placeholder="Confirm password" required minlength="8" autocomplete="new-password" style="margin-top:10px;">
                <button type="submit">Set Password</button>
            </form>
        </div>
    `;

    res.send(layoutTemplate({ title: 'Setup - Microblog', bodyContent, isOwner: false }));
});

app.post('/setup', async (req, res) => {
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
        return res.send(layoutTemplate({ title: 'Setup - Microblog', bodyContent, isOwner: false }));
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
        return res.send(layoutTemplate({ title: 'Setup - Microblog', bodyContent, isOwner: false }));
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
app.get('/login', (req, res) => {
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
            <p style="margin-top:15px;"><a href="/" class="back-link">&larr; Back to posts</a></p>
        </div>
    `;

    res.send(layoutTemplate({ title: 'Login - Microblog', bodyContent, isOwner: false }));
});

app.post('/login', async (req, res) => {
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
app.get('/logout', (req, res) => {
    res.clearCookie('session');
    res.redirect('/');
});

// --- Main Routes ---

app.get('/', async (req, res) => {
    // Redirect to setup if no owner password exists
    if (!isOwnerSetup()) return res.redirect('/setup');

    try {
        const searchQuery = req.query.q || '';
let entries;
let hasMore = false;

const PAGE_SIZE = 50;
const offset = parseInt(req.query.offset || '0', 10);

const archives = await getArchives();

        if (searchQuery) {
            const formattedQuery = searchQuery.trim() + '*';
            entries = await db.all(`
                SELECT entries.* FROM entries
                JOIN entries_fts ON entries.id = entries_fts.id
                WHERE entries_fts.content MATCH ?
                ORDER BY entries.timestamp DESC
            `, [formattedQuery]);
        } else {
    entries = await db.all(
    'SELECT * FROM entries ORDER BY timestamp DESC LIMIT ? OFFSET ?',
    [PAGE_SIZE, offset]
);

const totalPosts = await db.get(
    'SELECT COUNT(*) AS count FROM entries'
);

hasMore = offset + PAGE_SIZE < totalPosts.count;
}

        const entriesHTML = renderEntries(entries, req.isOwner);
        const topFiltersHTML = renderTopFilters(archives, null, null);

        // Publish box: shown fully for owner, grayed out with login prompt for visitors
        let publishSection;
        if (req.isOwner) {
            publishSection = `
                <form action="/add" method="POST">
                    <textarea
                        id="main-publish-box"
                        name="content"
                        placeholder="Share a thought..."
                        required
                        oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px';"
                    ></textarea>
                    <script>
                    document.addEventListener('DOMContentLoaded', function() {
                        var el = document.getElementById('main-publish-box');
                        if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
                    });
                    </script>
                    <div class="char-counter" id="char-counter">0 words &middot; 0 characters</div>
                    <div class="shortcut-hint">Shortcuts: <kbd>N</kbd> = new post &middot; <kbd>/</kbd> = search</div>
                        <button type="submit">Publish</button>
                    </form>
            `;
        } else {
            publishSection = `
                <div class="locked-publish">
                    <textarea disabled placeholder="Share a thought..." style="cursor:not-allowed;"></textarea>
                </div>
                <p class="login-prompt"><a href="/login">Login</a> to publish, edit, and delete posts.</p>
            `;
        }

        const bodyContent = `
            <div class="search-container">
                <form action="/" method="GET" class="search-form">
                    <input type="text" name="q" id="search-field" placeholder="Fuzzy search" value="${escapeHtml(searchQuery)}">
                    <button type="submit" class="search-icon-btn" aria-label="Search">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="7"></circle>
                            <line x1="16.65" y1="16.65" x2="21" y2="21"></line>
                        </svg>
                    </button>
                    ${searchQuery ? '<a href="/" class="clear-search">Clear</a>' : ''}
                </form>
            </div>

            ${topFiltersHTML}
            ${publishSection}

            <div id="entries">${entriesHTML}</div>
            ${(!searchQuery && hasMore) ? `
            <div style="text-align:center;margin:30px 0;">
                <a href="/?offset=${offset + 50}" class="btn">
                    Load More
                </a>
            </div>
            ` : ''}

            <script>
                var publishBox = document.getElementById('main-publish-box');
                var charCounter = document.getElementById('char-counter');
                if (publishBox && charCounter) {
                    publishBox.addEventListener('input', function() {
                        var text = this.value;
                        var chars = text.length;
                        var words = text.trim() === '' ? 0 : text.trim().split(/\\s+/).length;
                        charCounter.textContent = words + ' words \\u00b7 ' + chars + ' characters';
                    });
                }

                document.addEventListener('keydown', function(e) {
                    var tag = e.target.tagName.toLowerCase();
                    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
                    if (e.key === 'n' || e.key === 'N') {
                        e.preventDefault();
                        var box = document.getElementById('main-publish-box');
                        if (box) box.focus();
                    }
                    if (e.key === '/') {
                        e.preventDefault();
                        var sf = document.getElementById('search-field');
                        if (sf) sf.focus();
                    }
                });
            </script>
        `;

        res.send(layoutTemplate({ title: 'Microblog', bodyContent, isOwner: req.isOwner }));
    } catch (err) {
        console.error(err);
        res.status(500).send('Error rendering page.');
    }
});

app.get('/random', async (req, res) => {
    try {
        const entry = await db.get('SELECT id FROM entries ORDER BY RANDOM() LIMIT 1');
        if (!entry) return res.redirect('/');
        res.redirect('/post/' + entry.id);
    } catch (err) {
        res.status(500).send('Error fetching random post.');
    }
});

app.get('/post/:id', async (req, res) => {
    try {
        const entry = await db.get('SELECT * FROM entries WHERE id = ?', [req.params.id]);
        if (!entry) return res.status(404).send('Post not found.');

        const dateStr = formatDate(entry.timestamp);
        const fullDate = new Date(entry.timestamp).toLocaleString();
        const safeContent = escapeHtml(entry.content);

        const ownerActions = req.isOwner ? `
                    <a href="/edit/${entry.id}" class="edit-link">edit</a>
                    <form action="/delete/${entry.id}" method="POST" style="background:none;padding:0;margin:0;display:inline;" onsubmit="return handleDelete(this)">
                        <button type="submit" class="delete-btn">delete</button>
                    </form>` : '';

        const bodyContent = `
            <div class="entry" style="border-bottom:none;">
                <div class="date" title="${fullDate}">${dateStr}</div>
                <div class="content">${safeContent}</div>
                <div class="actions">
                    <a href="/post/${entry.id}" class="permalink" title="Permalink">#</a>
                    <span class="copy-link" onclick="copyPermalink(this, '${entry.id}')">copy</span>
                    ${ownerActions}
                </div>
            </div>
            <p style="margin-top:30px;"><a href="/" class="back-link">&larr; Back</a></p>
        `;

        res.send(layoutTemplate({ title: 'Post', bodyContent, isOwner: req.isOwner }));
    } catch (err) {
        res.status(500).send('Error fetching post.');
    }
});

app.get('/archive/year/:year', async (req, res) => {
    try {
        const { year } = req.params;
        const archives = await getArchives();
        const entries = await db.all(`
            SELECT * FROM entries
            WHERE strftime('%Y', timestamp / 1000, 'unixepoch') = ?
            ORDER BY timestamp DESC
        `, [year]);

        const entriesHTML = renderEntries(entries, req.isOwner);
        const topFiltersHTML = renderTopFilters(archives, year, null);

        const bodyContent = `
            ${topFiltersHTML}
            <h2 style="margin-top:10px;margin-bottom:25px;font-size:1rem;color:var(--text-muted);font-weight:normal;">
                Showing entries from ${year}
                <a href="/" class="back-link" style="margin-left:15px;">Back to all</a>
            </h2>
            <div id="entries">${entriesHTML}</div>
        `;

        res.send(layoutTemplate({ title: 'Archive - ' + year, bodyContent, isOwner: req.isOwner }));
    } catch (err) {
        res.status(500).send('Error fetching year archive.');
    }
});

app.get('/archive/month/:month', async (req, res) => {
    try {
        const { month } = req.params;
        const archives = await getArchives();
        const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const monthName = monthNames[parseInt(month, 10) - 1] || month;

        const entries = await db.all(`
            SELECT * FROM entries
            WHERE strftime('%m', timestamp / 1000, 'unixepoch') = ?
            ORDER BY timestamp DESC
        `, [month]);

        const entriesHTML = renderEntries(entries, req.isOwner);
        const topFiltersHTML = renderTopFilters(archives, null, month);

        const bodyContent = `
            ${topFiltersHTML}
            <h2 style="margin-top:10px;margin-bottom:25px;font-size:1rem;color:var(--text-muted);font-weight:normal;">
                Showing entries from ${monthName}
                <a href="/" class="back-link" style="margin-left:15px;">Back to all</a>
            </h2>
            <div id="entries">${entriesHTML}</div>
        `;

        res.send(layoutTemplate({ title: 'Archive - ' + monthName, bodyContent, isOwner: req.isOwner }));
    } catch (err) {
        res.status(500).send('Error fetching month archive.');
    }
});

app.get('/archive/:year/:month', async (req, res) => {
    try {
        const { year, month } = req.params;
        const archives = await getArchives();
        const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const monthName = monthNames[parseInt(month, 10) - 1] || month;

        const entries = await db.all(`
            SELECT * FROM entries
            WHERE strftime('%Y', timestamp / 1000, 'unixepoch') = ?
            AND strftime('%m', timestamp / 1000, 'unixepoch') = ?
            ORDER BY timestamp DESC
        `, [year, month]);

        const entriesHTML = renderEntries(entries, req.isOwner);
        const topFiltersHTML = renderTopFilters(archives, year, month);

        const bodyContent = `
            ${topFiltersHTML}
            <h2 style="margin-top:10px;margin-bottom:25px;font-size:1rem;color:var(--text-muted);font-weight:normal;">
                Showing entries from ${monthName} ${year}
                <a href="/" class="back-link" style="margin-left:15px;">Back to all</a>
            </h2>
            <div id="entries">${entriesHTML}</div>
        `;

        res.send(layoutTemplate({ title: 'Archive - ' + monthName + ' ' + year, bodyContent, isOwner: req.isOwner }));
    } catch (err) {
        res.status(500).send('Error fetching archive.');
    }
});

// --- Protected Write Routes ---

app.get('/edit/:id', requireOwner, async (req, res) => {
    try {
        const entry = await db.get('SELECT * FROM entries WHERE id = ?', [req.params.id]);
        if (!entry) return res.status(404).send('Post not found.');

        const bodyContent = `
            <div class="edit-container">
                <form action="/edit/${entry.id}" method="POST" style="margin:0;">
                    <textarea
                        id="edit-box"
                        name="content"
                        required
                        oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px';"
                    >${entry.content}</textarea>
                    <script>
                    document.addEventListener('DOMContentLoaded', function() {
                        var el = document.getElementById('edit-box');
                        if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
                    });
                    </script>
                    <div>
                        <button type="submit">Update Post</button>
                        <a href="/" class="cancel-btn">Cancel</a>
                    </div>
                </form>
            </div>
            <script>attachAutoResize('edit-box');</script>
        `;

        res.send(layoutTemplate({ title: 'Edit Post', bodyContent, isOwner: true }));
    } catch (err) {
        res.status(500).send('Error loading edit page.');
    }
});

app.post('/edit/:id', requireOwner, async (req, res) => {
    try {
        const { content } = req.body;
        await db.run('UPDATE entries SET content = ? WHERE id = ?', [content, req.params.id]);
        await db.run('UPDATE entries_fts SET content = ? WHERE id = ?', [content, req.params.id]);
        res.redirect('/post/' + req.params.id);
    } catch (err) {
        res.status(500).send('Error updating post.');
    }
});

app.post('/add', requireOwner, async (req, res) => {
    try {
        const id = generateId();
        const content = req.body.content;
        const timestamp = Date.now();

        await db.run('INSERT INTO entries (id, content, timestamp) VALUES (?, ?, ?)', [id, content, timestamp]);
        await db.run('INSERT INTO entries_fts (id, content) VALUES (?, ?)', [id, content]);

        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error saving post.');
    }
});

app.post('/delete/:id', requireOwner, async (req, res) => {
    try {
        await db.run('DELETE FROM entries WHERE id = ?', [req.params.id]);
        await db.run('DELETE FROM entries_fts WHERE id = ?', [req.params.id]);
        res.redirect('/');
    } catch (err) {
        res.status(500).send('Error deleting post.');
    }
});

// --- Start Server ---

initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log('Microblog running at http://localhost:' + PORT);
        if (!isOwnerSetup()) {
            console.log('No owner password set. Visit http://localhost:' + PORT + '/setup to configure.');
        }
    });
});
