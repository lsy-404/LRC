<template>
  <div class="wb">
    <!-- 验证（根层）：进工作站先统一验证一次，上传/修改都要求已验证 -->
    <section v-if="!verified && !restoring" class="wb-card">
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
        <button class="wb-help" type="button" @click="showGuide = true">使用指引</button>
      </div>
      <!-- v-show 保留各面板状态：切 tab 不丢上传进度 / 编辑内容 -->
      <UploadBox v-show="tab === 'upload'" :password="password" />
      <EditBox v-show="tab === 'edit'" :password="password" />

      <div v-if="showGuide" class="wb-guide-backdrop" @click.self="closeGuide">
        <section
          ref="guidePanel"
          class="wb-guide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wb-guide-title"
          tabindex="-1"
          @keydown.esc="closeGuide"
        >
          <div class="wb-guide-head">
            <div>
              <p class="wb-guide-kicker">工作台</p>
              <h2 id="wb-guide-title">第一次使用，从这里开始</h2>
            </div>
            <button class="wb-icon-btn" type="button" aria-label="关闭使用指引" @click="closeGuide">×</button>
          </div>
          <ol class="wb-steps">
            <li><strong>上传</strong><span>选择音频、歌词与专辑信息，提交后等待处理完成。</span></li>
            <li><strong>修改 / 试听</strong><span>在“修改”中校对歌词、时间轴，并用播放器试听。</span></li>
            <li><strong>保存 / 确认</strong><span>确认内容无误后保存；上传前请检查专辑与曲目名称。</span></li>
          </ol>
          <div class="wb-shortcuts">
            <h3>校对时常用操作</h3>
            <dl>
              <div><dt><kbd>空格</kbd></dt><dd>播放 / 暂停</dd></div>
              <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>前后移动播放位置</dd></div>
              <div><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>跳到上一句 / 下一句</dd></div>
            </dl>
          </div>
          <div class="wb-guide-foot">
            <span>之后可随时点击“使用指引”重新打开。</span>
            <button class="wb-btn primary" type="button" @click="closeGuide">开始使用</button>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, watch } from 'vue';
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
const showGuide = ref(false);
const guidePanel = ref(null);
const INTRO_KEY = 'lrc-workstation-intro-seen';

function hasSeenIntro() {
  try { return localStorage.getItem(INTRO_KEY) === '1'; } catch { return false; }
}
function closeGuide() {
  showGuide.value = false;
  try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* 隐私模式等不可写，关闭仍可继续使用 */ }
}

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
    if (!silent && !hasSeenIntro()) showGuide.value = true;
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

watch(showGuide, (open) => {
  if (open) nextTick(() => guidePanel.value?.focus());
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
.wb-help {
  margin-left: auto;
  padding: .35rem .6rem;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: .78rem;
  cursor: pointer;
}
.wb-guide-backdrop {
  position: fixed;
  z-index: 20;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(0 0 0 / 42%);
}
.wb-guide {
  width: min(100%, 34rem);
  max-height: min(90vh, 42rem);
  overflow: auto;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 12px;
  padding: clamp(1.1rem, 3vw, 1.6rem);
  background: var(--bg-color, #fff);
  color: var(--text-color, #222);
  box-shadow: 0 16px 48px rgb(0 0 0 / 22%);
}
.wb-guide:focus { outline: 2px solid var(--wb-accent); outline-offset: 3px; }
.wb-guide-head, .wb-guide-foot { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.wb-guide-kicker { margin: 0 0 .2rem; color: var(--wb-accent); font-size: .75rem; font-weight: 600; }
.wb-guide h2 { margin: 0; font-size: 1.35rem; }
.wb-icon-btn { border: 0; background: transparent; color: inherit; font-size: 1.45rem; line-height: 1; cursor: pointer; }
.wb-steps { display: grid; gap: .75rem; margin: 1.3rem 0; padding-left: 1.5rem; }
.wb-steps li { padding-left: .2rem; }
.wb-steps strong, .wb-steps span { display: block; }
.wb-steps span, .wb-guide-foot span { margin-top: .2rem; color: color-mix(in srgb, currentColor 70%, transparent); font-size: .84rem; line-height: 1.5; }
.wb-shortcuts { border-top: 1px solid var(--border-color, #ddd); border-bottom: 1px solid var(--border-color, #ddd); padding: .9rem 0; }
.wb-shortcuts h3 { margin: 0 0 .65rem; font-size: .9rem; }
.wb-shortcuts dl { display: grid; gap: .45rem; margin: 0; }
.wb-shortcuts dl div { display: flex; align-items: center; gap: .75rem; }
.wb-shortcuts dt { min-width: 5.5rem; }
.wb-shortcuts dd { margin: 0; font-size: .84rem; }
kbd { display: inline-block; min-width: 1.4rem; padding: .12rem .35rem; border: 1px solid var(--border-color, #bbb); border-radius: 4px; background: color-mix(in srgb, currentColor 8%, transparent); font: .75rem/1.2 inherit; text-align: center; }
.wb-guide-foot { align-items: center; margin-top: 1rem; }
.wb-guide-foot span { margin: 0; }
@media (max-width: 520px) { .wb-guide-foot { align-items: flex-start; flex-direction: column; } }
</style>
