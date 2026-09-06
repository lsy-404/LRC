<template>
  <nav ref="tabs" class="workspace-tabs" role="tablist" aria-label="打开的文档" @wheel.prevent="scrollTabs">
    <div v-for="document in documents" :key="document.id" class="workspace-tab" :class="{ active: document.id === activeId }">
      <button type="button" role="tab" :aria-selected="document.id === activeId" :tabindex="document.id === activeId ? 0 : -1" @click="$emit('activate', document.id)" @keydown.right.prevent="move(document.id, 1)" @keydown.left.prevent="move(document.id, -1)"><span class="workspace-tab-title">{{ document.title }}</span><span v-if="document.dirty" class="workspace-tab-dirty" aria-label="有未保存修改">●</span></button>
      <button class="workspace-tab-close" type="button" :aria-label="`关闭 ${document.title}`" @click="$emit('close', document.id)">×</button>
    </div>
  </nav>
</template>
<script setup>
import { nextTick, ref, watch } from 'vue';
const props = defineProps({ documents: { type: Array, default: () => [] }, activeId: String });
const emit = defineEmits(['activate', 'close']); const tabs = ref(null);
function scrollTabs(event) { tabs.value.scrollLeft += event.deltaY || event.deltaX; }
function move(id, amount) { const index = props.documents.findIndex(item => item.id === id); const target = props.documents[(index + amount + props.documents.length) % props.documents.length]; if (target) { emit('activate', target.id); nextTick(() => tabs.value.querySelector('[aria-selected="true"]')?.focus()); } }
watch(() => props.activeId, async () => { await nextTick(); tabs.value?.querySelector('.active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); });
</script>
