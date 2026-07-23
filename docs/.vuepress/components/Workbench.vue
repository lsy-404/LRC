<template>
  <div class="wb">
    <div class="wb-tabs" role="tablist">
      <button :class="{ on: tab === 'upload' }" role="tab" @click="tab = 'upload'">上传</button>
      <button :class="{ on: tab === 'edit' }" role="tab" @click="tab = 'edit'">修改</button>
    </div>
    <!-- v-show 保留各面板状态：切 tab 不丢上传进度 / 编辑内容 -->
    <UploadBox v-show="tab === 'upload'" />
    <EditBox v-show="tab === 'edit'" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import UploadBox from './UploadBox.vue';
import EditBox from './EditBox.vue';

const tab = ref('upload');
</script>

<style scoped>
.wb-tabs {
  display: flex;
  gap: .5rem;
  margin: 1rem 0 .5rem;
  border-bottom: 1px solid var(--border-color, #ddd);
}
.wb-tabs button {
  padding: .5rem 1.2rem;
  border: none;
  background: transparent;
  color: inherit;
  font-size: .95rem;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  opacity: .55;
  transition: opacity .2s, border-color .2s;
}
.wb-tabs button.on {
  opacity: 1;
  border-bottom-color: var(--theme-color, #3a7afe);
  font-weight: 600;
}
</style>
