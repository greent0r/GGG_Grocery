const $=selector=>document.querySelector(selector);
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let photos=[],trigger;
async function load(){
  $('#loading').hidden=false;$('#failure').hidden=true;$('#empty').hidden=true;
  try{
    const response=await fetch('./photos.json',{cache:'no-cache'});
    if(!response.ok)throw Error('load');
    photos=(await response.json()).photos.sort((a,b)=>{
      const first=a.metadata?.capturedAt,second=b.metadata?.capturedAt;
      return first&&second?first.localeCompare(second)||a.name.localeCompare(b.name):first?-1:second?1:a.name.localeCompare(b.name);
    });
    $('#count').textContent=String(photos.length).padStart(2,'0');
    renderShelves();
    $('#empty').hidden=photos.length>0;
  }catch{$('#failure').hidden=false}
  finally{$('#loading').hidden=true}
}
const shelfBreakpoints=[matchMedia('(max-width:540px)'),matchMedia('(max-width:800px)')];
function renderShelves(){
  const columns=shelfBreakpoints[0].matches?1:shelfBreakpoints[1].matches?2:3;
  const groups=new Map();
  photos.forEach((photo,index)=>{
    const date=/^\d{4}-\d{2}-\d{2}/.exec(photo.metadata?.capturedAt||'')?.[0]||'';
    if(!groups.has(date))groups.set(date,[]);
    groups.get(date).push({photo,index});
  });
  $('#grid').innerHTML=[...groups].map(([date,entries])=>{
    const label=date?date.split('-').map(Number).join('/'):'未记录拍摄日期';
    const tiers=[];
    for(let start=0;start<entries.length;start+=columns){
      const cards=entries.slice(start,start+columns).map(({photo:p,index:i})=>{
        const metadata=p.metadata||{};
        const settings=[metadata.focalLength,metadata.aperture,metadata.iso?`ISO ${metadata.iso}`:''].filter(Boolean).join(' · ');
        return `<button class="photo-card shelf-photo ${p.height>p.width?'portrait':'landscape'}" data-index="${i}" aria-label="查看照片：${escapeHTML(p.name)}"><span class="photo-print"><img src="${escapeHTML(p.thumbnail)}" alt="${escapeHTML(p.name)}" width="${p.width}" height="${p.height}" loading="lazy" decoding="async"><span class="print-caption"><span class="print-heading"><span>${escapeHTML(metadata.camera||p.name)}</span><span class="print-number">${String(i+1).padStart(2,'0')}</span></span>${settings?`<span class="print-settings">${escapeHTML(settings)}</span>`:''}</span></span></button>`;
      }).join('');
      tiers.push(`<div class="shelf-tier" style="--columns:${columns}">${cards}<span class="shelf-plank" aria-hidden="true"></span></div>`);
    }
    return `<section class="date-shelf" aria-label="${escapeHTML(label)}拍摄的照片"><div class="shelf-date"><h2>${date?`<time datetime="${date}">${label}</time>`:label}</h2><span>${entries.length} 张照片</span></div><div class="rack">${tiers.join('')}</div></section>`;
  }).join('');
}
shelfBreakpoints.forEach(query=>query.addEventListener('change',()=>{if(photos.length)renderShelves()}));
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
function close(){ $('#viewer').close();if(trigger?.isConnected)trigger.focus();else if(trigger)document.querySelector(`[data-index="${trigger.dataset.index}"]`)?.focus() }
$('.close').onclick=close;
$('#viewer').addEventListener('click',e=>{if(e.target!==$('#viewer'))return;const r=$('#viewer').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close()});
$('#retry').onclick=load;
new IntersectionObserver(([entry])=>$('.orbit').style.animationPlayState=entry.isIntersecting?'running':'paused').observe($('.geometry'));
load();
