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
const albumCards = []; // 用于生成docs/README.md的专辑卡片
albums.forEach(album => {
  const albumPath = path.join(resDir, album);
  const lrcFiles = fs.readdirSync(albumPath).filter(file => file.endsWith('.lrc'));

  // 将文件名中的空格替换为下划线，避免VuePress路由问题
  const albumFileName = album.replace(/\s+/g, '_');

  const songs = [];
  let albumArtist = '';
  lrcFiles.forEach(file => {
    const filePath = path.join(albumPath, file);
    const { title, artist, album: alb } = parseLrc(filePath);
    if (!albumArtist && artist) albumArtist = artist;
    const songTitle = title || file.replace('.lrc', '');
    songs.push({ title: songTitle, file });
  });

  // Copy cover image if exists
  const coverExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  let coverFile = null;
  let coverExt = '';
  for (const ext of coverExtensions) {
    const potentialCover = path.join(albumPath, `cover${ext}`);
    if (fs.existsSync(potentialCover)) {
      coverFile = `cover${ext}`;
      coverExt = ext;
      break;
    }
  }
  if (coverFile) {
    const srcCover = path.join(albumPath, coverFile);
    const destCover = path.join(albumsDir, `${albumFileName}${coverExt}`);
    fs.copyFileSync(srcCover, destCover);
  }

  // Check if cover exists in docs (any supported extension)
  let hasCover = false;
  let coverDisplayExt = '';
  for (const ext of coverExtensions) {
    const potentialCover = path.join(albumsDir, `${albumFileName}${ext}`);
    if (fs.existsSync(potentialCover)) {
      hasCover = true;
      coverDisplayExt = ext;
      break;
    }
  }

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

${hasCover ? `<img src="${albumFileName}${coverDisplayExt}" alt="${album} 封面" style="max-width: 40%; height: auto;" />` : ''}

**Artist:** ${albumArtist || 'Unknown'}

**歌曲数量:** ${songs.length} 首

## 曲目列表

${songs.map((song, index) => `${index + 1}. [${song.title}](https://cdn.jsdelivr.net/gh/${repo}@main/res/${encodeURIComponent(album)}/${encodeURIComponent(song.file)})`).join('\n')}

## 下载

下载本专辑所有歌词文件：[📦 ZIP 打包下载](https://cdn.jsdelivr.net/gh/${repo}@main/pack/${encodeURIComponent(album)}.zip)
`;

  fs.writeFileSync(path.join(albumsDir, `${albumFileName}.md`), mdContent);
  albumList.push(`- [${album}](albums/${albumFileName}.md)`);
  
  // 为docs/README.md生成专辑卡片
  const coverUrl = hasCover ? `albums/${albumFileName}${coverDisplayExt}` : '';
  albumCards.push({
    name: album,
    fileName: albumFileName,
    cover: coverUrl,
    songCount: songs.length,
    artist: albumArtist || 'Unknown'
  });
});

// 生成docs/README.md
const docsReadmeContent = `---
home: true
icon: material-symbols:home
title: 首页
heroText: 中术 LRC 歌词分享
tagline: 中术虚拟歌手团体的歌词资源库
---

## 关于本站

本站收录并整理中术虚拟歌手团体官方及第三方专辑的 LRC 歌词文件，方便爱好者在线浏览和下载使用。

所有歌词资源遵循 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 协议，**仅供个人学习和研究使用**。

---

## 专辑列表

${albumCards.map(card => {
  const coverImg = card.cover ? `<img src="${card.cover}" alt="${card.name}" width="150" align="left" style="margin-right: 20px; margin-bottom: 10px;" />` : '';
  return `${coverImg}

### [${card.name}](albums/${card.fileName}.md)

**歌手：** ${card.artist}  
**曲目数：** ${card.songCount} 首

[查看详情 →](albums/${card.fileName}.md)

<div style="clear: both;"></div>

---
`;
}).join('\n')}

## 资源说明

- 📝 点击专辑名称查看完整歌词列表
- 📥 支持单曲下载和专辑打包下载
- 🔍 使用顶部搜索框快速查找歌曲

::: tip 版权声明
所有歌词版权归原作者或版权所有方所有，请勿用于商业目的。
:::
`;

fs.writeFileSync(path.join(docsDir, 'README.md'), docsReadmeContent);

console.log('MD files generated successfully.');
console.log(`Generated ${albums.length} album pages and docs/README.md`);