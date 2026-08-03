const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { getSessionSecret } = require('./src/config');
const { initDatabase } = require('./src/db');
const { attachAuthStatus } = require('./src/middleware/auth');
const { pendingCounts } = require('./src/middleware/pendingCounts');

const authRoutes = require('./src/routes/auth');
const postsRoutes = require('./src/routes/posts');
const articlesRoutes = require('./src/routes/articles');
const commentsRoutes = require('./src/routes/comments');
const contactRoutes = require('./src/routes/contact');
const feedsRoutes = require('./src/routes/feeds');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
// Trust the local nginx proxy so rate limiting sees each visitor's real IP
app.set('trust proxy', '127.0.0.1');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(getSessionSecret()));
app.use(express.static(path.join(__dirname, 'public')));

// Make auth status available to all route handlers
app.use(attachAuthStatus);

// Pending counts for owner (comments + messages)
app.use(pendingCounts);

// --- Routes ---
app.use(authRoutes);
app.use(postsRoutes);
app.use(articlesRoutes);
app.use(commentsRoutes);
app.use(contactRoutes);
app.use(feedsRoutes);

// --- Start Server ---
// Only listen when run directly (not when imported by tests)
if (require.main === module) {
    initDatabase().then(() => {
        app.listen(PORT, () => {
            console.log('Scrawl running at http://localhost:' + PORT);
            const { isOwnerSetup } = require('./src/config');
            if (!isOwnerSetup()) {
                console.log('No owner password set. Visit http://localhost:' + PORT + '/setup to configure.');
            }
        });
    });
}

module.exports = { app, initDatabase };