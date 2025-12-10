/* script.js
   Handles:
   - robust camera open with fallback
   - advanced color detection (center crop, sample area, k-means fallback)
   - audio unlock + beep + TTS in selected alert language
   - germination % prediction
   - sprout animation
   - history/save & printable report (user can Save as PDF via print dialog)
   - full-page multilingual UI using languages.json
*/

// --- Config / calibration ---
const IDEAL_PINK = [200,100,140]; // tune after calibration
const SAMPLE_PIXEL_COUNT = 400; // sample up to ~400 pixels from crop area

// --- Elements ---
const langSelect = document.getElementById('langSelect');
const alertLang = document.getElementById('alertLang');
const deviceSelect = document.getElementById('deviceSelect');
const themeToggle = document.getElementById('themeToggle');

const openCam = document.getElementById('openCam');
const captureBtn = document.getElementById('captureBtn');
const enableAudio = document.getElementById('enableAudio');
const resetBtn = document.getElementById('resetBtn');

const video = document.getElementById('video');
const swatch = document.getElementById('swatch');
const rgbText = document.getElementById('rgbText');
const hsvText = document.getElementById('hsvText');
const cameraNote = document.getElementById('cameraNote');

const detectedState = document.getElementById('detectedState');
const badgeText = document.getElementById('statusBadge');
const meterFill = document.getElementById('meterFill');
const percentText = document.getElementById('percentText');
const adviceText = document.getElementById('adviceText');

const saveBtn = document.getElementById('saveBtn');
const downloadBtn = document.getElementById('downloadBtn');
const speakBtn = document.getElementById('speakBtn');
const historyEl = document.getElementById('history');

const seedSelect = document.getElementById('seedSelect');
const customName = document.getElementById('customName');

const ui_title = document.getElementById('ui_title');
const ui_sub = document.getElementById('ui_sub');
const ui_seed_label = document.getElementById('ui_seed_label');
const ui_tip = document.getElementById('ui_tip');
const ui_instructions = document.getElementById('ui_instructions');
const ui_how = document.getElementById('ui_how');
const ui_how_text = document.getElementById('ui_how_text');
const ui_footer = document.getElementById('ui_footer');

// --- State ---
let stream = null;
let devices = [];
let lastReport = null;
let audioCtx = null;

// --- Load languages.json and populate UI ---
let LANG = {};
fetch('languages.json').then(r=>r.json()).then(js=>{
  LANG = js;
  // populate language selector
  const langs = Object.keys(LANG);
  langSelect.innerHTML = '';
  langs.forEach(l => {
    const o = document.createElement('option'); o.value = l; o.innerText = LANG[l].ui_lang_name || l;
    langSelect.appendChild(o);
  });
  // default english
  langSelect.value = 'en';
  applyLanguage();
}).catch(e=>{
  console.error('languages.json load failed', e);
});

// --- Language switch: full page texts ---
function applyLanguage(){
  const L = langSelect.value || 'en';
  const S = LANG[L].strings;
  ui_title.innerText = S.title;
  ui_sub.innerText = S.sub;
  ui_seed_label.innerText = S.seed_label;
  ui_tip.innerText = S.tip;
  ui_instructions.innerText = S.instructions;
  ui_how.innerText = S.how;
  ui_how_text.innerText = S.how_text;
  ui_footer.innerText = S.footer;
  openCam.innerText = S.open_camera;
  captureBtn.innerText = S.capture;
  resetBtn.innerText = S.reset;
  saveBtn.innerText = S.save;
  downloadBtn.innerText = S.download;
  speakBtn.innerText = S.speak;
  document.getElementById('customName').placeholder = S.custom_placeholder || '';
  detectedState.innerText = S.waiting;
  badgeText.innerText = '--';
  adviceText.innerText = '';
}
langSelect.addEventListener('change', applyLanguage);

// --- enumerate devices ---
async function enumerateDevices(){
  try{
    const list = await navigator.mediaDevices.enumerateDevices();
    devices = list.filter(d => d.kind === 'videoinput');
    if(devices.length > 0){
      deviceSelect.style.display = 'inline-block';
      deviceSelect.innerHTML = '';
      devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.innerText = d.label || ('Camera ' + d.deviceId.slice(-4));
        deviceSelect.appendChild(opt);
      });
    }
  }catch(e){
    console.warn('enumerateDevices error', e);
  }
}
enumerateDevices();

// --- audio unlock (must be called on user gesture before playing) ---
function ensureAudioContext(){
  try{
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(audioCtx.state === 'suspended') audioCtx.resume();
  }catch(e){ console.warn('AudioContext not available', e); }
}

// --- beep generator (uses AudioContext) ---
function beep(freq=700, duration=180, type='sine'){
  try{
    ensureAudioContext();
    if(!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    o.connect(g); g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
    o.start();
    setTimeout(()=> {
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.02);
      o.stop(audioCtx.currentTime + 0.04);
    }, duration);
  }catch(e){ console.warn('beep failed', e); }
}

// --- TTS speak ---
function speak(text){
  try{
    const langCode = alertLang.value === 'ml' ? 'ml-IN' : (alertLang.value === 'hi' ? 'hi-IN' : 'en-IN');
    const u = new SpeechSynthesisUtterance(text);
    u.lang = langCode;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }catch(e){ console.warn('TTS failed', e); }
}

// --- camera open robust ---
async function openCamera(deviceId=null){
  closeStream();
  cameraNote.innerText = '';
  try{
    let constraints;
    if(deviceId){
      constraints = { video: { deviceId: { exact: deviceId }, width:{ideal:1280}, height:{ideal:720} } };
    } else {
      constraints = { video: { facingMode: { ideal: 'environment' }, width:{ideal:1280}, height:{ideal:720} } };
    }
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play().catch(()=>{});
    enumerateDevices();
    cameraNote.innerText = '';
    startLivePreview();
  }catch(err){
    console.warn('openCamera failed', err);
    cameraNote.innerText = 'Camera open failed; trying fallback.';
    // fallback to any camera
    try{
      stream = await navigator.mediaDevices.getUserMedia({video:true});
      video.srcObject = stream;
      await video.play().catch(()=>{});
      startLivePreview();
      cameraNote.innerText = '';
    }catch(er){
      cameraNote.innerText = 'Camera not available. Check permissions or try another browser.';
      console.error('camera fallback failed', er);
    }
  }
}
openCam.addEventListener('click', ()=> openCamera(deviceSelect.value || null));
deviceSelect.addEventListener('change', ()=> openCamera(deviceSelect.value));

// --- close stream ---
function closeStream(){
  if(stream){
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  stopLivePreview();
}

// --- live preview sampling (for meter) ---
let liveInterval = null;
function startLivePreview(){
  if(liveInterval) clearInterval(liveInterval);
  liveInterval = setInterval(()=> sampleFrame(true), 700);
}
function stopLivePreview(){ if(liveInterval) clearInterval(liveInterval); liveInterval = null; }

// --- sample frame (center crop) ---
const tmpCanvas = document.createElement('canvas');
function sampleFrame(isLive=false){
  if(!stream) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  if(!vw || !vh) return;
  // crop center ~ 20% x 20% area (guide)
  const cropW = Math.floor(vw * 0.28);
  const cropH = Math.floor(vh * 0.28);
  const sx = Math.floor((vw - cropW)/2);
  const sy = Math.floor((vh - cropH)/2);
  tmpCanvas.width = cropW; tmpCanvas.height = cropH;
  const ctx = tmpCanvas.getContext('2d');
  try{ ctx.drawImage(video, sx, sy, cropW, cropH, 0,0,cropW,cropH); }catch(e){ console.warn('drawImage failed', e); return; }
  const img = ctx.getImageData(0,0,cropW,cropH);
  const pixels = sampleImagePixels(img, SAMPLE_PIXEL_COUNT);
  let dominant = null;
  try{ dominant = getDominantColorKMeans(pixels, 3); }catch(e){ dominant = null; }
  if(!dominant) dominant = averageColor(pixels);
  const [r,g,b] = dominant;
  swatch.style.background = `rgb(${r},${g},${b})`;
  rgbText.innerText = `R ${r} • G ${g} • B ${b}`;
  const hsv = rgbToHsv(r,g,b);
  hsvText.innerText = `H ${Math.round(hsv[0])}° • S ${Math.round(hsv[1]*100)}% • V ${Math.round(hsv[2]*100)}%`;
  if(isLive){
    const quick = simpleScore(r,g,b);
    meterFill.style.width = quick + '%';
  } else {
    analyzeAndShow({r,g,b,hsv});
  }
}

// --- Sampling helpers ---
function sampleImagePixels(imgData, maxSamples){
  const pixels = [];
  const data = imgData.data;
  const total = data.length / 4;
  const step = Math.max(1, Math.floor(total / maxSamples));
  for(let i=0;i<total;i+=step){
    const idx = i*4;
    pixels.push([data[idx], data[idx+1], data[idx+2]]);
  }
  return pixels;
}
function averageColor(pixels){
  let r=0,g=0,b=0;
  pixels.forEach(p=>{ r+=p[0]; g+=p[1]; b+=p[2]; });
  const n = Math.max(1, pixels.length);
  return [Math.round(r/n), Math.round(g/n), Math.round(b/n)];
}

// --- K-means small ---
function getDominantColorKMeans(pixels, k=3, iter=8){
  if(!pixels || pixels.length===0) return null;
  const centroids = [];
  for(let i=0;i<k;i++) centroids.push(pixels[Math.floor(Math.random()*pixels.length)].slice());
  for(let it=0; it<iter; it++){
    const clusters = Array.from({length:k}, ()=>({sum:[0,0,0],count:0}));
    for(const p of pixels){
      let best=0, bestd=distanceRgb(p, centroids[0]);
      for(let c=1;c<k;c++){ const d=distanceRgb(p, centroids[c]); if(d<bestd){bestd=d;best=c;} }
      clusters[best].sum[0]+=p[0]; clusters[best].sum[1]+=p[1]; clusters[best].sum[2]+=p[2]; clusters[best].count++;
    }
    let moved=false;
    for(let c=0;c<k;c++){
      if(clusters[c].count===0) continue;
      const nr = Math.round(clusters[c].sum[0]/clusters[c].count);
      const ng = Math.round(clusters[c].sum[1]/clusters[c].count);
      const nb = Math.round(clusters[c].sum[2]/clusters[c].count);
      if(nr !== centroids[c][0] || ng !== centroids[c][1] || nb !== centroids[c][2]){
        moved = true; centroids[c] = [nr,ng,nb];
      }
    }
    if(!moved) break;
  }
  // choose largest cluster
  const counts = new Array(k).fill(0);
  for(const p of pixels){
    let best=0, bestd=distanceRgb(p, centroids[0]);
    for(let c=1;c<k;c++){ const d=distanceRgb(p, centroids[c]); if(d<bestd){bestd=d;best=c;} }
    counts[best]++;
  }
  let maxIdx = 0; for(let i=1;i<k;i++) if(counts[i]>counts[maxIdx]) maxIdx = i;
  return centroids[maxIdx];
}
function distanceRgb(a,b){ const dr=a[0]-b[0], dg=a[1]-b[1], db=a[2]-b[2]; return Math.sqrt(dr*dr+dg*dg+db*db); }

// --- analysis & UI update ---
function analyzeAndShow({r,g,b,hsv}){
  showLoader(true);
  setTimeout(()=> {
    const zone = detectZone(r,g,b,hsv);
    const germ = computeGerminationPercent(r,g,b,zone);
    updateUI(zone,r,g,b,hsv,germ);
    lastReport = { seed: getSeedName(), r,g,b,hsv, zone, germination_percent: germ, timestamp: new Date().toISOString(), lang: langSelect.value || 'en' };
    showLoader(false);
    if(zone==='dry' || zone==='wet') playAlert(zone);
  }, 220);
}

function detectZone(r,g,b,hsv){
  const h = hsv[0], s = hsv[1], v = hsv[2];
  if((h>=260 && h<=320) || (b - r > 45 && b > 110 && s>0.12)) return 'dry'; // purple/violet
  if(r>150 && r - g > 20 && r - b > 15){
    const d = distanceRgb([r,g,b], IDEAL_PINK);
    if(d < 90) return 'good';
  }
  if(b > 150 || g > 150) return 'wet';
  if(h>=300 || h<=30){
    const d = distanceRgb([r,g,b], IDEAL_PINK); if(d<130) return 'good';
  }
  if((h>=180 && h<=260) || (h>=80 && h<=160)) return 'wet';
  return (distanceRgb([r,g,b], IDEAL_PINK) < 140) ? 'good' : 'unknown';
}

function computeGerminationPercent(r,g,b,zone){
  const d = distanceRgb([r,g,b], IDEAL_PINK);
  let base = Math.round(Math.max(0, 100 - d));
  if(zone==='good') base = clamp(base, 60, 98);
  else if(zone==='dry') base = clamp(Math.round(base * 0.55), 12, 75);
  else if(zone==='wet') base = clamp(Math.round(base * 0.45), 10, 70);
  else base = clamp(base, 20, 90);
  return base;
}

function updateUI(zone,r,g,b,hsv,germ){
  const S = LANG[langSelect.value].strings;
  if(zone==='dry'){ badgeText.innerText = S.dry_title; badgeText.style.color = 'var(--bad)'; detectedState.innerText = S.dry_title; adviceText.innerText = S.dry_desc; }
  else if(zone==='good'){ badgeText.innerText = S.good_title; badgeText.style.color = 'var(--good)'; detectedState.innerText = S.good_title; adviceText.innerText = S.good_desc; }
  else if(zone==='wet'){ badgeText.innerText = S.wet_title; badgeText.style.color = '#0b62a3'; detectedState.innerText = S.wet_title; adviceText.innerText = S.wet_desc; }
  else { badgeText.innerText = S.unknown_title; detectedState.innerText = S.unknown_title; adviceText.innerText = S.unknown_desc;}
  percentText.innerText = germ + ' %';
  meterFill.style.width = germ + '%';
  // sprout animation scale
  animateSprout(germ);
}

// --- sprout animation: scale sproutGroup from 0 to 1 based on percent ---
function animateSprout(percent){
  const g = document.getElementById('sproutGroup');
  if(!g) return;
  const scale = 0.2 + (percent/100) * 1.2; // min 0.2 to max ~1.4
  g.setAttribute('transform', `translate(50,120) scale(${scale})`);
}

// --- alert: beep + TTS localized ---
function playAlert(zone){
  ensureAudioContext();
  // beep pattern by zone
  if(zone==='dry'){
    beep(500,220); setTimeout(()=>beep(600,180),260);
  } else if(zone==='wet'){
    beep(900,220); setTimeout(()=>beep(780,180),260);
  } else {
    beep(880,120);
  }
  // TTS in selected alert language
  const L = alertLang.value || 'en';
  const S = LANG[L].strings;
  const text = zone==='dry' ? S.dry_title : (zone==='wet'? S.wet_title : S.good_title);
  speakLocalized(text, L);
}
function beep(freq, dur){ beepImpl(freq, dur); }
function beepImpl(freq, dur){
  try{ ensureAudioContext(); if(!audioCtx) return; const o = audioCtx.createOscillator(); const g = audioCtx.createGain(); o.type='sine'; o.frequency.value=freq; o.connect(g); g.connect(audioCtx.destination); g.gain.setValueAtTime(0.0001, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02); o.start(); setTimeout(()=>{ g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.02); o.stop(audioCtx.currentTime + 0.04); }, dur); }catch(e){ console.warn(e); } }
function speakLocalized(text, langCode){
  try{
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = langCode === 'ml' ? 'ml-IN' : (langCode === 'hi' ? 'hi-IN' : 'en-IN');
    speechSynthesis.cancel(); speechSynthesis.speak(utter);
  }catch(e){ console.warn('speak failed', e); }
}

// --- manual TTS speak button ---
speakBtn.addEventListener('click', ()=> {
  if(!lastReport) return alert('No reading');
  const L = alertLang.value || langSelect.value;
  const S = LANG[L].strings;
  const title = lastReport.zone === 'good' ? S.good_title : (lastReport.zone === 'dry' ? S.dry_title : (lastReport.zone === 'wet' ? S.wet_title : S.unknown_title));
  speakLocalized(title, alertLang.value);
});

// --- enable audio button (user gesture to resume audio) ---
enableAudio.addEventListener('click', ()=>{
  ensureAudioContext();
  if(audioCtx && audioCtx.state==='suspended') audioCtx.resume();
  // play a small confirm tone
  beep(880,90);
  enableAudio.innerText = LANG[langSelect.value].strings ? LANG[langSelect.value].strings.audio_enabled || 'Audio Enabled' : 'Audio Enabled';
});

// --- Save & history ---
saveBtn.addEventListener('click', ()=> {
  if(!lastReport) return alert(LANG[langSelect.value].strings.no_report || 'No report');
  const arr = JSON.parse(localStorage.getItem('ss-history')||'[]');
  arr.unshift(lastReport);
  localStorage.setItem('ss-history', JSON.stringify(arr.slice(0,200)));
  renderHistory();
  alert(LANG[langSelect.value].strings.saved || 'Saved');
});
function renderHistory(){
  const arr = JSON.parse(localStorage.getItem('ss-history')||'[]');
  historyEl.innerHTML = '';
  arr.forEach(r=>{
    const d = document.createElement('div'); d.className='hist-item';
    d.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><div><strong>${r.seed}</strong><div class="small">${new Date(r.timestamp).toLocaleString()}</div></div><div style="text-align:right"><div>${r.germination_percent}%</div><div class="small">${r.zone}</div></div></div>`;
    d.addEventListener('click', ()=> { lastReport=r; updateUI(r.zone,r.r,r.g,r.b,r.hsv,r.germination_percent); swatch.style.background = `rgb(${r.r},${r.g},${r.b})`; });
    historyEl.appendChild(d);
  });
}
renderHistory();

// --- Report download: open printable window & call print (user can Save as PDF) ---
downloadBtn.addEventListener('click', ()=> {
  if(!lastReport) return alert(LANG[langSelect.value].strings.no_report || 'No report');
  openPrintWindow(lastReport);
});
function openPrintWindow(report){
  const L = report.lang || langSelect.value;
  const S = LANG[L].strings;
  const html = `
  <html><head><title>${S.title} — Report</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;padding:18px;color:#222}
    h1{color:#1e7f3f}
    .row{display:flex;gap:10px}
    .box{border:1px solid #ddd;padding:10px;border-radius:8px;margin-top:10px}
  </style>
  </head><body>
  <h1>${S.title} — ${S.download}</h1>
  <div class="box">
    <div><strong>${S.seed_label}:</strong> ${report.seed}</div>
    <div><strong>Timestamp:</strong> ${new Date(report.timestamp).toLocaleString()}</div>
    <div><strong>Zone:</strong> ${report.zone}</div>
    <div><strong>Germination %:</strong> ${report.germination_percent}%</div>
    <div><strong>RGB:</strong> ${report.r}, ${report.g}, ${report.b}</div>
    <div style="margin-top:12px"><strong>Advice:</strong> ${S[report.zone + '_desc'] || ''}</div>
  </div>
  <script>window.onload = ()=>{ setTimeout(()=>{ window.print(); }, 500); }</script>
  </body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

// --- helpers ---
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function rgbToHsv(r,g,b){ r/=255; g/=255; b/=255; const max=Math.max(r,g,b), min=Math.min(r,g,b); let h=0, s=0, v=max; const d=max-min; s=max===0?0:d/max; if(max!==min){ switch(max){ case r: h=(g-b)/d + (g<b?6:0); break; case g: h=(b-r)/d + 2; break; case b: h=(r-g)/d + 4; break; } h/=6; h*=360; } return [h,s,v]; }

// --- simple quick score for live preview ---
function simpleScore(r,g,b){
  if(b < 100) return 40;
  if(b > 170) return 55;
  return 80;
}

// --- distance ---
function distanceRgb(a,b){ const dr=a[0]-b[0], dg=a[1]-b[1], db=a[2]-b[2]; return Math.sqrt(dr*dr+dg*dg+db*db); }

// --- get seed name ---
function getSeedName(){ return seedSelect.value === 'custom' && customName.value.trim() ? customName.value.trim() : seedSelect.value; }

// --- utility: show loader (not used heavily) ---
function showLoader(on){ if(on) loader.style.display='inline-block'; else loader.style.display='none'; }

// --- reset UI ---
function clearAll(){
  lastReport = null;
  swatch.style.background = '#fff';
  rgbText.innerText = 'R - G - B';
  hsvText.innerText = '';
  badgeText.innerText = '--';
  detectedState.innerText = LANG[langSelect.value].strings.waiting;
  percentText.innerText = '-- %';
  meterFill.style.width = '0%';
  adviceText.innerText = '';
}
resetBtn.addEventListener('click', clearAll);

// --- capture manual ---
captureBtn.addEventListener('click', ()=> sampleFrame(false));

// --- unlo