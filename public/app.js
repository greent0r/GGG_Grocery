const $=selector=>document.querySelector(selector);
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let photos=[],trigger;
async function load(){
  $('#loading').hidden=false;$('#failure').hidden=true;$('#empty').hidden=true;
  try{
    const response=await fetch('./photos.json',{cache:'no-cache'});
    if(!response.ok)throw Error('load');
    photos=(await response.json()).photos;
    $('#count').textContent=String(photos.length).padStart(2,'0');
    $('#grid').innerHTML=photos.map((p,i)=>`<button class="photo-card" data-index="${i}" aria-label="查看照片：${escapeHTML(p.name)}"><img src="${escapeHTML(p.thumbnail)}" alt="${escapeHTML(p.name)}" width="${p.width}" height="${p.height}" loading="lazy" decoding="async"></button>`).join('');
    $('#empty').hidden=photos.length>0;
  }catch{$('#failure').hidden=false}
  finally{$('#loading').hidden=true}
}
const cameraFields=[['camera','相机'],['lens','镜头'],['shutter','快门'],['aperture','光圈'],['iso','ISO'],['focalLength','焦距'],['equivalentFocalLength','等效焦距'],['capturedAt','拍摄时间'],['whiteBalance','白平衡']];
const detailRows=rows=>rows.map(([label,value])=>`<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join('');
function showPhoto(photo){
  $('#full-photo').src=photo.preview;$('#full-photo').alt=photo.name;
  $('#photo-title').textContent=photo.name;
  const metadata=photo.metadata||{};
  const camera=cameraFields.filter(([key])=>metadata[key]).map(([key,label])=>[label,metadata[key]]);
  $('#camera-details').innerHTML=detailRows(camera);$('#no-exif').hidden=camera.length>0;
  const files=[['文件名',photo.filename||photo.name],['尺寸',`${photo.width} × ${photo.height} px`]];
  if(photo.format)files.push(['格式',photo.format]);
  if(photo.bytes)files.push(['文件大小',photo.bytes>=1048576?`${(photo.bytes/1048576).toFixed(2)} MB`:`${(photo.bytes/1024).toFixed(0)} KB`]);
  $('#file-details').innerHTML=detailRows(files);$('#original').href=photo.original;$('#viewer').showModal();
}
$('#grid').onclick=e=>{const button=e.target.closest('[data-index]');if(!button)return;trigger=button;showPhoto(photos[Number(button.dataset.index)])};
function close(){ $('#viewer').close();trigger?.focus() }
$('.close').onclick=close;
$('#viewer').addEventListener('click',e=>{if(e.target!==$('#viewer'))return;const r=$('#viewer').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close()});
$('#retry').onclick=load;
new IntersectionObserver(([entry])=>$('.orbit').style.animationPlayState=entry.isIntersecting?'running':'paused').observe($('.geometry'));
load();
