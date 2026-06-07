const express = require('express');
const fs = require('fs');
const path = require('path');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');

const app = express();
const PORT = 3000;
let db;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

function renderEntries(entries) {
    if (entries.length === 0) {
        return `<p class="no-entries">No entries found.</p>`;
    }
    return entries.map(entry => {
        const dateStr = new Date(entry.timestamp).toLocaleString();
        return `
            <div class="entry">
                <div class="date">${dateStr}</div>
                <div class="content">${entry.content}</div>
                <div class="actions">
                    <a href="/edit/${entry.id}" class="edit-link">Edit</a>
                    <form action="/delete/${entry.id}" method="POST" style="background:none; padding:0; margin:0; display:inline;">
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

    return `
        <div class="filter-bar">
            <select id="filter-year" aria-label="Filter by Year">${yearOptions}</select>
            <select id="filter-month" aria-label="Filter by Month">${monthOptions}</select>
            <button type="button" onclick="applyFilters()" class="filter-submit-btn">Filter</button>
            ${(selectedYear || selectedMonth) ? `<a href="/" class="clear-search">Clear Filters</a>` : ''}
        </div>
    `;
}

// Global Stylesheet optimized for ultra-minimalist responsive mobile viewports
const sharedStyles = `
    :root {
        --bg-body: #ffffff;
        --bg-card: #ffffff;
        --text-main: #333333;
        --text-muted: #666666;
        --separator-color: #eeeeee;
    }
    [data-theme="dark"] {
        --bg-body: #000000;
        --bg-card: #000000;
        --text-main: #e0e0e0;
        --text-muted: #888888;
        --separator-color: #222222;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 20px auto; padding: 0 16px; background: var(--bg-body); color: var(--text-main); transition: background 0.2s, color 0.2s; -webkit-font-smoothing: antialiased; letter-spacing: -0.01em; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; padding-bottom: 10px; }
    
    .theme-toggle { background: none; border: 1px solid var(--text-main); color: var(--text-main); padding: 6px 14px; border-radius: 20px; cursor: pointer; font-size: 0.85rem; font-weight: 500; }
    
    .container { width: 100%; margin-top: 20px; }
    .main-content { width: 100%; }
    
    form, .edit-container, .search-container { background: var(--bg-card); padding: 0; margin-bottom: 30px; }
    
    textarea { width: 100%; height: 50px; padding: 12px 0; background: var(--bg-body); color: var(--text-main); border: none; border-bottom: 1px solid var(--separator-color); font-family: inherit; font-size: 1rem; outline: none; resize: none; overflow: hidden; display: block; }
    input[type="text"] { width: 100%; padding: 12px 0; background: var(--bg-body); color: var(--text-main); border: none; border-bottom: 1px solid var(--separator-color); font-family: inherit; font-size: 1rem; outline: none; }
    
    /* Mobile-responsive Filter Bar Dropdowns */
    .filter-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 30px; padding-bottom: 5px; }
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
    
    .search-form { display: flex; gap: 15px; align-items: center; }
    .search-form button { margin-top: 0; }
    
    .entry { background: var(--bg-card); padding: 0; padding-bottom: 25px; margin-bottom: 25px; border-bottom: 1px solid var(--separator-color); }
    .entry:last-child { border-bottom: none; }
    
    .date { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px; }
    .actions { display: flex; gap: 15px; align-items: baseline; justify-content: flex-end; }
    
    .content { white-space: pre-wrap; line-height: 1.6; font-size: 1.05rem; margin-bottom: 12px; }
    
    .edit-link { color: #1da1f2; text-decoration: none; font-weight: bold; font-size: 0.85rem; }
    .edit-link:hover { text-decoration: underline; }
    
    .delete-btn { background: none; color: #ff4d4d; border: none; padding: 0; font-size: 0.85rem; font-weight: bold; cursor: pointer; margin: 0; }
    .delete-btn:hover { text-decoration: underline; }
    .cancel-btn { background: none; color: var(--text-muted); margin-left: 15px; font-weight: bold; }
    .cancel-btn:hover { text-decoration: underline; }
    
    .clear-search { font-size: 0.9rem; color: #1da1f2; text-decoration: none; margin-left: 5px; font-weight: 500; }
    .no-entries { text-align: center; color: var(--text-muted); margin-top: 20px; }
`;

const themeScript = `
    const toggleBtn = document.getElementById('themeToggle');
    const currentTheme = localStorage.getItem('theme') || 'light';
    if (currentTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        if(toggleBtn) toggleBtn.textContent = 'Light';
    }
    if(toggleBtn) {
        toggleBtn.addEventListener('click', () => {
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
        
        // Dynamic fallback selection routing
        const targetYear = year || new Date().getFullYear().toString();
        const targetMonth = month || "01";
        
        window.location.href = "/archive/" + targetYear + "/" + targetMonth;
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
    <style>${sharedStyles}</style>
</head>
<body>
    <header>
        <h1><a href="/" style="color: inherit; text-decoration: none;">Microblog</a></h1>
        <button id="themeToggle" class="theme-toggle">Dark</button>
    </header>
    
    <div class="container">
        <main class="main-content">
            ${bodyContent}
        </main>
    </div>
    <script>${themeScript}</script>
    <script>${filterExecutionScript}</script>
</body>
</html>
`;

// Routes

app.get('/', async (req, res) => {
    try {
        const searchQuery = req.query.q || '';
        let entries;

        const archives = await db.all(`
            SELECT strftime('%Y', timestamp / 1000, 'unixepoch') AS year,
                   strftime('%m', timestamp / 1000, 'unixepoch') AS month,
                   COUNT(*) AS count 
            FROM entries 
            GROUP BY year, month 
            ORDER BY year DESC, month DESC
        `);

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
                    <input type="text" name="q" placeholder="Fuzzy search" value="${searchQuery}">
                    <button type="submit">Search</button>
                    ${searchQuery ? `<a href="/" class="clear-search">Clear</a>` : ''}
                </form>
            </div>
            
            ${topFiltersHTML}
            
            <form action="/add" method="POST">
                <textarea id="main-publish-box" name="content" placeholder="Share a thought..." required></textarea>
                <button type="submit">Publish</button>
            </form>

            <div id="entries">${entriesHTML}</div>
            
            <script>
                ${textareaAutoResizeScript}
                attachAutoResize('main-publish-box');
            </script>
        `;

        res.send(layoutTemplate({ title: "Microblog", bodyContent }));
    } catch (err) {
        res.status(500).send("Error rendering dashboard view.");
    }
});

app.get('/archive/:year/:month', async (req, res) => {
    try {
        const { year, month } = req.params;

        const archives = await db.all(`
            SELECT strftime('%Y', timestamp / 1000, 'unixepoch') AS year,
                   strftime('%m', timestamp / 1000, 'unixepoch') AS month,
                   COUNT(*) AS count 
            FROM entries 
            GROUP BY year, month 
            ORDER BY year DESC, month DESC
        `);

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
                Showing entries from ${month}/${year} 
                <a href="/" style="font-size:0.85rem; margin-left: 15px; color:#1da1f2; text-decoration:none; font-weight: bold;">Back to all</a>
            </h2>
            <div id="entries">${entriesHTML}</div>
        `;

        res.send(layoutTemplate({ title: `Archive - ${month}/${year}`, bodyContent }));
    } catch (err) {
        res.status(500).send("Error pulling structural monthly history logs.");
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
                        <a href="/" class="btn cancel-btn">Cancel</a>
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
        const id = Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
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