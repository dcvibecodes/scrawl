const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Allow tests to isolate data (env var override; production uses ./data)
const DATA_DIR = process.env.SCRAWL_DATA_DIR
    ? path.resolve(process.env.SCRAWL_DATA_DIR)
    : path.join(__dirname, '..', 'data');
const HASH_FILE = path.join(DATA_DIR, 'owner.hash');
const SECRET_FILE = path.join(DATA_DIR, 'session.secret');
const BLOG_TITLE_FILE = path.join(DATA_DIR, 'blog-title.txt');
const COPYRIGHT_FILE = path.join(DATA_DIR, 'copyright.txt');
const OWNER_NAME_FILE = path.join(DATA_DIR, 'owner-name.txt');
const OWNER_USER_FILE = path.join(DATA_DIR, 'owner-user.txt');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const BCRYPT_ROUNDS = 12;
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_BLOG_TITLE = 'Scrawl';
const MAX_CUSTOM_PAGES = 5;
const DEFAULT_SETTINGS = {
    landingPage: 'posts',      // 'posts' | 'articles' | 'custom'  (public homepage for visitors)
    ownerHome: 'default',      // 'default' | 'posts' | 'articles' (owner's landing page)
    postsEnabled: true,
    articlesEnabled: true,
    commentsOnPostsEnabled: true,
    commentsOnArticlesEnabled: true,
    contactEnabled: true,
    lightTheme: 'sepia',       // 'sepia' | 'white' | 'pink' | 'alice'  (site-wide light palette; dark mode is per-visitor)
    customLandingContent: '',
    customPages: []            // up to 5 { id, name, content } — order = array order, URL = /p/:id
};

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

function getOwnerName() {
    if (!fs.existsSync(OWNER_NAME_FILE)) return '';
    return fs.readFileSync(OWNER_NAME_FILE, 'utf8').trim();
}

function saveOwnerName(name) {
    fs.writeFileSync(OWNER_NAME_FILE, name.trim(), 'utf8');
}

// Owner username — handle-style: 3-30 chars, lowercase a-z 0-9 dashes.
// Stored normalized lowercase so comparisons are case-insensitive.
function isValidUsername(u) {
    return typeof u === 'string' && /^[a-z0-9-]{3,30}$/.test(u);
}

function normalizeUsername(u) {
    return String(u || '').trim().toLowerCase();
}

function getOwnerUser() {
    if (!fs.existsSync(OWNER_USER_FILE)) return '';
    const u = normalizeUsername(fs.readFileSync(OWNER_USER_FILE, 'utf8'));
    return isValidUsername(u) ? u : '';
}

function saveOwnerUser(u) {
    const normalized = normalizeUsername(u);
    if (!isValidUsername(normalized)) {
        throw new Error('Invalid username: use 3-30 lowercase letters, numbers, or dashes.');
    }
    fs.writeFileSync(OWNER_USER_FILE, normalized, 'utf8');
}

function getSettings() {
    if (!fs.existsSync(SETTINGS_FILE)) {
        return { ...DEFAULT_SETTINGS };
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        return { ...DEFAULT_SETTINGS, ...parsed };
    } catch (e) {
        return { ...DEFAULT_SETTINGS };
    }
}

function getCustomPages() {
    const s = getSettings();
    return Array.isArray(s.customPages) ? s.customPages : [];
}

function saveSettings(settings) {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    // normalize customPages: keep at most MAX, ensure shape
    if (Array.isArray(merged.customPages)) {
        merged.customPages = merged.customPages.slice(0, MAX_CUSTOM_PAGES).map(function(p) {
            return { id: String(p.id || ''), name: String(p.name || '').trim().slice(0, 50), content: String(p.content || '') };
        }).filter(function(p) { return p.id && p.name; });
    } else {
        merged.customPages = [];
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8');
}

module.exports = {
    DATA_DIR,
    HASH_FILE,
    SECRET_FILE,
    BLOG_TITLE_FILE,
    COPYRIGHT_FILE,
    OWNER_NAME_FILE,
    OWNER_USER_FILE,
    SETTINGS_FILE,
    BCRYPT_ROUNDS,
    SESSION_MAX_AGE,
    MAX_CUSTOM_PAGES,
    DEFAULT_BLOG_TITLE,
    DEFAULT_SETTINGS,
    getSessionSecret,
    isOwnerSetup,
    getOwnerHash,
    getBlogTitle,
    saveBlogTitle,
    getCopyright,
    saveCopyright,
    getOwnerName,
    saveOwnerName,
    isValidUsername,
    normalizeUsername,
    getOwnerUser,
    saveOwnerUser,
    getSettings,
    getCustomPages,
    saveSettings
};
