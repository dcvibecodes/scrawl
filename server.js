const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
let db;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory for PWA
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Database with virtual FTS5 tables for Fuzzy Search
async function initDatabase() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
    }

    db = await open({
        filename: path.join(dataDir, 'microblog.db'),
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
    var map = {
        '&': '\x26amp;',
        '<': '\x26lt;',
        '>': '\x26gt;',
        '"': '\x26quot;',
        "'": '\x26#039;'
    };
    return String(text).replace(/[&<>"']/g, function(c) { return map[c]; });
}

function generateId() {
    try {
        return crypto.randomUUID();
    } catch {
        return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    }
}

function formatDate(timestamp) {
    return new Date(timestamp).toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric'
    });
}

function renderEntries(entries) {
    if (entries.length === 0) {
        return `<p class="no-entries">Nothing here yet.</p>`;
    }
    return entries.map(entry => {
        const dateStr = formatDate(entry.timestamp);
        const fullDate = new Date(entry.timestamp).toLocaleString();
        const safeContent = escapeHtml(entry.content);
        return `
            <div class="entry">
                <div class="date" title="${fullDate}">
                 ${dateStr}
             </div>
                <div class="content">${safeContent}</div>
                <div class="actions">
                    <a href="/post/${entry.id}" class="permalink" title="Permalink">#</a>
                    <a href="/edit/${entry.id}" class="edit-link">Edit</a>
                    <form action="/delete/${entry.id}" method="POST" style="background:none; padding:0; margin:0; display:inline;" onsubmit="return confirm('Delete this post?')">
                        <button type="submit" class="delete-btn">Delete</button>
                    </form>
                </div>
            </div>
        `;
    }).join('');
}

// Generates the inline dropdown select markup on top
function renderTopFilters(archives, selectedYear, selectedMonth) {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    // Extract unique years and months from index array records
    const years = [...new Set(archives.map(a => a.year))].sort((a, b) => b - a);
    const months = ["01","02","03","04","05","06","07","08","09","10","11","12"];

    let yearOptions = `<option value="">All Years</option>`;
    years.forEach(y => {
        yearOptions += `<option value="${y}" ${selectedYear === y ? 'selected' : ''}>${y}</option>`;
    });

    let monthOptions = `<option value="">All Months</option>`;
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

// Global Stylesheet optimized for ultra-minimalist responsive mobile viewports
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
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 20px auto; padding: 0 16px; background: var(--bg-body); color: var(--text-main); transition: background 0.2s, color 0.2s; -webkit-font-smoothing: antialiased; letter-spacing: -0.01em; }
    img, textarea, input, select, button { max-width: 100%; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; padding-bottom: 10px; }
    
    .header-controls {
    display: flex;
    align-items: center;
    line-height: 1;
    }
    .theme-toggle {
    background: none !important;
    border: none;
    color: var(--text-muted);
    text-decoration: none;
    padding: 0;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 500;
    transition: color 0.2s ease;
    line-height: 1;
}

.theme-toggle:hover {
    color: var(--text-main);
}
    
    .container { width: 100%; max-width: 100%; margin-top: 20px; }
    .main-content { width: 100%; max-width: 100%; }
    
    form, .edit-container, .search-container { background: var(--bg-card); padding: 0; margin-bottom: 30px; max-width: 100%; }
    
    textarea { width: 100%; max-width: 100%; height: 50px; padding: 12px 0; background: var(--bg-body); color: var(--text-main); border: none; border-bottom: 1px solid var(--separator-color); font-family: inherit; font-size: 1rem; outline: none; resize: none; overflow: hidden; display: block; }
    input[type="text"] { width: 100%; max-width: 100%; padding: 12px 0; background: var(--bg-body); color: var(--text-main); border: none; border-bottom: 1px solid var(--separator-color); font-family: inherit; font-size: 1rem; outline: none; }
    
    /* Mobile-responsive Filter Bar Dropdowns */
    .filter-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 30px; padding-bottom: 5px; max-width: 100%; }
    .filter-bar select { background: var(--bg-body); color: var(--text-main); border: 1px solid var(--separator-color); padding: 6px 12px; border-radius: 12px; font-family: inherit; font-size: 0.9rem; outline: none; cursor: pointer; }
    
    /* Unified high-contrast buttons */
    button, .btn, .filter-submit-btn { 
        background: #000000; 
        color: #ffffff; 
        border: none; 
        cursor: pointer; 
        font-weight: bold; 
        text-decoration: none; 
        display: inline-block; 
        transition: opacity 0.2s;
    }
    
    button, .btn { 
        padding: 10px 20px; 
        border-radius: 20px; 
        font-size: 0.9rem; 
        margin-top: 15px; 
    }
    
    .filter-submit-btn { 
        padding: 6px 14px; 
        border-radius: 12px; 
        font-size: 0.85rem; 
        margin-top: 0 !important; 
    }
    
    button:hover, .btn:hover, .filter-submit-btn:hover { 
        opacity: 0.8; 
    }
    
    [data-theme="dark"] button, 
    [data-theme="dark"] .btn, 
    [data-theme="dark"] .filter-submit-btn { 
        background: #ffffff; 
        color: #000000; 
    }
    
    .search-form {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    }
    .search-form input[type="text"] { flex: 1; min-width: 0; }
    .search-form .search-icon-btn {
    margin-top: 0;
    }
    
    .entry { background: var(--bg-card); padding: 0; padding-bottom: 25px; margin-bottom: 25px; border-bottom: 1px solid var(--separator-color); max-width: 100%; }
    .entry:last-child { border-bottom: none; }
    
    .date {
    font-size: 0.75rem;
    color: var(--text-muted);
    opacity: 0.75;
    margin-bottom: 12px;
    }
    .actions { display: flex; gap: 15px; align-items: baseline; justify-content: flex-end; }
    
    .content { white-space: pre-wrap; line-height: 1.6; font-size: 1.05rem; margin-bottom: 12px; }
    
    .edit-link { color: var(--text-muted); text-decoration: none; font-weight: bold; font-size: 0.85rem; transition: color 0.2s ease; }
    .edit-link:hover { color: var(--text-main); }
    
    .delete-btn { background: none !important; color: #d96b6b; border: none; padding: 0; margin: 0; font-size: 0.85rem; font-weight: bold; cursor: pointer; appearance: none; -webkit-appearance: none; }
    .delete-btn:hover { color: #ff7a7a; }
    [data-theme="dark"] .delete-btn { background: none !important; color: #d96b6b; }
    .cancel-btn {
    background: none;
    color: var(--text-muted);
    margin-left: 15px;
    font-weight: bold;
    text-decoration: none;
    transition: color 0.2s ease;
}

.cancel-btn:hover {
    color: var(--text-main);
    text-decoration: underline;
}
    
    .clear-search {
    font-size: 0.9rem;
    color: var(--text-muted);
    text-decoration: none;
    margin-left: 5px;
    font-weight: 500;
}

.random-link {
    color: var(--text-muted);
    text-decoration: none;
    font-size: 0.85rem;
    font-weight: 500;
    transition: color 0.2s ease;
}

.random-link:hover {
    color: var(--text-main);
}
    
.header-separator {
    color: var(--text-muted);
    opacity: 0.5;
    margin: 0 6px;
    user-select: none;
}

.back-link {
    color: var(--text-muted);
    text-decoration: none;
    font-weight: bold;
    font-size: 0.9rem;
    transition: color 0.2s ease;
}

.back-link:hover {
    color: var(--text-main);
}

.no-entries {
    text-align: center;
    color: var(--text-muted);
    margin-top: 20px;
}
    
    .permalink { color: var(--text-muted); text-decoration: none; font-size: 0.85rem; font-weight: bold; opacity: 0.5; }
    .permalink:hover { opacity: 1; }
    
    .char-counter { font-size: 0.7rem; color: var(--text-muted); opacity: 0.6; margin-top: 4px; text-align: right; }
    .shortcut-hint { font-size: 0.7rem; color: var(--text-muted); opacity: 0.5; margin-top: 8px; margin-bottom: 10px; }
    
    .search-icon-btn {
    background: none !important;
    border: none !important;
    padding: 0;
    margin: 0;
    color: var(--text-muted);
    cursor: pointer;
    opacity: 0.6;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
 }

    .search-icon-btn svg {
        width: 18px;
        height: 18px;
        display: block;
    }

    .search-icon-btn:hover {
        opacity: 1;
    }

    [data-theme="dark"] .search-icon-btn {
        background: none !important;
        color: var(--text-muted);
    }

    .back-to-top {
        position: fixed;
        right: 16px;
        bottom: 20px;
        color: var(--text-main);
        text-decoration: none;
        font-size: 1.1rem;
        opacity: 0;
        transition: opacity 0.2s ease;
        z-index: 1000;
        cursor: pointer;
        user-select: none;
    }

    .back-to-top.visible {
        opacity: 0.6;
    }

    .back-to-top:hover {
        opacity: 1;
    }
`;

const themeScript = `
    const toggleBtn = document.getElementById('themeToggle');
    const currentTheme = localStorage.getItem('theme') || 'light';
    if (currentTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        if(toggleBtn) toggleBtn.textContent = 'Light';
    }
    if(toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();

        let theme = 'light';
            if (document.documentElement.getAttribute('data-theme') !== 'dark') {
                document.documentElement.setAttribute('data-theme', 'dark');
                toggleBtn.textContent = 'Light';
                theme = 'dark';
            } else {
                document.documentElement.removeAttribute('data-theme');
                toggleBtn.textContent = 'Dark';
                theme = 'light';
            }
            localStorage.setItem('theme', theme);
        });
    }
`;

const filterExecutionScript = `
    function applyFilters() {
        const year = document.getElementById('filter-year').value;
        const month = document.getElementById('filter-month').value;
        
        if (!year && !month) {
            window.location.href = '/';
            return;
        }
        
        if (year && month) {
            window.location.href = "/archive/" + year + "/" + month;
        } else if (year) {
            window.location.href = "/archive/year/" + year;
        } else if (month) {
            window.location.href = "/archive/month/" + month;
        }
    }
`;

const textareaAutoResizeScript = `
    function attachAutoResize(textareaId) {
        const el = document.getElementById(textareaId);
        if (!el) return;
        function resize() {
            el.style.height = 'auto';
            el.style.height = el.scrollHeight + 'px';
        }
        el.addEventListener('input', resize);
        resize();
    }
`;

const layoutTemplate = ({ title, bodyContent }) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="manifest" href="/manifest.json">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="apple-mobile-web-app-title" content="Microblog">
    <link rel="apple-touch-icon" href="/icon.svg">
    <link rel="icon" type="image/svg+xml" href="/icon.svg">
    <link rel="shortcut icon" href="/icon.svg">
    <style>${sharedStyles}</style>
</head>
<body>
    <header>
    <h1><a href="/" style="color: inherit; text-decoration: none;">Microblog</a></h1>

    <div class="header-controls">
    <a href="/random" class="random-link">Random</a>
    <span class="header-separator">·</span>
    <a href="#" id="themeToggle" class="theme-toggle">Dark</a>
</div>
    </header>
    
    <div class="container">
        <main class="main-content">
            ${bodyContent}
        </main>
    </div>
    <script>${themeScript}</script>
    <script>${filterExecutionScript}</script>
    <a href="#" id="backToTop" class="back-to-top" aria-label="Back to top">↑</a>
    <script>
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js');
        }
    </script>
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            var backToTop = document.getElementById('backToTop');
            if (!backToTop) return;
            window.addEventListener('scroll', function() {
                if (window.scrollY > 500) {
                    backToTop.classList.add('visible');
                } else {
                    backToTop.classList.remove('visible');
                }
            });
            backToTop.addEventListener('click', function(e) {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        });
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

// Routes

app.get('/', async (req, res) => {
    try {
        const searchQuery = req.query.q || '';
        let entries;

        const archives = await getArchives();

        if (searchQuery) {
            const formattedQuery = `${searchQuery.trim()}*`;
            entries = await db.all(`
                SELECT entries.* FROM entries
                JOIN entries_fts ON entries.id = entries_fts.id
                WHERE entries_fts.content MATCH ?
                ORDER BY entries.timestamp DESC
            `, [formattedQuery]);
        } else {
            entries = await db.all('SELECT * FROM entries ORDER BY timestamp DESC');
        }

        const entriesHTML = renderEntries(entries);
        const topFiltersHTML = renderTopFilters(archives, null, null);

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
                    ${searchQuery ? `<a href="/" class="clear-search">Clear</a>` : ''}
                </form>
            </div>
            
            ${topFiltersHTML}
            
            <form action="/add" method="POST">
                <textarea id="main-publish-box" name="content" placeholder="Share a thought..." required></textarea>
                <div class="char-counter" id="char-counter">0 characters</div>
                <div class="shortcut-hint">Shortcuts: <kbd>N</kbd> = new post &middot; <kbd>/</kbd> = search</div>
                <button type="submit">Publish</button>
            </form>

            <div id="entries">${entriesHTML}</div>
            
            <script>
                ${textareaAutoResizeScript}
                attachAutoResize('main-publish-box');
                
                // Character counter
                const publishBox = document.getElementById('main-publish-box');
                const charCounter = document.getElementById('char-counter');
                if (publishBox && charCounter) {
                    publishBox.addEventListener('input', function() {
                        charCounter.textContent = this.value.length + ' characters';
                    });
                }
                
                // Keyboard shortcuts
                document.addEventListener('keydown', function(e) {
                    const tag = e.target.tagName.toLowerCase();
                    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
                    
                    if (e.key === 'n' || e.key === 'N') {
                        e.preventDefault();
                        const composeBox = document.getElementById('main-publish-box');
                        if (composeBox) composeBox.focus();
                    }
                    if (e.key === '/') {
                        e.preventDefault();
                        const searchField = document.getElementById('search-field');
                        if (searchField) searchField.focus();
                    }
                });
            </script>
        `;

        res.send(layoutTemplate({ title: "Microblog", bodyContent }));
    } catch (err) {
        res.status(500).send("Error rendering dashboard view.");
    }
});

app.get('/random', async (req, res) => {
    try {
        const entry = await db.get(`
            SELECT id
            FROM entries
            ORDER BY RANDOM()
            LIMIT 1
        `);

        if (!entry) {
            return res.redirect('/');
        }

        res.redirect(`/post/${entry.id}`);
    } catch (err) {
        res.status(500).send('Error fetching random post.');
    }
});

app.get('/post/:id', async (req, res) => {
    try {
        const entry = await db.get('SELECT * FROM entries WHERE id = ?', [req.params.id]);
        if (!entry) return res.status(404).send("Post not found.");

        const dateStr = formatDate(entry.timestamp);
        const fullDate = new Date(entry.timestamp).toLocaleString();
        const safeContent = escapeHtml(entry.content);

        const bodyContent = `
            <div class="entry" style="border-bottom: none;">
                <div class="date" title="${fullDate}">
                 ${dateStr}
             </div>
                <div class="content">${safeContent}</div>
                <div class="actions">
                    <a href="/edit/${entry.id}" class="edit-link">Edit</a>
                    <form action="/delete/${entry.id}" method="POST" style="background:none; padding:0; margin:0; display:inline;" onsubmit="return confirm('Delete this post?')">
                        <button type="submit" class="delete-btn">Delete</button>
                    </form>
                </div>
            </div>
            <p style="margin-top: 30px;"><a href="/" class="back-link">
    &larr; Back
        </a></p>
        `;

        res.send(layoutTemplate({ title: "Post", bodyContent }));
    } catch (err) {
        res.status(500).send("Error fetching post.");
    }
});

// Archive: year only - shows all posts from a given year
app.get('/archive/year/:year', async (req, res) => {
    try {
        const { year } = req.params;
        const archives = await getArchives();

        const entries = await db.all(`
            SELECT * FROM entries 
            WHERE strftime('%Y', timestamp / 1000, 'unixepoch') = ?
            ORDER BY timestamp DESC
        `, [year]);

        const entriesHTML = renderEntries(entries);
        const topFiltersHTML = renderTopFilters(archives, year, null);

        const bodyContent = `
            ${topFiltersHTML}

            <h2 style="margin-top: 10px; margin-bottom: 25px; font-size: 1rem; color: var(--text-muted); font-weight: normal;">
                Showing entries from ${year}
                <a href="/" class="back-link" style="margin-left:15px;">Back to all</a>
            </h2>
            <div id="entries">${entriesHTML}</div>
        `;

        res.send(layoutTemplate({ title: `Archive - ${year}`, bodyContent }));
    } catch (err) {
        res.status(500).send("Error fetching year archive.");
    }
});

// Archive: month only - shows all posts from a given month across all years
app.get('/archive/month/:month', async (req, res) => {
    try {
        const { month } = req.params;
        const archives = await getArchives();
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const monthName = monthNames[parseInt(month, 10) - 1] || month;

        const entries = await db.all(`
            SELECT * FROM entries 
            WHERE strftime('%m', timestamp / 1000, 'unixepoch') = ?
            ORDER BY timestamp DESC
        `, [month]);

        const entriesHTML = renderEntries(entries);
        const topFiltersHTML = renderTopFilters(archives, null, month);

        const bodyContent = `
            ${topFiltersHTML}

            <h2 style="margin-top: 10px; margin-bottom: 25px; font-size: 1rem; color: var(--text-muted); font-weight: normal;">
                Showing entries from ${monthName}
                <a href="/" class="back-link" style="margin-left:15px;">Back to all</a>
            </h2>
            <div id="entries">${entriesHTML}</div>
        `;

        res.send(layoutTemplate({ title: `Archive - ${monthName}`, bodyContent }));
    } catch (err) {
        res.status(500).send("Error fetching month archive.");
    }
});

// Archive: year and month combined
app.get('/archive/:year/:month', async (req, res) => {
    try {
        const { year, month } = req.params;
        const archives = await getArchives();
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const monthName = monthNames[parseInt(month, 10) - 1] || month;

        const entries = await db.all(`
            SELECT * FROM entries 
            WHERE strftime('%Y', timestamp / 1000, 'unixepoch') = ? 
              AND strftime('%m', timestamp / 1000, 'unixepoch') = ?
            ORDER BY timestamp DESC
        `, [year, month]);

        const entriesHTML = renderEntries(entries);
        const topFiltersHTML = renderTopFilters(archives, year, month);

        const bodyContent = `
            ${topFiltersHTML}

            <h2 style="margin-top: 10px; margin-bottom: 25px; font-size: 1rem; color: var(--text-muted); font-weight: normal;">
                Showing entries from ${monthName} ${year}
                <a href="/" class="back-link" style="margin-left:15px;">Back to all</a>
            </h2>
            <div id="entries">${entriesHTML}</div>
        `;

        res.send(layoutTemplate({ title: `Archive - ${monthName} ${year}`, bodyContent }));
    } catch (err) {
        res.status(500).send("Error fetching archive.");
    }
});

app.get('/edit/:id', async (req, res) => {
    try {
        const entry = await db.get('SELECT * FROM entries WHERE id = ?', [req.params.id]);
        if (!entry) return res.status(404).send("Post not found.");

        const bodyContent = `
            <div class="edit-container">
                <form action="/edit/${entry.id}" method="POST" style="margin:0;">
                    <textarea id="edit-box" name="content" required>${entry.content}</textarea>
                    <div>
                        <button type="submit">Update Post</button>
                        <a href="/" class="cancel-btn">Cancel</a>
                    </div>
                </form>
            </div>
            
            <script>
                ${textareaAutoResizeScript}
                attachAutoResize('edit-box');
            </script>
        `;

        res.send(layoutTemplate({ title: "Edit Post", bodyContent }));
    } catch (err) {
        res.status(500).send("Error fetching target record elements.");
    }
});

app.post('/edit/:id', async (req, res) => {
    try {
        const { content } = req.body;
        await db.run('UPDATE entries SET content = ? WHERE id = ?', [content, req.params.id]);
        await db.run('UPDATE entries_fts SET content = ? WHERE id = ?', [content, req.params.id]);
        res.redirect('/');
    } catch (err) {
        res.status(500).send("Error modifying structural records.");
    }
});

app.post('/add', async (req, res) => {
    try {
        const id = generateId();
        const content = req.body.content;
        const timestamp = Date.now();

        await db.run('INSERT INTO entries (id, content, timestamp) VALUES (?, ?, ?)', [id, content, timestamp]);
        await db.run('INSERT INTO entries_fts (id, content) VALUES (?, ?)', [id, content]);
        
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error writing record to database cluster.");
    }
});

app.post('/delete/:id', async (req, res) => {
    try {
        await db.run('DELETE FROM entries WHERE id = ?', [req.params.id]);
        await db.run('DELETE FROM entries_fts WHERE id = ?', [req.params.id]);
        res.redirect('/');
    } catch (err) {
        res.status(500).send("Error executing structural erasure queries.");
    }
});

initDatabase().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Microblog running at http://199.192.16.197:${PORT}`);
    });
});