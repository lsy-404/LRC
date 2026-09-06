<template>
  <section class="album-assets" aria-label="专辑素材" @dragover.prevent="dragOver = !readOnly && !uploading" @dragleave.self="dragOver = false" @drop.prevent="dropFiles">
    <div class="asset-import" :class="{ over: dragOver }">
      <p>拖入原曲、歌词或内页，在这里整理文件用途与曲目关联。</p>
      <div class="asset-actions"><button type="button" :disabled="locked" @click="filesInput.click()">添加文件</button><button type="button" :disabled="locked" @click="folderInput.click()">添加文件夹</button><button type="button" :disabled="locked" @click="cameraInput.click()">拍照</button></div>
      <input ref="filesInput" hidden type="file" multiple @change="pickFiles">
      <input ref="folderInput" hidden type="file" multiple webkitdirectory @change="pickFiles">
      <input ref="cameraInput" hidden type="file" accept="image/png,image/jpeg,image/webp" capture="environment" @change="pickFiles">
    </div>
    <p v-if="progress" role="status">{{ progress }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="!entries.length" class="asset-empty">尚未导入素材</p>
    <ul v-else class="asset-list">
      <li v-for="entry in entries" :key="entry.key" class="asset-item">
        <div class="asset-row">
          <span class="asset-icon" aria-hidden="true">{{ imageFile(entry.item) ? '▧' : entry.item.role === 'song' ? '♫' : '≡' }}</span>
          <label class="asset-path"><span class="sr-only">文件名</span><input :value="pathOf(entry.item)" :aria-label="`文件名 ${pathOf(entry.item)}`" :disabled="locked" @change="rename(entry, $event.target.value)"></label>
          <label><span class="sr-only">用途</span><select :value="entry.item.role" :aria-label="`用途 ${pathOf(entry.item)}`" :disabled="locked" @change="change(entry, { role: $event.target.value })"><option v-for="role in roles" :key="role.value" :value="role.value">{{ role.label }}</option></select></label>
          <span class="asset-size">{{ formatSize(entry.item.size ?? entry.item.raw?.size) }}</span>
          <span class="asset-status">{{ entry.pending ? '待保存' : '已上传' }}</span>
          <button v-if="imageFile(entry.item)" type="button" :disabled="locked || imageBusy || (!entry.pending && !loadAsset)" :aria-label="`编辑图片 ${pathOf(entry.item)}`" @click="editImage(entry)">旋转 / 马赛克</button>
          <button type="button" :disabled="locked" :aria-label="`移除 ${pathOf(entry.item)}`" @click="remove(entry)">移除</button>
        </div>
        <fieldset v-if="['photo', 'staff', 'cover', 'text'].includes(entry.item.role)" :disabled="locked" class="asset-links">
          <legend>关联</legend>
          <label><input type="checkbox" :checked="(entry.item.linkTo || []).includes('SP')" @change="link(entry, 'SP', $event.target.checked)">专辑内页 / 整专信息</label>
          <label v-for="track in linkTargets" :key="track.order"><input type="checkbox" :checked="(entry.item.linkTo || []).includes(track.order)" @change="link(entry, track.order, $event.target.checked)">{{ String(track.order).padStart(2, '0') }} {{ track.title }}</label>
          <span v-if="(entry.item.linkTo || []).filter(value => value !== 'SP').length > 1" class="shared">共享素材</span>
        </fieldset>
      </li>
    </ul>
    <ImageEditDialog v-if="imageEdit" :file="imageEdit.file" :theme="theme" @close="imageEdit = null" @save="applyImage" />
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';
import ImageEditDialog from './ImageEditDialog.vue';
const props = defineProps({ assets: { type: Array, default: () => [] }, pendingFiles: { type: Array, default: () => [] }, tracks: { type: Array, default: () => [] }, uploading: Boolean, progress: String, readOnly: Boolean, theme: String, loadAsset: Function });
const emit = defineEmits(['import', 'update', 'update-pending', 'replace']);
const filesInput=ref(null);const folderInput=ref(null);const cameraInput=ref(null);const dragOver=ref(false);const imageBusy=ref(false);const imageEdit=ref(null);const error=ref('');
const locked=computed(()=>props.readOnly||props.uploading);
const roles=[{value:'song',label:'原曲'},{value:'photo',label:'歌词本图片'},{value:'text',label:'歌词文本'},{value:'staff',label:'制作信息'},{value:'cover',label:'封面'},{value:'etc',label:'其他'}];
const entries=computed(()=>[...props.assets.map(item=>({item,key:`saved-${item.n}`,pending:false})),...props.pendingFiles.map(item=>({item,key:`pending-${item.id}`,pending:true}))]);
const linkTargets=computed(()=>props.tracks.length?props.tracks:entries.value.filter(entry=>entry.item.role==='song').map((entry,index)=>({order:index+1,title:pathOf(entry.item)})));
const pathOf=item=>item.path||item.name||item.raw?.name||'';
const imageFile=item=>/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(pathOf(item));
const formatSize=value=>{const size=Number(value)||0;return size>=1024*1024?`${(size/1024/1024).toFixed(1)} MB`:`${Math.ceil(size/1024)} KB`;};
function change(entry, patch) { if(locked.value)return; const list=entry.pending?props.pendingFiles:props.assets; emit(entry.pending?'update-pending':'update',list.map(item=>item===entry.item?{...item,...patch}:item)); }
function rename(entry,value) { error.value=''; const name=value.trim().replaceAll('\\','/'); if(!name||name.startsWith('/')||name.split('/').some(part=>!part||part==='.'||part==='..')||/[\u0000-\u001f\u007f]/.test(name)){error.value='文件名必须是专辑内有效的相对路径';return;}if(entries.value.some(other=>other.key!==entry.key&&pathOf(other.item).toLowerCase()===name.toLowerCase())){error.value='已有同名素材';return;} change(entry,entry.pending?{name,path:name}:{path:name}); }
function link(entry,target,checked) { const values=new Set(entry.item.linkTo||[]);checked?values.add(target):values.delete(target);change(entry,{linkTo:[...values]}); }
function remove(entry) { if(locked.value)return;emit(entry.pending?'update-pending':'update',(entry.pending?props.pendingFiles:props.assets).filter(item=>item!==entry.item)); }
function pickFiles(event) { const files=[...(event.target.files||[])];event.target.value='';if(files.length&&!locked.value)emit('import',files); }
async function dropFiles(event) {
  dragOver.value=false;if(locked.value)return;error.value='';
  try {
    const nodes=[...(event.dataTransfer.items||[])].map(item=>item.webkitGetAsEntry?.()).filter(Boolean);const picked=[];
    async function walk(node,prefix='') { if(node.isFile){const file=await new Promise((resolve,reject)=>node.file(resolve,reject));Object.defineProperty(file,'webkitRelativePath',{value:prefix+file.name,configurable:true});picked.push(file);}else if(node.isDirectory){const reader=node.createReader();for(;;){const batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!batch.length)break;for(const child of batch)await walk(child,prefix+node.name+'/');}} }
    if(nodes.length){for(const node of nodes)await walk(node);}else picked.push(...event.dataTransfer.files);
    if(picked.length)emit('import',picked);
  } catch(e){error.value=`读取文件夹失败：${e.message}`;}
}
async function editImage(entry) { imageBusy.value=true;error.value='';try{const file=entry.item.raw||await props.loadAsset(entry.item);if(!file)throw new Error('图片不可用');imageEdit.value={entry,file};}catch(e){error.value=e.message;}finally{imageBusy.value=false;} }
function applyImage(file) { const {entry}=imageEdit.value;const name=pathOf(entry.item).replace(/[^/]+$/,file.name);if(entry.pending)change(entry,{raw:file,name,path:name,size:file.size});else emit('replace',{asset:entry.item,file,path:name});imageEdit.value=null; }
</script>

<style scoped>
.album-assets { padding:1rem; }
.asset-import { padding:1rem; border:1px dashed var(--border-color,#d0d7de); border-radius:6px; margin-bottom:1rem; }.asset-import.over { border-color:var(--theme-color,#3a7afe); background:#3a7afe12; }.asset-import p { margin:0 0 .7rem;font-size:.85rem; }
.asset-actions,.asset-row { display:flex; gap:.55rem; align-items:center; flex-wrap:wrap; }
button,input,select { font:inherit; color:inherit; border:1px solid var(--border-color,#d0d7de); border-radius:4px; background:var(--bg-color,#fff); padding:.4rem .5rem; min-width:0; }button { cursor:pointer;font-size:.8rem; }button:disabled { opacity:.5;cursor:default; }
.asset-list { padding:0;margin:0;list-style:none; }.asset-item { border-bottom:1px solid var(--border-color,#d0d7de); padding:.8rem 0; font-size:.82rem; }.asset-path { flex:1;min-width:160px; }.asset-path input { width:100%;box-sizing:border-box; }.asset-icon { font-size:1.25rem;opacity:.65; }
.asset-size,.asset-status,.asset-empty { opacity:.65; }.asset-links { display:flex;gap:.6rem;flex-wrap:wrap;border:0;padding:.5rem 0 0 1.8rem;min-width:0; }.asset-links legend { float:left;margin-right:.65rem;padding-top:.6rem;opacity:.6; }.asset-links label { display:flex;align-items:center;gap:.2rem; }.asset-links input { accent-color:var(--theme-color,#3a7afe); }.shared { color:var(--theme-color,#3a7afe); }.sr-only { position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%); }[role='alert'] { color:#d73a49; }
</style>
