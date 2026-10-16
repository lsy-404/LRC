import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from './worker/_studio.mjs';
import { fakeBucket, authedRequest } from './worker/_fakeR2.mjs';

const ref = 'a'.repeat(32);
function environment() {
  const bucket=fakeBucket({[`workspace/${ref}/draft.json`]:{album:'示例',assets:[{n:1,path:'cover.png',role:'cover',size:5}]},[`workspace/${ref}/status.json`]:{},[`web/${ref}/1`]:'image'});
  return {UPLOAD_BUCKET:bucket,USERS:{getByName:()=>({resolveSession:()=>({id:1,name:'editor',role:'editor'})})}};
}
test('素材与封面只读取登录用户工作区已登记图片',async()=>{
  const env=environment();
  assert.equal((await handleApi(new Request(`https://x/api/workspace/media?ref=${ref}&n=1`),env)).status,401);
  assert.equal((await handleApi(authedRequest(`https://x/api/workspace/media?ref=${ref}&n=2`),env)).status,404);
  const image=await handleApi(authedRequest(`https://x/api/workspace/cover?ref=${ref}`),env);
  assert.equal(image.headers.get('content-type'),'image/png');assert.equal(await image.text(),'image');
  assert.equal((await handleApi(authedRequest(`https://x/api/workspace/media?ref=../bad&n=1`),env)).status,400);
});
test('丢弃草稿不影响原料，并拒绝删除已开始的投稿',async()=>{
  const env=environment();await env.UPLOAD_BUCKET.put(`web/${ref}/manifest.json`,'{}');
  assert.equal((await handleApi(authedRequest('https://x/api/workspace/discard',{method:'POST',body:{ref}}),env)).status,409);
  await env.UPLOAD_BUCKET.delete(`web/${ref}/manifest.json`);
  assert.equal((await handleApi(authedRequest('https://x/api/workspace/discard',{method:'POST',body:{ref}}),env)).status,200);
  assert.equal(env.UPLOAD_BUCKET.store.has(`workspace/${ref}/draft.json`),false);
  assert.equal(env.UPLOAD_BUCKET.store.has(`web/${ref}/1`),true);
});
test('审核图片仅允许精确文件名或唯一basename，不能跨投稿读取',async()=>{
  const env=environment();
  await env.UPLOAD_BUCKET.put(`web/${ref}/manifest.json`,JSON.stringify({files:[{n:1,path:'lyrics/page.png'},{n:2,path:'other/page.png'}]}));
  const url=`https://x/api/ingest/media?ref=${ref}&name=`;
  assert.equal((await handleApi(authedRequest(url+'page.png'),env)).status,404);
  assert.equal(await (await handleApi(authedRequest(url+'lyrics%2Fpage.png'),env)).text(),'image');
  assert.equal((await handleApi(authedRequest(url+'..%2Fpage.png'),env)).status,400);
});

test('具体文件预览读取已登记歌词、音频和二进制，封面仍限制为图片', async () => {
  const env=environment();
  const entries=[{n:2,path:'lyrics/song.elrc',text:'[00:01.000]<00:01.000>歌词',type:'text/plain; charset=utf-8'}, {n:3,path:'audio.wav',text:'audio',type:'audio/wav'}, {n:4,path:'notes.json',text:'{}',type:'application/json; charset=utf-8'}, {n:5,path:'page.html',text:'<script>example</script>',type:'application/octet-stream'}];
  await env.UPLOAD_BUCKET.put(`workspace/${ref}/draft.json`,JSON.stringify({album:'素材',assets:entries}));
  await env.UPLOAD_BUCKET.put(`web/${ref}/manifest.json`,JSON.stringify({files:entries}));
  for(const item of entries){
    await env.UPLOAD_BUCKET.put(`web/${ref}/${item.n}`,item.text);
    for(const url of [`https://x/api/workspace/media?ref=${ref}&n=${item.n}`,`https://x/api/ingest/media?ref=${ref}&name=${encodeURIComponent(item.path)}`]){
      const response=await handleApi(authedRequest(url),env);
      assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),item.type);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(await response.text(),item.text);
    }
  }
  assert.equal((await handleApi(authedRequest(`https://x/api/workspace/cover?ref=${ref}`),env)).status,404);
});
