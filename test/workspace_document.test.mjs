import test from 'node:test';
import assert from 'node:assert/strict';
import {
  META_FIELDS, assetRole, cleanAlbumName, documentId, explorerTree, isDirty, persistVocal,
  sanitizeGeneratedTrack, selectedVocal, toDraft, toEdit, viewsFor, linkedInstrumentalTracks, syncInstrumentalLyrics,
} from '../docs/.vuepress/components/workspaceDocument.js';

function makeNewId() {
  let n = 0;
  return () => n++;
}

function baseDraft(overrides = {}) {
  return {
    album: '测试专辑',
    meta: {},
    names: {},
    pages: [],
    tracks: [{ order: 1, title: '曲目一', lines: ['第一句', '第二句'] }],
    ...overrides,
  };
}

test('META_FIELDS 覆盖全部投稿元数据字段且 key 唯一', () => {
  assert.ok(META_FIELDS.length > 0);
  const keys = META_FIELDS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(META_FIELDS.every((f) => typeof f.key === 'string' && typeof f.label === 'string' && typeof f.list === 'boolean'));
});

test('toEdit 用显式传入的 id 生成器分配 _id，不依赖任何闭包计数器', () => {
  const draft = baseDraft();
  const e1 = toEdit('storage', draft, makeNewId());
  const e2 = toEdit('storage', draft, makeNewId());
  // 两次各自独立传入从 0 开始的生成器，结果应完全一致（纯函数、无隐藏状态）
  assert.deepEqual(
    e1.tracks.map((t) => t._id),
    e2.tracks.map((t) => t._id),
  );
  assert.equal(typeof e1.tracks[0]._id, 'number');
});

test('toEdit 展开 META_FIELDS：list 字段数组转顿号分隔字符串，标量字段透传', () => {
  const draft = baseDraft({ meta: { vocal: ['甲', '乙'], year: '2024' } });
  const e = toEdit('storage', draft, makeNewId());
  assert.equal(e.meta.vocal, '甲、乙');
  assert.equal(e.meta.year, '2024');
  assert.equal(e.meta.lyricist, ''); // 未提供时留空
});

test('toDraft 把顿号/逗号/换行分隔的字符串还原成数组，并裁剪首尾空白', () => {
  const draft = baseDraft({ meta: { vocal: ['甲'] } });
  const e = toEdit('storage', draft, makeNewId());
  e.meta.vocal = ' 甲 、乙,丙\n丁 ';
  const out = toDraft(e);
  assert.deepEqual(out.meta.vocal, ['甲', '乙', '丙', '丁']);
});

test('专辑名称可编辑，但 _storageAlbum（审核存储定位）不受改名影响', () => {
  const draft = baseDraft({ album: '原始投稿名' });
  const e = toEdit('raw-storage-slug', draft, makeNewId());
  assert.equal(e.album, '原始投稿名');
  assert.equal(e._storageAlbum, 'raw-storage-slug');
  e.album = '改名后的专辑';
  const out = toDraft(e);
  assert.equal(out.album, '改名后的专辑');
  assert.equal(e._storageAlbum, 'raw-storage-slug', '改名不影响审核存储定位');
});

test('toDraft 对权威 LRC 轨道原样透传 _orig，只覆盖 order/title/inst/output_name/final_name', () => {
  const orig = {
    order: 1, title: '原曲名', authoritative_lrc: true, lrc: '[00:01.000]一\n', klrc: '', edited: true, aligned: 'x',
  };
  const draft = baseDraft({ tracks: [orig] });
  const e = toEdit('storage', draft, makeNewId());
  const track = e.tracks[0];
  assert.equal(track.authoritativeLrc, true);
  track.title = ' 改名 ';
  track.outputName = '导出名';
  const out = toDraft(e);
  assert.equal(out.tracks[0].title, '改名');
  assert.equal(out.tracks[0].output_name, '导出名');
  assert.equal(out.tracks[0].edited, false, '权威轨保存后不标记为待重对齐');
  assert.equal(out.tracks[0].aligned, 'x', '非覆盖字段原样透传 _orig');
});

test('toDraft：伴奏轨落 final_name，非伴奏轨强制清空 final_name', () => {
  const draft = baseDraft({ tracks: [{ order: 1, title: '曲', inst: true, output_name: '导出名', final_name: '伴奏最终名', lines: ['一'] }] });
  const e = toEdit('storage', draft, makeNewId());
  const track = e.tracks[0];
  track.finalName = '新伴奏名';
  assert.equal(toDraft(e).tracks[0].final_name, '新伴奏名');
  track.inst = false;
  assert.equal(toDraft(e).tracks[0].final_name, '', '非伴奏轨不应落最终文件名');
});

test('cleanAlbumName 仅取路径最后一段（basename），并替换残留的非法文件名字符', () => {
  assert.equal(cleanAlbumName('a/b\\c:d*e?f', '回退名'), 'c_d_e_f');
  assert.equal(cleanAlbumName('  专辑名  ', '回退名'), '专辑名');
});

test('cleanAlbumName 对空值或纯点号名回退到原名', () => {
  assert.equal(cleanAlbumName('', '回退名'), '回退名');
  assert.equal(cleanAlbumName('...', '回退名'), '回退名');
  assert.equal(cleanAlbumName('  ', '回退名'), '回退名');
});

test('selectedVocal/persistVocal 在多声部间读写选中声部', () => {
  const track = {
    _selectedVocal: 1,
    head: ['head'], rows: ['row'], text: 'text', timingLocked: true, _view: 'lrc',
    _vocals: [
      { id: 'main', head: [], rows: [], text: '', timingLocked: false, _view: 'text' },
      { id: 'harmony', head: [], rows: [], text: '', timingLocked: false, _view: 'text' },
    ],
  };
  assert.equal(selectedVocal(track), track._vocals[1]);
  persistVocal(track);
  assert.deepEqual(track._vocals[1].rows, ['row']);
  assert.equal(track._vocals[1].timingLocked, true);
});

test('sanitizeGeneratedTrack 清理已知 STT 水印文本并补齐纯音乐占位行', () => {
  const track = {
    title: '曲名',
    _vocals: [{
      id: 'main', head: [], timingLocked: false,
      rows: [{ text: '', words: [] }],
    }],
  };
  sanitizeGeneratedTrack(track);
  assert.equal(track.rows.length, 1);
  assert.equal(track.rows[0].text, '纯音乐请欣赏', '过滤掉空行后应补入纯音乐占位');
});

test('isDirty：本次改过文本，或此前保存已标记 edited，均判定为脏', () => {
  const cleanTrack = {
    order: 1, title: '曲', inst: false, timingLocked: false, text: '一\n二', rows: [],
    _orig: { order: 1, title: '曲', inst: false, lines: ['一', '二'], edited: false },
  };
  assert.equal(isDirty(cleanTrack), false);

  const editedTrack = { ...cleanTrack, _orig: { ...cleanTrack._orig, edited: true } };
  assert.equal(isDirty(editedTrack), true);

  const changedTrack = { ...cleanTrack, text: '一\n二\n三' };
  assert.equal(isDirty(changedTrack), true);
});

test('documentId 对 origin/ref/storageAlbum/kind/index/view 编码为可比较的唯一字符串', () => {
  const a = { origin: 'workspace', ref: 'r1', storageAlbum: 's1', kind: 'track', index: 1 };
  const b = { ...a, index: 2 };
  assert.notEqual(documentId(a, 'timing'), documentId(b, 'timing'));
  assert.notEqual(documentId(a, 'timing'), documentId(a, 'text:lrc'));
  assert.equal(documentId(a, 'timing'), documentId({ ...a }, 'timing'));
});

test('viewsFor 按资源类型返回对应可切换视图集', () => {
  assert.deepEqual(viewsFor({ kind: 'track' }), ['timing', 'text:lrc', 'text:elrc']);
  assert.deepEqual(viewsFor({ kind: 'album' }), ['meta', 'text:json', 'assets']);
});

test('explorerTree：一份专辑资源同时产出虚拟节点与真实文件节点，曲目下挂 lrc/elrc', () => {
  const draft = baseDraft({
    album: '专辑名',
    tracks: [{ order: 1, title: '曲目一' }, { order: 2, title: '曲目二' }],
  });
  const origin = { origin: 'workspace', ref: 'ref123', storageAlbum: 'storage-slug' };
  const [albumNode] = explorerTree(draft, origin);

  assert.equal(albumNode.type, 'virtual');
  assert.equal(albumNode.view, 'meta');
  assert.equal(albumNode.label, '专辑名');

  const metaJsonNode = albumNode.children.find((c) => c.label === 'meta.json');
  assert.equal(metaJsonNode.type, 'file');
  assert.equal(metaJsonNode.view, 'text:json');

  const assetsNode = albumNode.children.find((c) => c.label === '素材');
  assert.equal(assetsNode.type, 'virtual');
  assert.equal(assetsNode.view, 'assets');

  const trackNode = albumNode.children.find((c) => c.label === '01 曲目一');
  assert.equal(trackNode.type, 'virtual');
  assert.equal(trackNode.view, 'timing');
  assert.equal(trackNode.children.length, 2);
  assert.ok(trackNode.children.some((c) => c.view === 'text:lrc' && c.label.endsWith('.lrc')));
  assert.ok(trackNode.children.some((c) => c.view === 'text:elrc' && c.label.endsWith('.elrc')));

  // 两首曲目、专辑本身共三组资源，节点 id 互不相同
  const allIds = [albumNode.id, ...albumNode.children.flatMap((c) => [c.id, ...(c.children || []).map((g) => g.id)])];
  assert.equal(new Set(allIds).size, allIds.length);
});

test('素材用途按扩展名归类，人工标记的用途不自动判定', () => {
  assert.equal(assetRole('01 曲名.flac'), 'song');
  assert.equal(assetRole('BONUS.MP3'), 'song');
  assert.equal(assetRole('歌词本 01.jpg'), 'photo');
  assert.equal(assetRole('scan.PNG'), 'photo');
  assert.equal(assetRole('歌词.lrc'), 'text');
  assert.equal(assetRole('逐字.elrc'), 'text');
  assert.equal(assetRole('staff.pdf'), 'etc');
  assert.equal(assetRole(''), 'etc');
  assert.equal(assetRole(undefined), 'etc');
});

test('专辑名称字段、素材关联和投稿类型在编辑后完整保存', () => {
  const draft = baseDraft({ names: { zh_name: '中文名', en_name: 'English', prefix: '前缀', suffix: '后缀' }, assets: [{ n: 0, path: 'page.jpg', size: 6, role: 'photo', linkTo: [1, 'SP'] }] });
  const editor = toEdit('storage', draft, makeNewId());
  editor.album = '新目录名';
  editor.names.en_name = 'New name';
  editor.assets[0].linkTo.push(2);
  editor.submissionType = 'single';
  const saved = toDraft(editor);
  assert.deepEqual(saved.names, { zh_name: '中文名', en_name: 'New name', prefix: '前缀', suffix: '后缀' });
  assert.deepEqual(saved.assets[0].linkTo, [1, 'SP', 2]);
  assert.deepEqual(draft.assets[0].linkTo, [1, 'SP']);
  assert.equal(saved.submission_type, 'single');
});

test('曲目序号重排与重复序号不会改变资源定位', () => {
  const draft = baseDraft({ tracks: [{ order: 4, title: '一' }, { order: 4, title: '二' }] });
  const origin = { origin: 'workspace', ref: 'ref', storageAlbum: 'album' };
  const nodes = explorerTree(draft, origin)[0].children.filter(node => node.resource.kind === 'track');
  assert.notEqual(nodes[0].id, nodes[1].id);
  draft.tracks[0].order = 8;
  assert.equal(explorerTree(draft, origin)[0].children[2].id, nodes[0].id);
});

test('ELRC 联动同步 LRC 与所选 INST，保留伴奏文件身份并隔离行对象', () => {
  const nextId = makeNewId();
  const draft = baseDraft({ tracks: [
    { order:1, title:'歌曲', audio:'歌曲.mp3', lrc:'[ti:歌曲]\n[00:01.000]你好\n', klrc:'[ti:歌曲]\n[00:01.000]<00:01.000>你<00:01.400>好\n', timing_locked:true },
    { order:2, title:'歌曲 INST.', inst:true, audio:'歌曲 INST.mp3', _pair_file:'歌曲.mp3', output_name:'伴奏文件', final_name:'最终伴奏', lrc:'[ti:歌曲 INST.]\n[00:01.000]旧词\n', timing_locked:true },
    { order:3, title:'别的歌曲 INST.', inst:true, lrc:'[00:01.000]不修改\n', timing_locked:true },
  ] });
  const editor = toEdit('album', draft, nextId);
  const [source, target] = editor.tracks;
  assert.deepEqual(linkedInstrumentalTracks(editor, source).map(item=>item._id), [target._id]);
  source.rows[0].words[1].time = 1600;
  assert.deepEqual(syncInstrumentalLyrics(editor, source, [target._id], nextId), [target]);
  const saved = toDraft(editor);
  assert.match(saved.tracks[0].klrc, /<00:01.600>好/);
  assert.match(saved.tracks[1].klrc, /<00:01.600>好/);
  assert.match(saved.tracks[1].lrc, /\[00:01.000\]你好/);
  assert.equal(saved.tracks[1].title,'歌曲 INST.');
  assert.equal(saved.tracks[1].output_name,'伴奏文件');
  assert.equal(saved.tracks[1].final_name,'最终伴奏');
  assert.match(saved.tracks[1].lrc,/\[ti:歌曲 INST.\]/);
  assert.match(saved.tracks[2].lrc,/不修改/);
  assert.notEqual(source.rows[0], target.rows[0]);
});
