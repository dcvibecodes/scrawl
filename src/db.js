const fs = require('fs');
const path = require('path');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const { DATA_DIR } = require('./config');
const { stripHtml } = require('./utils/html');

let db;

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
        filename: newDbPath,
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
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT,
            subject TEXT,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            article_id TEXT,
            post_id TEXT,
            parent_id TEXT,
            author TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            approved INTEGER NOT NULL DEFAULT 0,
            is_owner INTEGER NOT NULL DEFAULT 0
        )
    `);

    // Migrate: add is_owner column if missing (for existing databases)
    try {
        await db.exec(`ALTER TABLE comments ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0`);
    } catch (e) {
        // Column already exists, ignore
    }

    // Migrate: add post_id column if missing (for existing databases)
    try {
        await db.exec(`ALTER TABLE comments ADD COLUMN post_id TEXT`);
    } catch (e) {
        // Column already exists, ignore
    }

    // Migrate: make article_id nullable (rebuild table if it was NOT NULL)
    const commentsInfo = await db.all(`PRAGMA table_info(comments)`);
    const articleIdCol = commentsInfo.find(c => c.name === 'article_id');
    if (articleIdCol && articleIdCol.notnull === 1) {
        await db.exec(`
            CREATE TABLE comments_new (
                id TEXT PRIMARY KEY,
                article_id TEXT,
                post_id TEXT,
                parent_id TEXT,
                author TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                approved INTEGER NOT NULL DEFAULT 0,
                is_owner INTEGER NOT NULL DEFAULT 0
            )
        `);
        await db.exec(`
            INSERT INTO comments_new (id, article_id, post_id, parent_id, author, content, timestamp, approved, is_owner)
            SELECT id, article_id, post_id, parent_id, author, content, timestamp, approved, is_owner
            FROM comments
        `);
        await db.exec(`DROP TABLE comments`);
        await db.exec(`ALTER TABLE comments_new RENAME TO comments`);
    }

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

// Rebuild the article search index on every boot. Cheap for a personal
// blog, and guarantees the index always matches the stripHtml() rules.
await db.run('DELETE FROM articles_fts');

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
        await stmtA.run(row.id, row.title, stripHtml(row.content));
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

function getDb() {
    return db;
}

module.exports = {
    initDatabase,
    getDb
};