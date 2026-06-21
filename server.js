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
const BLOG_TITLE_FILE = path.join(DATA_DIR, 'blog-title.txt');
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

function getBlogTitle() {
    if (!fs.existsSync(BLOG_TITLE_FILE)) {
        return 'Microblog';
    }

    const title = fs.readFileSync(BLOG_TITLE_FILE, 'utf8').trim();
    return title || 'Microblog';
}

function saveBlogTitle(title) {
    fs.writeFileSync(BLOG_TITLE_FILE, title.trim(), 'utf8');
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

// Backfill: index any entries missing from FTS
const missing = await db.all(`
    SELECT e.id, e.content
    FROM entries e
    LEFT JOIN entries_fts f ON e.id = f.id
    WHERE f.id IS NULL
`);

if (missing.length > 0) {
    const stmt = await db.prepare(`
        INSERT INTO entries_fts (id, content)
        VALUES (?, ?)
    `);

    for (const row of missing) {
        await stmt.run(row.id, row.content);
    }

    await stmt.finalize();
    console.log(`FTS5: Indexed ${missing.length} existing entries.`);
}

const { c: totalEntries } = await db.get(
    'SELECT COUNT(*) as c FROM entries'
);

const { c: ftsEntries } = await db.get(
    'SELECT COUNT(*) as c FROM entries_fts'
);

console.log(
`SQLite Database ready. Entries: ${totalEntries}, FTS indexed: ${ftsEntries}${
        totalEntries === ftsEntries ? ' ✓' : ' ✗ MISMATCH'
    }`
);

} // End initDatabase()

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

        const SNIPPET_LENGTH = 280;
        const isLong = entry.content.length > SNIPPET_LENGTH;

        const snippetContent = isLong
            ? escapeHtml(entry.content.slice(0, SNIPPET_LENGTH)) + '...'
            : safeContent;

        const expandableClass = isLong ? ' expandable-content' : '';

        const ownerActions = isOwner ? `
                    <a href="/edit/${entry.id}" class="edit-link">edit</a>
                    <form action="/delete/${entry.id}" method="POST" style="background:none;padding:0;margin:0;display:inline;" onsubmit="return handleDelete(this)">
                        <button type="submit" class="delete-btn">delete</button>
                    </form>` : '';

        return `
            <div class="entry">
                <div class="date" title="${fullDate}">${dateStr}</div>
                <div class="content${expandableClass}"
                data-expanded="false"
                data-full="${entry.content
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')}">${snippetContent}</div>
                <div class="actions">
                    <a href="/post/${entry.id}" class="permalink" title="Permalink">#</a>
                    <span class="copy-link" onclick="copyPermalink(this, '${entry.id}')">copy</span>
                    ${ownerActions}
                </div>
            </div>
        `;
    }).join('');
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
    header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 30px; padding-bottom: 10px; position: relative; min-height: 44px; }
    .header-controls { display: flex; align-items: center; gap: 0; line-height: 1; }
    .container { width: 100%; max-width: 100%; margin-top: 20px; }
    .main-content { width: 100%; max-width: 100%; }
    form, .edit-container { background: var(--bg-card); padding: 0; margin-bottom: 30px; max-width: 100%; }
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
    textarea::placeholder,
    input::placeholder {
        color: var(--text-muted);
        opacity: 1;
        font-family: inherit;
        font-size: 1rem;
        font-weight: normal;
    }
    button, .btn { background: #000000; color: #ffffff; border: none; cursor: pointer; font-weight: bold; text-decoration: none; display: inline-block; transition: opacity 0.2s; }
    button, .btn { padding: 10px 20px; border-radius: 20px; font-size: 0.9rem; margin-top: 15px; }
    button:hover, .btn:hover { opacity: 0.8; }
    [data-theme="dark"] button, [data-theme="dark"] .btn { background: #ffffff; color: #000000; }
    .entry { background: var(--bg-card); padding: 0; padding-bottom: 25px; margin-bottom: 25px; border-bottom: 1px solid var(--separator-color); max-width: 100%; }
    .entry:last-child { border-bottom: none; }
    .date { font-size: 0.75rem; color: var(--text-muted); opacity: 0.75; margin-bottom: 12px; }
    .actions { display: flex; gap: 15px; align-items: baseline; justify-content: flex-end; }
    .content {
        white-space: pre-wrap;
        line-height: 1.6;
        font-size: 1.05rem;
        margin-bottom: 12px;
    }
    .expandable-content { cursor: pointer; }
    .edit-link { color: var(--text-muted); text-decoration: none; font-weight: normal; font-size: 0.85rem; transition: color 0.2s ease; }
    .edit-link:hover { color: var(--text-main); }
    .delete-btn { background: none !important; color: #d96b6b; border: none; padding: 0; margin: 0; font-size: 0.85rem; font-weight: normal; cursor: pointer; appearance: none; -webkit-appearance: none; }
    .delete-btn:hover { color: #ff7a7a; }
    [data-theme="dark"] .delete-btn { background: none !important; color: #d96b6b; }
    .random-link { color: var(--text-muted); text-decoration: none; font-size: 0.85rem; font-weight: normal; transition: color 0.2s ease; }
    .random-link:hover { color: var(--text-main); }
    .header-separator { color: var(--text-muted); opacity: 0.5; margin: 0 6px; user-select: none; }
    .back-link { color: var(--text-muted); text-decoration: none; font-weight: normal; font-size: 0.85rem; transition: color 0.2s ease; }
    .back-link:hover { color: var(--text-main); }
    .no-entries { text-align: center; color: var(--text-muted); margin-top: 20px; }
    .permalink { color: var(--text-muted); text-decoration: none; font-size: 0.85rem; font-weight: normal; opacity: 0.5; }
    .permalink:hover { opacity: 1; }
    .copy-link { color: var(--text-muted); text-decoration: none; font-size: 0.85rem; font-weight: normal; cursor: pointer; transition: color 0.2s ease; }
    .copy-link:hover { color: var(--text-main); }
    .char-counter { font-size: 0.7rem; color: var(--text-muted); opacity: 0.6; margin-top: 4px; text-align: right; }
    .shortcut-hint { font-size: 0.7rem; color: var(--text-muted); opacity: 0.5; margin-top: 8px; margin-bottom: 10px; }
    @media (max-width: 500px) {
        .shortcut-hint { display: none; }
    }
    .search-icon-btn { background: none !important; border: none !important; padding: 0; margin: 0; color: var(--text-muted); cursor: pointer; opacity: 0.6; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .search-icon-btn svg { width: 18px; height: 18px; display: block; }
    .search-icon-btn:hover { opacity: 1; }
    [data-theme="dark"] .search-icon-btn { background: none !important; color: var(--text-muted); }
    .publish-row { margin-top: 15px; }
    .inline-search { display: flex; align-items: center; }
    .inline-search .search-icon-btn { flex-shrink: 0; }
    .search-bar-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: var(--bg-body); display: flex; align-items: center; gap: 8px; padding-right: 4px; opacity: 0; pointer-events: none; transition: opacity 0.25s ease; z-index: 10; }
    .search-bar-overlay.open { opacity: 1; pointer-events: auto; }
    .search-bar-overlay input[type="text"] { flex: 1; padding: 6px 0; font-size: 1rem; border: none; border-bottom: 1px solid var(--separator-color); background: transparent; color: var(--text-main); outline: none; font-family: inherit; }
    .search-bar-overlay input[type="text"]::placeholder { color: var(--text-muted); opacity: 0.7; font-size: 1rem; }
    .search-bar-overlay .search-bar-close { background: none !important; border: none; padding: 0; margin: 0; color: var(--text-muted); cursor: pointer; font-size: 1.2rem; line-height: 1; opacity: 0.6; flex-shrink: 0; }
    .search-bar-overlay .search-bar-close:hover { opacity: 1; }
    [data-theme="dark"] .search-bar-overlay .search-bar-close { background: none !important; color: var(--text-muted); }
    .mobile-random-btn { display: none; color: var(--text-muted); opacity: 0.6; line-height: 1; }
    .mobile-random-btn:hover { opacity: 1; }
    .mobile-random-btn svg { width: 16px; height: 16px; display: block; }
    .hamburger-btn { display: none; background: none !important; border: none; padding: 0; margin: 0; cursor: pointer; color: var(--text-muted); opacity: 0.7; line-height: 1; }
    .hamburger-btn:hover { opacity: 1; }
    .hamburger-btn svg { width: 20px; height: 20px; display: block; }
    [data-theme="dark"] .hamburger-btn { background: none !important; color: var(--text-muted); }
    .gear-wrapper { position: relative; display: inline-flex; align-items: center; }
    .gear-btn { background: none !important; border: none; padding: 0; margin: 0; cursor: pointer; color: var(--text-muted); opacity: 0.6; display: flex; align-items: center; justify-content: center; line-height: 1; }
    .gear-btn:hover { opacity: 1; }
    .gear-btn svg { width: 16px; height: 16px; display: block; }
    [data-theme="dark"] .gear-btn { background: none !important; color: var(--text-muted); }
    .gear-dropdown { display: none; position: absolute; top: calc(100% + 10px); right: 0; background: var(--bg-body); border: 1px solid var(--separator-color); border-radius: 8px; padding: 6px 0; min-width: 120px; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .gear-dropdown.open { display: block; }
    .gear-dropdown a { display: block; padding: 8px 16px; color: var(--text-main); text-decoration: none; font-size: 0.85rem; }
    .gear-dropdown a:hover { background: var(--separator-color); }
    [data-theme="dark"] .gear-dropdown { box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
    .mobile-menu { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: var(--bg-body); z-index: 3000; padding: 30px 24px; }
    .mobile-menu.open { display: flex; flex-direction: column; }
    .mobile-menu-close { background: none !important; border: none; padding: 0; color: var(--text-muted); cursor: pointer; font-size: 1.6rem; line-height: 1; align-self: flex-end; opacity: 0.6; margin-bottom: 30px; }
    .mobile-menu-close:hover { opacity: 1; }
    [data-theme="dark"] .mobile-menu-close { background: none !important; color: var(--text-muted); }
    .mobile-menu a { display: block; color: var(--text-main); text-decoration: none; font-size: 0.9rem; padding: 12px 0; border-bottom: 1px solid var(--separator-color); }
    .mobile-menu a:last-child { border-bottom: none; }
    .mobile-menu a:hover { color: var(--text-muted); }
    .back-to-top { position: fixed; right: 32px; bottom: 28px; color: var(--text-main); text-decoration: none; font-size: 1.1rem; opacity: 0; transition: opacity 0.2s ease; z-index: 1000; cursor: pointer; user-select: none; }
    .back-to-top.visible { opacity: 0.6; }
    .back-to-top:hover { opacity: 1; }
    .auth-link { color: var(--text-muted); text-decoration: none; font-size: 0.85rem; font-weight: normal; transition: color 0.2s ease; }
    .auth-link:hover { color: var(--text-main); }
    .login-form { margin-bottom: 30px; }
    .login-form input[type="password"] { margin-bottom: 10px; }
    .login-error { color: #d96b6b; font-size: 0.85rem; margin-bottom: 10px; }
    .login-prompt { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 30px; }
    .login-prompt a { color: var(--text-muted); text-decoration: underline; }
    .login-prompt a:hover { color: var(--text-main); }
    .setup-container { max-width: 100%; width: 100%; margin: 40px auto; padding: 0; }
    .setup-container h2 { font-size: 1rem; margin-bottom: 20px; font-weight: normal; color: var(--text-muted); }
    .setup-container p { font-size: 0.9rem; color: var(--text-muted); margin-bottom: 20px; line-height: 1.5; }
    .password-requirements { font-size: 0.75rem; color: var(--text-muted); margin-top: 5px; opacity: 0.7; }
    .desktop-nav { display: flex; align-items: center; gap: 0; }
    @media (max-width: 500px) {
        .desktop-nav { display: none; }
        .hamburger-btn { display: block; }
        .mobile-random-btn { display: block; }
        .gear-wrapper { display: none; }
        .inline-search .header-separator { display: none; }
        .header-controls { gap: 14px; }
    }
`;

const layoutTemplate = ({ title, bodyContent, isOwner, blogTitle, searchQuery }) =>  `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>${title}</title>
    <link rel="manifest" href="/manifest.json">
    <link rel="alternate" type="application/json" href="/api/posts" title="All posts (JSON)">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="${escapeHtml(blogTitle)}">
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
        <div>
            <h1 style="margin-bottom:4px;">
                <a href="/" id="blogTitle" style="color:inherit;text-decoration:none;">
                    ${escapeHtml(blogTitle)}
                </a>
            </h1>
        </div>
        <div class="header-controls">
            <div class="desktop-nav">
                <a href="/all" class="random-link">all</a>
                <span class="header-separator">&middot;</span>
                <a href="/archive" class="random-link">archive</a>
                <span class="header-separator">&middot;</span>
                <a href="/random" class="random-link">random</a>
            </div>
            <a href="/random" class="mobile-random-btn" aria-label="Random">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="16 3 21 3 21 8"></polyline>
                    <line x1="4" y1="20" x2="21" y2="3"></line>
                    <polyline points="21 16 21 21 16 21"></polyline>
                    <line x1="15" y1="15" x2="21" y2="21"></line>
                    <line x1="4" y1="4" x2="9" y2="9"></line>
                </svg>
            </a>
            <span class="inline-search" id="headerInlineSearch" style="margin:0;padding:0;">
                <span class="header-separator">&middot;</span>
                <button type="button" class="search-icon-btn" id="searchOpenBtn" aria-label="Search" style="margin-top:0;">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="7"></circle>
                        <line x1="16.65" y1="16.65" x2="21" y2="21"></line>
                    </svg>
                </button>
            </span>
            ${isOwner ? `
            <span class="gear-wrapper" style="margin:0;padding:0;">
                <span class="header-separator">&middot;</span>
                <button type="button" class="gear-btn" id="gearBtn" aria-label="Settings" style="margin-top:0;">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                </button>
                <div class="gear-dropdown" id="gearDropdown">
                    <a href="#" id="editBlogTitle">edit title</a>
                    <a href="#" id="themeToggle">dark</a>
                    <a href="/logout">logout</a>
                </div>
            </span>
            ` : `
            <span class="gear-wrapper" style="margin:0;padding:0;">
                <span class="header-separator">&middot;</span>
                <button type="button" class="gear-btn" id="gearBtn" aria-label="Settings" style="margin-top:0;">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                </button>
                <div class="gear-dropdown" id="gearDropdown">
                    <a href="#" id="themeToggle">dark</a>
                    <a href="/login">login</a>
                </div>
            </span>
            `}
            <button type="button" class="hamburger-btn" id="hamburgerBtn" aria-label="Menu">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="3" y1="6" x2="21" y2="6"></line>
                    <line x1="3" y1="12" x2="21" y2="12"></line>
                    <line x1="3" y1="18" x2="21" y2="18"></line>
                </svg>
            </button>
        </div>
        <div class="search-bar-overlay" id="searchBarOverlay">
            <input type="text" id="search-field" placeholder="Search posts..." value="${escapeHtml(searchQuery || '')}" autocomplete="off">
            <button type="button" class="search-bar-close" id="searchCloseBtn">&times;</button>
        </div>
    </header>

    <!-- Mobile menu overlay -->
    <div class="mobile-menu" id="mobileMenu">
        <button type="button" class="mobile-menu-close" id="mobileMenuClose">&times;</button>
        <a href="/all">all</a>
        <a href="/archive">archive</a>
        ${isOwner
            ? '<a href="#" id="mobileEditTitle">edit title</a><a href="#" id="mobileThemeToggle">dark</a><a href="/logout">logout</a>'
            : '<a href="#" id="mobileThemeToggle">dark</a><a href="/login">login</a>'
        }
    </div>

    <div class="container">
        <main class="main-content">${bodyContent}</main>
    </div>
    <a href="#" id="backToTop" class="back-to-top" aria-label="Back to top">&uarr;</a>
    <script>
    (function(){
        // Mobile menu
        var hamburger = document.getElementById('hamburgerBtn');
        var mobileMenu = document.getElementById('mobileMenu');
        var mobileMenuClose = document.getElementById('mobileMenuClose');
        if (hamburger) {
            hamburger.addEventListener('click', function() { mobileMenu.classList.add('open'); });
        }
        if (mobileMenuClose) {
            mobileMenuClose.addEventListener('click', function() { mobileMenu.classList.remove('open'); });
        }
        var mobileTheme = document.getElementById('mobileThemeToggle');
        if (mobileTheme) {
            if (document.documentElement.getAttribute('data-theme') === 'dark') mobileTheme.textContent = 'light';
            mobileTheme.addEventListener('click', function(e) {
                e.preventDefault();
                var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
                if (isDark) {
                    document.documentElement.removeAttribute('data-theme');
                    mobileTheme.textContent = 'dark';
                    localStorage.setItem('theme', 'light');
                } else {
                    document.documentElement.setAttribute('data-theme', 'dark');
                    mobileTheme.textContent = 'light';
                    localStorage.setItem('theme', 'dark');
                }
                mobileMenu.classList.remove('open');
            });
        }

        // Search bar
        var searchOpenBtn = document.getElementById('searchOpenBtn');
        var searchCloseBtn = document.getElementById('searchCloseBtn');
        var searchBarOverlay = document.getElementById('searchBarOverlay');
        var searchField = document.getElementById('search-field');

        function openSearch() {
            searchBarOverlay.classList.add('open');
            setTimeout(function() { searchField.focus(); }, 100);
        }

        function closeSearch() {
            if (searchField.value) {
                window.location.href = '/';
                return;
            }
            searchBarOverlay.classList.remove('open');
        }

        if (searchOpenBtn) searchOpenBtn.addEventListener('click', openSearch);
        if (searchCloseBtn) searchCloseBtn.addEventListener('click', closeSearch);

        // Submit search on Enter
        if (searchField) {
            searchField.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var q = searchField.value.trim();
                    if (q) window.location.href = '/?q=' + encodeURIComponent(q);
                }
                if (e.key === 'Escape') {
                    closeSearch();
                }
            });
        }

        // Auto-open if there's an active search query
        if (searchField && searchField.value) {
            openSearch();
        }

        // Gear dropdown
        var gearBtn = document.getElementById('gearBtn');
        var gearDropdown = document.getElementById('gearDropdown');
        if (gearBtn) {
            gearBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                gearDropdown.classList.toggle('open');
            });
            document.addEventListener('click', function(e) {
                if (gearDropdown && !gearDropdown.contains(e.target) && e.target !== gearBtn) {
                    gearDropdown.classList.remove('open');
                }
            });
        }

        // Theme toggle (desktop dropdown + mobile menu)
        var toggleBtn = document.getElementById('themeToggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function(e) {
                e.preventDefault();
                var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
                if (isDark) {
                    document.documentElement.removeAttribute('data-theme');
                    toggleBtn.textContent = 'dark';
                    localStorage.setItem('theme', 'light');
                } else {
                    document.documentElement.setAttribute('data-theme', 'dark');
                    toggleBtn.textContent = 'light';
                    localStorage.setItem('theme', 'dark');
                }
                if (gearDropdown) gearDropdown.classList.remove('open');
            });
            // Set initial text
            if (document.documentElement.getAttribute('data-theme') === 'dark') toggleBtn.textContent = 'light';
        }

        // Copy post text
        window.copyPermalink = function(el, id) {
            var entry = el.closest('.entry');
            var content = entry ? entry.querySelector('.content') : null;
            var text = '';
            if (content) { text = content.dataset.full || content.textContent; }
            navigator.clipboard.writeText(text).then(function() {
                el.textContent = 'copied';
                setTimeout(function() { el.textContent = 'copy'; }, 2000);
            }).catch(function() {
                el.textContent = 'failed';
                setTimeout(function() { el.textContent = 'copy'; }, 2000);
            });
        };

        // Textarea auto-resize
        window.attachAutoResize = function(id) {
            var el = document.getElementById(id);
            if (!el) return;
            function resize() { var s = window.scrollY; el.style.height = 'auto'; el.style.overflowY = 'hidden'; el.style.height = el.scrollHeight + 'px'; window.scrollTo(0, s); }
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

        // Update Post link feedback
        var editForms = document.querySelectorAll('form[action^="/edit/"]');
        editForms.forEach(function(form) {
            form.addEventListener('submit', function() {
                var link = form.querySelector('#updatePostLink');
                if (link) { link.textContent = 'updating...'; link.style.pointerEvents = 'none'; }
            });
        });

        // Delete handler
        window.handleDelete = function(form) {
            var btn = form.querySelector('.delete-btn');
            // If already confirming, proceed with delete
            if (btn && btn.dataset.confirming === 'true') {
                btn.textContent = 'deleting...';
                btn.disabled = true;
                var entry = form.closest('.entry');
                fetch(form.action, { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                .then(function(response) {
                    if (!response.ok) throw new Error('Delete failed');
                    if (entry) {
                        entry.style.transition = 'opacity 0.2s ease, max-height 0.2s ease, margin 0.2s ease, padding 0.2s ease';
                        entry.style.opacity = '0';
                        setTimeout(function() { entry.style.maxHeight = '0'; entry.style.marginBottom = '0'; entry.style.paddingBottom = '0'; entry.style.overflow = 'hidden'; }, 50);
                        setTimeout(function() { entry.remove(); }, 250);
                    }
                })
                .catch(function() {
                    if (btn) { btn.textContent = 'delete'; btn.disabled = false; btn.dataset.confirming = ''; }
                    alert('Failed to delete post.');
                });
                return false;
            }
            // First click: show "confirm?" text
            if (btn) {
                btn.textContent = 'confirm?';
                btn.dataset.confirming = 'true';
                // Reset after 3 seconds if not confirmed
                setTimeout(function() {
                    if (btn.dataset.confirming === 'true') {
                        btn.textContent = 'delete';
                        btn.dataset.confirming = '';
                    }
                }, 3000);
            }
            return false;
        };

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

        // Expand truncated posts
        document.querySelectorAll('.expandable-content').forEach(function(el) {
            el.addEventListener('click', function() {
                if (el.dataset.expanded === 'true') return;
                el.textContent = el.dataset.full;
                el.dataset.expanded = 'true';
                el.style.cursor = 'default';
            });
        });

        // Global keyboard shortcut: / to open search
        document.addEventListener('keydown', function(e) {
            var tag = e.target.tagName.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
            if (e.key === '/') {
                e.preventDefault();
                openSearch();
            }
        });

        if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js'); }

        // Blog title edit
        var blogTitle = document.getElementById('blogTitle');
        var editBlogTitle = document.getElementById('editBlogTitle');
        var mobileEditTitle = document.getElementById('mobileEditTitle');

        function doEditTitle() {
            var currentTitle = blogTitle.textContent.trim();
            var newTitle = prompt('Blog title:', currentTitle);
            if (newTitle === null || newTitle.trim() === '' || newTitle === currentTitle) return;
            fetch('/api/blog-title', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle.trim() })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.success) throw new Error();
                blogTitle.textContent = data.title;
                document.title = data.title;
            })
            .catch(function() { alert('Failed to save title'); });
        }

        if (editBlogTitle) {
            editBlogTitle.addEventListener('click', function(e) {
                e.preventDefault();
                if (gearDropdown) gearDropdown.classList.remove('open');
                doEditTitle();
            });
        }
        if (mobileEditTitle) {
            mobileEditTitle.addEventListener('click', function(e) {
                e.preventDefault();
                mobileMenu.classList.remove('open');
                doEditTitle();
            });
        }
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

    res.send(layoutTemplate({
    title: 'Setup - Microblog',
    bodyContent,
    isOwner: false,
    blogTitle: getBlogTitle()
}));
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
        return res.send(layoutTemplate({
            title: 'Setup - Microblog',
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
            title: 'Setup - Microblog',
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
            <p style="margin-top:15px;"><a href="/" class="back-link">&larr; back to posts</a></p>
        </div>
    `;

        res.send(layoutTemplate({
        title: 'Login - Microblog',
        bodyContent,
        isOwner: false,
        blogTitle: getBlogTitle()
    }));
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

app.post('/api/blog-title', requireOwner, (req, res) => {

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

        if (searchQuery) {
            // Sanitize: remove FTS5 special characters, split into words
            const words = searchQuery.trim()
                .replace(/["""*\-+(){}[\]^~:]/g, '')
                .split(/\s+/)
                .filter(w => w.length > 0);

            if (words.length === 0) {
                entries = [];
            } else {
                // Each word gets a prefix wildcard, joined with AND
                const formattedQuery = words.map(w => '"' + w.replace(/"/g, '') + '"*').join(' AND ');
                entries = await db.all(`
                    SELECT entries.*
                    FROM entries
                    JOIN entries_fts ON entries.id = entries_fts.id
                    WHERE entries_fts.content MATCH ?
                    ORDER BY entries_fts.rank
                `, [formattedQuery]);
            }
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

        // Publish box: shown fully for owner, search icon next to publish. Logged out: just login prompt.
        let publishSection;
        if (req.isOwner) {
            publishSection = `
                <form action="/add" method="POST">
                    <textarea
                        id="main-publish-box"
                        name="content"
                        placeholder="Post a thought..."
                        required
                        oninput="var s=window.scrollY;this.style.height='auto';this.style.height=this.scrollHeight+'px';window.scrollTo(0,s);"
                    ></textarea>
                    <script>
                    document.addEventListener('DOMContentLoaded', function() {
                        var el = document.getElementById('main-publish-box');
                        if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
                    });
                    </script>
                    <div class="char-counter" id="char-counter">0 words &middot; 0 characters</div>
                    <div class="shortcut-hint">Shortcuts: <kbd>N</kbd> = new post &middot; <kbd>/</kbd> = search</div>
                    <div class="publish-row">
                        <button type="submit">Publish</button>
                    </div>
                </form>
            `;
        } else {
            publishSection = `
                <p class="login-prompt"><a href="/login">Login</a> to publish, edit, and delete posts.</p>
            `;
        }

        const bodyContent = `
            ${publishSection}
            ${searchQuery ? `<p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:20px;">${entries.length} result${entries.length !== 1 ? 's' : ''} for "${escapeHtml(searchQuery)}"</p>` : ''}
            <div id="entries">${searchQuery && entries.length === 0 ? '' : entriesHTML}</div>
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
                });
            </script>
        `;

        res.send(layoutTemplate({
            title: getBlogTitle(),
            bodyContent,
            isOwner: req.isOwner,
            blogTitle: getBlogTitle(),
            searchQuery
        }));
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
            <p style="margin-top:30px;"><a href="/" class="back-link">&larr; back</a></p>
        `;

        res.send(layoutTemplate({
            title: 'Post',
            bodyContent,
            isOwner: req.isOwner,
            blogTitle: getBlogTitle()
        }));
    } catch (err) {
        res.status(500).send('Error fetching post.');
    }
});

app.get('/archive/year/:year', async (req, res) => {
    try {
        const { year } = req.params;
        const entries = await db.all(`
            SELECT * FROM entries
            WHERE strftime('%Y', timestamp / 1000, 'unixepoch') = ?
            ORDER BY timestamp DESC
        `, [year]);

        const entriesHTML = renderEntries(entries, req.isOwner);

        const bodyContent = `
            <h2 style="margin-top:10px;margin-bottom:25px;font-size:1rem;color:var(--text-muted);font-weight:normal;">
                Showing entries from ${year}
                <a href="/archive" class="back-link" style="margin-left:15px;">back to archive</a>
            </h2>
            <div id="entries">${entriesHTML}</div>
        `;

        res.send(layoutTemplate({
            title: 'Archive - ' + year,
            bodyContent,
            isOwner: req.isOwner,
            blogTitle: getBlogTitle()
        }));
    } catch (err) {
        res.status(500).send('Error fetching year archive.');
    }
});

app.get('/archive/month/:month', async (req, res) => {
    try {
        const { month } = req.params;
        const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const monthName = monthNames[parseInt(month, 10) - 1] || month;

        const entries = await db.all(`
            SELECT * FROM entries
            WHERE strftime('%m', timestamp / 1000, 'unixepoch') = ?
            ORDER BY timestamp DESC
        `, [month]);

        const entriesHTML = renderEntries(entries, req.isOwner);

        const bodyContent = `
            <h2 style="margin-top:10px;margin-bottom:25px;font-size:1rem;color:var(--text-muted);font-weight:normal;">
                Showing entries from ${monthName}
                <a href="/archive" class="back-link" style="margin-left:15px;">back to archive</a>
            </h2>
            <div id="entries">${entriesHTML}</div>
        `;

        res.send(layoutTemplate({
            title: 'Archive - ' + monthName,
            bodyContent,
            isOwner: req.isOwner,
            blogTitle: getBlogTitle()
        }));
    } catch (err) {
        res.status(500).send('Error fetching month archive.');
    }
});

app.get('/archive/:year/:month', async (req, res) => {
    try {
        const { year, month } = req.params;
        const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const monthName = monthNames[parseInt(month, 10) - 1] || month;

        const entries = await db.all(`
            SELECT * FROM entries
            WHERE strftime('%Y', timestamp / 1000, 'unixepoch') = ?
            AND strftime('%m', timestamp / 1000, 'unixepoch') = ?
            ORDER BY timestamp DESC
        `, [year, month]);

        const entriesHTML = renderEntries(entries, req.isOwner);

        const bodyContent = `
            <h2 style="margin-top:10px;margin-bottom:25px;font-size:1rem;color:var(--text-muted);font-weight:normal;">
                Showing entries from ${monthName} ${year}
                <a href="/archive" class="back-link" style="margin-left:15px;">back to archive</a>
            </h2>
            <div id="entries">${entriesHTML}</div>
        `;

        res.send(layoutTemplate({
            title: 'Archive - ' + monthName + ' ' + year,
            bodyContent,
            isOwner: req.isOwner,
            blogTitle: getBlogTitle()
        }));
    } catch (err) {
        res.status(500).send('Error fetching archive.');
    }
});

// --- Sitemap ---

app.get('/sitemap.xml', async (req, res) => {
    try {
        const entries = await db.all('SELECT id, timestamp FROM entries ORDER BY timestamp DESC');
        const host = `${req.protocol}://${req.get('host')}`;

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `  <url>\n    <loc>${host}/</loc>\n    <changefreq>daily</changefreq>\n  </url>\n`;
        xml += `  <url>\n    <loc>${host}/all</loc>\n    <changefreq>daily</changefreq>\n  </url>\n`;
        xml += `  <url>\n    <loc>${host}/archive</loc>\n    <changefreq>weekly</changefreq>\n  </url>\n`;
        xml += `  <url>\n    <loc>${host}/api/posts</loc>\n    <changefreq>daily</changefreq>\n  </url>\n`;

        for (const entry of entries) {
            const lastmod = new Date(entry.timestamp).toISOString().split('T')[0];
            xml += `  <url>\n    <loc>${host}/post/${entry.id}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>\n`;
        }

        xml += '</urlset>';
        res.type('application/xml').send(xml);
    } catch (err) {
        res.status(500).send('Error generating sitemap.');
    }
});

// --- Archive Index ---

app.get('/archive', async (req, res) => {
    try {
        const archives = await getArchives();
        const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

        let archiveHTML = '';
        let currentYear = null;

        for (const a of archives) {
            if (a.year !== currentYear) {
                if (currentYear !== null) archiveHTML += '</div>';
                currentYear = a.year;
                archiveHTML += `<div style="margin-bottom:25px;">
                    <h2 style="font-size:1.1rem;margin-bottom:10px;font-weight:600;">${a.year}</h2>`;
            }
            const monthName = monthNames[parseInt(a.month, 10) - 1];
            archiveHTML += `<div style="margin-bottom:6px;">
                <a href="/archive/${a.year}/${a.month}" class="back-link" style="font-size:0.95rem;">${monthName}</a>
                <span style="color:var(--text-muted);font-size:0.8rem;margin-left:8px;">(${a.count} post${a.count !== 1 ? 's' : ''})</span>
            </div>`;
        }
        if (currentYear !== null) archiveHTML += '</div>';

        if (archives.length === 0) {
            archiveHTML = '<p class="no-entries">No posts yet.</p>';
        }

        const bodyContent = `
            <h2 style="font-size:1rem;color:var(--text-muted);font-weight:normal;margin-bottom:25px;">
                Archive
            </h2>
            ${archiveHTML}
        `;

        res.send(layoutTemplate({
            title: 'Archive',
            bodyContent,
            isOwner: req.isOwner,
            blogTitle: getBlogTitle()
        }));
    } catch (err) {
        res.status(500).send('Error fetching archive index.');
    }
});

// --- All Posts (paginated, 200 per page) ---

app.get('/all', async (req, res) => {
    try {
        const PAGE_SIZE = 200;
        const offset = parseInt(req.query.offset || '0', 10);

        const entries = await db.all(
            'SELECT * FROM entries ORDER BY timestamp DESC LIMIT ? OFFSET ?',
            [PAGE_SIZE, offset]
        );
        const totalPosts = await db.get('SELECT COUNT(*) AS count FROM entries');
        const hasMore = offset + PAGE_SIZE < totalPosts.count;

        const entriesHTML = renderEntries(entries, req.isOwner);

        let paginationHTML = '';
        if (hasMore || offset > 0) {
            paginationHTML = '<div style="text-align:center;margin:30px 0;display:flex;gap:15px;justify-content:center;">';
            if (offset > 0) {
                const prevOffset = Math.max(0, offset - PAGE_SIZE);
                paginationHTML += `<a href="/all?offset=${prevOffset}" class="btn">&larr; Newer</a>`;
            }
            if (hasMore) {
                paginationHTML += `<a href="/all?offset=${offset + PAGE_SIZE}" class="btn">Older &rarr;</a>`;
            }
            paginationHTML += '</div>';
        }

        const bodyContent = `
            <h2 style="font-size:1rem;color:var(--text-muted);font-weight:normal;margin-bottom:25px;">
                All Posts <span style="font-size:0.85rem;">(${totalPosts.count})</span>
            </h2>
            <div id="entries">${entriesHTML}</div>
            ${paginationHTML}
        `;

        res.send(layoutTemplate({
            title: 'All Posts',
            bodyContent,
            isOwner: req.isOwner,
            blogTitle: getBlogTitle()
        }));
    } catch (err) {
        res.status(500).send('Error fetching all posts.');
    }
});

// --- JSON API for LLMs ---

app.get('/api/posts', async (req, res) => {
    try {
        const entries = await db.all('SELECT id, content, timestamp FROM entries ORDER BY timestamp DESC');
        const host = `${req.protocol}://${req.get('host')}`;

        const posts = entries.map(e => ({
            id: e.id,
            content: e.content,
            date: new Date(e.timestamp).toISOString(),
            url: `${host}/post/${e.id}`
        }));

        res.json({
            title: getBlogTitle(),
            total: posts.length,
            posts
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch posts.' });
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
                        oninput="var s=window.scrollY;this.style.height='auto';this.style.height=this.scrollHeight+'px';window.scrollTo(0,s);"
                    >${entry.content}</textarea>
                    <script>
                    document.addEventListener('DOMContentLoaded', function() {
                        var el = document.getElementById('edit-box');
                        if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
                    });
                    </script>
                    <div class="actions" style="justify-content:flex-start;margin-top:15px;">
                        <a href="#" class="edit-link" id="updatePostLink" onclick="event.preventDefault();var f=this.closest('form');this.textContent='updating...';this.style.pointerEvents='none';setTimeout(function(){f.requestSubmit();},0);">update</a>
                        <a href="/post/${entry.id}" class="edit-link">cancel</a>
                    </div>
                </form>
            </div>
            <script>attachAutoResize('edit-box');</script>
        `;

        res.send(layoutTemplate({
            title: 'Edit Post',
            bodyContent,
            isOwner: true,
            blogTitle: getBlogTitle()
        }));
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

        if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
            return res.json({ success: true });
        }

        res.redirect('/');
    } catch (err) {
        if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
            return res.status(500).json({ success: false });
        }

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
