# Microblog

**Version 1.3**

A minimalist microblogging and note-taking platform built for people who prefer writing over scrolling.

Microblog is designed to feel like a personal notebook: fast, distraction-free, and focused entirely on ideas. No feeds. No likes. No algorithms. Just your thoughts, organized chronologically and instantly searchable.

---

## Features

### Writing First

- Clean, distraction-free writing experience
- Fast post creation
- Auto-expanding text editor
- Character and word counter
- Keyboard shortcuts
- Button feedback on publish, edit, delete, and filter actions

### Owner Authentication

- Password-protected publishing, editing, and deleting
- Visitors can read all posts but cannot modify anything
- One-time setup flow on first launch
- bcrypt-hashed password storage (12 rounds, salted)
- HMAC-signed session cookies (httpOnly, sameSite strict)
- 7-day session persistence
- Grayed-out publish box for visitors with login prompt

### Search

- Fuzzy full-text search powered by SQLite FTS5
- Instant access to old thoughts and notes
- Search directly from the homepage

### Archives

- Filter by year
- Filter by month
- Browse historical entries
- Quickly rediscover older ideas

### Random Discovery

- Open a random post from your archive
- Rediscover forgotten thoughts and notes

### Editing

- Edit existing posts
- Delete posts with confirmation and visual feedback
- Permanent links for individual entries
- Inline post expansion for long posts
- Full-post copying even when previews are truncated

### Mobile Friendly

- Responsive design
- No horizontal scrolling
- Works well on phones and tablets
- Progressive Web App (PWA) support
- Optimized header layout for narrow screens

### Dark Mode

- Light and dark themes
- Theme preference saved locally

---

## Philosophy

Most writing apps have become increasingly complicated.

Microblog takes the opposite approach.

The goal is simple:

- Capture ideas quickly
- Find them later
- Stay out of the way

No timelines.

No engagement metrics.

No notifications.

No unnecessary features.

Just writing.

---

## Keyboard Shortcuts

| Shortcut | Action                |
| -------- | --------------------- |
| N        | Focus new post editor |
| /        | Focus search box      |

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

## Security

| Concern | Solution |
|---------|----------|
| Password storage | bcrypt hash (12 rounds, salted, slow-by-design) |
| Session token | HMAC-signed, stored in httpOnly cookie |
| Cookie flags | httpOnly, sameSite strict |
| Write protection | Server-side middleware on all mutating routes |
| XSS prevention | HTML escaping on all user content |

### Password Reset

If you forget your password, delete the file `data/owner.hash` from the server and restart. The app will redirect you to `/setup` to set a new password.

---

## Changelog

### Version 1.3

#### Added

* Expandable post previews for long entries
* Inline expansion without page reloads
* Full-post copying from previews without requiring expansion
* Pagination with "Load More" navigation
* Improved editing workflow with cancel returning to the post permalink

#### Improved

* Reduced homepage clutter for long-form writing
* Faster browsing through large archives
* Better reading experience on mobile devices
* Cleaner handling of long posts while preserving the minimalist interface

#### Fixed

* Preview expansion now preserves original post formatting
* Copy action correctly copies the complete post instead of the visible preview
* Removed layout shifts and spacing inconsistencies when expanding posts

### Version 1.2

#### Added

- Owner authentication with bcrypt password hashing
- One-time `/setup` flow for first-time password creation
- Login/logout with signed session cookies
- Grayed-out publish box for unauthenticated visitors
- "Login" link in header and below disabled publish area
- Server-side `requireOwner` middleware on all write routes
- Button feedback: "Publishing...", "Updating...", "deleting...", "Filtering..."
- Delete button shows "deleting..." with entry fade-out
- Responsive header tightening for very narrow screens

#### Security

- Passwords hashed with bcryptjs (12 rounds)
- Session tokens are HMAC-SHA256 signed with auto-generated secret
- Cookies are httpOnly + sameSite strict
- Timing-safe comparison for session validation
- No plaintext credentials stored anywhere

### Version 1.1

#### Added

- Random post navigation
- Dark mode UI refinements
- Improved search icon
- Improved mobile responsiveness
- Back-to-top navigation
- Consistent archive navigation
- MM/DD/YYYY date formatting
- Cleaner action links
- Improved dark mode styling

#### Improved

- Reduced visual clutter
- More consistent typography
- More cohesive monochrome design language
- Better mobile experience
- Cleaner archive browsing

---

## Installation

```bash
git clone <repository-url>
cd microblog
npm install
npm start
```

The application will be available at:

```
http://localhost:3000
```

On first visit, you'll be redirected to `/setup` to create your owner password.

---

## Who Is This For?

Microblog is ideal for:

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
