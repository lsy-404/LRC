import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import Workbench from '../../docs/.vuepress/components/Workbench.vue';

// 冒烟：确认 happy-dom + @vue/test-utils 环境能挂载真实工作站组件树。
describe('组件挂载环境冒烟', () => {
  it('挂载 Workbench 后渲染未登录账户入口', async () => {
    globalThis.fetch = async (url) => new Response(JSON.stringify(url === '/api/auth/setup' ? { needsBootstrap: false, githubConfigured: false } : { error: 'unauthorized' }), { status: url === '/api/auth/setup' ? 200 : 401 });
    globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    const wrapper = mount(Workbench);
    await flushPromises();
    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    expect(wrapper.find('button').text()).toContain('登录');
    wrapper.unmount();
  });
});
