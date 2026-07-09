# Scrawl

**Version 2.3.0**

A minimalist personal publishing space for quick posts and long-form articles.

Scrawl evolved from a microblog into a complete writing platform. It keeps the speed and simplicity of a scratchpad for quick thoughts, while adding a dedicated articles section for longer-form writing with formatting support.

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
- Actions: permalink, copy text, edit, delete

### Articles

- Dedicated `/articles` section, listed by year
- Rich text editor toolbar:
  - **Bold**, *Italic*, Underline
  - Hyperlinks
  - H2 and H3 headings
  - Numbered and bullet lists
  - Blockquotes
- Draft support — save privately, publish when ready
- Backdating — set a custom date for imported articles
- Web Share API for native device sharing
- Unsaved changes protection (browser warns before navigating away)
- Actions: permalink, copy link, share, edit, delete

### Search

- Full-text search (SQLite FTS5) across both posts and articles
- Multi-word prefix matching with relevance ranking
- Results grouped by type (articles shown separately from posts)
- Accessible via header icon or `/` keyboard shortcut

### Navigation

- **random** — opens a random post
- **post archive** — browse posts by year and month
- **articles** — article list grouped by year
- **search** — full-text search icon
- **gear menu** — settings (title, footer, theme, RSS, help, login/logout)

### RSS Feeds

- `/feed/posts` — latest 50 posts
- `/feed/articles` — latest 50 published articles
- Auto-discoverable via `<link>` tags in HTML head
- Links in the gear menu

### Customization

- Editable site title (gear menu → edit title)
- Editable footer/copyright text (gear menu → edit footer)
- Light and dark themes (preference saved in browser)
- Light theme by default

### Authentication

- Password-protected publishing, editing, and deleting
- One-time setup flow on first launch
- bcrypt-hashed password (12 rounds, salted)
- HMAC-signed session cookies (httpOnly, sameSite strict)
- 7-day session persistence
- Visitors can read all published content

### Help Page

- Built-in help at `/help` explaining all features
- Accessible from the gear menu

### Progressive Web App

- Installable on mobile and desktop
- Service worker with cache-first for static assets
- Network-first for HTML pages (always fresh content)

### LLM Discoverability

- Dynamic sitemap at `/sitemap.xml` (posts and articles)
- JSON API at `/api/posts`
- RSS feeds for both content types
- `<link rel="alternate">` tags for machine-readable discovery

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
| `/articles/:id` | View article |
| `/articles/:id/edit` | Edit article (owner) |
| `/archive` | Post archive by year/month |
| `/random` | Random post |
| `/post/:id` | Single post permalink |
| `/edit/:id` | Edit post (owner) |
| `/help` | Help page |
| `/feed/posts` | RSS feed for posts |
| `/feed/articles` | RSS feed for articles |
| `/sitemap.xml` | XML sitemap |
| `/api/posts` | JSON API for all posts |
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
| XSS (articles) | HTML sanitization (only b, i, u, a, br, h2, h3, ol, ul, li, blockquote allowed) |

### Password Reset

Delete `data/owner.hash` and restart the server. You'll be redirected to `/setup`.

---

## Data Files

All user data is stored in the `data/` directory (git-ignored):

| File | Purpose |
|------|---------|
| `scrawl.db` | SQLite database (posts + articles) |
| `owner.hash` | bcrypt password hash |
| `session.secret` | HMAC signing key |
| `blog-title.txt` | Custom site title |
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

## Changelog

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
