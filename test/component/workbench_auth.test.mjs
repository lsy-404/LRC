import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import Workbench from '../../docs/.vuepress/components/Workbench.vue';
import AccountSettingsView from '../../docs/.vuepress/components/AccountSettingsView.vue';
import WorkspaceUsersView from '../../docs/.vuepress/components/WorkspaceUsersView.vue';

const admin = { id: 1, name: 'root', display_name: 'Root', role: 'admin', github: null, status: 'active' };
const editor = { id: 2, name: 'ed', display_name: 'Editor', role: 'editor', github: null, status: 'active' };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const Workspace = { name: 'Workspace', template: '<main><slot name="account"/><slot name="users"/></main>', methods: { canLeave: () => true, openVirtualView: () => {} } };
async function mountWorkbench(fetcher) { globalThis.fetch = fetcher; globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }); const wrapper = mount(Workbench, { global: { stubs: { Workspace } } }); await flushPromises(); return wrapper; }

describe('工作站会话界面', () => {
  it('未登录时只显示用户名和密码登录入口', async () => {
    const wrapper = await mountWorkbench((url) => url === '/api/auth/setup' ? response({ needsBootstrap: false, githubConfigured: false }) : response({ error: 'unauthorized' }, 401));
    expect(wrapper.text()).toContain('登录工作站'); expect(wrapper.text()).toContain('凭邀请码开号'); expect(wrapper.find('input[autocomplete="username"]').exists()).toBe(true); expect(wrapper.html()).not.toContain('/api/upload/verify'); wrapper.unmount();
  });
  it('登录成功后挂载工作区，401 返回登录态', async () => {
    let logged = false; const wrapper = await mountWorkbench((url) => { if (url === '/api/auth/setup') return response({ needsBootstrap: false, githubConfigured: true }); if (url === '/api/auth/me') return logged ? response({ user: admin }) : response({ error: 'unauthorized' }, 401); if (url === '/api/auth/login') { logged = true; return response({ user: admin }); } return response({}); });
    await wrapper.find('input[autocomplete="username"]').setValue('root'); await wrapper.find('input[autocomplete="current-password"]').setValue('pass'); await wrapper.find('form').trigger('submit'); await flushPromises(); expect(wrapper.text()).toContain('管理员'); wrapper.vm.endSession(); await wrapper.vm.$nextTick(); expect(wrapper.text()).toContain('登录已失效'); wrapper.unmount();
  });
  it('初始管理员错误会显示服务端错误', async () => {
    const wrapper = await mountWorkbench((url) => url === '/api/auth/setup' ? response({ needsBootstrap: true, githubConfigured: false }) : url === '/api/auth/me' ? response({ error: 'unauthorized' }, 401) : response({ error: '引导口令错误' }, 401));
    expect(wrapper.text()).toContain('设置首个管理员'); await wrapper.find('form').trigger('submit'); await flushPromises(); expect(wrapper.text()).toContain('引导口令错误'); wrapper.unmount();
  });
  it('编辑者没有用户管理入口', async () => {
    const wrapper = await mountWorkbench((url) => url === '/api/auth/setup' ? response({ needsBootstrap: false, githubConfigured: false }) : response({ user: editor }));
    expect(wrapper.text()).not.toContain('用户管理'); wrapper.unmount();
  });
  it('退出请求失败时保留登录界面并显示可重试错误', async () => {
    const wrapper=await mountWorkbench((url)=>url==='/api/auth/setup'?response({needsBootstrap:false,githubConfigured:false}):url==='/api/auth/logout'?response({error:'退出服务暂不可用'},503):response({user:admin}));
    await wrapper.findAll('button').find(button=>button.text()==='退出').trigger('click');await flushPromises();
    expect(wrapper.text()).toContain('退出服务暂不可用');expect(wrapper.text()).toContain('管理员');expect(wrapper.text()).not.toContain('登录工作站');wrapper.unmount();
  });
  it('管理员首次创建后退出返回普通登录而非重复初始化', async () => {
    const wrapper=await mountWorkbench((url)=>url==='/api/auth/setup'?response({needsBootstrap:true,githubConfigured:false}):url==='/api/auth/me'?response({error:'unauthorized'},401):url==='/api/auth/bootstrap'?response({user:admin}):response({ok:true}));
    await wrapper.find('input[autocomplete="username"]').setValue('root');
    await wrapper.find('form').trigger('submit');await flushPromises();
    await wrapper.findAll('button').find(button=>button.text()==='退出').trigger('click');await flushPromises();
    expect(wrapper.text()).toContain('登录工作站');expect(wrapper.text()).not.toContain('设置首个管理员');wrapper.unmount();
  });
});

describe('账户与用户管理交互', () => {
  it('账户更新、密码更新与 OAuth 配置状态可见', async () => {
    const adapter = { updateMe: vi.fn().mockResolvedValue({ user: { ...editor, display_name: 'New' } }), unlinkGithub: vi.fn() };
    const wrapper = mount(AccountSettingsView, { props: { user: editor, githubConfigured: false, adapter } }); expect(wrapper.text()).toContain('尚未配置 GitHub OAuth'); expect(wrapper.findAll('button').find((b) => b.text() === '绑定 GitHub').attributes('disabled')).toBeDefined(); await wrapper.find('input[autocomplete="name"]').setValue('New'); await wrapper.find('form').trigger('submit'); await flushPromises(); expect(adapter.updateMe).toHaveBeenCalledWith({ display_name: 'New' }); wrapper.unmount();
  });
  it('管理员可创建、显示和吊销邀请码，并区分占用中断', async () => {
    const adapter = { users: vi.fn().mockResolvedValue({ users: [admin] }), invites: vi.fn().mockResolvedValue({ invites: [{ code_hash: 'a', role: 'editor', used_by: null, expires_at: 0 }, { code_hash: 'b', role: 'editor', used_by: 0, expires_at: 0 }] }), createInvite: vi.fn().mockResolvedValue({ code: 'new-code' }), revokeInvite: vi.fn().mockResolvedValue({ ok: true }), updateUser: vi.fn() };
    const wrapper = mount(WorkspaceUsersView, { props: { adapter } }); await flushPromises(); expect(wrapper.text()).toContain('未使用'); expect(wrapper.text()).toContain('占用中断'); await wrapper.find('.invite-create button').trigger('click'); await flushPromises(); expect(wrapper.text()).toContain('new-code'); await wrapper.findAll('button').find((button) => button.text() === '吊销').trigger('click'); expect(adapter.revokeInvite).toHaveBeenCalledWith('a'); wrapper.unmount();
  });
});
