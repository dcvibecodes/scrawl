const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Set up isolated data dir BEFORE requiring app modules (config reads env at load)
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scrawl-test-'));
process.env.SCRAWL_DATA_DIR = TEST_DATA_DIR;

const { app, initDatabase } = require('../server');
const { getDb } = require('../src/db');

async function setupTestDb() {
    await initDatabase();
    return getDb();
}

function cleanupTestData() {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}

// Create a spam token that is old enough to pass the 3-second time check
function makeOldSpamToken() {
    const timestamp = (Date.now() - 5000).toString(36);
    const noise = crypto.randomBytes(8).toString('hex');
    return `${timestamp}.${noise}`;
}

module.exports = {
    app,
    setupTestDb,
    cleanupTestData,
    makeOldSpamToken,
    TEST_DATA_DIR
};