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
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const BCRYPT_ROUNDS = 12;
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_BLOG_TITLE = 'Scrawl';
const DEFAULT_SETTINGS = {
    landingPage: 'posts',      // 'posts' | 'articles' | 'custom'  (public homepage for visitors)
    ownerHome: 'default',      // 'default' | 'posts' | 'articles' (owner's landing page)
    postsEnabled: true,
    articlesEnabled: true,
    commentsOnPostsEnabled: true,
    commentsOnArticlesEnabled: true,
    contactEnabled: true,
    lightTheme: 'sepia',       // 'sepia' | 'white' | 'pink'  (site-wide light palette; dark mode is per-visitor)
    customLandingContent: ''
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

function saveSettings(settings) {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8');
}

module.exports = {
    DATA_DIR,
    HASH_FILE,
    SECRET_FILE,
    BLOG_TITLE_FILE,
    COPYRIGHT_FILE,
    OWNER_NAME_FILE,
    SETTINGS_FILE,
    BCRYPT_ROUNDS,
    SESSION_MAX_AGE,
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
    getSettings,
    saveSettings
};
