<template>
  <section class="account-view">
    <h2>账户设置</h2>
    <p class="muted">用户名：{{ user.name }} · {{ user.role === 'admin' ? '管理员' : '编辑者' }}</p>
    <form @submit.prevent="saveName">
      <label>展示名<input v-model.trim="displayName" autocomplete="name" required></label>
      <button :disabled="saving">保存展示名</button>
    </form>
    <form @submit.prevent="changePassword">
      <h3>修改密码</h3>
      <label>旧密码<input v-model="oldPassword" type="password" autocomplete="current-password" required></label>
      <label>新密码<input v-model="newPassword" type="password" autocomplete="new-password" required></label>
      <button :disabled="saving">修改密码</button>
    </form>
    <section>
      <h3>GitHub</h3>
      <p v-if="user.github">已绑定：@{{ user.github }}</p>
      <p v-else-if="!githubConfigured" class="muted">此部署尚未配置 GitHub OAuth。</p>
      <p v-else class="muted">绑定后会读取 GitHub 用户名用于署名。</p>
      <button v-if="user.github" :disabled="saving" @click="unlinkGithub">解绑 GitHub</button>
      <button v-else :disabled="!githubConfigured" @click="connectGithub">绑定 GitHub</button>
    </section>
    <p v-if="message" :class="{ error }" role="status">{{ message }}</p>
  </section>
</template>

<script setup>
import { ref, watch } from 'vue';
const props = defineProps({ user: { type: Object, required: true }, githubConfigured: Boolean, adapter: { type: Object, required: true } });
const emit = defineEmits(['user', 'unauthorized']);
const displayName = ref(props.user.display_name || props.user.name); const oldPassword = ref(''); const newPassword = ref(''); const saving = ref(false); const message = ref(''); const error = ref(false);
watch(() => props.user, (user) => { displayName.value = user.display_name || user.name; }, { deep: true });
function report(value, failed = false) { message.value = value; error.value = failed; }
async function run(action) { saving.value = true; report(''); try { return await action(); } catch (cause) { if (cause.status === 401) emit('unauthorized'); report(cause.message || '请求失败', true); return null; } finally { saving.value = false; } }
async function saveName() { const data = await run(() => props.adapter.updateMe({ display_name: displayName.value })); if (data?.user) { emit('user', data.user); report('展示名已保存'); } }
async function changePassword() { const data = await run(() => props.adapter.updateMe({ old_password: oldPassword.value, new_password: newPassword.value })); if (data?.user) { emit('user', data.user); oldPassword.value = ''; newPassword.value = ''; report('密码已修改，请重新登录'); emit('unauthorized'); } }
function connectGithub() { if (props.githubConfigured) window.location.assign('/api/auth/github/start'); }
async function unlinkGithub() { const data = await run(() => props.adapter.unlinkGithub()); if (data?.user) { emit('user', data.user); report('GitHub 已解绑'); } }
</script>

<style scoped>
.account-view { max-width:40rem; padding:1.25rem; }.account-view h2,.account-view h3 { margin:0; }.account-view h2 { font-size:1rem; }.account-view h3 { font-size:.85rem; font-weight:600; }.account-view form,.account-view section { display:grid; gap:.7rem; margin-top:1.2rem; padding-top:1rem; border-top:1px solid var(--border-color,#d4d4d8); }.account-view label { display:grid; gap:.3rem; font-size:.82rem; opacity:.8; }.account-view input,.account-view button { padding:.45rem .65rem; border:1px solid var(--border-color,#d4d4d8); border-radius:2px; color:inherit; background:transparent; font:inherit; }.account-view button { width:max-content; cursor:pointer; }.muted { opacity:.7; }.error { color:#dc2626; }
</style>
