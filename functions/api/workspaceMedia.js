import { json, requireUser } from './auth/_lib.js';
import { cleanAlbum, cleanIndex } from './upload/_lib.js';
import { readJson, deletePrefix, audioContentType, callWorker, REVIEW } from './ingest/_lib.js';

const validRef = (value) => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
const imageType = (name) => ({ png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif', bmp:'image/bmp' })[String(name).split('.').at(-1).toLowerCase()];
async function access(request, env) {
  if (!env.UPLOAD_BUCKET) return json({ error:'r2 not configured' },503);
  if (!await requireUser({ request,env })) return json({ error:'unauthorized' },401);
  return null;
}
const assetType = (name) => imageType(name) || audioContentType(name) || (/\.(?:lrc|elrc|txt|md)$/i.test(name) ? 'text/plain; charset=utf-8' : /\.json$/i.test(name) ? 'application/json; charset=utf-8' : 'application/octet-stream');
async function fileResponse(env,key,type) {
  if(!type)return json({error:'unsupported image'},400);
  const object=await env.UPLOAD_BUCKET.get(key);
  if(!object)return json({error:'not found'},404);
  return new Response(object.body,{headers:{'content-type':type,'content-length':String(object.size),'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
}
export async function onMediaGet({request,env}) {
  const denied=await access(request,env);if(denied)return denied;
  const url=new URL(request.url);const ref=url.searchParams.get('ref');const n=cleanIndex(url.searchParams.get('n'));
  if(!validRef(ref)||n===null)return json({error:'bad request'},400);
  const draft=await readJson(env,`workspace/${ref}/draft.json`);
  const asset=draft?.assets?.find(item=>item.n===n);
  if(!asset)return json({error:'not found'},404);
  return fileResponse(env,`web/${ref}/${n}`,assetType(asset.path));
}
export async function onWorkspaceCoverGet({request,env}) {
  const denied=await access(request,env);if(denied)return denied;
  const ref=new URL(request.url).searchParams.get('ref');if(!validRef(ref))return json({error:'bad request'},400);
  const draft=await readJson(env,`workspace/${ref}/draft.json`);
  const cover=draft?.assets?.find(item=>item.role==='cover');
  if(!cover)return json({error:'not found'},404);
  return fileResponse(env,`web/${ref}/${cover.n}`,imageType(cover.path));
}
export async function onReviewCoverGet({request,env}) {
  const denied=await access(request,env);if(denied)return denied;
  const url=new URL(request.url);const ref=url.searchParams.get('ref');const album=cleanAlbum(url.searchParams.get('album'));
  if(!/^[a-zA-Z0-9_-]{7,64}$/.test(ref||'')||!album)return json({error:'bad request'},400);
  const base=`review/${ref}/${album}`;const draft=await readJson(env,`${base}/draft.json`);
  if(!draft?.cover_ext||!/^\.(png|jpe?g|webp|gif|bmp)$/i.test(draft.cover_ext))return json({error:'not found'},404);
  return fileResponse(env,`${base}/cover${draft.cover_ext}`,imageType(`cover${draft.cover_ext}`));
}
export async function onReviewMediaGet({request,env}) {
  const denied=await access(request,env);if(denied)return denied;
  const url=new URL(request.url);const ref=url.searchParams.get('ref');const name=url.searchParams.get('name')||'';
  if(!/^[a-zA-Z0-9_-]{7,64}$/.test(ref||'')||!name||name.length>200||name.split('/').some(part=>part==='..'))return json({error:'bad request'},400);
  const manifest=await readJson(env,`web/${ref}/manifest.json`);
  const files=Array.isArray(manifest?.files)?manifest.files:[];
  const exact=files.find(file=>file.path===name);
  const matches=files.filter(file=>String(file.path).split('/').at(-1)===name);
  const file=exact||(matches.length===1?matches[0]:null);
  if(!file||cleanIndex(file.n)===null)return json({error:'not found'},404);
  return fileResponse(env,`web/${ref}/${file.n}`,assetType(file.path));
}
export async function onDiscardPost({request,env}) {
  const denied=await access(request,env);if(denied)return denied;
  const body=await request.json().catch(()=>null);const ref=body?.ref;
  if(!validRef(ref))return json({error:'bad request'},400);
  await deletePrefix(env,`workspace/${ref}/`);
  // 已提交的工作区还要撤掉审核产物并通知编排取消；web/<ref>/ 原始上传按惯例保留。
  if(await env.UPLOAD_BUCKET.head(`web/${ref}/manifest.json`)){await deletePrefix(env,`${REVIEW}/${ref}/`);await callWorker(env,'/discard',{ref});}
  return json({ok:true,ref});
}
