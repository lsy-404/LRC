<template>
  <div class="wb">
    <!-- 验证（根层）：进工作站先统一验证一次，上传/修改都要求已验证 -->
    <section v-if="!verified && !restoring" class="wb-card">
      <p class="wb-lead">凭邀请密码进入工作站。</p>
      <div class="wb-row">
        <input
          v-model="pwInput"
          type="password"
          class="wb-input grow"
          placeholder="邀请密码"
          autocomplete="off"
          @keyup.enter="verify()"
        >
        <button class="wb-btn primary" :disabled="verifying || !pwInput" @click="verify()">
          {{ verifying ? '验证中…' : '验证' }}
        </button>
      </div>
      <p v-if="gateMsg" class="wb-msg" :class="{ err: gateErr }">{{ gateMsg }}</p>
    </section>
    <p v-else-if="restoring" class="wb-verified">正在恢复登录状态…</p>

    <template v-else>
      <div class="wb-tabs" role="tablist">
        <button :class="{ on: tab === 'upload' }" role="tab" @click="tab = 'upload'">上传</button>
        <button :class="{ on: tab === 'edit' }" role="tab" @click="tab = 'edit'">修改</button>
      </div>
      <!-- v-show 保留各面板状态：切 tab 不丢上传进度 / 编辑内容 -->
      <UploadBox v-show="tab === 'upload'" :password="password" />
      <EditBox v-show="tab === 'edit'" :password="password" />
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import UploadBox from './UploadBox.vue';
import EditBox from './EditBox.vue';

const AUTH_KEY = 'lrc-upload-auth';
const AUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const tab = ref('upload');
const password = ref('');
const verified = ref(false);
const restoring = ref(false);
const pwInput = ref('');
const verifying = ref(false);
const gateMsg = ref('');
const gateErr = ref(false);

// 记住密码 30 天：仅存本地，静默重试失败（密码已轮换等）就清掉退回正常输入
function loadStoredAuth() {
  try {
    const { password: pw, exp } = JSON.parse(localStorage.getItem(AUTH_KEY) || '{}');
    return (typeof pw === 'string' && pw && exp > Date.now()) ? pw : '';
  } catch { return ''; }
}
function saveAuth(pw) {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ password: pw, exp: Date.now() + AUTH_TTL_MS }));
  } catch { /* 隐私模式等不可写，静默跳过 */ }
}
function clearStoredAuth() {
  try { localStorage.removeItem(AUTH_KEY); } catch { /* noop */ }
}

async function verify(candidate, silent = false) {
  const pw = candidate ?? pwInput.value;
  if (verified.value || verifying.value || !pw) return;
  verifying.value = true;
  if (!silent) { gateErr.value = false; gateMsg.value = ''; }
  try {
    const r = await fetch('/api/upload/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (!r.ok) {
      clearStoredAuth();
      if (!silent) { gateErr.value = true; gateMsg.value = '密码错误'; }
      return;
    }
    password.value = pw;
    verified.value = true;
    saveAuth(pw);
  } catch {
    if (!silent) { gateErr.value = true; gateMsg.value = '网络错误，请重试'; }
  } finally {
    verifying.value = false;
  }
}

onMounted(async () => {
  const stored = loadStoredAuth();
  if (stored) {
    restoring.value = true;
    await verify(stored, true);
    restoring.value = false;
  }
});
</script>

<style scoped>
.wb { margin: 1.5rem 0; --wb-accent: var(--theme-color, #3a7afe); }

.wb-card {
  border: 1px solid var(--border-color, #ddd);
  border-radius: 10px;
  padding: 1.1rem 1.3rem;
  margin-bottom: 1rem;
}
.wb-lead { margin: 0 0 .75rem; }
.wb-verified { color: var(--wb-accent); font-size: .85rem; margin: 0 0 1rem; }
.wb-row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
.wb-input {
  padding: .5rem .65rem;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font-size: .9rem;
  box-sizing: border-box;
}
.wb-input.grow { flex: 1; }
.wb-input:focus {
  outline: none;
  border-color: var(--wb-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--wb-accent) 22%, transparent);
}
.wb-btn {
  padding: .45rem 1.1rem;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 7px;
  cursor: pointer;
  background: transparent;
  color: inherit;
  font-size: .85rem;
}
.wb-btn.primary { background: var(--wb-accent); border-color: var(--wb-accent); color: #fff; }
.wb-btn:disabled { opacity: .4; cursor: not-allowed; }
.wb-msg { font-size: .85rem; margin: .6rem 0 0; color: var(--wb-accent); }
.wb-msg.err { color: #f85149; }

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
  border-bottom-color: var(--wb-accent);
  font-weight: 600;
}
</style>
