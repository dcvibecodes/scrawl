const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app, setupTestDb, cleanupTestData, makeOldSpamToken } = require('./helpers');

const A = String.fromCharCode(38); // '&'

let agent;

before(async () => {
    await setupTestDb();
    agent = request.agent(app);
});

after(() => {
    cleanupTestData();
});

test('GET / redirects to /setup when no owner password exists', async () => {
    const res = await request(app).get('/');
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/setup');
});

test('POST /setup creates owner password and sets session cookie', async () => {
    const res = await agent
        .post('/setup')
        .type('form')
        .send({ password: 'test-password-123', confirm: 'test-password-123' });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/');
    assert.ok(res.headers['set-cookie'] && res.headers['set-cookie'].length > 0);
});

test('GET / returns 200 with blog title after setup', async () => {
    const res = await agent.get('/');
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Scrawl'));
    assert.ok(res.text.includes('Write something...'));
});

test('POST /add creates a post (owner)', async () => {
    const res = await agent
        .post('/add')
        .type('form')
        .send({ content: 'Hello world test post' });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/');
});

test('GET / shows the created post', async () => {
    const res = await agent.get('/');
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Hello world test post'));
});

test('GET /post/:id shows a single post', async () => {
    // Find the post id from the API
    const apiRes = await request(app).get('/api/posts');
    const posts = apiRes.body.posts;
    assert.ok(posts.length > 0);
    const id = posts[0].id;
    const res = await request(app).get('/post/' + id);
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Hello world test post'));
});

test('POST /articles creates an article (owner)', async () => {
    const res = await agent
        .post('/articles')
        .send({ title: 'Test Article', content: '<p>Article body text</p>', status: 'published' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.id);
});

test('GET /articles lists the article', async () => {
    const res = await agent.get('/articles');
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Test Article'));
});

test('GET /articles/:id shows the article', async () => {
    const apiRes = await request(app).get('/api/posts');
    // Get article id from the articles list page
    const listRes = await request(app).get('/articles');
    const match = listRes.text.match(/\/articles\/([a-f0-9-]+)">Test Article/);
    assert.ok(match, 'Article link not found in list');
    const id = match[1];
    const res = await request(app).get('/articles/' + id);
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Test Article'));
    assert.ok(res.text.includes('Article body text'));
});

test('POST /api/comments creates a pending comment (public)', async () => {
    // Get article id
    const listRes = await request(app).get('/articles');
    const match = listRes.text.match(/\/articles\/([a-f0-9-]+)">Test Article/);
    const articleId = match[1];

    const res = await request(app)
        .post('/api/comments')
        .send({
            article_id: articleId,
            parent_id: null,
            author: 'Reader',
            content: 'Nice article!',
            website_url: '',
            _token: makeOldSpamToken()
        });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
});

test('GET /articles/:id hides pending comments from public', async () => {
    const listRes = await request(app).get('/articles');
    const match = listRes.text.match(/\/articles\/([a-f0-9-]+)">Test Article/);
    const articleId = match[1];

    const res = await request(app).get('/articles/' + articleId);
    assert.strictEqual(res.status, 200);
    assert.ok(!res.text.includes('Nice article!'));
});

test('GET /articles/:id shows pending comments to owner', async () => {
    const listRes = await agent.get('/articles');
    const match = listRes.text.match(/\/articles\/([a-f0-9-]+)">Test Article/);
    const articleId = match[1];

    const res = await agent.get('/articles/' + articleId);
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Nice article!'));
});

test('POST /api/comments creates a pending comment on a post (public)', async () => {
    const apiRes = await request(app).get('/api/posts');
    const postId = apiRes.body.posts[0].id;

    const res = await request(app)
        .post('/api/comments')
        .send({
            post_id: postId,
            parent_id: null,
            author: 'PostReader',
            content: 'Nice post!',
            website_url: '',
            _token: makeOldSpamToken()
        });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
});

test('GET /post/:id hides pending post comments from public', async () => {
    const apiRes = await request(app).get('/api/posts');
    const postId = apiRes.body.posts[0].id;

    const res = await request(app).get('/post/' + postId);
    assert.strictEqual(res.status, 200);
    assert.ok(!res.text.includes('Nice post!'));
});

test('GET /post/:id shows pending post comments to owner', async () => {
    const apiRes = await request(app).get('/api/posts');
    const postId = apiRes.body.posts[0].id;

    const res = await agent.get('/post/' + postId);
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Nice post!'));
});

test('GET /comments shows post and article comments in a single list', async () => {
    const res = await agent.get('/comments');
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Nice post!'));
    assert.ok(res.text.includes('Nice article!'));
});

test('POST /api/comments rejects too-fast submissions (spam token)', async () => {
    const listRes = await request(app).get('/articles');
    const match = listRes.text.match(/\/articles\/([a-f0-9-]+)">Test Article/);
    const articleId = match[1];

    // Fresh token (not old enough) should be rejected
    const freshToken = (Date.now()).toString(36) + '.abcdef1234567890';
    const res = await request(app)
        .post('/api/comments')
        .send({
            article_id: articleId,
            parent_id: null,
            author: 'Spammer',
            content: 'Too fast!',
            website_url: '',
            _token: freshToken
        });
    assert.strictEqual(res.status, 400);
});

test('POST /api/comments honeypot silently succeeds', async () => {
    const listRes = await request(app).get('/articles');
    const match = listRes.text.match(/\/articles\/([a-f0-9-]+)">Test Article/);
    const articleId = match[1];

    const res = await request(app)
        .post('/api/comments')
        .send({
            article_id: articleId,
            parent_id: null,
            author: 'Bot',
            content: 'spam spam spam',
            website_url: 'http://spam.example.com',
            _token: makeOldSpamToken()
        });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
});

test('POST /contact creates a message (public)', async () => {
    const res = await request(app)
        .post('/contact')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
            name: 'Visitor',
            email: 'visitor@example.com',
            subject: 'Hello',
            content: 'Just saying hi',
            website_url: '',
            _token: makeOldSpamToken()
        });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
});

test('GET /contact shows messages to owner', async () => {
    const res = await agent.get('/contact');
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Just saying hi'));
});

test('GET /feed/posts returns RSS XML', async () => {
    const res = await request(app).get('/feed/posts');
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('<?xml'));
    assert.ok(res.text.includes('<rss'));
    assert.ok(res.text.includes('Hello world test post'));
});

test('GET /feed/articles returns RSS XML', async () => {
    const res = await request(app).get('/feed/articles');
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('<?xml'));
    assert.ok(res.text.includes('<rss'));
    assert.ok(res.text.includes('Test Article'));
});

test('GET /sitemap.xml returns XML sitemap', async () => {
    const res = await request(app).get('/sitemap.xml');
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('<urlset'));
    assert.ok(res.text.includes('/post/'));
    assert.ok(res.text.includes('/articles/'));
});

test('GET /api/posts returns JSON', async () => {
    const res = await request(app).get('/api/posts');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.title, 'Scrawl');
    assert.ok(res.body.posts.length > 0);
});

test('GET /api/export requires owner auth', async () => {
    const res = await request(app).get('/api/export');
    assert.strictEqual(res.status, 403);
});

test('GET /api/export works for owner', async () => {
    const res = await agent.get('/api/export');
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Full Export'));
    assert.ok(res.text.includes('Hello world test post'));
    assert.ok(res.text.includes('Test Article'));
});

test('GET /?q= searches posts', async () => {
    const res = await request(app).get('/?q=Hello');
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Hello world test post'));
});

test('GET /random redirects to a post', async () => {
    const res = await request(app).get('/random');
    assert.strictEqual(res.status, 302);
    assert.ok(res.headers.location.startsWith('/post/'));
});

test('GET /archive shows post archive', async () => {
    const res = await request(app).get('/archive');
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Post Archive'));
});

test('GET /login shows login page', async () => {
    const res = await request(app).get('/login');
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Owner Login'));
});

test('POST /login with wrong password redirects with error', async () => {
    const res = await request(app)
        .post('/login')
        .type('form')
        .send({ password: 'wrong-password' });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/login?error=1');
});

test('POST /login with correct password redirects to home', async () => {
    const res = await request(app)
        .post('/login')
        .type('form')
        .send({ password: 'test-password-123' });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/');
});

test('GET / serves styles.css and app.js as static assets', async () => {
    const cssRes = await request(app).get('/styles.css');
    assert.strictEqual(cssRes.status, 200);
    assert.ok(cssRes.text.includes('--bg-body'));

    const jsRes = await request(app).get('/app.js');
    assert.strictEqual(jsRes.status, 200);
    assert.ok(jsRes.text.includes('copyPermalink'));

    const editorJsRes = await request(app).get('/article-editor.js');
    assert.strictEqual(editorJsRes.status, 200);
    assert.ok(editorJsRes.text.includes('initArticleEditor'));
});

test('GET /articles/new includes article-editor.js', async () => {
    const res = await agent.get('/articles/new');
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('/article-editor.js'));
    assert.ok(res.text.includes("initArticleEditor({ mode: 'new' })"));
});

test('GET /articles/:id/edit includes article-editor.js', async () => {
    const listRes = await agent.get('/articles');
    const match = listRes.text.match(/\/articles\/([a-f0-9-]+)\/edit/);
    assert.ok(match, 'Edit link not found');
    const id = match[1];
    const res = await agent.get('/articles/' + id + '/edit');
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('/article-editor.js'));
    assert.ok(res.text.includes("initArticleEditor({ mode: 'edit'"));
});

test('GET /articles/new requires owner auth', async () => {
    const res = await request(app).get('/articles/new');
    assert.strictEqual(res.status, 403);
});

test('POST /add requires owner auth', async () => {
    const res = await request(app)
        .post('/add')
        .type('form')
        .send({ content: 'should not work' });
    assert.strictEqual(res.status, 403);
});