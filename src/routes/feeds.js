const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { getBlogTitle } = require('../config');
const { requireOwner } = require('../middleware/auth');
const { escapeHtml, stripHtml } = require('../utils/html');

// --- RSS Feeds ---

router.get('/feed/posts', async (req, res) => {
    try {
        const db = getDb();
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

router.get('/feed/articles', async (req, res) => {
    try {
        const db = getDb();
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

router.get('/sitemap.xml', async (req, res) => {
    try {
        const db = getDb();
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

// --- JSON API for LLMs ---

router.get('/api/posts', async (req, res) => {
    try {
        const db = getDb();
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

// --- Export (Markdown download) ---

router.get('/api/export', requireOwner, async (req, res) => {
    try {
        const db = getDb();
        const articles = await db.all("SELECT * FROM articles ORDER BY timestamp DESC");
        const entries = await db.all('SELECT * FROM entries ORDER BY timestamp DESC');
        const blogTitle = getBlogTitle();

        let md = `# ${blogTitle} — Full Export\n\n`;
        md += `Exported on ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}\n\n`;

        // Articles section
        if (articles.length > 0) {
            md += `---\n\n## Articles (${articles.length})\n\n`;
            for (const article of articles) {
                const date = new Date(article.timestamp).toLocaleDateString('en-US', {
                    month: 'long', day: 'numeric', year: 'numeric'
                });
                const plainContent = stripHtml(article.content);
                const draftLabel = article.status === 'draft' ? ' (draft)' : '';
                md += `### ${article.title}${draftLabel}\n\n`;
                md += `Date: ${date}\n\n`;
                md += `URL: ${req.protocol}://${req.get('host')}/articles/${article.id}\n\n`;
                md += `${plainContent}\n\n`;
                md += `---\n\n`;
            }
        }

        // Posts section
        if (entries.length > 0) {
            md += `## Posts (${entries.length})\n\n`;
            for (const entry of entries) {
                const date = new Date(entry.timestamp).toLocaleDateString('en-US', {
                    month: 'long', day: 'numeric', year: 'numeric'
                });
                md += `Date: ${date}\n\n`;
                md += `URL: ${req.protocol}://${req.get('host')}/post/${entry.id}\n\n`;
                md += `${entry.content}\n\n`;
                md += `---\n\n`;
            }
        }

        const filename = blogTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-export.md';
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(md);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error generating export.');
    }
});

module.exports = router;