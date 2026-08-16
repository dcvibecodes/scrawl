const { escapeHtml } = require('../utils/html');
const { getCopyright, getBlogTitle } = require('../config');

const layoutTemplate = ({ title, bodyContent, isOwner, blogTitle, searchQuery, copyright, meta, pendingComments, pendingMessages }) =>  {
    const copyrightText = copyright !== undefined ? copyright : getCopyright();
    // Build social/SEO meta tags
    let metaTags = '';
    if (meta) {
        const ogTitle = escapeHtml(meta.title || title);
        const ogDesc = escapeHtml(meta.description || '');
        const ogUrl = escapeHtml(meta.url || '');
        const ogSiteName = escapeHtml(blogTitle);
        const ogType = meta.type || 'article';
        const publishedTime = meta.publishedTime || '';
        const author = meta.author || '';
        metaTags = `
    <meta name="description" content="${ogDesc}">
    <meta property="og:title" content="${ogTitle}">
    <meta property="og:description" content="${ogDesc}">
    <meta property="og:url" content="${ogUrl}">
    <meta property="og:site_name" content="${ogSiteName}">
    <meta property="og:type" content="${ogType}">
    <meta property="og:locale" content="en_US">
    ${publishedTime ? `<meta property="article:published_time" content="${escapeHtml(publishedTime)}">` : ''}
    ${author ? `<meta property="article:author" content="${escapeHtml(author)}">` : ''}
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${ogTitle}">
    <meta name="twitter:description" content="${ogDesc}">
    <meta property="og:image" content="${ogUrl.endsWith('/') ? ogUrl.slice(0, -1) : ogUrl.split('/').slice(0, 3).join('/')}/og-image.png">
    <meta name="twitter:image" content="${ogUrl.endsWith('/') ? ogUrl.slice(0, -1) : ogUrl.split('/').slice(0, 3).join('/')}/og-image.png">
    <link rel="canonical" href="${ogUrl}">`;
    }
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="index, follow">
    <title>${escapeHtml(title)}</title>${metaTags}
    <link rel="manifest" href="/manifest.json">
    <link rel="alternate" type="application/json" href="/api/posts" title="All posts (JSON)">
    <link rel="alternate" type="application/rss+xml" href="/feed/posts" title="Posts RSS Feed">
    <link rel="alternate" type="application/rss+xml" href="/feed/articles" title="Articles RSS Feed">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="${escapeHtml(blogTitle)}">
    <meta name="theme-color" content="#1a1a1a">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
    <link rel="stylesheet" href="/styles.css?v=5">
    <script>(function(){var t=localStorage.getItem('theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');})()</script>
</head>
<body>
    <header>
        <div>
            <h1 style="margin-bottom:4px;">
                <a href="/" id="blogTitle" style="color:inherit;text-decoration:none;">
                    ${escapeHtml(blogTitle)}
                </a>
            </h1>
        </div>
        <div class="header-controls">
            <a href="/random" class="nav-icon-btn random-btn" aria-label="Random" title="Random post">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="3"></rect>
                    <circle class="die-dot" data-pos="tl" cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"></circle>
                    <circle class="die-dot" data-pos="tr" cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"></circle>
                    <circle class="die-dot" data-pos="l" cx="8.5" cy="12" r="1.2" fill="currentColor" stroke="none" style="display:none"></circle>
                    <circle class="die-dot" data-pos="c" cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"></circle>
                    <circle class="die-dot" data-pos="r" cx="15.5" cy="12" r="1.2" fill="currentColor" stroke="none" style="display:none"></circle>
                    <circle class="die-dot" data-pos="bl" cx="8.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"></circle>
                    <circle class="die-dot" data-pos="br" cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"></circle>
                </svg>
            </a>
            <a href="/articles" class="nav-text-btn" title="Articles">articles</a>
            <span class="inline-search" id="headerInlineSearch" style="margin:0;padding:0;">
                <button type="button" class="search-icon-btn" id="searchOpenBtn" aria-label="Search" title="Search" style="margin-top:0;">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="7"></circle>
                        <line x1="16.65" y1="16.65" x2="21" y2="21"></line>
                    </svg>
                </button>
            </span>
            ${isOwner ? `
            <span class="menu-wrapper" style="margin:0;padding:0;">
                <button type="button" class="menu-btn" id="menuBtn" aria-label="Menu" title="Menu" style="margin-top:0;">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="3" y1="6" x2="21" y2="6"></line>
                        <line x1="3" y1="12" x2="21" y2="12"></line>
                        <line x1="3" y1="18" x2="21" y2="18"></line>
                    </svg>
                </button>
                <div class="menu-dropdown" id="menuDropdown">
                    <a href="/archive">post archive</a>
                    <a href="#" id="editBlogTitle">edit title</a>
                    <a href="#" id="editOwnerName">edit name</a>
                    <a href="#" id="editCopyright">edit footer</a>
                    <a href="#" id="themeToggle">dark</a>
                    <a href="/comments">comments${pendingComments ? ` (${pendingComments})` : ''}</a>
                    <a href="/feed/posts">rss: posts</a>
                    <a href="/feed/articles">rss: articles</a>
                    <a href="/api/export">export</a>
                    <a href="/contact">contact${pendingMessages ? ` (${pendingMessages})` : ''}</a>
                    <a href="/logout">logout</a>
                </div>
            </span>
            ` : `
            <span class="menu-wrapper" style="margin:0;padding:0;">
                <button type="button" class="menu-btn" id="menuBtn" aria-label="Menu" title="Menu" style="margin-top:0;">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="3" y1="6" x2="21" y2="6"></line>
                        <line x1="3" y1="12" x2="21" y2="12"></line>
                        <line x1="3" y1="18" x2="21" y2="18"></line>
                    </svg>
                </button>
                <div class="menu-dropdown" id="menuDropdown">
                    <a href="/archive">post archive</a>
                    <a href="#" id="themeToggle">dark</a>
                    <a href="/feed/posts">rss: posts</a>
                    <a href="/feed/articles">rss: articles</a>
                    <a href="/contact">contact</a>
                    <a href="/login">login</a>
                </div>
            </span>
            `}
            <button type="button" class="hamburger-btn" id="hamburgerBtn" aria-label="Menu" title="Menu">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="3" y1="6" x2="21" y2="6"></line>
                    <line x1="3" y1="12" x2="21" y2="12"></line>
                    <line x1="3" y1="18" x2="21" y2="18"></line>
                </svg>
            </button>
        </div>
        <div class="search-bar-overlay" id="searchBarOverlay">
            <input type="text" id="search-field" placeholder="Search posts and articles..." value="${escapeHtml(searchQuery || '')}" autocomplete="off">
            <button type="button" class="search-bar-close" id="searchCloseBtn">&times;</button>
        </div>
    </header>

    <!-- Mobile menu drawer -->
    <div class="mobile-menu-backdrop" id="mobileMenuBackdrop"></div>
    <div class="mobile-menu" id="mobileMenu">
        <button type="button" class="mobile-menu-close" id="mobileMenuClose">&times;</button>
        <a href="/archive">post archive</a>
        ${isOwner
            ? '<a href="#" id="mobileEditTitle">edit title</a><a href="#" id="mobileEditOwnerName">edit name</a><a href="#" id="mobileEditCopyright">edit footer</a><a href="/comments">comments' + (pendingComments ? ' (' + pendingComments + ')' : '') + '</a><a href="#" id="mobileThemeToggle">dark</a><a href="/feed/posts">rss: posts</a><a href="/feed/articles">rss: articles</a><a href="/api/export">export</a><a href="/contact">contact' + (pendingMessages ? ' (' + pendingMessages + ')' : '') + '</a><a href="/logout">logout</a>'
            : '<a href="#" id="mobileThemeToggle">dark</a><a href="/feed/posts">rss: posts</a><a href="/feed/articles">rss: articles</a><a href="/contact">contact</a><a href="/login">login</a>'
        }
    </div>

    <div class="container">
        <main class="main-content">${bodyContent}</main>
    </div>
    ${copyrightText ? '<footer class="site-footer">' + copyrightText + '</footer>' : ''}
    <a href="#" id="backToTop" class="back-to-top" aria-label="Back to top">&uarr;</a>
    <script src="/app.js"></script>
</body>
</html>
`;
}

module.exports = {
    layoutTemplate
};