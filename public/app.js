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
$('#grid').onclick=e=>{const button=e.target.closest('[data-index]');if(!button)return;const photo=photos[Number(button.dataset.index)];trigger=button;$('#full-photo').src=photo.preview;$('#full-photo').alt=photo.name;$('#original').href=photo.original;$('#viewer').showModal()};
function close(){ $('#viewer').close();trigger?.focus() }
$('.close').onclick=close;
$('#viewer').addEventListener('click',e=>{if(e.target!==$('#viewer'))return;const r=$('#viewer').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close()});
$('#retry').onclick=load;
new IntersectionObserver(([entry])=>$('.orbit').style.animationPlayState=entry.isIntersecting?'running':'paused').observe($('.geometry'));
load();
