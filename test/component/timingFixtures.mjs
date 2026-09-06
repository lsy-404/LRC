import { mount } from '@vue/test-utils';
import TrackTimingView from '../../docs/.vuepress/components/TrackTimingView.vue';
import { toEdit } from '../../docs/.vuepress/components/workspaceDocument.js';

export function timingTrack(rows) {
  let id = 0;
  const tag = (ms) => `00:${String(Math.floor(ms / 1000)).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  const draft = { album: '测试', tracks: [{ order: 1, title: '轨道A', lrc: rows.map((row) => `[${tag(row.time)}]${row.words.map((word) => word[1]).join('')}`).join('\n'), klrc: rows.map((row) => `[${tag(row.time)}]${row.words.map(([time, text]) => `<${tag(time)}>${text}`).join('')}`).join('\n'), lines: rows.map((row) => row.words.map((word) => word[1]).join('')) }] };
  return toEdit('测试', draft, () => ++id).tracks[0];
}
export function mountTimingTrack(track) { return mount(TrackTimingView, { attachTo: document.body, props: { track, theme: 'light' } }); }
