firebase.initializeApp(firebaseConfig);
const auth=firebase.auth(), fs=firebase.firestore();
const KMLKEY='territorios_kml', MAXD=180;
let visits=[], nv=[], terr=[], layers={}, nvMode=false, nvMarkers=[], unsub=[], inst=null;
const $=id=>document.getElementById(id);
const esc=s=>String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const today=()=>new Date().toISOString().slice(0,10);
const daysSince=d=>Math.floor((new Date(today()+'T00:00')-new Date(d+'T00:00'))/864e5);
const fmt=d=>d?d.split('-').reverse().join('/'):'—';
const visitsOf=n=>visits.filter(v=>v.t===n).sort((a,b)=>b.d.localeCompare(a.d));
const lastDays=n=>{const v=visitsOf(n)[0];return v?daysSince(v.d):null};
const color=d=>d===null?'#888':`hsl(${120*(1-Math.min(d,MAXD)/MAXD)},75%,45%)`;

/* Sesión y datos en tiempo real */
$('loginForm').onsubmit=async e=>{e.preventDefault();$('loginErr').textContent='';
  try{await auth.signInWithEmailAndPassword($('em').value,$('pw').value)}catch{$('loginErr').textContent='Correo o contraseña incorrectos'}};
$('btnOut').onclick=()=>auth.signOut();
auth.onAuthStateChanged(u=>{
  unsub.forEach(f=>f());unsub=[];
  $('login').hidden=!!u;
  if(!u){visits=[];nv=[];paint();return}
  setTimeout(()=>map.invalidateSize(),100);
  unsub.push(fs.collection('visitas').onSnapshot(s=>{if(s.metadata.fromCache)return;visits=s.docs.map(d=>({id:d.id,...d.data()}));paint()}));
  unsub.push(fs.collection('nv').onSnapshot(s=>{if(s.metadata.fromCache)return;nv=s.docs.map(d=>({id:d.id,...d.data()}));paint()}));
});

const map=L.map('map').setView([-31.12,-64.47],14);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);

function parseKML(txt){
  const x=new DOMParser().parseFromString(txt,'text/xml');
  return [...x.getElementsByTagName('Placemark')].map(p=>({
    name:(p.getElementsByTagName('name')[0]?.textContent||'').trim(),
    polys:[...p.getElementsByTagName('Polygon')].map(pg=>
      pg.getElementsByTagName('coordinates')[0].textContent.trim().split(/\s+/)
        .map(s=>{const a=s.split(',');return [+a[1],+a[0]]}))
  })).filter(t=>t.polys.length);
}
function loadKML(txt){
  terr=parseKML(txt);
  Object.values(layers).forEach(l=>map.removeLayer(l));layers={};
  terr.forEach(t=>{
    const l=L.polygon(t.polys,{weight:2,color:'#222',fillOpacity:.55}).addTo(map);
    l.on('click',e=>{if(!nvMode)openPop(t.name,e.latlng)});
    layers[t.name]=l;
  });
  if(terr.length)map.fitBounds(L.featureGroup(Object.values(layers)).getBounds());
  paint();
}
function paint(){
  terr.forEach(t=>layers[t.name].setStyle({fillColor:color(lastDays(t.name))}));
  const rows=terr.map(t=>({n:t.name,d:lastDays(t.name)})).sort((a,b)=>(b.d??1e9)-(a.d??1e9));
  $('list').innerHTML=rows.map(r=>`<div class="item" data-n="${esc(r.n)}"><span class="dot" style="background:${color(r.d)}"></span><div>${esc(r.n)}<small>${r.d===null?'Sin registro':'Hace '+r.d+' días · '+fmt(visitsOf(r.n)[0].d)}</small></div></div>`).join('')||'<p style="padding:12px">Cargá el archivo KML de los territorios.</p>';
  document.querySelectorAll('.item').forEach(el=>el.onclick=()=>{
    const l=layers[el.dataset.n];map.fitBounds(l.getBounds());openPop(el.dataset.n,l.getBounds().getCenter())});
  drawNV();
}
function openPop(n,ll){
  const hist=visitsOf(n).map(v=>`<li>${fmt(v.d)} ${esc(v.who)} <button data-id="${v.id}">✕</button></li>`).join('');
  const el=document.createElement('div');el.className='pop';
  el.innerHTML=`<b>${esc(n)}</b><br>${hist?'<ul>'+hist+'</ul>':'<i>Sin registros</i>'}
   <input type="date" id="pd" value="${today()}"><input id="pwho" placeholder="Conductor / nota (opcional)">
   <button id="pg">✔ Registrar como trabajado</button>`;
  el.querySelector('#pg').onclick=()=>{fs.collection('visitas').add({t:n,d:el.querySelector('#pd').value||today(),who:el.querySelector('#pwho').value});map.closePopup()};
  el.querySelectorAll('li button').forEach(b=>b.onclick=()=>{if(confirm('¿Borrar este registro?')){fs.collection('visitas').doc(b.dataset.id).delete();map.closePopup()}});
  L.popup().setLatLng(ll).setContent(el).openOn(map);
}
/* NO VISITAR */
function addNV(ll){
  const addr=prompt('Dirección / referencia de la casa:');if(addr===null)return;
  fs.collection('nv').add({lat:ll.lat,lng:ll.lng,addr,note:prompt('Nota (opcional):')||'',d:today()});
}
function drawNV(){
  nvMarkers.forEach(m=>map.removeLayer(m));
  nvMarkers=nv.map(n=>{
    const m=L.marker([n.lat,n.lng],{icon:L.divIcon({className:'nv',html:'⛔',iconSize:[26,26]})}).addTo(map);
    const el=document.createElement('div');el.className='pop';
    el.innerHTML=`<b>NO VISITAR</b><br>${esc(n.addr)}<br><small>${esc(n.note)}<br>Desde ${fmt(n.d)}</small><button>Eliminar</button>`;
    el.querySelector('button').onclick=()=>{if(confirm('¿Quitar esta marca?'))fs.collection('nv').doc(n.id).delete()};
    m.bindPopup(el);return m;
  });
}
$('btnNV').onclick=()=>{nvMode=!nvMode;$('btnNV').classList.toggle('on',nvMode);
  $('btnNV').querySelector('.lbl').textContent=nvMode?'Tocá el mapa…':'NO VISITAR'};
map.on('click',e=>{if(nvMode)addNV(e.latlng)});
/* Informe */
$('btnRep').onclick=()=>{
  const rows=terr.map(t=>{const v=visitsOf(t.name),rec=v.filter(x=>daysSince(x.d)<=MAXD);
    return `<tr><td>${esc(t.name)}</td><td>${fmt(v[0]?.d)}</td><td>${v[0]?daysSince(v[0].d):'—'}</td><td>${rec.length}</td><td>${rec.map(x=>fmt(x.d)).join(', ')}</td></tr>`}).join('');
  const nvr=nv.map(n=>`<tr><td>${esc(n.addr)}</td><td>${esc(n.note)}</td><td>${fmt(n.d)}</td></tr>`).join('')||'<tr><td colspan=3>Ninguna</td></tr>';
  $('report').innerHTML=`<h2>Informe de territorios — últimos 6 meses</h2><p>Congregación Valle Hermoso · Emitido: ${fmt(today())}</p>
   <table><tr><th>Territorio</th><th>Última vez</th><th>Días</th><th>Veces (6 meses)</th><th>Fechas</th></tr>${rows}</table>
   <h3>Casas NO VISITAR (${nv.length})</h3><table><tr><th>Dirección</th><th>Nota</th><th>Desde</th></tr>${nvr}</table>`;
  window.print();
};
$('btnExp').onclick=()=>{const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify({visits,nv})],{type:'application/json'}));
  a.download='territorios-respaldo-'+today()+'.json';a.click()};
$('fileKml').onchange=async e=>{const t=await e.target.files[0].text();try{localStorage.setItem(KMLKEY,t)}catch{}loadKML(t)};
/* Instalación como app */
addEventListener('beforeinstallprompt',e=>{e.preventDefault();inst=e;$('btnInst').hidden=false});
$('btnInst').onclick=async()=>{if(!inst)return;inst.prompt();await inst.userChoice;inst=null;$('btnInst').hidden=true};
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js');
(async()=>{
  let t=null;
  try{const r=await fetch('territorios.kml');if(r.ok)t=await r.text()}catch{}
  t=t||localStorage.getItem(KMLKEY);
  if(t)loadKML(t);else paint();
})();
