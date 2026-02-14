const fs = require('fs');
const path = require('path');
const chardet = require('chardet');
const iconv = require('iconv-lite');

const resDir = path.join(__dirname, '..', '..', 'res');

const albums = fs.readdirSync(resDir, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name);

// Default dates for years (can be customized per album)
const yearToDate = {
  '2023': '2023-01-01',
  '2024': '2024-01-01',
  '2025': '2025-01-01',
  '2026': '2026-01-01'
};

albums.forEach(album => {
  const albumPath = path.join(resDir, album);
  const tomlPath = path.join(albumPath, 'info.toml');

  if (!fs.existsSync(tomlPath)) {
    return;
  }

  try {
    const buffer = fs.readFileSync(tomlPath);
    const detected = chardet.detect(buffer) || 'utf8';
    
    let content;
    try {
      content = iconv.decode(buffer, detected);
    } catch (e) {
      content = buffer.toString('utf-8');
    }

    // Replace year format (YYYY) with date format (YYYY-MM-DD)
    const updatedContent = content.replace(/^年份\s*=\s*"(\d{4})"\s*$/m, (match, year) => {
      const date = yearToDate[year] || `${year}-01-01`;
      return `年份 = "${date}"`;
    });

    // Write back with UTF-8 encoding
    fs.writeFileSync(tomlPath, updatedContent, 'utf-8');
    console.log(`Updated: ${album}`);
  } catch (err) {
    console.warn(`Failed to update ${album}: ${err.message}`);
  }
});

console.log('All TOML files updated successfully.');
