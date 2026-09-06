import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MonacoLrcEditor from '../../docs/.vuepress/components/MonacoLrcEditor.vue?real';

const api = vi.hoisted(() => ({
  editor: {
    defineTheme: vi.fn((_name, data) => {
      if (!data.colors || typeof data.colors !== 'object') throw new TypeError('Theme colors are required');
    }),
    setTheme: vi.fn(),
    createModel: vi.fn(() => ({ onDidChangeContent() {}, dispose() {}, getValue: () => '' })),
    create: vi.fn(() => ({ layout() {}, dispose() {}, updateOptions() {} })),
  },
  languages: {
    getLanguages: () => [], register() {}, setLanguageConfiguration() {}, setMonarchTokensProvider() {},
  },
}));
vi.mock('monaco-editor', () => api);
vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({ default: class {} }));
vi.mock('monaco-editor/esm/vs/language/json/json.worker?worker', () => ({ default: class {} }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(['light', 'dark'])('源码编辑器在 %s 主题下完成挂载', async theme => {
  const wrapper = mount(MonacoLrcEditor, { props: { theme, modelValue: '[00:01.000]歌词' } });
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(api.editor.create).toHaveBeenCalledOnce();
  expect(api.editor.setTheme).toHaveBeenCalledWith(`lrc-${theme}`);
  wrapper.unmount();
});

it('加载失败时显示重试入口并保留原始错误供诊断', async () => {
  const error = new Error('Editor initialization failed');
  api.editor.create.mockImplementationOnce(() => { throw error; });
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  const wrapper = mount(MonacoLrcEditor);
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain('刷新页面重试');
  expect(logged).toHaveBeenCalledWith('Lyric editor could not load', error);
  wrapper.unmount();
});

it('异步导入完成前卸载不会创建失效编辑器', async () => {
  const wrapper = mount(MonacoLrcEditor);
  wrapper.unmount();
  await flushPromises();
  expect(api.editor.create).not.toHaveBeenCalled();
});
