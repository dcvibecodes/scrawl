const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');
const { app, setupTestDb, cleanupTestData, TEST_DATA_DIR } = require('./helpers');
const { getDb } = require('../src/db');
const { sanitizeArticleHtml, extractImageRefs } = require('../src/utils/html');
const imageStore = require('../src/services/images');

let agent;
let pngBuf, jpgBuf;

before(async () => {
    await setupTestDb();
    agent = request.agent(app);
    await agent
        .post('/setup')
        .type('form')
        .send({ username: 'testowner', password: 'test-password-123', confirm: 'test-password-123' });
    pngBuf = await sharp({ create: { width: 80, height: 60, channels: 3, background: { r: 200, g: 100, b: 50 } } }).png().toBuffer();
    jpgBuf = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 10, g: 150, b: 90 } } }).jpeg().toBuffer();
});

after(() => {
    cleanupTestData();
});

const uploadsDir = path.join(TEST_DATA_DIR, 'uploads');

function upload(buf, opts = {}) {
    return agent
        .post('/api/images')
        .attach('image', buf, { filename: opts.name || 't.png', contentType: opts.type || 'image/png' });
}

// ---------- upload endpoint ----------
test('POST /api/images requires owner auth', async () => {
    const res = await request(app).post('/api/images').attach('image', pngBuf, { filename: 'x.png', contentType: 'image/png' });
    assert.strictEqual(res.status, 403);
});

test('POST /api/images uploads a PNG and serves it back', async () => {
    const res = await upload(pngBuf);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.match(res.body.url, /^\/images\/[a-f0-9-]{36}\.png$/);
    const filePath = path.join(uploadsDir, res.body.url.replace('/images/', ''));
    assert.ok(fs.existsSync(filePath));
    const served = await request(app).get(res.body.url);
    assert.strictEqual(served.status, 200);
    assert.strictEqual(served.headers['content-type'], 'image/png');
    assert.match(served.headers['cache-control'] || '', /immutable/);
});

test('POST /api/images re-encodes JPEG (compresses, strips EXIF)', async () => {
    const res = await upload(jpgBuf, { name: 't.jpg', type: 'image/jpeg' });
    assert.strictEqual(res.status, 200);
    assert.match(res.body.url, /\.jpg$/);
    assert.ok(res.body.bytes > 0);
    assert.ok(res.body.bytes < jpgBuf.length, 're-encode should shrink the fixture');
    const meta = await sharp(path.join(uploadsDir, res.body.url.replace('/images/', ''))).metadata();
    assert.strictEqual(meta.exif, undefined);
});

test('POST /api/images rejects non-image types', async () => {
    const res = await upload(Buffer.from('<html>not an image</html>'), { name: 'x.txt', contentType: 'text/plain' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
});

test('POST /api/images rejects files over 10 MB', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    const res = await upload(big);
    assert.strictEqual(res.status, 413);
});

test('GET /images/:file 404s on malformed names', async () => {
    assert.strictEqual((await request(app).get('/images/../../etc/passwd')).status, 404);
    assert.strictEqual((await request(app).get('/images/not-a-uuid.png')).status, 404);
});

// ---------- sanitizer ----------
test('sanitizer keeps our own uploaded figures intact (caption preserved, empty removed)', () => {
    const html = '<figure><img src="/images/11111111-2222-3333-4444-555555555555.png" alt="a chart"><figcaption>Revenue 2024</figcaption></figure>';
    const out = sanitizeArticleHtml(html);
    assert.ok(out.includes('<figure>'));
    assert.ok(out.includes('src="/images/11111111-2222-3333-4444-555555555555.png"'));
    assert.ok(out.includes('alt="a chart"'));
    assert.ok(out.includes('<figcaption>Revenue 2024</figcaption>'));
    assert.strictEqual(sanitizeArticleHtml('<figure><img src="/images/11111111-2222-3333-4444-555555555555.png" alt=""></figure>').includes('figcaption'), false);
    assert.strictEqual(sanitizeArticleHtml('<figure><img src="/images/11111111-2222-3333-4444-555555555555.png" alt=""><figcaption>   </figcaption></figure>').includes('figcaption'), false);
});

test('sanitizer drops images with external or dangerous srcs', () => {
    assert.strictEqual(sanitizeArticleHtml('<img src="https://evil.com/x.png">').includes('<img'), false);
    assert.strictEqual(sanitizeArticleHtml('<img src="javascript:alert(1)">').includes('<img'), false);
    assert.strictEqual(sanitizeArticleHtml('<img src="/images/../../secret.png">').includes('<img'), false);
});

test('sanitizer strips attributes like onclick from kept images', () => {
    const out = sanitizeArticleHtml('<img src="/images/11111111-2222-3333-4444-555555555555.png" onclick="evil()" onload="evil()">');
    assert.ok(out.includes('<img src="/images/11111111-2222-3333-4444-555555555555.png"'));
    assert.strictEqual(out.includes('onclick'), false);
    assert.strictEqual(out.includes('onload'), false);
});

test('extractImageRefs finds and dedupes ids', () => {
    const refs = extractImageRefs(
        '<p>a</p><figure><img src="/images/11111111-2222-3333-4444-555555555555.png"></figure>' +
        '<figure><img src="/images/11111111-2222-3333-4444-555555555555.png"></figure>' +
        '<img src="/images/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg">'
    );
    assert.deepStrictEqual(refs.sort(), ['11111111-2222-3333-4444-555555555555', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']);
});

// ---------- lifecycle GC ----------
test('deleting a post purges its images (file + row)', async () => {
    const up = await upload(pngBuf, { name: 'post.png' });
    const db = getDb();
    await db.run('INSERT INTO entries (id, content, timestamp) VALUES (?, ?, ?)', [
        'post-img-1',
        `<figure><img src="${up.body.url}" alt=""></figure>`,
        Date.now()
    ]);
    await db.run('INSERT INTO entries_fts (id, content) VALUES (?, ?)', ['post-img-1', 'x']);

    const del = await agent.post('/delete/post-img-1').set('X-Requested-With', 'XMLHttpRequest');
    assert.strictEqual(del.status, 200);
    assert.strictEqual(fs.existsSync(path.join(uploadsDir, up.body.url.replace('/images/', ''))), false);
    const row = await db.get('SELECT id FROM images WHERE id = ?', [up.body.id]);
    assert.strictEqual(row, undefined);
});

test('deleting an article purges its images (file + row)', async () => {
    const up = await upload(jpgBuf, { name: 'art.jpg', type: 'image/jpeg' });
    const db = getDb();
    await db.run('INSERT INTO articles (id, title, content, timestamp, status) VALUES (?, ?, ?, ?, ?)', [
        'art-img-1', 'T', `<figure><img src="${up.body.url}" alt=""></figure>`, Date.now(), 'published'
    ]);
    const del = await agent.post('/articles/art-img-1/delete');
    assert.strictEqual(del.status, 302);
    assert.strictEqual(fs.existsSync(path.join(uploadsDir, up.body.url.replace('/images/', ''))), false);
    const row = await db.get('SELECT id FROM images WHERE id = ?', [up.body.id]);
    assert.strictEqual(row, undefined);
});

test('overwriting the landing page purges removed images, keeps kept ones', async () => {
    const a = await upload(pngBuf, { name: 'a.png' });
    const b = await upload(pngBuf, { name: 'b.png' });
    const fig = (url) => `<figure><img src="${url}" alt=""></figure>`;

    const save1 = await agent.post('/api/landing').type('json').send({ content: fig(a.body.url) + fig(b.body.url) });
    assert.strictEqual(save1.status, 200);

    // Overwrite keeping b, dropping a
    const save2 = await agent.post('/api/landing').type('json').send({ content: fig(b.body.url) });
    assert.strictEqual(save2.status, 200);
    assert.strictEqual(fs.existsSync(path.join(uploadsDir, a.body.url.replace('/images/', ''))), false);
    assert.ok(fs.existsSync(path.join(uploadsDir, b.body.url.replace('/images/', ''))));

    // Landing delete purges the rest
    const del = await agent.post('/api/landing/delete');
    assert.strictEqual(del.status, 200);
    assert.strictEqual(fs.existsSync(path.join(uploadsDir, b.body.url.replace('/images/', ''))), false);
});

test('boot reconcile sweeps stale orphans but spares referenced images', async () => {
    const kept = await upload(pngBuf, { name: 'keep.png' });
    const stale = await upload(pngBuf, { name: 'stale.png' });
    const fresh = await upload(pngBuf, { name: 'fresh.png' });
    const db = getDb();

    await db.run('INSERT INTO entries (id, content, timestamp) VALUES (?, ?, ?)', [
        'post-keep', `<figure><img src="${kept.body.url}" alt=""></figure>`, Date.now()
    ]);
    // stale: unreferenced AND older than the 24h grace window
    await db.run('UPDATE images SET created_at = ? WHERE id = ?', [Date.now() - 25 * 60 * 60 * 1000, stale.body.id]);

    const removed = await imageStore.reconcileOrphans();
    assert.strictEqual(fs.existsSync(path.join(uploadsDir, stale.body.url.replace('/images/', ''))), false);
    const staleRow = await db.get('SELECT id FROM images WHERE id = ?', [stale.body.id]);
    assert.strictEqual(staleRow, undefined);
    const keptRow = await db.get('SELECT id FROM images WHERE id = ?', [kept.body.id]);
    assert.ok(keptRow, 'referenced image survives');
    const freshRow = await db.get('SELECT id FROM images WHERE id = ?', [fresh.body.id]);
    assert.ok(freshRow, 'unreferenced but fresh image survives grace window');
    assert.ok(removed >= 1);
});

test('POST /api/images/delete removes file and row (owner)', async () => {
    const up = await upload(pngBuf, { name: 'del.png' });
    const del = await agent.post(`/api/images/delete/${up.body.id}`);
    assert.strictEqual(del.status, 200);
    assert.strictEqual(del.body.deleted, true);
    assert.strictEqual(fs.existsSync(path.join(uploadsDir, up.body.url.replace('/images/', ''))), false);
    const again = await agent.post(`/api/images/delete/${up.body.id}`);
    assert.strictEqual(again.body.deleted, false);
});
