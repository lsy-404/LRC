const fs = require('fs');
const path = require('path');
const chardet = require('chardet');
const iconv = require('iconv-lite');

const repo = 'wuyilingwei/LRC';
const rootDir = path.resolve(__dirname, '..', '..');
const resDir = path.join(rootDir, 'res');
const docsDir = path.join(rootDir, 'docs');
const albumsDir = path.join(docsDir, 'albums');
const publicDir = path.join(docsDir, '.vuepress', 'public');
const publicAlbumsDir = path.join(publicDir, 'albums');

// Ensure directories exist
if (!fs.existsSync(albumsDir)) {
  fs.mkdirSync(albumsDir, { recursive: true });
}
if (!fs.existsSync(publicAlbumsDir)) {
  fs.mkdirSync(publicAlbumsDir, { recursive: true });
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

// Function to parse info.json or info.toml with Chinese support
function parseInfoFile(albumPath) {
  const info = {
    year: '',
    produce: '',
    vocal: [],
    lyricist: [],
    composer: [],
    tuning: [],
    release: '',
    purchase: ''
  };

  // Try JSON first
  const jsonPath = path.join(albumPath, 'info.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const content = fs.readFileSync(jsonPath, 'utf-8');
      const parsed = JSON.parse(content);
      
      info.year = parsed['年份'] || parsed['year'] || '';
      info.produce = parsed['出品'] || parsed['produce'] || '';
      info.vocal = Array.isArray(parsed['演唱'] || parsed['vocal']) 
        ? (parsed['演唱'] || parsed['vocal']).filter(v => v && v !== 'N/A' && v !== '') 
        : [];
      info.lyricist = Array.isArray(parsed['作词'] || parsed['lyricist']) 
        ? (parsed['作词'] || parsed['lyricist']).filter(v => v && v !== 'N/A' && v !== '') 
        : [];
      info.composer = Array.isArray(parsed['作曲'] || parsed['composer']) 
        ? (parsed['作曲'] || parsed['composer']).filter(v => v && v !== 'N/A' && v !== '') 
        : [];
      info.tuning = Array.isArray(parsed['调校'] || parsed['tuning']) 
        ? (parsed['调校'] || parsed['tuning']).filter(v => v && v !== 'N/A' && v !== '') 
        : [];
      info.release = parsed['发布'] || parsed['release'] || '';
      info.purchase = parsed['购买'] || parsed['purchase'] || '';
      
      return info;
    } catch (err) {
      // Fall through to TOML
    }
  }

  // Try TOML with regex parsing for Chinese key support
  const tomlPath = path.join(albumPath, 'info.toml');
  if (fs.existsSync(tomlPath)) {
    try {
      const buffer = fs.readFileSync(tomlPath);
      const detected = chardet.detect(buffer) || 'utf8';
      let content;
      try {
        content = iconv.decode(buffer, detected);
      } catch (e) {
        content = buffer.toString('utf-8');
      }

      // Parse TOML with regex for Chinese keys
      const parseValue = (val) => {
        val = val.trim();
        // Handle arrays
        if (val.startsWith('[')) {
          const arrayContent = val.slice(1, -1);
          if (!arrayContent.trim()) return [];
          return arrayContent.split('/,/').map(v => {
            v = v.trim();
            if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
            if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
            return v;
          });
        }
        // Handle strings
        if (val.startsWith('"') && val.endsWith('"')) return val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) return val.slice(1, -1);
        return val;
      };

      // Use regex to parse key-value pairs
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/^([^=]+?)\s*=\s*(.+)$/);
        if (!match) continue;
        
        const key = match[1].trim();
        const value = parseValue(match[2]);

        if (key === '年份' || key === 'year') info.year = value;
        else if (key === '出品' || key === 'produce') info.produce = value;
        else if (key === '演唱' || key === 'vocal') info.vocal = Array.isArray(value) ? value : [];
        else if (key === '作词' || key === 'lyricist') info.lyricist = Array.isArray(value) ? value : [];
        else if (key === '作曲' || key === 'composer') info.composer = Array.isArray(value) ? value : [];
        else if (key === '调校' || key === 'tuning') info.tuning = Array.isArray(value) ? value : [];
        else if (key === '发布' || key === 'release') info.release = value;
        else if (key === '购买' || key === 'purchase') info.purchase = value;
      }

      return info;
    } catch (err) {
      // Fall back to defaults
    }
  }

  return info;
}

// Function to read and parse info.json or info.toml
function readAlbumInfo(albumPath) {
  return parseInfoFile(albumPath);
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

  // 读取专辑信息
  const info = readAlbumInfo(albumPath);

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
    // Copy to public directory for VuePress static assets
    const destCover = path.join(publicAlbumsDir, `${albumFileName}${coverExt}`);
    fs.copyFileSync(srcCover, destCover);
  }

  // Check if cover exists in public directory
  let hasCover = false;
  let coverDisplayExt = '';
  for (const ext of coverExtensions) {
    const potentialCover = path.join(publicAlbumsDir, `${albumFileName}${ext}`);
    if (fs.existsSync(potentialCover)) {
      hasCover = true;
      coverDisplayExt = ext;
      break;
    }
  }

  // Build tag list
  const tagList = [album];
  if (info.produce) tagList.push(info.produce);
  if (info.vocal.length > 0) tagList.push(...info.vocal);
  if (info.lyricist.length > 0) tagList.push(...info.lyricist);
  if (info.composer.length > 0) tagList.push(...info.composer);
  if (info.tuning.length > 0) tagList.push(...info.tuning);

  // Build info display for album page
  const infoDisplay = [];
  if (info.year) infoDisplay.push(`**发行年份:** ${info.year}`);
  if (info.produce) infoDisplay.push(`**出品:** ${info.produce}`);
  if (info.vocal.length > 0) infoDisplay.push(`**演唱:** ${info.vocal.join('、')}`);
  if (info.lyricist.length > 0) infoDisplay.push(`**作词:** ${info.lyricist.join('、')}`);
  if (info.composer.length > 0) infoDisplay.push(`**作曲:** ${info.composer.join('、')}`);
  if (info.tuning.length > 0) infoDisplay.push(`**调校:** ${info.tuning.join('、')}`);

  // Generate MD for album
  const mdContent = `---
title: ${album}
category:
  - ${album}
tag:
${tagList.map(t => `  - ${t}`).join('\n')}
---

# ${album}

${hasCover ? `<img src="/albums/${albumFileName}${coverDisplayExt}" alt="${album} 封面" style="max-width: 40%; height: auto;" />` : ''}

${infoDisplay.length > 0 ? infoDisplay.join('\n\n') + '\n' : ''}
**歌曲数量:** ${songs.length} 首

## 曲目列表

${songs.map((song, index) => `${index + 1}. [${song.title}](https://cdn.jsdelivr.net/gh/${repo}@main/res/${encodeURIComponent(album)}/${encodeURIComponent(song.file)})`).join('\n')}

## 下载

下载本专辑所有歌词文件：[📦 ZIP 打包下载](https://cdn.jsdelivr.net/gh/${repo}@main/pack/${encodeURIComponent(album)}.zip)
`;

  fs.writeFileSync(path.join(albumsDir, `${albumFileName}.md`), mdContent);
  albumList.push(`- [${album}](albums/${albumFileName}.md)`);
  
  // 为docs/README.md生成专辑卡片
  const coverUrl = hasCover ? `/albums/${albumFileName}${coverDisplayExt}` : '';
  albumCards.push({
    name: album,
    fileName: albumFileName,
    cover: coverUrl,
    songCount: songs.length,
    produce: info.produce || '缺少信息',
    year: info.year || '缺少信息',
    vocal: info.vocal
  });
});

// 生成docs/README.md
const docsReadmeContent = `---
icon: material-symbols:home
title: 首页
heroText: 中术 LRC 歌词分享
tagline: 中术虚拟歌手团体的歌词资源库
---

## 关于本站

本站收录并整理中术虚拟歌手团体官方及第三方专辑的 LRC 歌词文件，方便爱好者在线浏览和下载使用。

所有歌词资源遵循 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 许可协议。本站仅收集网上公开资源。

## 专辑列表

${albumCards.map(card => {
  
  // 构建信息字符串
  let infoStr = '';
  if (card.year !== '缺少信息') infoStr += `年份：${card.year} | `;
  infoStr += `出品：${card.produce}`;
  if (card.vocal && card.vocal.length > 0) infoStr += ` | 演唱：${card.vocal.join('、')}`;
  
  // 构建cover image HTML
  const coverImg = card.cover ? `<img src="${card.cover}" style="float: left; width: 150px; height: auto; margin-right: 20px; border-radius: 4px;">` : '';
  
  return `${coverImg}

### [${card.name}](albums/${card.fileName}.md)

${infoStr}  
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