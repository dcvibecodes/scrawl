const fs = require('fs');
const path = require('path');

function generateSvgIcon(size, color = '#333333') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="white"/>
  <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${size * 0.5}" font-weight="bold" fill="${color}">M</text>
</svg>`;
}

const publicDir = path.join(__dirname, 'public');

fs.writeFileSync(path.join(publicDir, 'icon.svg'), generateSvgIcon(64));
fs.writeFileSync(path.join(publicDir, 'icon-192.svg'), generateSvgIcon(192));
fs.writeFileSync(path.join(publicDir, 'icon-512.svg'), generateSvgIcon(512));

console.log('Icons generated in public/');