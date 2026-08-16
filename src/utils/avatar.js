// Pixel-art gender-neutral avatar (head + shoulders), monochrome via currentColor.
const PIXEL_AVATAR_SVG = `<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">
<rect x="4" y="1" width="4" height="1"/>
<rect x="3" y="2" width="6" height="1"/>
<rect x="3" y="3" width="6" height="1"/>
<rect x="3" y="4" width="6" height="1"/>
<rect x="5" y="5" width="2" height="1"/>
<rect x="2" y="6" width="8" height="1"/>
<rect x="1" y="7" width="10" height="1"/>
<rect x="1" y="8" width="10" height="1"/>
<rect x="1" y="9" width="10" height="1"/>
<rect x="2" y="10" width="8" height="1"/>
</svg>`;

// Pixel-art thought bubble (cloud with trailing dots), monochrome via currentColor.
const THOUGHT_BUBBLE_SVG = `<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">
<rect x="5" y="1" width="2" height="1"/>
<rect x="4" y="2" width="4" height="1"/>
<rect x="3" y="3" width="6" height="1"/>
<rect x="2" y="4" width="8" height="1"/>
<rect x="2" y="5" width="8" height="1"/>
<rect x="1" y="6" width="10" height="1"/>
<rect x="1" y="7" width="10" height="1"/>
<rect x="2" y="8" width="8" height="1"/>
<rect x="4" y="9" width="2" height="1"/>
<rect x="4" y="10" width="2" height="1"/>
<rect x="3" y="11" width="1" height="1"/>
</svg>`;

const ENTRY_AVATAR = `<div class="entry-avatar">${THOUGHT_BUBBLE_SVG}</div>`;

module.exports = { PIXEL_AVATAR_SVG, THOUGHT_BUBBLE_SVG, ENTRY_AVATAR };