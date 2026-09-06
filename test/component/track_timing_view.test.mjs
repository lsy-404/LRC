import { mount } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';
import TrackTimingView from '../../docs/.vuepress/components/TrackTimingView.vue';
import { toEdit } from '../../docs/.vuepress/components/workspaceDocument.js';

function track() {
  return toEdit('album', { album: 'album', tracks: [{ order: 1, title: '轨道', lrc: '[00:01.000]你好\n', klrc: '[00:01.000]<00:01.000>你<00:01.300>好\n', lines: ['你好'] }] }, (() => { let id = 0; return () => ++id; })()).tracks[0];
}

it('directly mounts the single-track timing editor and emits edits', async () => {
  const wrapper = mount(TrackTimingView, { props: { track: track(), theme: 'light' } });
  expect(wrapper.get('[aria-label="调整 好 的句内偏移"]').text()).toContain('+00:00.300');
  const title = wrapper.get('input[placeholder="曲名"]');
  await title.setValue('新曲名');
  await title.trigger('blur');
  expect(wrapper.emitted('update').at(-1)[0].title).toBe('新曲名');
  wrapper.unmount();
});

it('缺字补标入口能真实渲染并插入标记', async () => {
  const value = track();
  value.rows[0].text = '你好吗';
  value.rows[0].words = [value.rows[0].words[0]];
  const wrapper = mount(TrackTimingView, { props:{track:value} });
  await wrapper.get('[aria-label="为 好 新增时间标记"]').trigger('click');
  expect(value.rows[0].words.map(word=>word.text).join('')).toContain('好');
  wrapper.unmount();
});

it('异步载入音频和切换曲目使用新 props，卸载暂停音频', async () => {
  const pause = vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
  const first=track(); const wrapper=mount(TrackTimingView,{props:{track:first}});
  expect(wrapper.find('audio').exists()).toBe(false);
  await wrapper.setProps({audioUrl:'blob:preview'});
  expect(wrapper.get('audio').attributes('src')).toBe('blob:preview');
  const second=track();second.title='第二轨';
  await wrapper.setProps({track:second,audioUrl:'blob:second'});
  expect(wrapper.get('input[placeholder="曲名"]').element.value).toBe('第二轨');
  await wrapper.get('input[placeholder="曲名"]').setValue('只改第二轨');
  expect(second.title).toBe('只改第二轨');expect(first.title).not.toBe('只改第二轨');
  wrapper.unmount();expect(pause).toHaveBeenCalled();pause.mockRestore();
});

it('只读任务禁用歌词修改与元数据写入，仍允许试听', () => {
  const wrapper=mount(TrackTimingView,{props:{track:track(),readOnly:true}});
  expect(wrapper.get('input[placeholder="曲名"]').attributes('readonly')).toBeDefined();
  expect(wrapper.get('[aria-label="调整 好 的句内偏移"]').element.disabled).toBe(true);
  expect(wrapper.findAll('button').find(button=>button.text()==='播放').element.disabled).toBe(false);
  wrapper.unmount();
});
