const { test } = require('node:test');
const assert = require('node:assert');
const { escapeHtml, sanitizeArticleHtml, stripHtml, formatDate, generateId } = require('../src/utils/html');

const A = String.fromCharCode(38); // '&'

test('escapeHtml escapes all special characters', () => {
    assert.strictEqual(escapeHtml('<script>alert("x")</script>'), A + 'lt;script' + A + 'gt;alert(' + A + 'quot;x' + A + 'quot;)' + A + 'lt;/script' + A + 'gt;');
    assert.strictEqual(escapeHtml("it's"), 'it' + A + '#039;s');
    assert.strictEqual(escapeHtml('a & b'), 'a ' + A + 'amp; b');
    assert.strictEqual(escapeHtml('plain text'), 'plain text');
});

test('sanitizeArticleHtml strips script tags', () => {
    const result = sanitizeArticleHtml('<p>Hello</p><script>alert(1)</script>');
    assert.ok(!result.includes('script'));
    assert.ok(result.includes('Hello'));
});

test('sanitizeArticleHtml strips disallowed tags but keeps content', () => {
    const result = sanitizeArticleHtml('<p>Hello <span>world</span></p>');
    assert.ok(!result.includes('span'));
    assert.ok(result.includes('world'));
});

test('sanitizeArticleHtml keeps allowed formatting tags', () => {
    const result = sanitizeArticleHtml('<p><b>bold</b> <i>italic</i> <u>under</u> <s>strike</s> <code>code</code></p>');
    assert.ok(result.includes('<b>bold</b>'));
    assert.ok(result.includes('<i>italic</i>'));
    assert.ok(result.includes('<u>under</u>'));
    assert.ok(result.includes('<s>strike</s>'));
    assert.ok(result.includes('<code>code</code>'));
});

test('sanitizeArticleHtml keeps links with href (target added client-side)', () => {
    const result = sanitizeArticleHtml('<p><a href="https://example.com">link</a></p>');
    assert.ok(result.includes('<a href="https://example.com">link</a>'));
    assert.ok(!result.includes('target="_blank"'));
});

test('sanitizeArticleHtml removes attributes from non-anchor tags', () => {
    const result = sanitizeArticleHtml('<p style="color:red" class="x">text</p>');
    assert.ok(result.includes('<p>text</p>'));
    assert.ok(!result.includes('style'));
    assert.ok(!result.includes('class'));
});

test('sanitizeArticleHtml converts div to p', () => {
    const result = sanitizeArticleHtml('<div>one</div><div>two</div>');
    assert.ok(!result.includes('<div'));
    assert.ok(result.includes('<p>one</p>'));
    assert.ok(result.includes('<p>two</p>'));
});

test('sanitizeArticleHtml downgrades h1 to h2', () => {
    const result = sanitizeArticleHtml('<h1>Title</h1>');
    assert.ok(result.includes('<h2>Title</h2>'));
    assert.ok(!result.includes('<h1'));
});

test('sanitizeArticleHtml keeps lists, blockquote, hr', () => {
    const result = sanitizeArticleHtml('<ul><li>item</li></ul><blockquote>quote</blockquote><hr>');
    assert.ok(result.includes('<ul><li>item</li></ul>'));
    assert.ok(result.includes('<blockquote>quote</blockquote>'));
    assert.ok(result.includes('<hr>'));
});

test('sanitizeArticleHtml wraps bare text in p', () => {
    const result = sanitizeArticleHtml('just text');
    assert.strictEqual(result, '<p>just text</p>');
});

test('sanitizeArticleHtml returns empty string for empty input', () => {
    assert.strictEqual(sanitizeArticleHtml(''), '');
    assert.strictEqual(sanitizeArticleHtml(null), '');
});

test('stripHtml removes tags and decodes entities', () => {
    const result = stripHtml('<p>Hello <b>world</b></p>');
    assert.strictEqual(result, 'Hello world');
});

test('stripHtml converts block tags to spaces', () => {
    const result = stripHtml('<p>one</p><p>two</p>');
    assert.strictEqual(result, 'one two');
});

test('stripHtml decodes HTML entities', () => {
    const result = stripHtml('<p>a ' + A + 'amp; b ' + A + 'lt; c ' + A + 'gt; d</p>');
    assert.strictEqual(result, 'a ' + A + ' b < c > d');
});

test('formatDate formats timestamp as MM/DD/YYYY', () => {
    const ts = new Date(2024, 0, 15).getTime(); // Jan 15, 2024
    assert.strictEqual(formatDate(ts), '01/15/2024');
});

test('generateId returns a non-empty string', () => {
    const id = generateId();
    assert.strictEqual(typeof id, 'string');
    assert.ok(id.length > 0);
});

test('generateId returns unique values', () => {
    const a = generateId();
    const b = generateId();
    assert.notStrictEqual(a, b);
});