# Microblog

**Version 1.5**

A minimalist microblogging and note-taking platform built for people who prefer writing over scrolling.

Microblog is designed to feel like a personal notebook: fast, distraction-free, and focused entirely on ideas. No feeds. No likes. No algorithms. Just your thoughts, organized chronologically and instantly searchable.

---

## Features

### Writing First

- Clean, distraction-free writing experience
- Fast post creation
- Auto-expanding text editor
- Character and word counter
- Keyboard shortcuts (desktop only)
- Button feedback on publish, edit, and delete actions

### Owner Authentication

- Password-protected publishing, editing, and deleting
- Visitors can read all posts but cannot modify anything
- One-time setup flow on first launch
- bcrypt-hashed password storage (12 rounds, salted)
- HMAC-signed session cookies (httpOnly, sameSite strict)
- 7-day session persistence

### Search

- Full-text search powered by SQLite FTS5 with BM25 relevance ranking
- Multi-word prefix matching with proper sanitization of special characters
- Result count displayed for active queries
- Search accessible from every page via header icon or `/` keyboard shortcut
- Full-screen overlay search bar with smooth animation

### Customization

- Custom blog title (editable from gear menu)
- Title persists across server restarts

### Archives

- Dedicated archive index page with year/month grouping and post counts
- Browse by year, month, or year+month combination
- Navigate directly to any time period

### All Posts

- Paginated view (200 posts per page) for browsing the full archive
- Newer/Older navigation

### Random Discovery

- Random post link in navigation
- Dedicated icon on mobile for quick access

### Editing

- Edit existing posts with inline "update" link
- Delete posts with confirmation and visual fade-out
- Permanent links for individual entries
- Inline post expansion for long posts (280+ characters)
- Full-post copying even when previews are truncated

### Mobile Friendly

- Responsive design with hamburger menu navigation
- Random and search icons always accessible in header
- No horizontal scrolling
- Progressive Web App (PWA) support
- Keyboard shortcut hints hidden on mobile

### Dark Mode

- Light and dark themes accessible from gear menu (desktop) or hamburger menu (mobile)
- Theme preference saved locally

### LLM Discoverability

- Dynamic sitemap at `/sitemap.xml`
- JSON API at `/api/posts` returning all posts with metadata
- `<link rel="alternate">` tag for machine-readable discovery
- Designed for LLM browsing agents to find and index all content

---

## Philosophy

Most writing apps have become increasingly complicated.

Microblog takes the opposite approach.

The goal is simple:

- Capture ideas quickly
- Find them later
- Stay out of the way

No timelines. No followers. No algorithms. No engagement metrics. No notifications. No unnecessary features.

Just writing.

---

## Keyboard Shortcuts

| Shortcut | Action                |
| -------- | --------------------- |
| N        | Focus new post editor |
| /        | Open search           |
| Escape   | Close search          |

---

## Navigation

### Desktop

`all · archive · random · 🔍 · ⚙`

The gear menu contains: edit title, theme toggle, logout/login.

### Mobile

`Title ... 🔀 🔍 ☰`

The hamburger menu contains: all, archive, edit title, theme toggle, logout/login.

---

## Technology

- Node.js
- Express
- SQLite with FTS5 Search
- bcryptjs (password hashing)
- cookie-parser (signed session cookies)
- Vanilla JavaScript
- Progressive Web App (PWA)

---

## API

### JSON Posts Endpoint

```
GET /api/posts
```

Returns all posts as JSON:

```json
{
  "title": "Microblog",
  "total": 150,
  "posts": [
    {
      "id": "uuid",
      "content": "Post text...",
      "date": "2026-06-14T12:00:00.000Z",
      "url": "https://yourdomain.com/post/uuid"
    }
  ]
}
```

### Sitemap

```
GET /sitemap.xml
```

Dynamic XML sitemap listing all post URLs, the archive, all posts page, and API endpoint.

---

## Search Engine Indexing

By default, Microblog prevents search engines from indexing your content:

```html
<meta name="robots" content="noindex, nofollow">
```

This is intentional. Microblog is designed as a personal notebook rather than a public content platform.

To allow indexing, remove this meta tag from `layoutTemplate()` in `server.js`.

---

## Security

| Concern | Solution |
|---------|----------|
| Password storage | bcrypt hash (12 rounds, salted, slow-by-design) |
| Session token | HMAC-signed, stored in httpOnly cookie |
| Cookie flags | httpOnly, sameSite strict |
| Write protection | Server-side middleware on all mutating routes |
| XSS prevention | HTML escaping on all user content |

### Password Reset

Delete `data/owner.hash` and restart the server. You'll be redirected to `/setup` to set a new password.

---

## Changelog

### Version 1.5

#### Added

- Improved search: multi-word prefix matching, BM25 relevance ranking, special character sanitization
- Search result count displayed for active queries
- Full-screen search overlay accessible from header on all pages
- Gear menu (⚙) for admin actions: edit title, theme toggle, logout
- Gear menu shown for visitors too (with theme toggle and login)
- Archive index page with year/month grouping and post counts
- All Posts page with pagination (200 per page)
- JSON API endpoint (`/api/posts`) for LLM discoverability
- Dynamic sitemap (`/sitemap.xml`)
- `<link rel="alternate">` meta tag for machine-readable API discovery
- Hamburger menu on mobile with consistent navigation
- Random post icon on mobile header
- Escape key closes search

#### Improved

- Header simplified: `all · archive · random · 🔍 · ⚙`
- All navigation links and action links use consistent lowercase styling
- Removed year/month filter dropdowns (replaced by archive page)
- Login prompt for visitors (no more grayed-out textarea)
- Login page stretched to full width
- Edit page uses lightweight link-style actions instead of heavy buttons
- Textarea auto-resize no longer causes scroll jumps
- Keyboard shortcut hints hidden on mobile
- Consistent font sizes across nav links, back links, and action links
- Removed dead CSS and unused code

#### Fixed

- Search no longer crashes on special characters
- Search no longer fails silently on multi-word queries
- Textarea editing no longer jumps page to top when content shrinks

### Version 1.4

#### Added

- Custom blog titles
- Inline title editing for owners
- Persistent blog title storage

#### Improved

- Simplified search terminology
- Better branding flexibility for self-hosted instances

### Version 1.3

#### Added

- Expandable post previews for long entries
- Inline expansion without page reloads
- Full-post copying from previews
- Pagination with "Load More" navigation

#### Improved

- Reduced homepage clutter for long-form writing
- Faster browsing through large archives
- Better reading experience on mobile

### Version 1.2

#### Added

- Owner authentication with bcrypt password hashing
- One-time `/setup` flow
- Login/logout with signed session cookies
- Server-side `requireOwner` middleware
- Button feedback on actions
- Delete fade-out animation

### Version 1.1

#### Added

- Random post navigation
- Dark mode
- Back-to-top navigation
- Archive navigation
- Improved mobile responsiveness

---

## Installation

```bash
git clone <repository-url>
cd microblog
npm install
npm start
```

Available at `http://localhost:3000`. On first visit, you'll be redirected to `/setup` to create your owner password.

---

## Who Is This For?

- Writers
- Journalers
- Thinkers
- Researchers
- Developers
- People who maintain personal knowledge archives
- Anyone who prefers simplicity over complexity

---

## License

Use it, modify it, and make it your own.

---

*"A notebook for thoughts, not a platform for attention."*
