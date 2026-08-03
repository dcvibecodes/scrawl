(function(){
    // Mobile menu
    var hamburger = document.getElementById('hamburgerBtn');
    var mobileMenu = document.getElementById('mobileMenu');
    var mobileMenuClose = document.getElementById('mobileMenuClose');
    var mobileMenuBackdrop = document.getElementById('mobileMenuBackdrop');
    function openMobileMenu() {
        mobileMenu.classList.add('open');
        mobileMenuBackdrop.classList.add('open');
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
    }
    function closeMobileMenu() {
        mobileMenu.classList.remove('open');
        mobileMenuBackdrop.classList.remove('open');
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
    }
    if (hamburger) {
        hamburger.addEventListener('click', openMobileMenu);
    }
    if (mobileMenuClose) {
        mobileMenuClose.addEventListener('click', closeMobileMenu);
    }
    if (mobileMenuBackdrop) {
        mobileMenuBackdrop.addEventListener('click', closeMobileMenu);
        mobileMenuBackdrop.addEventListener('touchmove', function(e) { e.preventDefault(); }, { passive: false });
    }
    var mobileTheme = document.getElementById('mobileThemeToggle');
    if (mobileTheme) {
        if (document.documentElement.getAttribute('data-theme') === 'dark') mobileTheme.textContent = 'light';
        mobileTheme.addEventListener('click', function(e) {
            e.preventDefault();
            var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            if (isDark) {
                document.documentElement.removeAttribute('data-theme');
                mobileTheme.textContent = 'dark';
                localStorage.setItem('theme', 'light');
            } else {
                document.documentElement.setAttribute('data-theme', 'dark');
                mobileTheme.textContent = 'light';
                localStorage.setItem('theme', 'dark');
            }
            closeMobileMenu();
        });
    }

    // Search bar
    var searchOpenBtn = document.getElementById('searchOpenBtn');
    var searchCloseBtn = document.getElementById('searchCloseBtn');
    var searchBarOverlay = document.getElementById('searchBarOverlay');
    var searchField = document.getElementById('search-field');

    function openSearch() {
        searchBarOverlay.classList.add('open');
        setTimeout(function() { searchField.focus(); }, 100);
    }

    function closeSearch() {
        if (searchField.value) {
            window.location.href = '/';
            return;
        }
        searchBarOverlay.classList.remove('open');
    }

    if (searchOpenBtn) searchOpenBtn.addEventListener('click', openSearch);
    if (searchCloseBtn) searchCloseBtn.addEventListener('click', closeSearch);

    // Submit search on Enter
    if (searchField) {
        searchField.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                var q = searchField.value.trim();
                if (q) window.location.href = '/?q=' + encodeURIComponent(q);
            }
            if (e.key === 'Escape') {
                closeSearch();
            }
        });
    }

    // Auto-open if there's an active search query
    if (searchField && searchField.value) {
        openSearch();
    }

    // Menu dropdown
    var menuBtn = document.getElementById('menuBtn');
    var menuDropdown = document.getElementById('menuDropdown');
    if (menuBtn) {
        menuBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            menuDropdown.classList.toggle('open');
        });
        document.addEventListener('click', function(e) {
            if (menuDropdown && !menuDropdown.contains(e.target) && e.target !== menuBtn) {
                menuDropdown.classList.remove('open');
            }
        });
    }

    // Theme toggle (desktop dropdown + mobile menu)
    var toggleBtn = document.getElementById('themeToggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function(e) {
            e.preventDefault();
            var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            if (isDark) {
                document.documentElement.removeAttribute('data-theme');
                toggleBtn.textContent = 'dark';
                localStorage.setItem('theme', 'light');
            } else {
                document.documentElement.setAttribute('data-theme', 'dark');
                toggleBtn.textContent = 'light';
                localStorage.setItem('theme', 'dark');
            }
            if (menuDropdown) menuDropdown.classList.remove('open');
        });
        // Set initial text
        if (document.documentElement.getAttribute('data-theme') === 'dark') toggleBtn.textContent = 'light';
    }

    // Copy post text
    window.copyPermalink = function(el, id) {
        var entry = el.closest('.entry');
        var content = entry ? entry.querySelector('.content') : null;
        var text = '';
        if (content) { text = content.dataset.full || content.textContent; }
        navigator.clipboard.writeText(text).then(function() {
            el.textContent = 'copied';
            setTimeout(function() { el.textContent = 'copy text'; }, 2000);
        }).catch(function() {
            el.textContent = 'failed';
            setTimeout(function() { el.textContent = 'copy text'; }, 2000);
        });
    };

    // Copy post link
    window.copyPostLink = function(el, id) {
        var url = window.location.origin + '/post/' + id;
        navigator.clipboard.writeText(url).then(function() {
            el.textContent = 'copied';
            setTimeout(function() { el.textContent = 'copy link'; }, 2000);
        }).catch(function() {
            el.textContent = 'failed';
            setTimeout(function() { el.textContent = 'copy link'; }, 2000);
        });
    };

    // Textarea auto-resize
    window.attachAutoResize = function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        function resize() { var s = window.scrollY; el.style.height = 'auto'; el.style.overflowY = 'hidden'; el.style.height = el.scrollHeight + 'px'; window.scrollTo(0, s); }
        el.addEventListener('input', resize);
        el.addEventListener('paste', function() { setTimeout(resize, 0); });
        requestAnimationFrame(resize);
        window.addEventListener('load', resize);
        resize();
    };

    // Random link feedback — cycle through random dice faces while rolling
    var DICE_FACES = {
        1: ['c'],
        2: ['tl', 'br'],
        3: ['tl', 'c', 'br'],
        4: ['tl', 'tr', 'bl', 'br'],
        5: ['tl', 'tr', 'c', 'bl', 'br'],
        6: ['tl', 'tr', 'l', 'r', 'bl', 'br']
    };
    function setDiceFace(link, face) {
        link.querySelectorAll('.die-dot').forEach(function(dot) {
            dot.style.display = DICE_FACES[face].indexOf(dot.getAttribute('data-pos')) !== -1 ? '' : 'none';
        });
    }
    function getStoredDiceFace() {
        var f = parseInt(localStorage.getItem('diceFace') || '5', 10);
        return (f >= 1 && f <= 6) ? f : 5;
    }
    document.querySelectorAll('a[href="/random"]').forEach(function(link) {
        var rollInterval = null;
        // A real die stays where it lands — show the last rolled face
        setDiceFace(link, getStoredDiceFace());
        link.addEventListener('click', function(e) {
            e.preventDefault();
            link.classList.add('loading');
            link.style.pointerEvents = 'none';
            var startFace = getStoredDiceFace();
            var lastFace = startFace;
            rollInterval = setInterval(function() {
                var face;
                do { face = Math.floor(Math.random() * 6) + 1; } while (face === lastFace);
                lastFace = face;
                setDiceFace(link, face);
            }, 100);
            setTimeout(function() {
                // Guarantee the roll ends on a different face than it started
                if (lastFace === startFace) {
                    do { lastFace = Math.floor(Math.random() * 6) + 1; } while (lastFace === startFace);
                    setDiceFace(link, lastFace);
                }
                localStorage.setItem('diceFace', lastFace);
                window.location.href = link.href;
            }, 550);
        });
        link.resetDice = function() {
            if (rollInterval) { clearInterval(rollInterval); rollInterval = null; }
            setDiceFace(link, getStoredDiceFace());
        };
    });

    // Reset random button state when returning via browser back (bfcache)
    window.addEventListener('pageshow', function(e) {
        if (e.persisted) {
            document.querySelectorAll('a[href="/random"]').forEach(function(link) {
                link.classList.remove('loading');
                link.style.pointerEvents = '';
                if (link.resetDice) link.resetDice();
            });
        }
    });

    // Publishing button feedback
    var addForms = document.querySelectorAll('form[action="/add"]');
    addForms.forEach(function(form) {
        form.addEventListener('submit', function() {
            postNavigating = true;
            var btn = form.querySelector('button[type="submit"]');
            if (btn) { btn.textContent = 'Posting...'; btn.disabled = true; }
        });
    });

    // Update Post link feedback
    var editForms = document.querySelectorAll('form[action^="/edit/"]');
    editForms.forEach(function(form) {
        form.addEventListener('submit', function() {
            var link = form.querySelector('#updatePostLink');
            if (link) { link.textContent = 'updating...'; link.style.pointerEvents = 'none'; }
        });
    });

    // Delete handler
    window.handleDelete = function(form) {
        var btn = form.querySelector('.delete-btn');
        // If already confirming, proceed with delete
        if (btn && btn.dataset.confirming === 'true') {
            btn.textContent = 'deleting...';
            btn.disabled = true;
            var entry = form.closest('.entry');
            var isArticle = form.action.indexOf('/articles/') !== -1;
            fetch(form.action, { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function(response) {
                if (!response.ok) throw new Error('Delete failed');
                if (isArticle) {
                    var listItem = form.closest('.article-list-item');
                    if (listItem) {
                        listItem.style.transition = 'opacity 0.2s ease, max-height 0.2s ease, margin 0.2s ease, padding 0.2s ease';
                        listItem.style.opacity = '0';
                        setTimeout(function() { listItem.style.maxHeight = '0'; listItem.style.marginBottom = '0'; listItem.style.paddingBottom = '0'; listItem.style.overflow = 'hidden'; }, 50);
                        setTimeout(function() { listItem.remove(); }, 250);
                    } else {
                        window.location.href = '/articles';
                    }
                } else if (entry) {
                    entry.style.transition = 'opacity 0.2s ease, max-height 0.2s ease, margin 0.2s ease, padding 0.2s ease';
                    entry.style.opacity = '0';
                    setTimeout(function() { entry.style.maxHeight = '0'; entry.style.marginBottom = '0'; entry.style.paddingBottom = '0'; entry.style.overflow = 'hidden'; }, 50);
                    setTimeout(function() { entry.remove(); }, 250);
                }
            })
            .catch(function() {
                if (btn) { btn.textContent = 'delete'; btn.disabled = false; btn.dataset.confirming = ''; }
                alert('Failed to delete.');
            });
            return false;
        }
        // First click: show "confirm?" text
        if (btn) {
            btn.textContent = 'confirm?';
            btn.dataset.confirming = 'true';
            // Reset after 3 seconds if not confirmed
            setTimeout(function() {
                if (btn.dataset.confirming === 'true') {
                    btn.textContent = 'delete';
                    btn.dataset.confirming = '';
                }
            }, 3000);
        }
        return false;
    };

    // Unpublish handler
    window.handleUnpublish = function(form) {
        var btn = form.querySelector('.unpublish-btn');
        if (btn && btn.dataset.confirming === 'true') {
            btn.textContent = 'unpublishing...';
            btn.disabled = true;
            fetch(form.action, { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function(response) {
                if (!response.ok) throw new Error('Unpublish failed');
                var listItem = form.closest('.article-list-item');
                if (listItem) {
                    // Add draft badge next to the article name
                    var titleDiv = listItem.querySelector('.article-list-title');
                    if (titleDiv && !titleDiv.querySelector('.draft-badge')) {
                        var badge = document.createElement('span');
                        badge.className = 'draft-badge';
                        badge.textContent = 'draft';
                        titleDiv.appendChild(badge);
                    }
                    // Remove the unpublish form
                    form.remove();
                }
            })
            .catch(function() {
                if (btn) { btn.textContent = 'unpublish'; btn.disabled = false; btn.dataset.confirming = ''; }
                alert('Failed to unpublish.');
            });
            return false;
        }
        if (btn) {
            btn.textContent = 'confirm?';
            btn.dataset.confirming = 'true';
            setTimeout(function() {
                if (btn.dataset.confirming === 'true') {
                    btn.textContent = 'unpublish';
                    btn.dataset.confirming = '';
                }
            }, 3000);
        }
        return false;
    };

    // Back to top
    var backToTop = document.getElementById('backToTop');
    if (backToTop) {
        window.addEventListener('scroll', function() {
            if (window.scrollY > 500) { backToTop.classList.add('visible'); }
            else { backToTop.classList.remove('visible'); }
        });
        backToTop.addEventListener('click', function(e) {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // Expand truncated posts
    document.querySelectorAll('.expandable-content').forEach(function(el) {
        el.addEventListener('click', function() {
            if (el.dataset.expanded === 'true') return;
            el.textContent = el.dataset.full;
            el.dataset.expanded = 'true';
            el.style.cursor = 'default';
        });
    });

    // Global keyboard shortcut: / to open search
    document.addEventListener('keydown', function(e) {
        var tag = e.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if (e.key === '/') {
            e.preventDefault();
            openSearch();
        }
    });

    if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js'); }

    // Blog title edit
    var blogTitle = document.getElementById('blogTitle');
    var editBlogTitle = document.getElementById('editBlogTitle');
    var mobileEditTitle = document.getElementById('mobileEditTitle');

    function doEditTitle() {
        var currentTitle = blogTitle.textContent.trim();
        var newTitle = prompt('Blog title:', currentTitle);
        if (newTitle === null || newTitle.trim() === '' || newTitle === currentTitle) return;
        fetch('/api/blog-title', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTitle.trim() })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) throw new Error();
            blogTitle.textContent = data.title;
            document.title = data.title;
        })
        .catch(function() { alert('Failed to save title'); });
    }

    if (editBlogTitle) {
        editBlogTitle.addEventListener('click', function(e) {
            e.preventDefault();
            if (menuDropdown) menuDropdown.classList.remove('open');
            doEditTitle();
        });
    }
    if (mobileEditTitle) {
        mobileEditTitle.addEventListener('click', function(e) {
            e.preventDefault();
            closeMobileMenu();
            doEditTitle();
        });
    }

    // Copyright/footer edit
    var editCopyright = document.getElementById('editCopyright');
    var mobileEditCopyright = document.getElementById('mobileEditCopyright');
    function doEditCopyright() {
        var footer = document.querySelector('.site-footer');
        var currentText = footer ? footer.textContent.trim() : '';
        var newText = prompt('Footer text (leave empty to remove):', currentText);
        if (newText === null) return;
        fetch('/api/copyright', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: newText.trim() })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) throw new Error();
            if (data.text) {
                if (footer) { footer.textContent = data.text; }
                else { var f = document.createElement('footer'); f.className = 'site-footer'; f.textContent = data.text; document.querySelector('.container').after(f); }
            } else {
                if (footer) footer.remove();
            }
        })
        .catch(function() { alert('Failed to save footer'); });
    }
    if (editCopyright) {
        editCopyright.addEventListener('click', function(e) {
            e.preventDefault();
            if (menuDropdown) menuDropdown.classList.remove('open');
            doEditCopyright();
        });
    }
    if (mobileEditCopyright) {
        mobileEditCopyright.addEventListener('click', function(e) {
            e.preventDefault();
            closeMobileMenu();
            doEditCopyright();
        });
    }

    // Owner name edit
    var editOwnerName = document.getElementById('editOwnerName');
    var mobileEditOwnerName = document.getElementById('mobileEditOwnerName');
    function doEditOwnerName() {
        fetch('/api/owner-name')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var currentName = data.name || '';
            var newName = prompt('Owner display name for comments:', currentName);
            if (newName === null) return;
            if (!newName.trim()) { alert('Name cannot be empty.'); return; }
            fetch('/api/owner-name', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName.trim() })
            })
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (!d.success) throw new Error();
            })
            .catch(function() { alert('Failed to save name'); });
        });
    }
    if (editOwnerName) {
        editOwnerName.addEventListener('click', function(e) {
            e.preventDefault();
            if (menuDropdown) menuDropdown.classList.remove('open');
            doEditOwnerName();
        });
    }
    if (mobileEditOwnerName) {
        mobileEditOwnerName.addEventListener('click', function(e) {
            e.preventDefault();
            closeMobileMenu();
            doEditOwnerName();
        });
    }
})();