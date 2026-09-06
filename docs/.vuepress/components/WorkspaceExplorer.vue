<template>
  <aside class="workspace-explorer" aria-label="工作区文件资源管理器" :inert="busy || undefined">
    <div class="workspace-explorer-head"><strong>资源管理器</strong><button type="button" aria-label="刷新工作区" @click="$emit('refresh')">↻</button></div>
    <section class="workspace-group"><div class="workspace-group-head"><button type="button" :aria-expanded="draftOpen" @click="draftOpen = !draftOpen"><span>{{ draftOpen ? '⌄' : '›' }}</span> 草稿</button><button type="button" aria-label="新建专辑" title="新建专辑" @click="$emit('create-album')">＋</button></div>
      <template v-if="draftOpen"><p v-if="!drafts.length && !pending.length" class="workspace-tree-empty">暂无草稿</p>
        <div v-for="entry in drafts" :key="entry.key" class="workspace-album"><div class="workspace-root"><button type="button" :aria-expanded="expanded.includes(entry.key)" @click="$emit('toggle', entry.key)"><span>{{ expanded.includes(entry.key) ? '⌄' : '›' }}</span><span class="workspace-tree-label">{{ entry.label }}<small v-if="entry.owner" class="workspace-owner">@{{ entry.owner }}</small><small v-if="entry.readOnly" class="workspace-owner">{{ entry.message || stateLabel(entry) }}</small></span><span v-if="entry.dirty" aria-label="专辑未保存">●</span></button><button v-if="entry.state === 'failed'" type="button" @click="$emit('retry', entry)">重试</button><button v-if="entry.origin === 'workspace' && !entry.readOnly" type="button" :aria-label="`新建曲目 ${entry.label}`" title="新建曲目" @click="$emit('create-track', entry.key)">＋</button><button type="button" :aria-label="`丢弃草稿 ${entry.label}`" title="丢弃草稿" @click="$emit('discard-draft', entry.key)">×</button></div>
          <div v-if="expanded.includes(entry.key)" class="workspace-tree"><WorkspaceNode v-for="node in entry.nodes[0]?.children" :key="node.id" :node="node" :selected-id="selectedId" @open="$emit('open', $event, entry.key)" /></div>
        </div>
        <article v-for="item in pending" :key="item.ref + item.storage_album" class="workspace-pending"><button type="button" :disabled="processing(item) || failed(item)" @click="$emit('open-pending', item)"><strong>{{ item.album }}</strong><small>{{ item.message || stateLabel(item) }}</small></button><span><button v-if="failed(item)" type="button" @click="$emit('retry', item)">重试</button><button type="button" @click="$emit('discard', item)">丢弃</button></span></article>
      </template>
    </section>
    <section class="workspace-group">
      <div class="workspace-group-head"><button type="button" :aria-expanded="catalogOpen" @click="catalogOpen = !catalogOpen"><span>{{ catalogOpen ? '⌄' : '›' }}</span> 成品修改</button></div>
      <template v-if="catalogOpen">
        <div v-for="item in catalog" :key="item.slug" class="workspace-album">
          <template v-if="item.workspace">
            <div class="workspace-root"><button type="button" :aria-expanded="expanded.includes(item.workspace.key)" @click="$emit('toggle', item.workspace.key)"><span>{{ expanded.includes(item.workspace.key) ? '⌄' : '›' }}</span><span class="workspace-tree-label">{{ item.workspace.label }}</span><span v-if="item.workspace.dirty" aria-label="专辑未保存">●</span></button><button type="button" :aria-label="`新建曲目 ${item.workspace.label}`" @click="$emit('create-track', item.workspace.key)">＋</button></div>
            <div v-if="expanded.includes(item.workspace.key)" class="workspace-tree"><WorkspaceNode v-for="node in item.workspace.nodes[0]?.children" :key="node.id" :node="node" :selected-id="selectedId" @open="$emit('open', $event, item.workspace.key)" /></div>
          </template>
          <button v-else class="workspace-catalog" type="button" @click="$emit('open-catalog', item)"><span>◇</span>{{ item.name || item.folder || item.slug }}</button>
        </div>
        <p v-if="!catalog.length" class="workspace-tree-empty">暂无成品</p>
      </template>
    </section>
  </aside>
</template>
<script setup>
import { defineComponent, h, ref } from 'vue';
const WorkspaceNode = defineComponent({
  name: 'WorkspaceNode', props: { node: Object, selectedId: String }, emits: ['open'],
  setup(props, { emit }) {
    const open = ref(true);
    return () => h('div', { class: 'workspace-node' }, [
      h('button', { type: 'button', class: { selected: props.node.id === props.selectedId }, 'aria-expanded': props.node.children?.length ? open.value : undefined, onClick: () => { if (props.node.children?.length) open.value = !open.value; else emit('open', props.node); } }, [h('span', { 'aria-hidden': 'true' }, props.node.children?.length ? (open.value ? '⌄' : '›') : props.node.view === 'text:json' ? '{}' : props.node.view === 'assets' ? '▧' : '≡'), h('span', { class: 'workspace-tree-label' }, props.node.label)]),
      props.node.children?.length && open.value ? h('div', { class: 'workspace-children' }, props.node.children.map(child => h(WorkspaceNode, { key: child.id, node: child, selectedId: props.selectedId, onOpen: node => emit('open', node) }))) : null,
    ]);
  },
});
defineProps({ drafts: { type: Array, default: () => [] }, pending: { type: Array, default: () => [] }, catalog: { type: Array, default: () => [] }, expanded: { type: Array, default: () => [] }, selectedId: String, busy: Boolean });
defineEmits(['refresh', 'create-album', 'create-track', 'toggle', 'open', 'open-pending', 'retry', 'discard', 'discard-draft', 'open-catalog']);
const draftOpen = ref(true); const catalogOpen = ref(true);
const failed = item => item?.state === 'failed' || item?.status === 'failed'; const processing = item => ['queued', 'dispatching', 'running', 'processing', 'submitted', 'job_started'].includes(item?.state) || item?.status === 'processing'; const stateLabel = item => failed(item) ? '处理失败' : processing(item) ? '处理中' : item?.state === 'done' ? '已完成' : '待审核';
</script>
