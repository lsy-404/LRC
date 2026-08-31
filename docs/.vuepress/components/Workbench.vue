<template>
  <div class="wb" :data-theme="resolvedTheme">
    <section v-if="!verified && !restoring" class="wb-card">
      <div class="wb-row"><input v-model="pwInput" type="password" class="wb-input" placeholder="邀请密码" autocomplete="off" @keyup.enter="verify()"><button class="wb-btn primary" :disabled="verifying || !pwInput" @click="verify()">{{ verifying ? '验证中…' : '进入工作区' }}</button></div>
      <p v-if="gateMsg" class="wb-msg" :class="{ err: gateErr }">{{ gateMsg }}</p>
    </section>
    <p v-else-if="restoring" class="wb-verified">正在恢复登录状态…</p>
    <UnifiedWorkspace v-else :password="password" :theme="resolvedTheme" />
    <footer v-if="verified" class="wb-footer"><label for="wb-theme">主题</label><select id="wb-theme" v-model="themePreference" class="wb-theme-select" aria-label="工作站主题"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">暗色</option></select><button class="wb-btn" type="button" @click="logout">退出</button></footer>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import UnifiedWorkspace from './UnifiedWorkspace.vue';
const AUTH_KEY = 'lrc-upload-auth'; const AUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000; const THEME_KEY = 'lrc-workstation-theme';
const password = ref(''); const verified = ref(false); const restoring = ref(false); const pwInput = ref(''); const verifying = ref(false); const gateMsg = ref(''); const gateErr = ref(false); const themePreference = ref('system'); const systemDark = ref(false);
const resolvedTheme = computed(() => themePreference.value === 'system' ? (systemDark.value ? 'dark' : 'light') : themePreference.value);
function storedAuth() { try { const value = JSON.parse(localStorage.getItem(AUTH_KEY) || '{}'); return value.password && value.exp > Date.now() ? value.password : ''; } catch { return ''; } }
function clearAuth() { try { localStorage.removeItem(AUTH_KEY); } catch {} }
function logout() { clearAuth(); password.value = ''; pwInput.value = ''; verified.value = false; gateMsg.value = ''; gateErr.value = false; }
async function verify(candidate, silent = false) { const pw = candidate || pwInput.value; if (!pw || verifying.value || verified.value) return; verifying.value = true; if (!silent) { gateMsg.value = ''; gateErr.value = false; } try { const response = await fetch('/api/upload/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) }); if (!response.ok) { clearAuth(); if (!silent) { gateMsg.value = '密码错误'; gateErr.value = true; } return; } password.value = pw; verified.value = true; localStorage.setItem(AUTH_KEY, JSON.stringify({ password: pw, exp: Date.now() + AUTH_TTL_MS })); } catch { if (!silent) { gateMsg.value = '网络错误，请重试'; gateErr.value = true; } } finally { verifying.value = false; } }
onMounted(async () => { try { const storedTheme = localStorage.getItem(THEME_KEY); themePreference.value = ['system', 'light', 'dark'].includes(storedTheme) ? storedTheme : 'system'; } catch {} const media = window.matchMedia('(prefers-color-scheme: dark)'); systemDark.value = media.matches; media.addEventListener('change', (event) => { systemDark.value = event.matches; }); const saved = storedAuth(); if (saved) { restoring.value = true; await verify(saved, true); restoring.value = false; } });
watch(themePreference, (value) => { try { localStorage.setItem(THEME_KEY, value); } catch {} });
</script>

<style scoped>
.wb { margin:1.5rem 0; --bg-color:#fff; --text-color:#24292f; --border-color:#d0d7de; color:var(--text-color); }.wb[data-theme='dark'] { --bg-color:#161b22; --text-color:#e6edf3; --border-color:#30363d; color-scheme:dark; }.wb-card { padding:1.1rem; border:1px solid var(--border-color); border-radius:10px; background:var(--bg-color); }.wb-row,.wb-footer { display:flex; align-items:center; gap:.5rem; }.wb-input,.wb-theme-select,.wb-btn { padding:.45rem .65rem; border:1px solid var(--border-color); border-radius:6px; color:inherit; background:var(--bg-color); font:inherit; }.wb-input { flex:1; }.wb-btn { cursor:pointer; }.wb-btn.primary { color:#fff; background:var(--theme-color,#3a7afe); border-color:var(--theme-color,#3a7afe); }.wb-btn:disabled { opacity:.5; cursor:not-allowed; }.wb-msg { color:var(--theme-color,#3a7afe); }.wb-msg.err { color:#f85149; }.wb-verified { color:var(--theme-color,#3a7afe); }.wb-footer { justify-content:flex-end; margin-top:.55rem; font-size:.82rem; }
</style>
