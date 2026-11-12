const $=selector=>document.querySelector(selector);
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const owners=['guigui','xiaoqiu'];
let photos=[],trigger;
async function load(){
 $('#loading').hidden=false;$('#failure').hidden=true;
 try{
  const response=await fetch('./photos.json',{cache:'no-cache'});if(!response.ok)throw Error('load');
  photos=(await response.json()).photos;renderShelves();
 }catch{$('#failure').hidden=false}
 finally{$('#loading').hidden=true}
}
function renderShelves(){
 for(const owner of owners){
  const groups=new Map();let ownerIndex=0;
  photos.forEach((photo,index)=>{if((photo.owner||'guigui')!==owner)return;const date=/^\d{4}-\d{2}-\d{2}/.exec(photo.metadata?.capturedAt||'')?.[0]||'';if(!groups.has(date))groups.set(date,[]);groups.get(date).push({photo,index,number:++ownerIndex})});
  $(`#${owner}-empty`).hidden=ownerIndex>0;
  $(`#${owner}-gallery`).innerHTML=[...groups].map(([date,entries])=>{
   const label=date?date.split('-').map(Number).join('/'):'未记录日期',tiers=[];
   for(let start=0;start<entries.length;start+=2){
    const cards=entries.slice(start,start+2).map(({photo:p,index:i,number:n})=>{
     const metadata=p.metadata||{};
     return `<button class="photo-card ${p.height>p.width?'portrait':'landscape'}" data-index="${i}" aria-label="查看照片：${escapeHTML(p.name)}"><span class="photo-print"><img src="${escapeHTML(p.thumbnail)}" alt="${escapeHTML(p.name)}" width="${p.width}" height="${p.height}" loading="lazy" decoding="async"><span class="print-label"><span>${escapeHTML(metadata.camera||'')}</span><span>${String(n).padStart(2,'0')}</span></span></span></button>`;
    }).join('');
    tiers.push(`<div class="shelf-tier">${cards}<span class="shelf-plank" aria-hidden="true"></span></div>`);
   }
   return `<section class="date-group" aria-label="${escapeHTML(label)}拍摄的照片"><h3 class="date-label">${date?`<time datetime="${date}">${label}</time>`:label}</h3>${tiers.join('')}</section>`;
  }).join('');
 }
}
const cameraFields=[['camera','相机'],['lens','镜头'],['shutter','快门'],['aperture','光圈'],['iso','ISO'],['focalLength','焦距'],['equivalentFocalLength','等效焦距'],['capturedAt','拍摄时间'],['whiteBalance','白平衡']];
const detailRows=rows=>rows.map(([label,value])=>`<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join('');
function showPhoto(photo){
 $('#viewer').dataset.owner=photo.owner||'guigui';$('#full-photo').src=photo.preview;$('#full-photo').alt=photo.name;$('#photo-title').textContent=photo.name;
 const metadata=photo.metadata||{},camera=cameraFields.filter(([key])=>metadata[key]).map(([key,label])=>[label,metadata[key]]);
 $('#camera-details').innerHTML=detailRows(camera);$('#no-exif').hidden=camera.length>0;
 const files=[['文件名',photo.filename||photo.name],['尺寸',`${photo.width} × ${photo.height} px`]];
 if(photo.format)files.push(['格式',photo.format]);if(photo.bytes)files.push(['文件大小',photo.bytes>=1048576?`${(photo.bytes/1048576).toFixed(2)} MB`:`${(photo.bytes/1024).toFixed(0)} KB`]);
 $('#file-details').innerHTML=detailRows(files);$('#original').href=photo.original;$('#viewer').showModal();
}
document.querySelectorAll('.gallery').forEach(gallery=>gallery.onclick=e=>{const button=e.target.closest('[data-index]');if(!button)return;trigger=button;showPhoto(photos[Number(button.dataset.index)])});
function close(){ $('#viewer').close();trigger?.focus() }
$('.close').onclick=close;
$('#viewer').addEventListener('click',e=>{if(e.target!==$('#viewer'))return;const r=$('#viewer').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close()});
$('#retry').onclick=load;
$('.skip').onclick=e=>{e.preventDefault();$('#content').focus();$('#content').scrollIntoView({block:'start'})};
load();
