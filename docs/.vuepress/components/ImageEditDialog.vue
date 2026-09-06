<template>
  <Teleport to="body">
    <div class="image-overlay" @keydown.esc.stop="emit('close')" @click.self="emit('close')">
      <section ref="dialog" class="image-dialog" :data-theme="theme" role="dialog" aria-modal="true" aria-label="图片编辑" tabindex="-1" @keydown.tab="trapFocus">
        <header><strong>{{ file.name }}</strong><button type="button" aria-label="关闭图片编辑" @click="emit('close')">×</button></header>
        <p>旋转图片，或在需要隐藏的内容上拖动涂抹马赛克。</p>
        <div class="canvas-wrap"><canvas ref="canvas" @pointerdown="startStroke" @pointermove="moveStroke" @pointerup="endStroke" @pointercancel="endStroke" /></div>
        <div class="controls">
          <button type="button" :disabled="!ready || busy" @click="rotate(-1)">左转</button><button type="button" :disabled="!ready || busy" @click="rotate(1)">右转</button>
          <label>笔刷 <input v-model.number="brush" type="range" min="12" max="160" step="4"></label>
          <label>颗粒 <input v-model.number="block" type="range" min="4" max="28" step="2"></label>
        </div>
        <footer><button type="button" :disabled="!history.length || busy" @click="undo">撤销</button><button type="button" :disabled="!ready || busy" @click="reset">重置</button><span /><button type="button" @click="emit('close')">取消</button><button type="button" :disabled="!ready || busy" @click="save">{{ busy ? '正在处理…' : '应用修改' }}</button></footer>
        <p v-if="error" role="alert">{{ error }}</p>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';
const props = defineProps({ file: { type: Object, required: true }, theme: { type: String, default: 'light' } });
const emit = defineEmits(['close', 'save']);
const canvas = ref(null); const dialog = ref(null); const brush = ref(48); const block = ref(12); const history = ref([]); const ready = ref(false); const busy = ref(false); const error = ref('');
let original; let drawing = false; let alive = true; let originalUrl = ''; let previousFocus;
function snapshot() { const c = canvas.value; history.value.push({ width:c.width, height:c.height, pixels:c.getContext('2d').getImageData(0,0,c.width,c.height) }); if (history.value.length > 10) history.value.shift(); }
function point(event) { const c = canvas.value; const r = c.getBoundingClientRect(); return { x:(event.clientX-r.left)*c.width/r.width, y:(event.clientY-r.top)*c.height/r.height }; }
function paint(event) {
  const c=canvas.value; const ctx=c.getContext('2d'); const {x,y}=point(event); const scale=c.width/c.getBoundingClientRect().width; const radius=brush.value*scale/2; const step=Math.max(2,Math.round(block.value*scale));
  for (let py=Math.max(0,Math.floor((y-radius)/step)*step);py<Math.min(c.height,y+radius);py+=step) for(let px=Math.max(0,Math.floor((x-radius)/step)*step);px<Math.min(c.width,x+radius);px+=step) {
    const rgba=ctx.getImageData(Math.min(c.width-1,px+Math.floor(step/2)),Math.min(c.height-1,py+Math.floor(step/2)),1,1).data;
    ctx.fillStyle=`rgba(${rgba[0]},${rgba[1]},${rgba[2]},${rgba[3]/255})`;ctx.fillRect(px,py,step,step);
  }
}
function startStroke(event) { if(!ready.value || busy.value || event.button!==0)return; snapshot(); drawing=true; canvas.value.setPointerCapture?.(event.pointerId);paint(event); }
function moveStroke(event) { if(drawing)paint(event); }
function endStroke(event) { drawing=false; if(canvas.value.hasPointerCapture?.(event.pointerId))canvas.value.releasePointerCapture(event.pointerId); }
function undo() { const old=history.value.pop(); if(!old)return; const c=canvas.value;c.width=old.width;c.height=old.height;c.getContext('2d').putImageData(old.pixels,0,0); }
function reset() { if(!original)return; snapshot(); const c=canvas.value;c.width=original.naturalWidth;c.height=original.naturalHeight;c.getContext('2d').drawImage(original,0,0); }
function rotate(direction) { snapshot(); const c=canvas.value;const copy=document.createElement('canvas');copy.width=c.width;copy.height=c.height;copy.getContext('2d').drawImage(c,0,0);c.width=copy.height;c.height=copy.width;const ctx=c.getContext('2d');ctx.translate(c.width/2,c.height/2);ctx.rotate(direction*Math.PI/2);ctx.drawImage(copy,-copy.width/2,-copy.height/2);ctx.setTransform(1,0,0,1,0,0); }
function trapFocus(event) { const nodes=[...dialog.value.querySelectorAll('button:not(:disabled),input:not(:disabled)')]; if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.value)){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();} }
async function save() { busy.value=true; error.value=''; try { const type=/\.png$/i.test(props.file.name)?'image/png':'image/jpeg';const blob=await new Promise(resolve=>canvas.value.toBlob(resolve,type,.92));if(!blob)throw new Error('图片编码失败');const name=props.file.name.replace(/\.[^.]+$/,type==='image/png'?'.png':'.jpg');emit('save',new File([blob],name,{type})); } catch(e){error.value=e.message;}finally{busy.value=false;} }
onMounted(()=>{ previousFocus=document.activeElement;dialog.value.focus();originalUrl=URL.createObjectURL(props.file);const img=new Image();img.onload=()=>{if(!alive)return;original=img;const c=canvas.value;c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);ready.value=true;};img.onerror=()=>{if(alive)error.value='无法读取这张图片';};img.src=originalUrl; });
onBeforeUnmount(()=>{alive=false;drawing=false;if(originalUrl)URL.revokeObjectURL(originalUrl);previousFocus?.focus?.();});
</script>

<style scoped>
.image-overlay { position:fixed; inset:0; z-index:1300; background:#000b; display:grid; place-items:center; padding:1rem; }
.image-dialog[data-theme='dark'] { --bg-color:#111113; --text-color:#e4e4e7; --border-color:#ffffff33; color-scheme:dark; }
.image-dialog { width:min(850px,100%); max-height:94vh; overflow:auto; background:var(--bg-color,#fff); color:var(--text-color,#24292f); border-radius:8px; padding:1rem; box-sizing:border-box; }
header,footer,.controls { display:flex; align-items:center; gap:.65rem; flex-wrap:wrap; } header strong,footer span { flex:1; } p { font-size:.85rem; }
button { background:transparent; color:inherit; border:1px solid var(--border-color,#d0d7de); border-radius:4px; padding:.4rem .7rem; cursor:pointer; } button:disabled { opacity:.5; }
.canvas-wrap { display:grid; place-items:center; background:#181818; overflow:hidden; } canvas { display:block; max-width:100%; max-height:60vh; touch-action:none; cursor:crosshair; }
.controls { margin:1rem 0; font-size:.8rem; } .controls label { display:flex; align-items:center; gap:.3rem; } .controls input { width:100px; } [role='alert'] { color:#d73a49; }
</style>
