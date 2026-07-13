# Scrawl

**Version 3.2.1**

A minimalist blogging platform for quick posts, long-form articles, and reader discussion.

Scrawl started as a simple microblog — a single-file scratchpad for quick thoughts. Over time it evolved into a full personal publishing platform with articles, rich text editing, threaded comments, and social sharing — while keeping the speed and simplicity that made it useful in the first place.

---

## Features

### Two Writing Modes

**Posts** — Quick thoughts, no title needed. Plain text, write and publish instantly.

**Articles** — Long-form writing with titles, rich formatting, headings, lists, blockquotes, and draft support.

### Posts

- Plain text with preserved line breaks
- No character limit
- Word and character counter
- Long posts (280+ chars) collapsed with click-to-expand
- Actions: permalink, copy text, copy link, edit, delete

### Articles

- Dedicated `/articles` section, listed by year
- Rich text editor toolbar:
  - **Bold**, *Italic*, Underline
  - ~~Strikethrough~~
  - `Inline code`
  - Hyperlinks
  - H2 and H3 headings
  - Numbered and bullet lists
  - Blockquotes
  - Horizontal rule (separator line)
- Draft support — save privately, publish when ready
- Unpublish — convert a published article back to draft with one click
- Drafts filter — owner can filter the articles list to show only drafts
- Inline article management — edit, delete, and unpublish actions appear directly on the articles listing page
- Backdating — set a custom date for imported articles
- Web Share API for native device sharing
- Unsaved changes protection (browser warns before navigating away)
- Actions: permalink, copy text, copy link, share, edit, delete

### Comments & Discussion

- Threaded comments on articles (only articles, not posts)
- Readers identify themselves with a "Discuss as" name — cached in browser localStorage indefinitely (no login required)
- Nested replies with visual thread connectors (left border lines showing hierarchy)
- Reply depth capped at 4 levels of indentation to preserve readability on mobile
- Comment form always visible below articles — no extra clicks to start discussing
- "Comments cannot be edited after posting" hint for readers
- Moderation: all reader comments require owner approval before they become visible to other readers
- Owner comments are auto-approved and appear immediately
- Owner name is configurable and displays dynamically on all owner comments (past and future)
- Inline approve/delete actions with feedback animations (slide-up on removal)
- Delete uses the same 2-step confirm pattern as posts and articles ("delete" → "confirm?" → gone)
- Deleting a parent comment removes all nested replies

### Comments Management

- Dedicated `/comments` page for the owner (accessible from the menu)
- Shows only pending reader comments awaiting approval
- Each comment links to its article for context
- Approve and delete with inline feedback and animations

### Search

- Full-text search (SQLite FTS5) across both posts and articles
- Multi-word prefix matching with relevance ranking
- Results grouped by type (articles shown separately from posts)
- Accessible via header icon or `/` keyboard shortcut

### Navigation

- **random** — opens a random post
- **articles** — visible in header on both desktop and mobile
- **search** — full-text search icon
- **menu** — hamburger icon with: post archive, settings (title, name, footer), comments, theme, RSS, contact, login/logout

### Contact Page

- Built-in contact form at `/contact` for visitors to send messages to the owner
- Fields: Name (required), Email (optional), Subject (optional), Message (required)
- "Message sent" notification on successful submission
- Owner sees accumulated messages listed latest-first below the form
- Owner can delete messages (same 2-step confirm pattern)
- Non-owner users only see the contact form
- Accessible from menu for all users

### RSS Feeds

- `/feed/posts` — latest 50 posts
- `/feed/articles` — latest 50 published articles
- Auto-discoverable via `<link>` tags in HTML head
- Links in the menu

### Social Sharing & SEO

- Open Graph meta tags on posts and articles (title, description, URL, type, published time, author)
- Twitter Card meta tags (summary card — text-focused, no image)
- `<meta name="description">` for search engines
- `<link rel="canonical">` for authoritative URLs
- `article:published_time` and `article:author` structured data
- Site fully indexable (`index, follow` robots directive)
- Description auto-generated from first 200 characters of content
- Works with: Twitter/X, Facebook, LinkedIn, WhatsApp, Telegram, Slack, Discord, Reddit, Mastodon, iMessage, WordPress, Substack, Blogger, Medium, and any platform supporting Open Graph

### Customization

- Editable site title (menu → edit title)
- Editable owner display name (menu → edit name) — propagates to all comments
- Editable footer/copyright text (menu → edit footer)
- Light and dark themes (preference saved in browser)
- Light theme by default

### Authentication

- Password-protected publishing, editing, and deleting
- One-time setup flow on first launch
- bcrypt-hashed password (12 rounds, salted)
- HMAC-signed session cookies (httpOnly, sameSite strict)
- 7-day session persistence
- Visitors can read all published content and comment on articles

### Help Page

- Built-in help at `/help` explaining all features
- Accessible from the menu

### Progressive Web App

- Installable on mobile and desktop
- Service worker with cache-first for static assets
- Network-first for HTML pages (always fresh content)

### Discoverability

- Dynamic sitemap at `/sitemap.xml` (posts and articles)
- JSON API at `/api/posts`
- RSS feeds for both content types
- `<link rel="alternate">` tags for machine-readable discovery
- Open Graph and Twitter Card meta for rich link previews

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| N | Focus new post editor (homepage) |
| / | Open search |
| Escape | Close search |

---

## Routes

| Route | Description |
|-------|-------------|
| `/` | Homepage with posts |
| `/articles` | Articles list grouped by year |
| `/articles/new` | Write new article (owner) |
| `/articles/:id` | View article with comments |
| `/articles/:id/edit` | Edit article (owner) |
| `/archive` | Post archive by year/month |
| `/random` | Random post |
| `/post/:id` | Single post permalink |
| `/edit/:id` | Edit post (owner) |
| `/comments` | Comment moderation (owner) |
| `/contact` | Contact page (form + messages for owner) |
| `/feed/posts` | RSS feed for posts |
| `/feed/articles` | RSS feed for articles |
| `/sitemap.xml` | XML sitemap |
| `/api/posts` | JSON API for all posts |
| `/api/comments` | Comment submission endpoint |
| `/login` | Owner login |
| `/setup` | First-time password setup |

---

## Technology

- Node.js + Express
- SQLite with FTS5 full-text search
- bcryptjs (password hashing)
- cookie-parser (signed session cookies)
- Vanilla JavaScript (no frontend framework)
- Progressive Web App (PWA)
- Single-file server architecture

---

## Security

| Concern | Solution |
|---------|----------|
| Password storage | bcrypt hash (12 rounds, salted) |
| Session token | HMAC-signed, httpOnly cookie |
| Cookie flags | httpOnly, sameSite strict |
| Write protection | Server-side middleware on all mutating routes |
| XSS (posts) | HTML escaping on all user content |
| XSS (articles) | HTML sanitization (only b, i, u, s, strike, code, a, br, hr, h2, h3, ol, ul, li, blockquote allowed) |
| XSS (comments) | HTML escaping on all comment content |
| Comment moderation | All reader comments require owner approval |

### Password Reset

Delete `data/owner.hash` and restart the server. You'll be redirected to `/setup`.

---

## Data Files

All user data is stored in the `data/` directory (git-ignored):

| File | Purpose |
|------|---------|
| `scrawl.db` | SQLite database (posts, articles, messages, comments) |
| `owner.hash` | bcrypt password hash |
| `session.secret` | HMAC signing key |
| `blog-title.txt` | Custom site title |
| `owner-name.txt` | Owner display name (for comments) |
| `copyright.txt` | Footer/copyright text |

---

## Installation

```bash
git clone <repository-url>
cd scrawl
npm install
npm start
```

Available at `http://localhost:3000`. On first visit, you'll be redirected to `/setup` to create your owner password.

---

## Evolution

Scrawl has gone through three major phases:

**v1.x — Microblog** (original)
A bare-bones microblog. Single text field, post button, chronological feed. No titles, no formatting, no articles. Just quick thoughts published instantly.

**v2.x — Writing Platform**
Added long-form articles with a rich text editor, full-text search, RSS feeds, draft support, backdating, a contact page, and PWA capabilities. Renamed from "Microblog" to "Scrawl."

**v3.0 — Blogging Platform**
Added threaded reader comments with moderation, owner identity (configurable display name), social sharing with Open Graph/Twitter Cards, full SEO indexability, and a unified hamburger menu. Transformed from a personal writing tool into a complete self-hosted blogging platform where readers can engage through discussion.

---

## Changelog

### Version 3.2.1

#### Added

- **Published filter** — articles page now has three filters for the owner: all, published, drafts
- **Show/Hide Options toggle** — action links (edit, unpublish, delete) are hidden by default; a "show options" link in the filter bar reveals them on demand
- **Draft badge** — red-bordered badge appears next to draft article names on the listing and on the article detail page title

#### Changed

- Article action links now render below the article name (not inline), only visible when "show options" is active
- Action link order changed to: edit, unpublish, delete (delete always last)
- Article listing spacing is tight by default, only expands when options are shown
- Article editor toolbar is now horizontally scrollable on mobile instead of clipping off-screen
- Draft badge uses `vertical-align: middle` for proper alignment with article titles
- Filter bar dots now have proper `margin: 0 6px` spacing matching the header navigation

#### Fixed

- **Draft badge vertical alignment** — badge no longer sits below the article title text on the detail page
- **PWA deprecation warning** — added standard `mobile-web-app-capable` meta tag alongside the Apple-prefixed version

### Version 3.2.0

#### Added

- **Inline article management** — edit, delete, and unpublish actions appear directly next to article names on the articles listing page (owner only), with a subtle dot separator between the title and actions
- **Unpublish action** — convert a published article back to draft status with a single click; uses the same 2-step confirm pattern ("unpublish" → "confirm?" → done)
- **Drafts filter** — owner sees "all · drafts" filter links at the top of the articles page to quickly view only draft articles
- **"Edit draft" link** — draft articles show an amber-colored "edit draft" action instead of the generic "edit" for instant visual identification
- **Strikethrough formatting** — new toolbar button (S̶) in the article editor for strikethrough text
- **Inline code formatting** — new toolbar button (<>) wraps selected text in `<code>` with monospace styling; toggleable
- **Horizontal rule** — new toolbar button (―) inserts a subtle separator line between article sections

#### Changed

- Draft badge removed entirely — draft status is now communicated through the amber "edit draft" action link rather than a badge
- Article editor toolbar reordered: B, I, U, S̶, <>, link, H2, H3, OL, UL, blockquote, ―, ↵
- HTML sanitizer now allows `<s>`, `<strike>`, `<code>`, and `<hr>` tags
- Delete on articles listing now fades out the item in-place instead of doing a full page redirect

#### Fixed

- **Critical: JavaScript IIFE crash** — a regex literal inside the layout template was being mangled by template literal backslash processing, producing invalid JS that killed all client-side functionality (hamburger menu, delete confirmations, copy actions, everything). Removed the offending unused variable.

### Version 3.1.0

#### Added

- **Articles link visible on mobile** — "articles" text link now shows directly in the mobile header (between random icon and search icon), no need to open the hamburger menu
- **Multi-level bullet points** — Tab key indents list items to create nested sub-lists; Shift+Tab outdents them back
- **Word and character counter on comments** — shows "X words · Y/2000 characters" as the user types, matching the post and article editor pattern
- **2000 character limit on comments** — server rejects comments exceeding this length with a clear error message
- **Edit footer in mobile drawer** — "edit footer" option now accessible from the mobile menu (was previously desktop-only)
- **og:image and twitter:image** — social sharing cards now include the site icon for visual recognition

#### Changed

- Desktop navigation simplified to: random · articles · search · menu (hamburger icon)
- "Post archive" moved into the hamburger menu (both desktop and mobile) — keeps header clean
- Mobile drawer slides in from the right with backdrop overlay and scroll lock (standard drawer UX)
- Tapping the backdrop or × closes the drawer; background page cannot scroll while drawer is open
- Menu items are now consistent between desktop dropdown and mobile drawer

#### Fixed

- **Shift+Enter on Mac** — explicitly handled in the article editor keydown listener with `insertLineBreak` fallback to `insertHTML('<br>')` for Safari compatibility
- **Line break button** — `execLineBreak()` now uses the same fallback mechanism for cross-browser reliability

#### Removed

- Help page (`/help`) — removed entirely as it was a maintenance liability during rapid iteration
- "Login to publish" prompt on homepage — removed; login is accessible from the menu
- "Articles" link from mobile drawer — redundant since it's now visible directly in the header

### Version 3.0.0

This is a major release that transforms Scrawl from a personal writing tool into a full blogging platform with reader engagement.

#### Added

- **Threaded comments** on articles — readers can discuss, reply to each other, and build conversation threads
- **Comment moderation** — all reader comments require owner approval before becoming public
- **Owner display name** — configurable via menu ("edit name"), shown on owner comments, propagates dynamically everywhere
- **Comments management page** (`/comments`) — owner sees pending comments, can approve or delete with inline feedback
- **Reply threading** with visual connectors (left border lines) capped at 4 levels of indentation
- **Comment identity** — readers enter a "Discuss as" name, cached in localStorage indefinitely (no login needed, no expiry)
- **"Cannot edit" warning** — readers see a hint that comments cannot be modified after posting
- **Social sharing meta tags** — Open Graph, Twitter Cards, and SEO description on all posts and articles
- **Full indexability** — removed `noindex/nofollow`, site is now fully crawlable by search engines and social platforms
- **Canonical URLs** — `<link rel="canonical">` on all content pages
- **Homepage OG tags** — sharing the homepage URL produces a proper card preview

#### Changed

- Desktop settings icon replaced with hamburger menu (three-line icon) — reflects that it's now a full menu, not just settings
- Mobile menu updated with "comments" and "edit name" options for the owner
- Comment form uses link-style actions ("post comment", "reply", "cancel") instead of buttons — buttons reserved for primary authoring actions
- Comment delete uses the same 2-step "delete → confirm?" inline pattern as posts and articles (no browser popup)
- Comment approve shows "approving..." feedback then slides the item away
- Comment text renders slightly smaller than article body text (visual hierarchy — comments are secondary to the main content)
- Input fields stay at 16px to prevent iOS Safari auto-zoom on focus
- Article deletion now also cleans up all associated comments

#### Database

- New `comments` table with fields: id, article_id, parent_id, author, content, timestamp, approved, is_owner
- Auto-migration adds `is_owner` column for existing databases

### Version 2.5.1

#### Added

- Word and character counter on article compose and article edit screens (same style as posts)

#### Fixed

- Post edit screen word/character counter now works correctly (counts on load and on input)

### Version 2.5.0

#### Added

- Contact page (`/contact`) — visitors can send messages to the owner via a simple form (name, email, subject, message)
- Owner sees accumulated messages on the contact page, listed latest-first, with delete capability
- "copy link" action on posts (copies the post URL to clipboard)
- "copy text" action on articles (copies the article body text to clipboard)
- Word and character counter on the post edit screen (same as the post writing screen)
- Help link now appears in the mobile menu (was only in desktop gear dropdown)
- Contact link in gear menu and mobile menu for all users

#### Changed

- Post edit page "update" action is now a button (matching the article edit page style) instead of a link
- Buttons are slightly smaller across the app (tighter padding and font size for a more proportional look)

### Version 2.4.0

#### Changed

- H2 and H3 headings in articles now have more breathing room (1.8em/1.4em top margin) for better visual separation between sections
- Footer text is now left-aligned within the content area

#### Fixed

- Article delete now redirects to `/articles` list after successful deletion instead of staying on the deleted article's page

### Version 2.3.0

#### Changed

- Article editor now uses `<p>` paragraphs instead of `<br>` for Enter key — proper paragraph spacing shows immediately while editing
- Enter = new paragraph, Shift+Enter = line break within paragraph
- Added ↵ (line break) button to toolbar for mobile and desktop users
- Editor hint below content area explains Enter vs line break behavior
- Article display uses proper paragraph rendering (removed `white-space: pre-wrap`)
- Plain text paste: double newlines become paragraphs, single newlines become line breaks

#### Fixed

- First Enter in a new article now shows paragraph spacing immediately (previously looked like a line break until saved)
- Cursor no longer appears on a wrong line when editor is empty
- Old articles with `<br>`-based content are auto-wrapped in `<p>` on edit

### Version 2.2.0

#### Added

- Keyboard shortcuts in article editor: Ctrl+B (bold), Ctrl+I (italic), Ctrl+U (underline)
- Toggle behavior for all formatting: clicking H2, H3, or Blockquote again reverts to normal text
- Active state indicators on toolbar buttons — buttons highlight when their formatting is active at the cursor position
- Link editing and removal via the link toolbar button (shows current URL, option to edit or remove)
- Sticky editor toolbar — formatting buttons stay pinned at the top when scrolling long articles

#### Fixed

- Sticky toolbar now works correctly (switched `overflow-x: hidden` to `overflow-x: clip` to avoid breaking `position: sticky`)

### Version 2.1.0

#### Added

- Paste sanitization in article editor — pasted content is stripped of all external fonts and styling, preserving only allowed formatting (bold, italic, underline, links, headings, lists, blockquotes)
- Sticky editor toolbar — formatting buttons stay pinned at the top of the screen when scrolling long articles
- Link editing and removal — clicking the link icon when cursor is on an existing link shows the current URL with options to edit or remove it

#### Fixed

- Paragraph and line break preservation — pasting or saving content with multiple paragraphs no longer collapses them into a single block
- Timezone-correct dates — article date picker now defaults to local date instead of UTC (previously showed yesterday's date in timezones ahead of UTC)

### Version 2.0.0

This is a major overhaul of the original microblog app.

#### Added

- Articles section with dedicated `/articles` route
- Article editor with contenteditable toolbar (B, I, U, link, H2, H3, numbered list, bullet list, blockquote)
- Draft support for articles
- Backdating support for articles (custom date picker)
- Articles grouped by year in listing
- Web Share API on articles (native OS sharing)
- Unified search across posts and articles
- Unsaved changes protection on article editor (beforeunload)
- RSS feeds for posts (`/feed/posts`) and articles (`/feed/articles`)
- RSS auto-discovery via link tags
- Editable footer/copyright text (stored in `data/copyright.txt`)
- Help page at `/help` with full feature documentation
- Database auto-migration from `microblog.db` to `scrawl.db`

#### Changed

- App renamed from "Microblog" to "Scrawl"
- Default blog title changed to "Scrawl"
- Directory renamed from `microblog` to `scrawl`
- "Archive" renamed to "Post Archive"
- Navigation reordered: random · post archive · articles · search · gear
- "copy" on posts renamed to "copy text"
- "Write new article" button simplified to "New Article"
- Search placeholder updated to "Search posts and articles..."
- Login prompt updated to mention articles
- Service worker cache name updated
- PWA manifest updated

#### Fixed

- Consistent line break rendering between article editor and article view
- Button vertical alignment in article forms
- Consistent button feedback across all actions

---

## License

Use it, modify it, and make it your own.
