const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const publicDir = path.join(__dirname, 'public');

// Ensure we have SVGs first
function ensureSvgs() {
    const svgs = [
        { name: 'icon.svg', size: 64 },
        { name: 'icon-192.svg', size: 192 },
        { name: 'icon-512.svg', size: 512 }
    ];
    
    svgs.forEach(({ name, size }) => {
        const filePath = path.join(publicDir, name);
        if (!fs.existsSync(filePath)) {
            const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="white"/>
  <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${size * 0.5}" font-weight="bold" fill="#333333">M</text>
</svg>`;
            fs.writeFileSync(filePath, svgContent);
            console.log(`Created ${name}`);
        }
    });
}

// Convert SVG to PNG using macOS sips
function convertSvgToPng(svgName, pngName, size) {
    const svgPath = path.join(publicDir, svgName);
    const pngPath = path.join(publicDir, pngName);
    
    if (!fs.existsSync(svgPath)) {
        console.error(`SVG not found: ${svgPath}`);
        return;
    }
    
    try {
        execSync(`sips -s format png "${svgPath}" --resampleWidth ${size} --out "${pngPath}" 2>/dev/null`, {
            stdio: 'pipe',
            timeout: 10000
        });
        console.log(`Created ${pngName} (${size}x${size})`);
    } catch (e) {
        console.error(`Failed to create ${pngName}:`, e.message);
    }
}

ensureSvgs();

// Generate all PNG icons
convertSvgToPng('icon-192.svg', 'icon-192.png', 192);
convertSvgToPng('icon-512.svg', 'icon-512.png', 512);
convertSvgToPng('icon-192.svg', 'apple-touch-icon.png', 192);
convertSvgToPng('icon-192.svg', 'favicon-32.png', 32);
convertSvgToPng('icon-192.svg', 'favicon-16.png', 16);

console.log('\nAll PNG icons generated in public/');