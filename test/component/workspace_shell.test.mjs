import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Workspace from '../../docs/.vuepress/components/Workspace.vue';
import { DIRECT_UPLOAD_LIMIT, MULTIPART_PART_SIZE } from '../../docs/.vuepress/components/uploadTransport.js';

const track = (order, title, text = '你好', extra = {}) => ({ order, title, lrc: `[00:01.000]${text}\n`, klrc: `[00:01.000]<00:01.000>${text[0]}<00:01.300>${text.slice(1)}\n`, lines: [text], timing_locked: true, ...extra });
const draft = (tracks = [track(1, '主歌')], extra = {}) => ({ album: '专辑', meta: { vocal: ['甲', '乙'] }, tracks, assets: [], ...extra });
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const button = (w, text) => w.findAll('button').find(node => node.text() === text);
const wrappers = [];
beforeEach(() => { vi.stubGlobal('confirm', vi.fn(() => true)); });
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
async function setup(data = draft(), overrides = {}) {
  const calls = []; const uploads = []; let server = structuredClone(data);
  vi.stubGlobal('fetch', vi.fn(async (input, init = {}) => {
    const url = new URL(String(input), 'https://test.invalid'); const path = url.pathname;
    const call = { path, url, init, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body }; calls.push(call);
    if (overrides[path]) return overrides[path](call);
    if (path === '/api/workspace/list') return reply({ workspaces: [{ ref: 'session' }] });
    if (path === '/api/workspace/draft') return reply({ ref: 'session', draft: structuredClone(server) });
    if (path === '/api/workspace/catalog') return reply({ albums: [] });
    if (path === '/api/ingest/list') return reply({ pending: [] });
    if (path === '/api/workspace/save') { server = structuredClone(call.body.draft); return reply({ ok: true }); }
    if (path === '/api/workspace/asset' || path === '/api/workspace/extract') return reply({ ok: true });
    throw new Error(`Unexpected request: ${path}`);
  }));
  vi.stubGlobal('XMLHttpRequest', class {
    upload = {}; status = 200; responseText = '{"ok":true}';
    open(method, url) { this.url = url; } setRequestHeader() {} abort() {}
    send(file) { uploads.push({ url: this.url, file }); this.upload.onprogress?.({ lengthComputable: true, loaded: file.size, total: file.size }); queueMicrotask(() => this.onload()); }
  });
  const w = mount(Workspace, { attachTo: document.body, props: { user: { role: 'admin', name: 'Test' } }, slots: { account: '<p>账户内容</p>', users: '<p>用户内容</p>' } }); wrappers.push(w);
  await flushPromises(); if (w.find('.workspace-root > button').exists()) await w.get('.workspace-root > button').trigger('click');
  return { w, calls, uploads };
}
async function openFile(w, name) { const node = w.findAll('.workspace-tree button').find(node => node.text().endsWith(name)); expect(node, `file ${name}`).toBeTruthy(); await node.trigger('click'); await flushPromises(); }
async function view(w, value) { await w.get('select[aria-label="切换编辑视图"]').setValue(value); await flushPromises(); }
function saved(calls) { return calls.filter(call => call.path === '/api/workspace/save').at(-1)?.body.draft; }
async function importFile(w, file) { const input = w.get('.upload-dialog input[type=file]'); Object.defineProperty(input.element, 'files', { configurable: true, value: [file] }); await input.trigger('change'); }

describe('文件工作区真实组件流', () => {
  it('一个Explorer包含草稿与成品区；ELRC/LRC独立标签，renderer切换原位', async () => {
    const { w } = await setup(); expect(w.findAll('.workspace-explorer')).toHaveLength(1); expect(w.text()).toContain('成品修改');
    await openFile(w, '.elrc'); expect(w.get('textarea').element.value).toContain('<00:01.300>');
    const title = w.get('[role=tab]').text(); await view(w, 'timing'); expect(w.get('input.eb-input.lrc').element.value).toBe('你好'); expect(w.get('[role=tab]').text()).toBe(title);
    await openFile(w, '.lrc'); expect(w.findAll('[role=tab]')).toHaveLength(2); expect(w.get('textarea').element.value).not.toContain('<00:');
  });
  it('成品编辑副本留在成品修改分区，文件仍在同一个右侧编辑器打开', async () => {
    const {w}=await setup(draft(),{
      '/api/workspace/catalog':()=>reply({albums:[{slug:'published',name:'已发布专辑'}]}),
      '/api/workspace/open':()=>reply({ref:'copy',draft:draft([track(1,'成品曲')],{album:'已发布专辑',source:{kind:'published',slug:'published'}})}),
    });
    await w.get('.workspace-catalog').trigger('click');await flushPromises();
    const groups=w.findAll('.workspace-group');
    expect(groups[0].text()).not.toContain('已发布专辑');expect(groups[1].text()).toContain('01 成品曲.elrc');
    await openFile(w,'01 成品曲.elrc');expect(w.get('textarea').element.value).toContain('<00:01.300>');
    expect(w.findAll('.workspace-main')).toHaveLength(1);
  });
  it('ELRC缓冲跨刷新、切轨与保存自动联动同行LRC，所有关联标签标脏', async () => {
    vi.useFakeTimers(); const { w, calls } = await setup(draft([track(1, '主歌'), track(2, '次歌', '世界')]));
    await openFile(w, '01 主歌.lrc'); await openFile(w, '01 主歌.elrc');
    await w.get('textarea').setValue('[00:03.000]<00:03.000>改<00:03.400>好\n');
    expect(w.findAll('[aria-label="有未保存修改"]')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(12000); await flushPromises(); expect(w.get('textarea').element.value).toContain('改');
    await openFile(w, '02 次歌.elrc'); expect(w.get('textarea').element.value).toContain('世');
    await openFile(w, '01 主歌.lrc'); expect(w.get('textarea').element.value).toBe('[00:03.000]改好\n');
    await button(w, '保存').trigger('click'); await flushPromises();
    expect(saved(calls).tracks[0].lrc).toContain('[00:03.000]改好'); expect(saved(calls).tracks[0].klrc).toContain('<00:03.400>好'); expect(saved(calls).tracks[1].lrc).toContain('世界'); expect(w.findAll('[aria-label="有未保存修改"]')).toHaveLength(0);
  });
  it('轮询保留已打开的干净编辑器节点、播放状态与联动选项', async () => {
    vi.useFakeTimers();
    const {w}=await setup(draft([track(1,'主歌'),track(2,'主歌 INST','歌词',{inst:true})]));
    await openFile(w,'01 主歌.elrc');
    await w.get('.workspace-sync input').setValue(true);
    const editor=w.get('textarea').element;
    await vi.advanceTimersByTimeAsync(24000);await flushPromises();
    expect(w.get('textarea').element).toBe(editor);
    expect(w.get('.workspace-sync input').element.checked).toBe(true);
  });
  it('真实对象形状的已提交status将稿件设为只读', async () => {
    const {w,calls}=await setup(draft(),{'/api/workspace/draft':()=>reply({ref:'session',draft:draft(),status:{submitted:true,job_started:true,job:'queued'}})});
    await openFile(w,'.elrc');
    expect(w.get('textarea').element.readOnly).toBe(true);
    expect(button(w,'保存').element.disabled).toBe(true);
    expect(calls.some(call=>call.path==='/api/workspace/save')).toBe(false);
  });
  it('生成后的审核稿替代原提交入口，不重复显示两套草稿树', async () => {
    const pending={ref:'session',storage_album:'review',album:'专辑',state:'waiting_review',owner:'editor'};
    const {w}=await setup(draft(),{
      '/api/workspace/draft':()=>reply({ref:'session',draft:draft(),status:{submitted:true,job_started:true,owner:'editor'}}),
      '/api/ingest/list':()=>reply({pending:[pending]}),
      '/api/ingest/state':()=>reply({status:'ready',albums:[{storage_album:'review',draft:draft()}]}),
    });
    expect(w.findAll('.workspace-root')).toHaveLength(0);
    expect(w.findAll('.workspace-pending')).toHaveLength(1);
    await w.get('.workspace-pending > button').trigger('click');await flushPromises();
    expect(w.findAll('.workspace-root')).toHaveLength(1);
    expect(w.findAll('.workspace-pending')).toHaveLength(0);
    expect(w.get('.workspace-root').text()).toContain('@editor');
    await openFile(w,'.elrc');expect(w.get('textarea').element.readOnly).toBe(false);
  });
  it('开启伴奏同步后保存ELRC更新匹配INST并保留文件名与序号；不勾选不修改', async () => {
    const main = track(1, '主歌'); const inst = track(2, '主歌 (INST)', '旧词', { inst: true, output_name: '伴奏输出', final_name: '最终伴奏' });
    const { w, calls } = await setup(draft([main, inst])); await openFile(w, '02 主歌 (INST).lrc'); await openFile(w, '01 主歌.elrc');
    await w.get('textarea').setValue('[00:02.000]<00:02.000>未同步\n'); await button(w, '保存').trigger('click'); await flushPromises(); expect(saved(calls).tracks[1].lrc).toContain('旧词');
    await w.get('.workspace-sync input').setValue(true); await w.get('textarea').setValue('[00:04.000]<00:04.000>同<00:04.500>步\n'); await button(w, '保存').trigger('click'); await flushPromises();
    expect(saved(calls).tracks[1].lrc).toContain('[00:04.000]同步'); expect(saved(calls).tracks[1]).toMatchObject({ order: 2, title: '主歌 (INST)', output_name: '伴奏输出', final_name: '最终伴奏' });
  });
  it('保存失败与非法源码均阻止提取，关闭标签后仍保留未保存状态', async () => {
    const { w, calls } = await setup(draft(), { '/api/workspace/save': () => reply({ error: 'save failed' }, 500) }); await openFile(w, '.elrc');
    await w.get('textarea').setValue('[错误]坏行'); await button(w, '提取生成').trigger('click'); await flushPromises(); expect(calls.some(call => call.path === '/api/workspace/save')).toBe(false);
    expect(w.text()).toContain('行首时间标签格式错误'); await w.get('textarea').setValue('[00:03.000]<00:03.000>修改\n'); await button(w, '提取生成').trigger('click'); await flushPromises(); expect(calls.some(call => call.path === '/api/workspace/extract')).toBe(false);
    await w.get('.workspace-tab-close').trigger('click'); expect(w.text()).toContain('1 个专辑未保存'); window.confirm.mockReturnValue(false); expect(w.vm.canLeave()).toBe(false);
    await openFile(w, '.elrc'); expect(w.get('textarea').element.value).toContain('修改');
  });
  it('JSON数组与元数据表单往返，离开JSON自动应用，账号虚拟文件无空引用', async () => {
    const { w, calls } = await setup(); await openFile(w, 'meta.json'); const source = JSON.parse(w.get('textarea').element.value); source.meta.vocal = ['丙', '丁']; await w.get('textarea').setValue(JSON.stringify(source)); await view(w, 'meta'); expect(w.findAll('input').some(input => input.element.value === '丙、丁')).toBe(true);
    await view(w, 'text:json'); expect(JSON.parse(w.get('textarea').element.value).meta.vocal).toEqual(['丙', '丁']);
    await button(w, '保存').trigger('click'); await flushPromises(); expect(saved(calls).meta.vocal).toEqual(['丙', '丁']);
    w.vm.openVirtualView('account'); await flushPromises(); expect(w.text()).toContain('账户内容'); expect(button(w, '保存').element.disabled).toBe(true);
  });
  it('权威歌词两个源码视图只读且原文随保存保持字节一致', async () => {
    const original = '[00:01.00]权威原文\n'; const { w, calls } = await setup(draft([track(1, '主歌', '原文', { authoritative_lrc: true, lrc: original })]));
    await openFile(w, '.lrc'); expect(w.get('textarea').element.readOnly).toBe(true); expect(w.get('textarea').element.value).toBe(original);
    await openFile(w, '.elrc'); expect(w.get('textarea').element.readOnly).toBe(true); await button(w, '保存').trigger('click'); await flushPromises(); expect(saved(calls).tracks[0].lrc).toBe(original);
  });
  it('上传窗口关闭保留共享队列，注册后保存完整assets且n不覆盖稀疏序号', async () => {
    const { w, calls, uploads } = await setup(draft([], { assets: [{ n: 7, path: 'old.png', role: 'photo', linkTo: ['SP'] }] })); await openFile(w, '素材'); await button(w, '上传素材').trigger('click');
    const file = new File(['image'], 'new.png', { type: 'image/png' }); Object.defineProperty(file, 'webkitRelativePath', { value: 'folder/new.png' }); await importFile(w, file);
    await w.get('[aria-label="关闭上传窗口"]').trigger('click'); expect(w.get('.album-assets').text()).toContain('待保存');
    await button(w, '上传素材 · 1').trigger('click'); expect(w.get('.upload-dialog').text()).toContain('1 个待保存文件');
    await button(w, '上传并保存').trigger('click'); await flushPromises(); expect(uploads[0].url).toContain('n=8'); expect(calls.find(call => call.path === '/api/workspace/asset').body).toMatchObject({ n: 8, path: 'folder/new.png' });
    expect(saved(calls).assets.map(asset => asset.n)).toEqual([7, 8]); expect(w.get('.upload-dialog').text()).toContain('0 个待保存文件');
  });
  it('分片失败后重试复用n和已上传片段，成功注册后才清除队列', async () => {
    let failPart = true; const parts = []; let creates = 0;
    const { w, calls } = await setup(draft(), { '/api/upload/multipart': ({ url }) => { const action = url.searchParams.get('action'); if (action === 'create') { creates++; return reply({ ok: true, uploadId: 'parts' }); } if (action === 'complete') return reply({ ok: true }); const n = Number(url.searchParams.get('partNumber')); parts.push(n); if (n === 2 && failPart) { failPart = false; return reply({ error: 'retry' }, 503); } return reply({ ok: true, partNumber: n, etag: `etag-${n}` }); } });
    await openFile(w, '素材'); await button(w, '上传素材').trigger('click'); const file = new File(['tiny'], 'big.wav'); Object.defineProperty(file, 'size', { value: DIRECT_UPLOAD_LIMIT + 1 }); await importFile(w, file);
    await button(w, '上传并保存').trigger('click'); await flushPromises(); expect(w.get('.upload-dialog').text()).toContain('队列已保留'); expect(calls.some(call => call.path === '/api/workspace/save')).toBe(false);
    await button(w, '上传并保存').trigger('click'); await flushPromises(); expect(creates).toBe(1); expect(parts.filter(n => n === 1)).toHaveLength(1); expect(parts.filter(n => n === 2)).toHaveLength(2); expect(parts.at(-1)).toBe(Math.ceil((DIRECT_UPLOAD_LIMIT + 1) / MULTIPART_PART_SIZE)); expect(saved(calls).assets).toHaveLength(1);
  });
  it('新曲目音频先返回时旧请求无法覆盖且按曲目序号选择素材', async () => {
    let releaseFirst; const requests = []; const { w } = await setup(draft([track(1, '主歌'), track(2, '次歌')], { assets: [{ n: 3, path: 'one.wav', role: 'song', linkTo: [1] }, { n: 9, path: 'two.wav', role: 'song', linkTo: [2] }] }), {
      '/api/workspace/audio': ({ url, init }) => { requests.push({ n: url.searchParams.get('n'), signal: init.signal }); if (requests.length === 1) return new Promise(resolve => { releaseFirst = resolve; }); return new Response('second', { headers: { 'content-type': 'audio/wav' } }); },
    });
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => `blob:size-${blob.size}`); await openFile(w, '01 主歌.lrc'); await view(w, 'timing'); await openFile(w, '02 次歌.lrc'); await view(w, 'timing'); expect(requests.map(item => item.n)).toEqual(['3', '9']); expect(requests[0].signal.aborted).toBe(true);
    releaseFirst(new Response('first-old-long', { headers: { 'content-type': 'audio/wav' } })); await flushPromises(); expect(w.findComponent({ name: 'TrackTimingView' }).props('audioUrl')).toBe('blob:size-6');
  });
  it('初始化401会通知宿主重新认证', async () => {
    const { w } = await setup(draft(), { '/api/workspace/catalog': () => reply({ error: 'expired' }, 401) }); expect(w.emitted('unauthorized')).toHaveLength(1);
  });
  it('审核稿保留存储专辑定位，原音按audio basename读取，封面在保存时写入', async () => {
    const review = draft([track(1, '审核曲', '歌词', { audio: 'source.flac' })], { album: '显示名' });
    const { w, calls } = await setup(draft(), {
      '/api/ingest/list': () => reply({ pending: [{ ref: 'review', storage_album: 'storage', album: '显示名', state: 'editing' }] }),
      '/api/ingest/state': () => reply({ status: 'editing', albums: [{ storage_album: 'storage', draft: review }] }),
      '/api/ingest/audio': () => new Response('audio', { headers: { 'content-type': 'audio/flac' } }),
      '/api/ingest/cover': () => reply({ ok: true }),
      '/api/ingest/save': () => reply({ ok: true }),
    });
    await w.get('.workspace-pending > button').trigger('click'); await flushPromises(); await w.get('[aria-label="专辑名称"]').setValue('改名');
    const input = w.get('.album-meta input[type=file]'); const file = new File(['cover'], 'cover.png', { type: 'image/png' }); Object.defineProperty(input.element, 'files', { value: [file] }); await input.trigger('change'); await button(w, '保存').trigger('click'); await flushPromises();
    const cover = calls.find(call => call.path === '/api/ingest/cover'); expect(cover.url.searchParams.get('album')).toBe('storage'); expect(await cover.init.body.text()).toBe('cover');
    expect(calls.find(call => call.path === '/api/ingest/save').body).toMatchObject({ album: 'storage', draft: { album: '改名', cover_ext: '.png' } });
    await openFile(w, '01 审核曲.lrc'); await view(w, 'timing'); expect(calls.find(call => call.path === '/api/ingest/audio').url.searchParams.get('name')).toBe('source.flac');
  });
  it('处理中与失败审核不能直接打开，失败可重试，已提交草稿只读', async () => {
    const { w, calls } = await setup(draft(), {
      '/api/workspace/draft': () => reply({ ref: 'session', status: 'job_started', draft: draft() }),
      '/api/ingest/list': () => reply({ pending: [{ ref: 'processing', album: '处理中', state: 'processing' }, { ref: 'failed', album: '失败稿', state: 'failed' }] }),
      '/api/ingest/retry': () => reply({ ok: true }),
    });
    expect(w.findAll('.workspace-pending > button').every(node => node.element.disabled)).toBe(true); await button(w, '重试').trigger('click'); await flushPromises(); expect(calls.some(call => call.path === '/api/ingest/retry')).toBe(true);
    await openFile(w, '.elrc'); expect(w.get('textarea').element.readOnly).toBe(true); expect(button(w, '保存').element.disabled).toBe(true);
  });
  it('新增专辑与曲目使用窗口，并在右侧打开文件内容', async () => {
    const { w } = await setup(draft(), {
      '/api/workspace/create': ({ body }) => reply({ ref: 'created', draft: draft([], { album: body.album }) }),
      '/api/workspace/lrc': ({ body }) => reply({ track: track(1, body.title) }),
    });
    await button(w, '新建专辑').trigger('click'); await w.get('[aria-label="名称"]').setValue('新专辑'); await w.get('form').trigger('submit'); await flushPromises(); expect(w.get('[aria-label="专辑名称"]').element.value).toBe('新专辑');
    await w.get('[aria-label="新建曲目 新专辑"]').trigger('click'); await w.get('[aria-label="名称"]').setValue('新曲'); await w.get('form').trigger('submit'); await flushPromises(); expect(w.get('input[placeholder="曲名"]').element.value).toBe('新曲'); expect(w.findAll('.workspace-explorer')).toHaveLength(1);
  });
  it('上传歌词文本可在特殊窗口编辑，共享队列上传编辑后文件原文', async () => {
    const { w, uploads } = await setup(); await openFile(w, '素材'); await button(w, '上传素材').trigger('click'); await importFile(w, new File(['[00:01.000]旧词'], 'lyrics.elrc', { type: 'text/plain' }));
    await w.get('[aria-label="编辑文本 lyrics.elrc"]').trigger('click'); await flushPromises(); await w.get('[aria-label="素材歌词文本编辑器"]').setValue('[00:02.000]<00:02.000>新词'); await button(w, '应用文本修改').trigger('click'); await button(w, '上传并保存').trigger('click'); await flushPromises(); expect(await uploads[0].file.text()).toBe('[00:02.000]<00:02.000>新词');
  });

  it('无待上传文件也先保存再提取，主题传入实际挂载的源码编辑器', async () => {
    const { w, calls } = await setup(); await w.setProps({ theme: 'dark' }); await openFile(w, '.elrc'); expect(w.findComponent({ name: 'MonacoLrcEditor' }).props('theme')).toBe('dark');
    await button(w, '提取生成').trigger('click'); await flushPromises(); const actions = calls.filter(call => ['/api/workspace/save', '/api/workspace/extract'].includes(call.path)).map(call => call.path); expect(actions).toEqual(['/api/workspace/save', '/api/workspace/extract']);
  });

  it('专辑改名保存后轮询保持同一草稿和标签，不重复创建资源', async () => {
    vi.useFakeTimers(); const { w } = await setup(); await openFile(w, 'meta.json'); await view(w, 'meta'); await w.get('[aria-label="专辑名称"]').setValue('改名后'); await button(w, '保存').trigger('click'); await flushPromises(); await vi.advanceTimersByTimeAsync(12000); await flushPromises(); expect(w.findAll('.workspace-root')).toHaveLength(1); expect(w.get('[aria-label="专辑名称"]').element.value).toBe('改名后'); expect(w.findAll('[role=tab]')).toHaveLength(1);
  });

});
