const fs = require('fs');
const path = require('path');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const { XMLParser } = require('fast-xml-parser');

// Helper function to strip HTML tags and convert text to pure plain text safely
function stripHTML(htmlString) {
    if (!htmlString) return '';
    
    // Force conversion to a real string case type to prevent object crashes
    let text = String(htmlString);
    
    // 1. Replace line breaks (<br>, <p>, <div> closures) with actual text newlines
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n');
    text = text.replace(/<\/div>/gi, '\n');
    
    // 2. Strip out all remaining HTML tags using a global regex match
    text = text.replace(/<[^>]+>/g, '');
    
    // 3. Decode common basic HTML entities
    text = text.replaceAll('&nbsp;', ' ')
               .replaceAll('&amp;', '&')
               .replaceAll('&lt;', '<')
               .replaceAll('&gt;', '>')
               .replaceAll('&quot;', '"')
               .replaceAll('&#39;', "'");
               
    return text.trim();
}

async function foolproofImport() {
    const xmlPath = path.join(__dirname, 'feed.atom');
    const dataDir = path.join(__dirname, 'data');
    const dbPath = path.join(dataDir, 'microblog.db');

    if (!fs.existsSync(xmlPath)) {
        console.error("❌ Critical Error: 'feed.atom' not found in your microblog folder.");
        return;
    }

    console.log("🔄 Connecting to SQLite database...");
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    console.log("实时 Wiping database tables for a fresh, plain-text import...");
    await db.run('DELETE FROM entries');
    await db.run('DELETE FROM entries_fts');

    console.log("📖 Reading feed.atom file into memory...");
    const xmlData = fs.readFileSync(xmlPath, 'utf8');
    
    const parser = new XMLParser({ 
        ignoreAttributes: false,
        attributeNamePrefix: "@_"
    });
    
    const jsonObj = parser.parse(xmlData);
    const entries = jsonObj.feed.entry || [];
    const entryArray = Array.isArray(entries) ? entries : [entries];

    let successCount = 0;
    console.log(`🚀 Processing ${entryArray.length} entries into clean plain text...`);

    const insertEntry = await db.prepare('INSERT INTO entries (id, content, timestamp) VALUES (?, ?, ?)');
    const insertFTS = await db.prepare('INSERT INTO entries_fts (id, content) VALUES (?, ?)');

    for (const entry of entryArray) {
        const idUri = entry.id || '';
        if (!idUri.includes('.post-')) continue;

        if (entry['app:control'] && entry['app:control']['app:draft'] === 'yes') {
            continue;
        }

        let rawContent = '';
        if (entry.content) {
            rawContent = entry.content['#text'] || entry.content || '';
        }

        // Apply HTML stripping pipeline
        const plainTextContent = stripHTML(rawContent);

        if (!plainTextContent) continue;

        const publishedDate = entry.published ? new Date(entry.published).getTime() : Date.now();
        const uniqueId = Math.random().toString(36).substr(2, 9) + Date.now().toString(36);

        try {
            await insertEntry.run([uniqueId, plainTextContent, publishedDate]);
            await insertFTS.run([uniqueId, plainTextContent]);
            successCount++;
        } catch (insertErr) {
            console.error(`⚠️ Error skipping item: ${insertErr.message}`);
        }
    }

    await insertEntry.finalize();
    await insertFTS.finalize();
    
    console.log(`\n✨ Success! Fully imported ${successCount} clean plain-text posts.`);
    await db.close();
}

foolproofImport().catch(console.error);