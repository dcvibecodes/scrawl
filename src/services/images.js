const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let sharp;
try { sharp = require('sharp'); } catch (e) { sharp = null; console.warn('[images] sharp not available — storing originals without processing'); }
const { DATA_DIR } = require('../config');
const { getDb } = require('../db');
const { extractImageRefs } = require('../utils/html');

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'jpg', 'image/heif': 'jpg' };
const MAX_DIMENSION = 2000;
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

function ensureUploadsDir() {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function isValidImageId(id) {
    return typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
}

// Re-encode: strips EXIF/GPS metadata, downsizes huge dimensions, compresses.
async function storeImage(file) {
    if (!EXT_BY_MIME[file.mimetype]) {
        throw Object.assign(new Error('Unsupported image type. Use PNG, JPEG, WebP, or GIF.'), { status: 400 });
    }

    ensureUploadsDir();
    let out, ext, outMeta;
    if (sharp) {
        try {
            let pipeline = sharp(file.buffer, { failOn: 'error' });
            const meta = await pipeline.metadata();
            if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) {
                pipeline = pipeline.resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true });
            }
            if (file.mimetype === 'image/gif') {
                out = await pipeline.gif().toBuffer(); ext = 'gif';
            } else if (file.mimetype === 'image/png') {
                out = await pipeline.png({ compressionLevel: 9 }).toBuffer(); ext = 'png';
            } else if (file.mimetype === 'image/webp') {
                out = await pipeline.webp({ quality: 82 }).toBuffer(); ext = 'webp';
            } else {
                out = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer(); ext = 'jpg';
            }
            outMeta = await sharp(out).metadata();
        } catch (e) {
            // HEIC on sharp without HEIF support — store original instead of failing
            if (file.mimetype === 'image/heic' || file.mimetype === 'image/heif') {
                out = file.buffer;
                ext = 'heic';
                outMeta = {};
            } else {
                throw Object.assign(new Error('Unsupported or corrupt image file.'), { status: 400 });
            }
        }
    } else {
        // Fallback: store original without processing (no EXIF strip, no resize)
        // For HEIC/HEIF, keep original extension so iOS Safari can display it
        out = file.buffer;
        if (file.mimetype === 'image/heic' || file.mimetype === 'image/heif') ext = 'heic';
        else ext = EXT_BY_MIME[file.mimetype];
        outMeta = {};
    }

    const id = crypto.randomUUID();
    const filename = `${id}.${ext}`;
    try {
        fs.writeFileSync(path.join(UPLOADS_DIR, filename), out);
        const db = getDb();
        await db.run(
            'INSERT INTO images (id, filename, mime, bytes, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, filename, `image/${ext === 'jpg' ? 'jpeg' : ext}`, out.length, outMeta.width || null, outMeta.height || null, Date.now()]
        );
    } catch (e) {
        try { fs.unlinkSync(path.join(UPLOADS_DIR, filename)); } catch (e2) {}
        throw Object.assign(new Error('Could not save image.'), { status: 500 });
    }

    return { id, url: `/images/${filename}`, mime: `image/${ext === 'jpg' ? 'jpeg' : ext}`, bytes: out.length, width: outMeta.width, height: outMeta.height };
}

// Delete one image: file from disk + row from DB. Missing file is fine.
async function deleteImageById(id) {
    if (!isValidImageId(id)) return false;
    const db = getDb();
    const row = await db.get('SELECT filename FROM images WHERE id = ?', [id]);
    if (!row) return false;
    try { fs.unlinkSync(path.join(UPLOADS_DIR, row.filename)); } catch (e) {}
    await db.run('DELETE FROM images WHERE id = ?', [id]);
    return true;
}

async function gcImageRefs(refIds) {
    for (const id of refIds) {
        await deleteImageById(id);
    }
    return refIds.length;
}

// Boot-time safety net: remove rows whose image is referenced by nothing
// (deleted content, abandoned draft uploads) after a 24h grace period.
async function reconcileOrphans() {
    const db = getDb();
    const rows = await db.all('SELECT id, filename, created_at FROM images');
    if (!rows.length) return 0;

    const keep = new Set();
    const addRefs = (html) => extractImageRefs(html).forEach((id) => keep.add(id));

    const entries = await db.all('SELECT content FROM entries');
    entries.forEach((r) => addRefs(r.content));
    const articles = await db.all('SELECT content FROM articles');
    articles.forEach((r) => addRefs(r.content));
    // settings lives in a flat file, not SQLite
    const { getSettings } = require('../config');
    addRefs(getSettings().customLandingContent || '');
    (getSettings().customPages || []).forEach(function(p){ addRefs(p.content || ''); });

    const cutoff = Date.now() - ORPHAN_GRACE_MS;
    let removed = 0;
    for (const row of rows) {
        if (!keep.has(row.id) && row.created_at < cutoff) {
            try { fs.unlinkSync(path.join(UPLOADS_DIR, row.filename)); } catch (e) {}
            await db.run('DELETE FROM images WHERE id = ?', [row.id]);
            removed++;
        }
    }
    if (removed) console.log(`Images: purged ${removed} orphaned file(s).`);
    return removed;
}

module.exports = {
    UPLOADS_DIR,
    EXT_BY_MIME,
    ensureUploadsDir,
    isValidImageId,
    storeImage,
    deleteImageById,
    gcImageRefs,
    reconcileOrphans
};
