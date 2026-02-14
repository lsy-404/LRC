const fs = require('fs');
const path = require('path');

const repo = 'wuyilingwei/LRC';
const rootDir = path.resolve(__dirname, '..', '..');
const resDir = path.join(rootDir, 'res');
const docsDir = path.join(rootDir, 'docs');
const albumsDir = path.join(docsDir, 'albums');

// Ensure albums directory exists
if (!fs.existsSync(albumsDir)) {
  fs.mkdirSync(albumsDir, { recursive: true });
}

// Function to parse LRC file for metadata
function parseLrc(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const tiMatch = content.match(/\[ti:(.+?)\]/);
  const arMatch = content.match(/\[ar:(.+?)\]/);
  const alMatch = content.match(/\[al:(.+?)\]/);
  return {
    title: tiMatch ? tiMatch[1] : '',
    artist: arMatch ? arMatch[1] : '',
    album: alMatch ? alMatch[1] : ''
  };
}

// Get all album directories
const albums = fs.readdirSync(resDir, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name);

// Process each album
const albumList = [];
albums.forEach(album => {
  const albumPath = path.join(resDir, album);
  const lrcFiles = fs.readdirSync(albumPath).filter(file => file.endsWith('.lrc'));

  const songs = [];
  let albumArtist = '';
  lrcFiles.forEach(file => {
    const filePath = path.join(albumPath, file);
    const { title, artist, album: alb } = parseLrc(filePath);
    if (!albumArtist && artist) albumArtist = artist;
    const songTitle = title || file.replace('.lrc', '');
    songs.push({ title: songTitle, file });
  });

  // Generate MD for album
  const tagList = [];
  if (albumArtist) tagList.push(albumArtist);
  tagList.push(album);
  const mdContent = `---
title: ${album}
category:
  - ${album}
tag:
${tagList.map(t => `  - ${t}`).join('\n')}
---

# ${album}

Artist: ${albumArtist || 'Unknown'}

## Songs

${songs.map(song => `- [${song.title}](https://raw.githubusercontent.com/${repo}/main/res/${album}/${song.file})`).join('\n')}

## Download

Download all LRC files for this album: [ZIP](https://github.com/${repo}/archive/main.zip) (placeholder)
`;

  fs.writeFileSync(path.join(albumsDir, `${album}.md`), mdContent);
  albumList.push(`- [${album}](albums/${album}.md)`);
});

// Update main README
const readmePath = path.join(docsDir, 'README.md');
let readme = fs.readFileSync(readmePath, 'utf-8');
const albumSection = '## Albums\n\n' + albumList.join('\n');
if (readme.includes('## Albums')) {
  readme = readme.replace(/## Albums[\s\S]*/, albumSection);
} else {
  readme += '\n\n' + albumSection;
}
fs.writeFileSync(readmePath, readme);

console.log('MD files generated successfully.');