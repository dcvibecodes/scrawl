const fs = require('fs');
const path = require('path');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const { XMLParser } = require('fast-xml-parser');

// Start URL with max allowable per-page results
let nextUrl = 'https://dancanvell.blogspot.com/feeds/posts/default?max-results=500';

async function fetchAndImport() {
    const dataDir = path.join(__dirname, 'data');
    const dbPath = path.join(dataDir, 'microblog.db');

    console.log("Connecting to local SQLite database...");
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    const parser = new XMLParser({ ignoreAttributes: false });
    let totalImportedCount = 0;
    let page = 1;

    try {
        while (nextUrl) {
            console.log(`[Page ${page}] Fetching from: ${nextUrl}`);
            const response = await fetch(nextUrl);
            if (!response.ok) throw new Error(`HTTP Error Status: ${response.status}`);
            
            const xmlData = await response.text();
            const jsonObj = parser.parse(xmlData);

            const entries = jsonObj.feed.entry || [];
            const entryArray = Array.isArray(entries) ? entries : [entries]; 
            
            if (entryArray.length === 0 || !entries) {
                console.log("No more entries found.");
                break;
            }

            let pageImportCount = 0;
            for (const entry of entryArray) {
                let content = '';
                if (entry.content) {
                    content = entry.content['#text'] || entry.content || '';
                }
                if (!content) continue;

                const publishedDate = entry.published ? new Date(entry.published).getTime() : Date.now();
                const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

                await db.run(
                    'INSERT INTO entries (id, content, timestamp) VALUES (?, ?, ?)',
                    [id, content, publishedDate]
                );
                pageImportCount++;
                totalImportedCount++;
            }

            console.log(`Saved ${pageImportCount} entries from this page.`);

            // Look for the "next" page link in the Atom structure
            const links = jsonObj.feed.link || [];
            const nextLinkObj = links.find(link => link['@_rel'] === 'next');
            
            if (nextLinkObj && nextLinkObj['@_href']) {
                nextUrl = nextLinkObj['@_href'];
                page++;
                // Small sleep timer to prevent aggressive rate-limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                nextUrl = null; // No more pages left
            }
        }

        console.log(`Finished! Successfully migrated a total of ${totalImportedCount} posts.`);
    } catch (error) {
        console.error("Migration pipeline failed:", error.message);
    } finally {
        await db.close();
    }
}

fetchAndImport();