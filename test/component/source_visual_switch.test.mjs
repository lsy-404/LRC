import { afterEach, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import TrackTextView from '../../docs/.vuepress/components/TrackTextView.vue';
import { toEdit, toDraft } from '../../docs/.vuepress/components/workspaceDocument.js';
import { undoLyricHistory } from '../../docs/.vuepress/components/lyricHistory.js';
const setup = () => { let id = 0; const editor = reactive(toEdit('album', { tracks: [{ order: 1, title: 'Song', lrc: '[00:01.000]你好\n', klrc: '[00:01.000]<00:01.000>你<00:01.300>好\n', timing_locked: true }] }, () => ++id)); return { editor, track: editor.tracks[0] }; };
afterEach(() => { vi.unstubAllGlobals(); });
it('源码应用保留行及字词标识、声部和历史，生成同行LRC', async () => {
  const { editor, track } = setup(); const ids = [track.rows[0]._id, ...track.rows[0].words.map(word => word._id)]; const w = mount(TrackTextView, { props: { track, format: 'elrc' } });
  await w.get('textarea').setValue('[00:03.000]<00:03.000>改<00:03.300>词\n'); expect(w.emitted('buffer')).toHaveLength(1); await w.get('button').trigger('click');
  expect([track.rows[0]._id, ...track.rows[0].words.map(word => word._id)]).toEqual(ids); expect(track._vocals[0].rows).toBe(track.rows); expect(toDraft(editor).tracks[0].lrc).toContain('改词');
  expect(undoLyricHistory(track._history, track)).toBe(true); await w.vm.$nextTick(); expect(w.get('textarea').element.value).toContain('你'); w.unmount();
});
it('非法ELRC仍保留buffer但不进入行模型，替换track展示新文件', async () => {
  const { track } = setup(); const w = mount(TrackTextView, { props: { track, format: 'elrc' } }); await w.get('textarea').setValue('[00:01.000]<错误>词'); await w.get('button').trigger('click'); expect(w.text()).toContain('逐字时间标签格式错误'); expect(track.rows[0].text).toBe('你好');
  const next = setup().track; next._id = 'second'; next.rows[0].text = '第二'; next.rows[0].words = [{ _id: 'word', time: 1000, text: '第二' }]; await w.setProps({ track: next }); expect(w.get('textarea').element.value).toContain('第二'); expect(track._sourceBuffers.elrc.text).toContain('<错误>'); w.unmount();
});
it('LRC丢逐字精度提示取消后仍保留buffer', async () => {
  vi.stubGlobal('confirm', vi.fn(() => false)); const { track } = setup(); const w = mount(TrackTextView, { props: { track } }); await w.get('textarea').setValue('[00:03.000]修改'); await w.get('button').trigger('click'); expect(track.rows[0].text).toBe('你好'); expect(w.get('textarea').element.value).toContain('修改'); expect(w.text()).toContain('未应用'); w.unmount();
});

it('去掉时间标签后保存清除旧时间流并保留新纯文本', async () => {
  const { editor, track } = setup(); const w = mount(TrackTextView, { props: { track, format: 'elrc' } }); await w.get('textarea').setValue('新的歌词\n第二句'); await w.get('button').trigger('click'); const saved = toDraft(editor).tracks[0]; expect(saved.lrc).toBe(''); expect(saved.klrc).toBe(''); expect(saved.timing_locked).toBe(false); expect(saved.lines).toEqual(['新的歌词', '第二句']); w.unmount();
});
