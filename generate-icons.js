const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');

function createIconSvg({ light = false, size = 512 } = {}) {
    const bg = light ? '#ffffff' : '#1a1a1a';
    const fg = light ? '#1a1a1a' : '#e5e5e5';
    const scale = size / 512;
    const s = n => Math.round(n * scale * 1000) / 1000;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${s(96)}" fill="${bg}"/>
  <rect x="${s(136)}" y="${s(112)}" width="${s(240)}" height="${s(288)}" rx="${s(16)}" fill="none" stroke="${fg}" stroke-width="${s(16)}"/>
  <line x1="${s(176)}" y1="${s(192)}" x2="${s(336)}" y2="${s(192)}" stroke="${fg}" stroke-width="${s(12)}" stroke-linecap="round"/>
  <line x1="${s(176)}" y1="${s(240)}" x2="${s(310)}" y2="${s(240)}" stroke="${fg}" stroke-width="${s(12)}" stroke-linecap="round"/>
  <line x1="${s(176)}" y1="${s(288)}" x2="${s(280)}" y2="${s(288)}" stroke="${fg}" stroke-width="${s(12)}" stroke-linecap="round"/>
  <line x1="${s(176)}" y1="${s(336)}" x2="${s(250)}" y2="${s(336)}" stroke="${fg}" stroke-width="${s(12)}" stroke-linecap="round"/>
</svg>`;
}

async function generate() {
    let sharp;
    try {
        sharp = require('sharp');
    } catch (e) {
        console.log('sharp is not installed. Install it with: npm install sharp');
        console.log('Or open generate-icons.html in a browser to download PNG icons manually.');
        process.exit(1);
    }

    const darkSvg = createIconSvg();
    const lightSvg = createIconSvg({ light: true });
    fs.writeFileSync(path.join(publicDir, 'icon.svg'), darkSvg);
    fs.writeFileSync(path.join(publicDir, 'icon-light.svg'), lightSvg);
    fs.writeFileSync(path.join(publicDir, 'favicon.svg'), createIconSvg({ size: 32 }));

    const sizes = [
        { name: 'icon-512.png', size: 512, svg: darkSvg },
        { name: 'icon-192.png', size: 192, svg: darkSvg },
        { name: 'apple-touch-icon.png', size: 180, svg: darkSvg },
        { name: 'icon-light-512.png', size: 512, svg: lightSvg },
        { name: 'icon-light-192.png', size: 192, svg: lightSvg },
        { name: 'apple-touch-icon-light.png', size: 180, svg: lightSvg },
        { name: 'favicon-32.png', size: 32, svg: darkSvg },
        { name: 'favicon-16.png', size: 16, svg: darkSvg }
    ];

    for (const { name, size, svg } of sizes) {
        await sharp(Buffer.from(svg))
            .resize(size, size)
            .png()
            .toFile(path.join(publicDir, name));
        console.log(`Created ${name} (${size}x${size})`);
    }

    console.log('\nAll PNG icons generated in public/');
}

generate().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
