// Clean gender-neutral avatar (head + shoulders), monochrome via currentColor.
const PIXEL_AVATAR_SVG = `<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">
<circle cx="6" cy="3.5" r="2.5"/>
<path d="M2 11c0-2.2 1.8-4 4-4s4 1.8 4 4z"/>
</svg>`;

// Clean thought bubble (rounded cloud with tail and dot), monochrome via currentColor.
const THOUGHT_BUBBLE_SVG = `<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">
<rect x="1" y="1" width="10" height="7" rx="2"/>
<path d="M4 8v2l2-2z"/>
<circle cx="6" cy="10.5" r="0.6"/>
</svg>`;

const ENTRY_AVATAR = `<div class="entry-avatar">${THOUGHT_BUBBLE_SVG}</div>`;

module.exports = { PIXEL_AVATAR_SVG, THOUGHT_BUBBLE_SVG, ENTRY_AVATAR };