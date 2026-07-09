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
const COPYRIGHT_FILE = path.join(DATA_DIR, 'copyright.txt');
const BCRYPT_ROUNDS = 12;
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_BLOG_TITLE = 'Scrawl';

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
        return DEFAULT_BLOG_TITLE;
    }

    const title = fs.readFileSync(BLOG_TITLE_FILE, 'utf8').trim();
    return title || DEFAULT_BLOG_TITLE;
}

function saveBlogTitle(title) {
    fs.writeFileSync(BLOG_TITLE_FILE, title.trim(), 'utf8');
}

function getCopyright() {
    if (!fs.existsSync(COPYRIGHT_FILE)) return '';
    return fs.readFileSync(COPYRIGHT_FILE, 'utf8').trim();
}

function saveCopyright(text) {
    fs.writeFileSync(COPYRIGHT_FILE, text.trim(), 'utf8');
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

    // Migrate old database filename if needed
    const oldDbPath = path.join(DATA_DIR, 'microblog.db');
    const newDbPath = path.join(DATA_DIR, 'scrawl.db');
    if (fs.existsSync(oldDbPath) && !fs.existsSync(newDbPath)) {
        fs.renameSync(oldDbPath, newDbPath);
        console.log('Migrated database: microblog.db → scrawl.db');
    }

    db = await open({
        filename: path.join(DATA_DIR, 'scrawl.db'),
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
        CREATE TABLE IF NOT EXISTS articles (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'published'
        )
    `);

    await db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
        id UNINDEXED,
        content
    )
`);

    await db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
        id UNINDEXED,
        title,
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

// Backfill: index any articles missing from FTS
const missingArticles = await db.all(`
    SELECT a.id, a.title, a.content
    FROM articles a
    LEFT JOIN articles_fts f ON a.id = f.id
    WHERE f.id IS NULL
`);

if (missingArticles.length > 0) {
    const stmtA = await db.prepare(`
        INSERT INTO articles_fts (id, title, content)
        VALUES (?, ?, ?)
    `);

    for (const row of missingArticles) {
        await stmtA.run(row.id, row.title, row.content);
    }

    await stmtA.finalize();
    console.log(`FTS5: Indexed ${missingArticles.length} existing articles.`);
}

const { c: totalEntries } = await db.get(
    'SELECT COUNT(*) as c FROM entries'
);

const { c: ftsEntries } = await db.get(
    'SELECT COUNT(*) as c FROM entries_fts'
);

const { c: totalArticles } = await db.get(
    'SELECT COUNT(*) as c FROM articles'
);

console.log(
`SQLite Database ready. Entries: ${totalEntries}, FTS indexed: ${ftsEntries}${
        totalEntries === ftsEntries ? ' ✓' : ' ✗ MISMATCH'
    }, Articles: ${totalArticles}`
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

// Sanitize article HTML: only allow b, i, u, a (with href), br, p, div (converted to paragraphs)
function sanitizeArticleHtml(html) {
    if (!html) return '';
    let result = html
        // Normalize: convert <p>...</p> blocks into content followed by double <br>
        // First handle </p><p> transitions (paragraph break)
        .replace(/<\/p>\s*<p[^>]*>/gi, '<br><br>')
        // Opening <p> at the start — just remove it
        .replace(/^\s*<p[^>]*>/gi, '')
        // Any remaining <p> tags (mid-content) — treat as line break
        .replace(/<p[^>]*>/gi, '<br><br>')
        // Closing </p> — treat as line break (handles final paragraph)
        .replace(/<\/p>/gi, '')
        // Convert div breaks to <br> for consistent rendering
        .replace(/<\/div>\s*<div[^>]*>/gi, '<br>')
        .replace(/<div><br\s*\/?><\/div>/gi, '<br>')
        .replace(/<div[^>]*>/gi, '<br>')
        .replace(/<\/div>/gi, '')
        // Strip all tags except allowed ones (b, i, u, a, br, h2, h3, ol, ul, li, blockquote)
        .replace(/<h1[^>]*>/gi, '<h2>')
        .replace(/<\/h1>/gi, '</h2>')
        .replace(/<(?!\/?(b|i|u|a|br|h[23]|ol|ul|li|blockquote)\b)[^>]*>/gi, '')
        // Remove all attributes from b, i, u, br, h2, h3, ol, ul, li, blockquote
        .replace(/<(b|i|u|br|h[23]|ol|ul|li|blockquote)\s[^>]*>/gi, '<$1>')
        // For <a>, keep only href attribute
        .replace(/<a\s+[^>]*href\s*=\s*"([^"]*)"[^>]*>/gi, '<a href="$1" target="_blank" rel="noopener">')
        .replace(/<a\s+[^>]*href\s*=\s*'([^']*)'[^>]*>/gi, '<a href="$1" target="_blank" rel="noopener">')
        // Remove any remaining attributes on <a> that didn't match
        .replace(/<a(?!\s+href)[^>]*>/gi, '<a>')
        // Clean up <br> immediately before or after headings, lists, and blockquotes (they create their own breaks)
        .replace(/<br\s*\/?>\s*(<h[23]>)/gi, '$1')
        .replace(/(<\/h[23]>)\s*<br\s*\/?>/gi, '$1')
        .replace(/<br\s*\/?>\s*(<[ou]l>)/gi, '$1')
        .replace(/(<\/[ou]l>)\s*<br\s*\/?>/gi, '$1')
        .replace(/<br\s*\/?>\s*(<blockquote>)/gi, '$1')
        .replace(/(<\/blockquote>)\s*<br\s*\/?>/gi, '$1')
        // Collapse 3+ consecutive <br> into double <br> (max one paragraph break)
        .replace(/(<br\s*\/?>){3,}/gi, '<br><br>')
        // Clean up leading <br> tags
        .replace(/^(<br\s*\/?>)+/i, '')
        // Clean up trailing <br> tags
        .replace(/(<br\s*\/?>)+$/i, '')
        .trim();
    return result;
}

// Strip HTML tags for FTS plain text indexing
function stripHtml(html) {
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
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
                    <span class="copy-link" onclick="copyPermalink(this, '${entry.id}')">copy text</span>
                    ${ownerActions}
                </div>
            </div>
        `;
    }).join('');
}



const sharedStyles = `
    * { box-sizing: border-box; }
    html { width: 100%; overflow-x: clip; }
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
    html, body { overflow-x: clip; overscroll-behavior-x: none; width: 100%; }
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
        font-size: 1.01rem;
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
    .publish-row button { margin-top: 0; }
    .inline-search { display: flex; align-items: center; }
    .inline-search .search-icon-btn { flex-shrink: 0; }
    .search-bar-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: var(--bg-body); display: flex; align-items: center; gap: 8px; padding-right: 4px; opacity: 0; pointer-events: none; transition: opacity 0.25s ease; z-index: 10; }
    .search-bar-overlay.open { opacity: 1; pointer-events: auto; }
    .search-bar-overlay input[type="text"] {
    flex: 1;
    padding: 12px 0;
    background: var(--bg-body);
    color: var(--text-main);
    border: none;
    border-bottom: 1px solid var(--separator-color);
    font-family: inherit;
    font-size: 1rem;
    font-weight: normal;
    outline: none;
}
    .search-bar-overlay input[type="text"]::placeholder {
    color: var(--text-muted);
    opacity: 1;
    font-family: inherit;
    font-size: 1rem;
    font-weight: normal;
}   
    .search-bar-overlay .search-bar-close { background: none !important; border: none; padding: 0; margin: 0; color: var(--text-muted); cursor: pointer; font-size: 1.2rem; line-height: 1; opacity: 0.6; flex-shrink: 0; }
    .search-bar-overlay .search-bar-close:hover { opacity: 1; }
    [data-theme="dark"] .search-bar-overlay .search-bar-close { background: none !important; color: var(--text-muted); }
    .mobile-random-btn { display: none; color: var(--text-muted); opacity: 0.6; line-height: 1; }
    .mobile-random-btn:hover { opacity: 1; }
    .mobile-random-btn svg { width: 16px; height: 16px; display: block; }
    .mobile-random-btn.loading svg {
    animation: spin 1s linear infinite;
}

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
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
    .site-footer { margin-top: 50px; padding: 20px 0; border-top: 1px solid var(--separator-color); font-size: 0.75rem; color: var(--text-muted); opacity: 0.7; text-align: center; }
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

const layoutTemplate = ({ title, bodyContent, isOwner, blogTitle, searchQuery, copyright }) =>  {
    const copyrightText = copyright !== undefined ? copyright : getCopyright();
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>${title}</title>
    <link rel="manifest" href="/manifest.json">
    <link rel="alternate" type="application/json" href="/api/posts" title="All posts (JSON)">
    <link rel="alternate" type="application/rss+xml" href="/feed/posts" title="Posts RSS Feed">
    <link rel="alternate" type="application/rss+xml" href="/feed/articles" title="Articles RSS Feed">
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
            <a href="/random" class="random-link">random</a>
            <span class="header-separator">&middot;</span>
            <a href="/archive" class="random-link">post archive</a>
            <span class="header-separator">&middot;</span>
            <a href="/articles" class="random-link">articles</a>
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
                    <a href="#" id="editCopyright">edit footer</a>
                    <a href="#" id="themeToggle">dark</a>
                    <a href="/feed/posts">rss: posts</a>
                    <a href="/feed/articles">rss: articles</a>
                    <a href="/help">help</a>
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
                    <a href="/feed/posts">rss: posts</a>
                    <a href="/feed/articles">rss: articles</a>
                    <a href="/help">help</a>
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
            <input type="text" id="search-field" placeholder="Search posts and articles..." value="${escapeHtml(searchQuery || '')}" autocomplete="off">
            <button type="button" class="search-bar-close" id="searchCloseBtn">&times;</button>
        </div>
    </header>

    <!-- Mobile menu overlay -->
    <div class="mobile-menu" id="mobileMenu">
        <button type="button" class="mobile-menu-close" id="mobileMenuClose">&times;</button>
        <a href="/archive">post archive</a>
        <a href="/articles">articles</a>
        ${isOwner
            ? '<a href="#" id="mobileEditTitle">edit title</a><a href="#" id="mobileThemeToggle">dark</a><a href="/feed/posts">rss: posts</a><a href="/feed/articles">rss: articles</a><a href="/logout">logout</a>'
            : '<a href="#" id="mobileThemeToggle">dark</a><a href="/feed/posts">rss: posts</a><a href="/feed/articles">rss: articles</a><a href="/login">login</a>'
        }
    </div>

    <div class="container">
        <main class="main-content">${bodyContent}</main>
    </div>
    ${copyrightText ? '<footer class="site-footer">' + copyrightText + '</footer>' : ''}
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
                setTimeout(function() { el.textContent = 'copy text'; }, 2000);
            }).catch(function() {
                el.textContent = 'failed';
                setTimeout(function() { el.textContent = 'copy text'; }, 2000);
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

        // Random link feedback
        document.querySelectorAll('a[href="/random"]').forEach(function(link) {
            link.addEventListener('click', function() {

                // Mobile icon version
                if (link.classList.contains('mobile-random-btn')) {
                    link.classList.add('loading');
                    link.style.pointerEvents = 'none';
                    return;
                }

                // Desktop text version
                link.textContent = 'randomizing...';
                link.style.pointerEvents = 'none';
            });
        });

        // Publishing button feedback
        var addForms = document.querySelectorAll('form[action="/add"]');
        addForms.forEach(function(form) {
            form.addEventListener('submit', function() {
                var btn = form.querySelector('button[type="submit"]');
                if (btn) { btn.textContent = 'Posting...'; btn.disabled = true; }
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

        // Copyright/footer edit
        var editCopyright = document.getElementById('editCopyright');
        if (editCopyright) {
            editCopyright.addEventListener('click', function(e) {
                e.preventDefault();
                if (gearDropdown) gearDropdown.classList.remove('open');
                var footer = document.querySelector('.site-footer');
                var currentText = footer ? footer.textContent.trim() : '';
                var newText = prompt('Footer text (leave empty to remove):', currentText);
                if (newText === null) return;
                fetch('/api/copyright', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: newText.trim() })
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (!data.success) throw new Error();
                    if (data.text) {
                        if (footer) { footer.textContent = data.text; }
                        else { var f = document.createElement('footer'); f.className = 'site-footer'; f.textContent = data.text; document.querySelector('.container').after(f); }
                    } else {
                        if (footer) footer.remove();
                    }
                })
                .catch(function() { alert('Failed to save footer'); });
            });
        }
    })();
    </script>
</body>
</html>
`;
}

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
        title: 'Login',
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

app.post('/api/copyright', requireOwner, (req, res) => {
    const text = String(req.body.text || '').trim();
    saveCopyright(text);
    res.json({ success: true, text });
});

// --- Main Routes ---

app.get('/', async (req, res) => {
    // Redirect to setup if no owner password exists
    if (!isOwnerSetup()) return res.redirect('/setup');

    try {
        const searchQuery = req.query.q || '';
let entries;
let hasMore = false;
let articleResults = [];

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

                // Also search articles
                articleResults = await db.all(`
                    SELECT articles.*
                    FROM articles
                    JOIN articles_fts ON articles.id = articles_fts.id
                    WHERE articles_fts MATCH ?
                    AND articles.status = 'published'
                    ORDER BY articles_fts.rank
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
                        placeholder="Write something..."
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
                        <button type="submit">Post</button>
                    </div>
                </form>
            `;
        } else {
            publishSection = `
                <p class="login-prompt"><a href="/login">Login</a> to publish, edit, and delete posts and articles.</p>
            `;
        }

        const bodyContent = `
            ${publishSection}
            ${searchQuery ? `<p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:20px;">${entries.length + articleResults.length} result${(entries.length + articleResults.length) !== 1 ? 's' : ''} for "${escapeHtml(searchQuery)}"</p>` : ''}
            ${searchQuery && articleResults.length > 0 ? `
                <div style="margin-bottom:25px;">
                    <h3 style="font-size:0.85rem;color:var(--text-muted);font-weight:normal;margin-bottom:12px;">Articles</h3>
                    ${articleResults.map(a => `
                        <div class="entry">
                            <div class="date">${formatDate(a.timestamp)}</div>
                            <div class="content"><a href="/articles/${a.id}" style="color:var(--text-main);text-decoration:none;font-weight:600;">${escapeHtml(a.title)}</a></div>
                        </div>
                    `).join('')}
                </div>
                ${entries.length > 0 ? '<h3 style="font-size:0.85rem;color:var(--text-muted);font-weight:normal;margin-bottom:12px;">Posts</h3>' : ''}
            ` : ''}
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
                    <span class="copy-link" onclick="copyPermalink(this, '${entry.id}')">copy text</span>
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

// --- RSS Feeds ---

app.get('/feed/posts', async (req, res) => {
    try {
        const entries = await db.all('SELECT * FROM entries ORDER BY timestamp DESC LIMIT 50');
        const host = `${req.protocol}://${req.get('host')}`;
        const blogTitle = getBlogTitle();

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n';
        xml += '<channel>\n';
        xml += `  <title>${escapeHtml(blogTitle)} - Posts</title>\n`;
        xml += `  <link>${host}</link>\n`;
        xml += `  <description>Posts from ${escapeHtml(blogTitle)}</description>\n`;
        xml += `  <atom:link href="${host}/feed/posts" rel="self" type="application/rss+xml"/>\n`;
        if (entries.length > 0) {
            xml += `  <lastBuildDate>${new Date(entries[0].timestamp).toUTCString()}</lastBuildDate>\n`;
        }

        for (const entry of entries) {
            const date = new Date(entry.timestamp).toUTCString();
            const snippet = escapeHtml(entry.content.substring(0, 100));
            xml += '  <item>\n';
            xml += `    <title>${snippet}${entry.content.length > 100 ? '...' : ''}</title>\n`;
            xml += `    <link>${host}/post/${entry.id}</link>\n`;
            xml += `    <guid isPermaLink="true">${host}/post/${entry.id}</guid>\n`;
            xml += `    <pubDate>${date}</pubDate>\n`;
            xml += `    <description>${escapeHtml(entry.content)}</description>\n`;
            xml += '  </item>\n';
        }

        xml += '</channel>\n</rss>';
        res.type('application/rss+xml').send(xml);
    } catch (err) {
        res.status(500).send('Error generating posts feed.');
    }
});

app.get('/feed/articles', async (req, res) => {
    try {
        const articles = await db.all("SELECT * FROM articles WHERE status = 'published' ORDER BY timestamp DESC LIMIT 50");
        const host = `${req.protocol}://${req.get('host')}`;
        const blogTitle = getBlogTitle();

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n';
        xml += '<channel>\n';
        xml += `  <title>${escapeHtml(blogTitle)} - Articles</title>\n`;
        xml += `  <link>${host}/articles</link>\n`;
        xml += `  <description>Articles from ${escapeHtml(blogTitle)}</description>\n`;
        xml += `  <atom:link href="${host}/feed/articles" rel="self" type="application/rss+xml"/>\n`;
        if (articles.length > 0) {
            xml += `  <lastBuildDate>${new Date(articles[0].timestamp).toUTCString()}</lastBuildDate>\n`;
        }

        for (const article of articles) {
            const date = new Date(article.timestamp).toUTCString();
            xml += '  <item>\n';
            xml += `    <title>${escapeHtml(article.title)}</title>\n`;
            xml += `    <link>${host}/articles/${article.id}</link>\n`;
            xml += `    <guid isPermaLink="true">${host}/articles/${article.id}</guid>\n`;
            xml += `    <pubDate>${date}</pubDate>\n`;
            xml += `    <description>${escapeHtml(stripHtml(article.content).substring(0, 300))}</description>\n`;
            xml += '  </item>\n';
        }

        xml += '</channel>\n</rss>';
        res.type('application/rss+xml').send(xml);
    } catch (err) {
        res.status(500).send('Error generating articles feed.');
    }
});

// --- Sitemap ---

app.get('/sitemap.xml', async (req, res) => {
    try {
        const entries = await db.all('SELECT id, timestamp FROM entries ORDER BY timestamp DESC');
        const articles = await db.all("SELECT id, timestamp FROM articles WHERE status = 'published' ORDER BY timestamp DESC");
        const host = `${req.protocol}://${req.get('host')}`;

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `  <url>\n    <loc>${host}/</loc>\n    <changefreq>daily</changefreq>\n  </url>\n`;
        xml += `  <url>\n    <loc>${host}/articles</loc>\n    <changefreq>weekly</changefreq>\n  </url>\n`;
        xml += `  <url>\n    <loc>${host}/archive</loc>\n    <changefreq>weekly</changefreq>\n  </url>\n`;
        xml += `  <url>\n    <loc>${host}/api/posts</loc>\n    <changefreq>daily</changefreq>\n  </url>\n`;

        for (const entry of entries) {
            const lastmod = new Date(entry.timestamp).toISOString().split('T')[0];
            xml += `  <url>\n    <loc>${host}/post/${entry.id}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>\n`;
        }

        for (const article of articles) {
            const lastmod = new Date(article.timestamp).toISOString().split('T')[0];
            xml += `  <url>\n    <loc>${host}/articles/${article.id}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>\n`;
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
        const { count: totalPosts } = await db.get(
            'SELECT COUNT(*) AS count FROM entries'
        );
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
                Post Archive <span style="font-size:0.9rem;color:var(--text-muted);opacity:0.75;">(${totalPosts} posts)</span>
            </h2>
            ${archiveHTML}
        `;

        res.send(layoutTemplate({
            title: 'Post Archive',
            bodyContent,
            isOwner: req.isOwner,
            blogTitle: getBlogTitle()
        }));
    } catch (err) {
        res.status(500).send('Error fetching archive index.');
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

// --- Help Page ---

app.get('/help', (req, res) => {
    const blogTitle = getBlogTitle();
    const bodyContent = `
        <style>
            .help-section { margin-bottom: 30px; }
            .help-section h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 10px; }
            .help-section h3 { font-size: 0.95rem; font-weight: 600; margin-bottom: 6px; margin-top: 15px; }
            .help-section p { font-size: 0.9rem; color: var(--text-main); line-height: 1.6; margin-bottom: 8px; }
            .help-section ul { font-size: 0.9rem; padding-left: 1.5em; margin-bottom: 8px; line-height: 1.6; }
            .help-section li { margin-bottom: 4px; }
            .help-section code { background: var(--separator-color); padding: 2px 5px; border-radius: 3px; font-size: 0.82rem; }
            .help-section kbd { background: var(--separator-color); padding: 2px 6px; border-radius: 3px; font-size: 0.8rem; font-family: inherit; }
        </style>
        <h2 style="font-size:1rem;color:var(--text-muted);font-weight:normal;margin-bottom:25px;">Help</h2>

        <div class="help-section">
            <h2>What is ${escapeHtml(blogTitle)}?</h2>
            <p>${escapeHtml(blogTitle)} is a personal publishing space with two writing modes: quick posts and long-form articles. It's designed to be fast, minimal, and distraction-free.</p>
        </div>

        <div class="help-section">
            <h2>Posts</h2>
            <p>Posts are short, quick thoughts — like a scratchpad. There's no title, no formatting. Just type and post.</p>
            <h3>How to create a post</h3>
            <ul>
                <li>Log in as the owner</li>
                <li>On the homepage, type in the text area</li>
                <li>Click <strong>Post</strong></li>
            </ul>
            <h3>Post features</h3>
            <ul>
                <li>Plain text only — line breaks are preserved as-is</li>
                <li>No character limit</li>
                <li>Word and character counter below the text area</li>
                <li>Long posts (280+ characters) are collapsed with a "click to expand" preview</li>
            </ul>
            <h3>Actions on posts</h3>
            <ul>
                <li><strong>#</strong> — permalink to the post</li>
                <li><strong>copy text</strong> — copies the post content to clipboard</li>
                <li><strong>edit</strong> — edit the post content (owner only)</li>
                <li><strong>delete</strong> — delete the post with confirmation (owner only)</li>
            </ul>
        </div>

        <div class="help-section">
            <h2>Articles</h2>
            <p>Articles are longer-form writing with a title and rich formatting. They live in their own section at <code>/articles</code>.</p>
            <h3>How to create an article</h3>
            <ul>
                <li>Go to <strong>articles</strong> from the navigation</li>
                <li>Click <strong>New Article</strong></li>
                <li>Enter a title</li>
                <li>Optionally change the date (for backdating)</li>
                <li>Write your content using the formatting toolbar</li>
                <li>Click <strong>Publish</strong> or <strong>Save as draft</strong></li>
            </ul>
            <h3>Formatting options (articles only)</h3>
            <ul>
                <li><strong>B</strong> — Bold</li>
                <li><strong>I</strong> — Italic</li>
                <li><strong>U</strong> — Underline</li>
                <li><strong>🔗</strong> — Insert hyperlink</li>
                <li><strong>H2</strong> — Section heading</li>
                <li><strong>H3</strong> — Sub-section heading</li>
                <li><strong>1.</strong> — Numbered list</li>
                <li><strong>•</strong> — Bullet list</li>
                <li><strong>"</strong> — Blockquote</li>
            </ul>
            <h3>Drafts</h3>
            <p>Articles can be saved as drafts. Drafts are only visible to the owner and show a "draft" badge. You can publish them later from the edit page.</p>
            <h3>Backdating</h3>
            <p>When creating or editing an article, you can set a custom date. This is useful for importing older articles from other platforms.</p>
            <h3>Actions on articles</h3>
            <ul>
                <li><strong>#</strong> — permalink</li>
                <li><strong>copy link</strong> — copies the article URL to clipboard</li>
                <li><strong>share</strong> — uses the native share dialog on supported devices (falls back to copy link)</li>
                <li><strong>edit</strong> / <strong>delete</strong> — owner only</li>
            </ul>
            <h3>Unsaved changes protection</h3>
            <p>If you're writing or editing an article and try to navigate away, the browser will warn you about unsaved changes.</p>
        </div>

        <div class="help-section">
            <h2>Navigation</h2>
            <ul>
                <li><strong>random</strong> — opens a random post (not articles)</li>
                <li><strong>post archive</strong> — browse posts by year and month</li>
                <li><strong>articles</strong> — the articles list, grouped by year</li>
                <li><strong><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;display:inline;"><circle cx="11" cy="11" r="7"></circle><line x1="16.65" y1="16.65" x2="21" y2="21"></line></svg></strong> — search across both posts and articles</li>
                <li><strong><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;display:inline;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></strong> — settings menu (theme, title, footer, RSS, login/logout)</li>
            </ul>
        </div>

        <div class="help-section">
            <h2>Search</h2>
            <p>Search finds results across both posts and articles. It uses full-text search with relevance ranking.</p>
            <ul>
                <li>Click the search icon or press <kbd>/</kbd> to open search</li>
                <li>Type your query and press <kbd>Enter</kbd></li>
                <li>Press <kbd>Escape</kbd> to close search</li>
                <li>Results show articles and posts separately</li>
            </ul>
        </div>

        <div class="help-section">
            <h2>Customization</h2>
            <h3>Changing the site title</h3>
            <p>Click the gear icon and select <strong>edit title</strong>. Enter the new title in the prompt.</p>
            <h3>Changing the footer / copyright text</h3>
            <p>Click the gear icon and select <strong>edit footer</strong>. Enter your copyright or footer text. Leave empty to remove it.</p>
            <h3>Dark mode</h3>
            <p>Click the gear icon and select <strong>dark</strong> (or <strong>light</strong> to switch back). Your preference is saved in the browser.</p>
        </div>

        <div class="help-section">
            <h2>RSS Feeds</h2>
            <p>Two separate RSS feeds are available for feed readers:</p>
            <ul>
                <li><code>/feed/posts</code> — latest posts</li>
                <li><code>/feed/articles</code> — latest published articles</li>
            </ul>
            <p>Links are also in the gear menu and auto-discoverable by feed readers.</p>
        </div>

        <div class="help-section">
            <h2>Keyboard Shortcuts</h2>
            <ul>
                <li><kbd>N</kbd> — focus the new post editor (homepage only)</li>
                <li><kbd>/</kbd> — open search</li>
                <li><kbd>Escape</kbd> — close search</li>
            </ul>
        </div>

        <div class="help-section">
            <h2>Authentication</h2>
            <p>Only the owner can create, edit, and delete posts and articles. Visitors can read everything that's published.</p>
            <h3>First-time setup</h3>
            <p>On first launch, visit the app and you'll be redirected to <code>/setup</code> to create your password.</p>
            <h3>Password reset</h3>
            <p>Delete the file <code>data/owner.hash</code> and restart the server. You'll be prompted to set a new password.</p>
        </div>

        <div class="help-section">
            <h2>Progressive Web App</h2>
            <p>This app can be installed on your phone or desktop as a PWA. Use your browser's "Add to Home Screen" or "Install App" option.</p>
        </div>
    `;

    res.send(layoutTemplate({
        title: 'Help',
        bodyContent,
        isOwner: req.isOwner,
        blogTitle: getBlogTitle()
    }));
});

// --- Articles Routes ---

// Articles styles (additional to shared)
const articleStyles = `
    .article-editor-toolbar { display: flex; gap: 4px; margin-bottom: 8px; padding: 6px 0; border-bottom: 1px solid var(--separator-color); position: sticky; top: 0; background: var(--bg-body); z-index: 100; }
    .article-editor-toolbar button { background: none !important; border: 1px solid var(--separator-color); border-radius: 4px; padding: 4px 10px; margin: 0; font-size: 0.85rem; color: var(--text-main); cursor: pointer; min-width: 32px; }
    .article-editor-toolbar button:hover { background: var(--separator-color) !important; }
    [data-theme="dark"] .article-editor-toolbar button { background: none !important; color: var(--text-main); border-color: var(--separator-color); }
    [data-theme="dark"] .article-editor-toolbar button:hover { background: var(--separator-color) !important; }
    .article-content-editor { min-height: 200px; padding: 12px 0; border: none; border-bottom: 1px solid var(--separator-color); outline: none; font-family: inherit; font-size: 1rem; line-height: 1.6; color: var(--text-main); }
    .article-content-editor:empty:before { content: attr(data-placeholder); color: var(--text-muted); opacity: 0.6; }
    .article-body { white-space: pre-wrap; line-height: 1.6; font-size: 1.01rem; }
    .article-body h2, .article-content-editor h2 { font-size: 1.2rem; font-weight: 600; margin: 0.7em 0 0.3em 0; line-height: 1.3; }
    .article-body h3, .article-content-editor h3 { font-size: 1.05rem; font-weight: 600; margin: 0.6em 0 0.2em 0; line-height: 1.3; }
    .article-body ul, .article-body ol, .article-content-editor ul, .article-content-editor ol { margin: 0.4em 0; padding-left: 1.5em; }
    .article-body li, .article-content-editor li { margin-bottom: 0.2em; }
    .article-body blockquote, .article-content-editor blockquote { margin: 0.5em 0; padding: 0.4em 0 0.4em 1em; border-left: 3px solid var(--separator-color); color: var(--text-muted); font-style: italic; }
    .article-body a { color: var(--text-main); text-decoration: underline; }
    .article-body a:hover { opacity: 0.7; }
    .article-title { font-size: 1.4rem; font-weight: 600; margin-bottom: 8px; line-height: 1.3; }
    .article-meta { font-size: 0.75rem; color: var(--text-muted); opacity: 0.75; margin-bottom: 20px; }
    .article-list-item { padding-bottom: 6px; margin-bottom: 6px; }
    .article-list-title { font-size: 0.95rem; font-weight: normal; }
    .article-list-title a { color: var(--text-muted); text-decoration: none; transition: color 0.2s ease; }
    .article-list-title a:hover { color: var(--text-main); }
    .article-list-date { font-size: 0.75rem; color: var(--text-muted); opacity: 0.75; }
    .article-year-heading { font-size: 1.1rem; font-weight: 600; margin-bottom: 15px; margin-top: 30px; }
    .article-year-heading:first-child { margin-top: 0; }
    .draft-badge { display: inline-block; font-size: 0.7rem; color: var(--text-muted); border: 1px solid var(--separator-color); border-radius: 3px; padding: 1px 6px; margin-left: 8px; vertical-align: middle; }
    .share-btn { background: none !important; border: none; padding: 0; margin: 0; color: var(--text-muted); cursor: pointer; font-size: 0.85rem; font-weight: normal; transition: color 0.2s ease; }
    .share-btn:hover { color: var(--text-main); }
    [data-theme="dark"] .share-btn { background: none !important; color: var(--text-muted); }
`;

// List articles
app.get('/articles', async (req, res) => {
    try {
        let articles;
        if (req.isOwner) {
            articles = await db.all('SELECT * FROM articles ORDER BY timestamp DESC');
        } else {
            articles = await db.all("SELECT * FROM articles WHERE status = 'published' ORDER BY timestamp DESC");
        }

        // Group by year
        const grouped = {};
        for (const article of articles) {
            const year = new Date(article.timestamp).getFullYear().toString();
            if (!grouped[year]) grouped[year] = [];
            grouped[year].push(article);
        }

        const years = Object.keys(grouped).sort((a, b) => b - a);

        let listHTML = '';
        if (articles.length === 0) {
            listHTML = '<p class="no-entries">No articles yet.</p>';
        } else {
            for (const year of years) {
                listHTML += `<h2 class="article-year-heading">${year}</h2>`;
                for (const article of grouped[year]) {
                    const draftBadge = article.status === 'draft' ? '<span class="draft-badge">draft</span>' : '';
                    listHTML += `
                        <div class="article-list-item">
                            <div class="article-list-title">
                                <a href="/articles/${article.id}">${escapeHtml(article.title)}</a>
                                ${draftBadge}
                            </div>
                        </div>
                    `;
                }
            }
        }

        const newArticleBtn = req.isOwner ? `
            <div style="margin-bottom:30px;">
                <a href="/articles/new" class="btn">New Article</a>
            </div>
        ` : '';

        const bodyContent = `
            <style>${articleStyles}</style>
            ${newArticleBtn}
            ${listHTML}
        `;

        res.send(layoutTemplate({
            title: 'Articles',
            bodyContent,
            isOwner: req.isOwner,
            blogTitle: getBlogTitle()
        }));
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading articles.');
    }
});

// New article form
app.get('/articles/new', requireOwner, (req, res) => {
    const now = new Date();
    const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const bodyContent = `
        <style>${articleStyles}</style>
        <form id="articleForm" style="margin:0;">
            <input type="text" id="article-title" name="title" placeholder="Article title" required style="font-size:1.2rem;font-weight:600;margin-bottom:10px;">
            <div style="margin-bottom:10px;">
                <input type="date" id="article-date" value="${today}" style="padding:8px 0;background:var(--bg-body);color:var(--text-main);border:none;border-bottom:1px solid var(--separator-color);font-family:inherit;font-size:0.85rem;outline:none;">
            </div>
            <div class="article-editor-toolbar">
                <button type="button" onclick="execCmd('bold')" title="Bold"><b>B</b></button>
                <button type="button" onclick="execCmd('italic')" title="Italic"><i>I</i></button>
                <button type="button" onclick="execCmd('underline')" title="Underline"><u>U</u></button>
                <button type="button" onclick="insertLink()" title="Insert link">&#128279;</button>
                <button type="button" onclick="execHeading('h2')" title="Heading 2">H2</button>
                <button type="button" onclick="execHeading('h3')" title="Heading 3">H3</button>
                <button type="button" onclick="execCmd('insertOrderedList')" title="Numbered list">1.</button>
                <button type="button" onclick="execCmd('insertUnorderedList')" title="Bullet list">&bull;</button>
                <button type="button" onclick="execQuote()" title="Blockquote">&#8220;</button>
            </div>
            <div id="article-content" class="article-content-editor" contenteditable="true" data-placeholder="Write your article..."></div>
            <div class="publish-row" style="display:flex;gap:10px;align-items:baseline;">
                <button type="button" onclick="submitArticle('published')">Publish</button>
                <button type="button" onclick="submitArticle('draft')" style="background:var(--separator-color);color:var(--text-main);">Save as draft</button>
                <a href="/articles" class="back-link" style="margin-left:10px;" onclick="if(!confirmCancel())return false;articleSaved=true;">cancel</a>
            </div>
        </form>
        <script>
        function execCmd(cmd) {
            document.execCommand(cmd, false, null);
            document.getElementById('article-content').focus();
        }
        function execHeading(tag) {
            document.execCommand('formatBlock', false, '<' + tag + '>');
            document.getElementById('article-content').focus();
        }
        function execQuote() {
            document.execCommand('formatBlock', false, '<blockquote>');
            document.getElementById('article-content').focus();
        }
        function insertLink() {
            var sel = window.getSelection();
            var anchor = null;
            if (sel.rangeCount > 0) {
                var node = sel.anchorNode;
                while (node && node !== document.getElementById('article-content')) {
                    if (node.tagName === 'A') { anchor = node; break; }
                    node = node.parentNode;
                }
            }
            if (anchor) {
                var action = prompt('Current URL: ' + anchor.href + '\\n\\nEdit URL or clear the field and press OK to remove the link:', anchor.href);
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
            document.getElementById('article-content').focus();
        }
        // Strip external styling on paste, preserving only allowed formatting and structure
        document.getElementById('article-content').addEventListener('paste', function(e) {
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
                // Plain text paste: convert line breaks to <br>
                var escaped = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                var htmlText = escaped.replace(/\\r\\n|\\r|\\n/g, '<br>');
                document.execCommand('insertHTML', false, htmlText);
            }
        });
        function confirmCancel() {
            var title = document.getElementById('article-title').value.trim();
            var content = document.getElementById('article-content').innerHTML.trim();
            if (title || (content && content !== '<br>')) {
                return confirm('You have unsaved changes. Discard?');
            }
            return true;
        }
        var articleSaved = false;
        function hasUnsavedChanges() {
            if (articleSaved) return false;
            var title = document.getElementById('article-title').value.trim();
            var content = document.getElementById('article-content').innerHTML.trim();
            return !!(title || (content && content !== '<br>'));
        }
        window.addEventListener('beforeunload', function(e) {
            if (hasUnsavedChanges()) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
        function submitArticle(status) {
            var title = document.getElementById('article-title').value.trim();
            var content = document.getElementById('article-content').innerHTML.trim();
            var dateVal = document.getElementById('article-date').value;
            if (!title) { alert('Title is required.'); return; }
            if (!content || content === '<br>') { alert('Content is required.'); return; }
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
        }
        </script>
    `;

    res.send(layoutTemplate({
        title: 'New Article',
        bodyContent,
        isOwner: true,
        blogTitle: getBlogTitle()
    }));
});

// Create article (API)
app.post('/articles', requireOwner, async (req, res) => {
    try {
        const { title, content, status, date } = req.body;
        if (!title || !content) {
            return res.status(400).json({ success: false, error: 'Title and content required.' });
        }

        const id = generateId();
        const sanitizedContent = sanitizeArticleHtml(content);
        const articleStatus = status === 'draft' ? 'draft' : 'published';
        // Support backdated articles
        const timestamp = date ? new Date(date + 'T12:00:00').getTime() : Date.now();

        await db.run(
            'INSERT INTO articles (id, title, content, timestamp, status) VALUES (?, ?, ?, ?, ?)',
            [id, title.trim(), sanitizedContent, timestamp, articleStatus]
        );
        await db.run(
            'INSERT INTO articles_fts (id, title, content) VALUES (?, ?, ?)',
            [id, title.trim(), stripHtml(sanitizedContent)]
        );

        res.json({ success: true, id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Failed to create article.' });
    }
});

// View single article
app.get('/articles/:id', async (req, res) => {
    try {
        const article = await db.get('SELECT * FROM articles WHERE id = ?', [req.params.id]);
        if (!article) return res.status(404).send('Article not found.');

        // Only owner can see drafts
        if (article.status === 'draft' && !req.isOwner) {
            return res.status(404).send('Article not found.');
        }

        const dateStr = formatDate(article.timestamp);
        const fullDate = new Date(article.timestamp).toLocaleString();
        const draftBadge = article.status === 'draft' ? '<span class="draft-badge">draft</span>' : '';

        const ownerActions = req.isOwner ? `
            <a href="/articles/${article.id}/edit" class="edit-link">edit</a>
            <form action="/articles/${article.id}/delete" method="POST" style="background:none;padding:0;margin:0;display:inline;" onsubmit="return handleDelete(this)">
                <button type="submit" class="delete-btn">delete</button>
            </form>
        ` : '';

        const bodyContent = `
            <style>${articleStyles}</style>
            <article>
                <h1 class="article-title">${escapeHtml(article.title)} ${draftBadge}</h1>
                <div class="article-meta" title="${fullDate}">${dateStr}</div>
                <div class="article-body">${article.content}</div>
                <div class="actions" style="margin-top:20px;">
                    <a href="/articles/${article.id}" class="permalink" title="Permalink">#</a>
                    <span class="copy-link" onclick="copyArticleLink(this)">copy link</span>
                    <button type="button" class="share-btn" onclick="shareArticle()">share</button>
                    ${ownerActions}
                </div>
            </article>
            <p style="margin-top:30px;"><a href="/articles" class="back-link">&larr; back to articles</a></p>
            <script>
            function copyArticleLink(el) {
                navigator.clipboard.writeText(window.location.href).then(function() {
                    el.textContent = 'copied';
                    setTimeout(function() { el.textContent = 'copy link'; }, 2000);
                }).catch(function() {
                    el.textContent = 'failed';
                    setTimeout(function() { el.textContent = 'copy link'; }, 2000);
                });
            }
            function shareArticle() {
                if (navigator.share) {
                    navigator.share({
                        title: ${JSON.stringify(article.title)},
                        url: window.location.href
                    }).catch(function() {});
                } else {
                    copyArticleLink(document.querySelector('.share-btn'));
                }
            }
            </script>
        `;

        res.send(layoutTemplate({
            title: article.title,
            bodyContent,
            isOwner: req.isOwner,
            blogTitle: getBlogTitle()
        }));
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading article.');
    }
});

// Edit article form
app.get('/articles/:id/edit', requireOwner, async (req, res) => {
    try {
        const article = await db.get('SELECT * FROM articles WHERE id = ?', [req.params.id]);
        if (!article) return res.status(404).send('Article not found.');

        const artDate = new Date(article.timestamp);
        const articleDate = artDate.getFullYear() + '-' + String(artDate.getMonth() + 1).padStart(2, '0') + '-' + String(artDate.getDate()).padStart(2, '0');

        const bodyContent = `
            <style>${articleStyles}</style>
            <form id="articleForm" style="margin:0;">
                <input type="text" id="article-title" name="title" placeholder="Article title" required value="${escapeHtml(article.title)}" style="font-size:1.2rem;font-weight:600;margin-bottom:10px;">
                <div style="margin-bottom:10px;">
                    <input type="date" id="article-date" value="${articleDate}" style="padding:8px 0;background:var(--bg-body);color:var(--text-main);border:none;border-bottom:1px solid var(--separator-color);font-family:inherit;font-size:0.85rem;outline:none;">
                </div>
                <div class="article-editor-toolbar">
                    <button type="button" onclick="execCmd('bold')" title="Bold"><b>B</b></button>
                    <button type="button" onclick="execCmd('italic')" title="Italic"><i>I</i></button>
                    <button type="button" onclick="execCmd('underline')" title="Underline"><u>U</u></button>
                    <button type="button" onclick="insertLink()" title="Insert link">&#128279;</button>
                    <button type="button" onclick="execHeading('h2')" title="Heading 2">H2</button>
                    <button type="button" onclick="execHeading('h3')" title="Heading 3">H3</button>
                    <button type="button" onclick="execCmd('insertOrderedList')" title="Numbered list">1.</button>
                    <button type="button" onclick="execCmd('insertUnorderedList')" title="Bullet list">&bull;</button>
                    <button type="button" onclick="execQuote()" title="Blockquote">&#8220;</button>
                </div>
                <div id="article-content" class="article-content-editor" contenteditable="true" data-placeholder="Write your article...">${article.content}</div>
                <div class="publish-row" style="display:flex;gap:10px;align-items:baseline;">
                    <button type="button" onclick="updateArticle('published')">
                        ${article.status === 'draft' ? 'Publish' : 'Update'}
                    </button>
                    ${article.status === 'published' ? '' : '<button type="button" onclick="updateArticle(\'draft\')" style="background:var(--separator-color);color:var(--text-main);">Save draft</button>'}
                    <a href="/articles/${article.id}" class="back-link" style="margin-left:10px;" onclick="articleSaved=true;">cancel</a>
                </div>
            </form>
            <script>
            function execCmd(cmd) {
                document.execCommand(cmd, false, null);
                document.getElementById('article-content').focus();
            }
            function execHeading(tag) {
                document.execCommand('formatBlock', false, '<' + tag + '>');
                document.getElementById('article-content').focus();
            }
            function execQuote() {
                document.execCommand('formatBlock', false, '<blockquote>');
                document.getElementById('article-content').focus();
            }
            function insertLink() {
                var sel = window.getSelection();
                var anchor = null;
                if (sel.rangeCount > 0) {
                    var node = sel.anchorNode;
                    while (node && node !== document.getElementById('article-content')) {
                        if (node.tagName === 'A') { anchor = node; break; }
                        node = node.parentNode;
                    }
                }
                if (anchor) {
                    var action = prompt('Current URL: ' + anchor.href + '\\n\\nEdit URL or clear the field and press OK to remove the link:', anchor.href);
                    if (action === null) return;
                    if (action.trim() === '') {
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
                document.getElementById('article-content').focus();
            }
            // Strip external styling on paste, preserving only allowed formatting and structure
            document.getElementById('article-content').addEventListener('paste', function(e) {
                e.preventDefault();
                var html = e.clipboardData.getData('text/html');
                var text = e.clipboardData.getData('text/plain');
                if (html) {
                    var temp = document.createElement('div');
                    temp.innerHTML = html;
                    temp.querySelectorAll('[style]').forEach(function(el) { el.removeAttribute('style'); });
                    temp.querySelectorAll('[class]').forEach(function(el) { el.removeAttribute('class'); });
                    temp.querySelectorAll('[color]').forEach(function(el) { el.removeAttribute('color'); });
                    temp.querySelectorAll('[face]').forEach(function(el) { el.removeAttribute('face'); });
                    temp.querySelectorAll('[size]').forEach(function(el) { el.removeAttribute('size'); });
                    temp.querySelectorAll('font, span').forEach(function(el) {
                        while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
                        el.parentNode.removeChild(el);
                    });
                    var allowed = ['B','I','U','A','BR','P','DIV','H1','H2','H3','OL','UL','LI','BLOCKQUOTE'];
                    temp.querySelectorAll('*').forEach(function(el) {
                        if (allowed.indexOf(el.tagName) === -1) {
                            while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
                            el.parentNode.removeChild(el);
                        }
                    });
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
                    var escaped = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                    var htmlText = escaped.replace(/\\r\\n|\\r|\\n/g, '<br>');
                    document.execCommand('insertHTML', false, htmlText);
                }
            });
            var articleSaved = false;
            window.addEventListener('beforeunload', function(e) {
                if (!articleSaved) {
                    e.preventDefault();
                    e.returnValue = '';
                }
            });
            function updateArticle(status) {
                var title = document.getElementById('article-title').value.trim();
                var content = document.getElementById('article-content').innerHTML.trim();
                var dateVal = document.getElementById('article-date').value;
                if (!title) { alert('Title is required.'); return; }
                if (!content || content === '<br>') { alert('Content is required.'); return; }
                articleSaved = true;
                var btn = event.target;
                btn.textContent = status === 'draft' ? 'Saving...' : (status === 'published' ? '${article.status === 'draft' ? 'Publishing...' : 'Updating...'}' : 'Saving...');
                btn.disabled = true;
                var body = { title: title, content: content, status: status };
                if (dateVal) body.date = dateVal;
                fetch('/articles/${article.id}', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) window.location.href = '/articles/${article.id}';
                    else { articleSaved = false; alert('Failed to update article.'); btn.disabled = false; btn.textContent = '${article.status === 'draft' ? 'Publish' : 'Update'}'; }
                })
                .catch(function() { articleSaved = false; alert('Failed to update article.'); btn.disabled = false; btn.textContent = '${article.status === 'draft' ? 'Publish' : 'Update'}'; });
            }
            </script>
        `;

        res.send(layoutTemplate({
            title: 'Edit Article',
            bodyContent,
            isOwner: true,
            blogTitle: getBlogTitle()
        }));
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading edit page.');
    }
});

// Update article (API)
app.put('/articles/:id', requireOwner, async (req, res) => {
    try {
        const { title, content, status, date } = req.body;
        if (!title || !content) {
            return res.status(400).json({ success: false, error: 'Title and content required.' });
        }

        const sanitizedContent = sanitizeArticleHtml(content);
        const articleStatus = status === 'draft' ? 'draft' : 'published';

        if (date) {
            const timestamp = new Date(date + 'T12:00:00').getTime();
            await db.run(
                'UPDATE articles SET title = ?, content = ?, status = ?, timestamp = ? WHERE id = ?',
                [title.trim(), sanitizedContent, articleStatus, timestamp, req.params.id]
            );
        } else {
            await db.run(
                'UPDATE articles SET title = ?, content = ?, status = ? WHERE id = ?',
                [title.trim(), sanitizedContent, articleStatus, req.params.id]
            );
        }
        await db.run(
            'UPDATE articles_fts SET title = ?, content = ? WHERE id = ?',
            [title.trim(), stripHtml(sanitizedContent), req.params.id]
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Failed to update article.' });
    }
});

// Delete article
app.post('/articles/:id/delete', requireOwner, async (req, res) => {
    try {
        await db.run('DELETE FROM articles WHERE id = ?', [req.params.id]);
        await db.run('DELETE FROM articles_fts WHERE id = ?', [req.params.id]);

        if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
            return res.json({ success: true });
        }

        res.redirect('/articles');
    } catch (err) {
        if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
            return res.status(500).json({ success: false });
        }
        res.status(500).send('Error deleting article.');
    }
});

// --- Start Server ---

initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log('Scrawl running at http://localhost:' + PORT);
        if (!isOwnerSetup()) {
            console.log('No owner password set. Visit http://localhost:' + PORT + '/setup to configure.');
        }
    });
});
