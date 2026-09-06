<template>
  <section class="users-view">
    <h2>用户管理</h2>
    <p v-if="message" :class="{ error }" role="status">{{ message }}</p>
    <section class="invite-create"><h3>创建邀请码</h3><label>角色<select v-model="inviteRole"><option value="editor">编辑者</option><option value="admin">管理员</option></select></label><label>有效小时数<input v-model.number="inviteHours" type="number" min="1"></label><button @click="createInvite">创建邀请码</button><p v-if="newCode">新邀请码：<code>{{ newCode }}</code> <button @click="copyCode">复制</button></p></section>
    <section><h3>用户</h3><table><thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>GitHub</th><th></th></tr></thead><tbody><tr v-for="person in users" :key="person.id"><td>{{ person.display_name || person.name }}</td><td><select v-model="person.role"><option value="editor">编辑者</option><option value="admin">管理员</option></select></td><td><select v-model="person.status"><option value="active">启用</option><option value="disabled">停用</option></select></td><td>{{ person.github ? `@${person.github}` : '—' }}</td><td><button @click="saveUser(person)">保存</button></td></tr></tbody></table></section>
    <section><h3>邀请码</h3><table><thead><tr><th>角色</th><th>状态</th><th>过期时间</th><th></th></tr></thead><tbody><tr v-for="invite in invites" :key="invite.code_hash"><td>{{ invite.role === 'admin' ? '管理员' : '编辑者' }}</td><td>{{ inviteStatus(invite) }}</td><td>{{ formatTime(invite.expires_at) }}</td><td><button v-if="invite.used_by === null || invite.used_by === 0" @click="revokeInvite(invite.code_hash)">吊销</button></td></tr></tbody></table></section>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue';
const props = defineProps({ adapter: { type: Object, required: true } }); const emit = defineEmits(['unauthorized']);
const users = ref([]); const invites = ref([]); const inviteRole = ref('editor'); const inviteHours = ref(168); const newCode = ref(''); const message = ref(''); const error = ref(false);
function report(value, failed = false) { message.value = value; error.value = failed; }
async function request(action) { try { return await action(); } catch (cause) { if (cause.status === 401) emit('unauthorized'); report(cause.message || '请求失败', true); return null; } }
async function refresh() { const [people, codes] = await Promise.all([request(() => props.adapter.users()), request(() => props.adapter.invites())]); if (people) users.value = people.users || []; if (codes) invites.value = codes.invites || []; }
async function saveUser(person) { const data = await request(() => props.adapter.updateUser({ id: person.id, role: person.role, status: person.status })); if (data?.user) { Object.assign(person, data.user); report('用户已保存'); } }
async function createInvite() { const data = await request(() => props.adapter.createInvite(inviteRole.value, inviteHours.value)); if (data?.code) { newCode.value = data.code; report('邀请码已创建；这是唯一一次显示明文。'); await refresh(); } }
async function revokeInvite(codeHash) { const data = await request(() => props.adapter.revokeInvite(codeHash)); if (data?.ok) { report('邀请码已吊销'); await refresh(); } }
function inviteStatus(invite) { return invite.used_by === null ? '未使用' : invite.used_by === 0 ? '占用中断' : '已使用'; }
function formatTime(value) { return value ? new Date(value).toLocaleString() : '—'; }
async function copyCode() { try { await navigator.clipboard.writeText(newCode.value); report('已复制邀请码'); } catch { report('复制失败，请手动复制', true); } }
onMounted(refresh);
</script>

<style scoped>
.users-view { padding:1.25rem; overflow:auto; }.users-view h2,.users-view h3 { margin:0; }.users-view h2 { font-size:1rem; }.users-view h3 { font-size:.85rem; }.users-view section { margin-top:1.4rem; padding-top:1rem; border-top:1px solid var(--border-color,#d4d4d8); }.invite-create { display:flex; flex-wrap:wrap; align-items:end; gap:.6rem; }.invite-create label { display:grid; gap:.25rem; font-size:.82rem; opacity:.8; } table { border-collapse:collapse; width:100%; font-size:.85rem; } th,td { padding:.55rem .45rem; border-bottom:1px solid var(--border-color,#d4d4d8); text-align:left; } select,input,button { padding:.4rem .55rem; border:1px solid var(--border-color,#d4d4d8); border-radius:2px; color:inherit; background:transparent; font:inherit; } button { cursor:pointer; } .error { color:#dc2626; }
</style>
