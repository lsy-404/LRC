import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import AlbumMetaView from '../../docs/.vuepress/components/AlbumMetaView.vue';
import AlbumAssetsView from '../../docs/.vuepress/components/AlbumAssetsView.vue';
import { toEdit, toDraft } from '../../docs/.vuepress/components/workspaceDocument.js';

describe('专辑视图', () => {
  it('表单编辑进入可保存草稿，中文名和英文名互不覆盖', async () => {
    let id = 0;
    const editor = reactive(toEdit('album', { album: '专辑', meta: {}, names: { zh_name: '中文', en_name: 'English' }, tracks: [], assets: [] }, () => ++id));
    const view = mount(AlbumMetaView, { props: { editor } });
    await view.get('[aria-label="英文名"]').setValue('Updated');
    await view.get('[aria-label="作曲"]').setValue('甲、乙');
    expect(toDraft(editor).names).toMatchObject({ zh_name: '中文', en_name: 'Updated' });
    expect(toDraft(editor).meta.composer).toEqual(['甲', '乙']);
    expect(view.emitted('update')).toHaveLength(2);
    view.unmount();
  });
  it('素材用途、共享曲目关联和移除更新同一份素材列表', async () => {
    const item = { n: 0, path: 'page.jpg', role: 'photo', size: 1024, linkTo: [1] };
    const view = mount(AlbumAssetsView, { props: { assets: [item], tracks: [{ order: 1, title: '一' }, { order: 2, title: '二' }] } });
    await view.get('[aria-label="用途 page.jpg"]').setValue('staff');
    expect(view.emitted('update').at(-1)[0][0].role).toBe('staff');
    await view.findAll('input[type="checkbox"]').at(-1).setValue(true);
    expect(view.emitted('update').at(-1)[0][0].linkTo).toEqual([1, 2]);
    await view.get('[aria-label="移除 page.jpg"]').trigger('click');
    expect(view.emitted('update').at(-1)[0]).toEqual([]);
    view.unmount();
  });
});
