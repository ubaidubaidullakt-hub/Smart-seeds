/* script.js - final version per your spec (rear camera only, manual scan, beep + male TTS V-G2, G1 meter) */

/* ---------- CONFIG ---------- */
const IDEAL_PINK = [200,100,140]; // calibrate later with real strips
const SAMPLE_PIXEL_COUNT = 400;   // sample count for averaging

/* ---------- DOM ---------- */
const langSelect = document.getElementById('langSelect');
const alertLang = document.getElementById('alertLang');
const deviceSelect = document.getElementById('deviceSelect');
const themeToggle = document.getElementById('themeToggle');

const openCam = document.getElementById('openCam');
const scanBtn = document.getElementById('scanBtn');
const resetBtn = document.getElementById('resetBtn');
const enableAudio = document.getElementById('enableAudio');

const video = document.getElementById('video');
const swatch = document.getElementById('swatch');
const rgbText = document.getElementById('rgbText');
const hsvText = document.getElementById('hsvText');
const cameraNote = document.getElementById('cameraNote');

const detectedState = document.getElementById('detectedState');
const statusBadge = document.getElementById('statusBadge');
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

/* ---------- STATE ---------- */
let LANG = null;
let stream = null;
let audioCtx = null;
let lastReport = null;

/* ---------- LOAD languages.json ---------- */
fetch('languages.json').then(r=>r.json()).then(js => {
  LANG = js;
  populateLangSelector();
  applyLanguage();
}).catch(e => {
  console.error('Failed to load languages.json', e);
});

/* ---------- populate language selector ---------- */
function populateLangSelector(){
  const keys = Object.keys(LANG);
  langSelect.innerHTML = '';
  keys.forEach(k=>{
    const opt = document.createElement('option'); opt.value = k; opt.innerText = LANG[k].ui_lang_name || k;
    langSelect.appendChild(opt);
  });
  // default en
  langSelect.value = 'en';
  // alertLang sync
  alertLang.value = 'en';
}

/* ---------- apply language to UI (full) ---------- */
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
  scanBtn.innerText = S.capture;
  resetBtn.innerText = S.reset;
  saveBtn.innerText = S.save;
  downloadBtn.innerText = S.download;
  speakBtn.innerText = S.speak;
  customName.placeholder = S.custom_placeholder || '';
  detectedState.innerText = S.waiting;
  statusBadge.innerText = '--';
  adviceText.innerText = '';
}
langSelect.addEventListener('change', ()=> { applyLanguage(); });

/* ---------- enumerate cameras and prefer rear camera ---------- */
async function enumerateDevicesPreferRear(){
  try{
    const list = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = list.filter(d=>d.kind === 'videoinput');
    deviceSelect.innerHTML = '';
    // try to select device whose label includes 'back' or 'rear' or 'environment'
    let rearFound = null;
    videoDevices.forEach(d=>{
      const label = d.label || d.deviceId;
      const opt = document.createElement('option'); opt.value = d.deviceId; opt.innerText = label;
      deviceSelect.appendChild(opt);
      if(/back|rear|environment/i.test(label)) rearFound = d.deviceId;
    });
    if(videoDevices.length > 0){
      deviceSelect.style.display = 'inline-block';
      // if rear found select it
      if(rearFound) deviceSelect.value = rearFound;
    } else {
      deviceSelect.style.display = 'none';
    }
  }catch(e){
    console.warn('enumerateDevices failed', e);
    deviceSelect.style.display = 'none';
  }
}
enumerateDevicesPreferRear();

/* ---------- audio context unlock ---------- */
function ensureAudio(){
  try{
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(audioCtx.state === 'suspended') audioCtx.resume();
  }catch(e){
    console.warn('AudioContext not available', e);
  }
}
enableAudio.addEventListener('click', ()=>{
  ensureAudio();
  beep(880,90);
  enableAudio.innerText = (LANG && LANG[langSelect.value] && LANG[langSelect.value].strings.audio_enabled) ? LANG[langSelect.value].strings.audio_enabled : 'Audio Enabled';
});

/* ---------- beep generator ---------- */
function beep(freq=700, duration=180){
  try{
    ensureAudio();
    if(!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    o.connect(g); g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
    o.start();
    setTimeout(()=> {
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.02);
      o.stop(audioCtx.currentTime + 0.04);
    }, duration);
  }catch(e){ console.warn('beep error', e); }
}

/* ---------- male-voice TTS (best-effort) ---------- */
async function speakMale(text, langCode){
  // find a "male" voice if available; else use fallback voice and lower pitch
  try{
    const voices = speechSynthesis.getVoices();
    // pick voice matching langCode then try to prefer voices with male indicators
    function chooseVoiceFor(langCode){
      const candidates = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith(langCode.split('-')[0]));
      // prefer voices with some male-like names
      const maleKeywords = ['male','google uk male','david','mark','man','thomas','raj'];
      for(const k of maleKeywords){
        const f = candidates.find(v => v.name.toLowerCase().includes(k));
        if(f) return f;
      }
      // else return first candidate
      return candidates.length ? candidates[0] : null;
    }

    let voice = chooseVoiceFor(langCode);
    if(!voice){
      // try any male-sounding voice in system
      const male = voices.find(v => /male/i.test(v.name));
      if(male) voice = male;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = langCode;
    // if we found a voice, assign
    if(voice) u.voice = voice;
    // lower pitch to sound more male if voice unspecified or if voice is female
    u.pitch = 0.8;
    u.rate = 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }catch(e){
    console.warn('TTS error', e);
  }
}

/* ---------- open rear camera only (preferred) ---------- */
async function openRearCamera(){
  closeStream();
  cameraNote.innerText = '';
  // choose device from deviceSelect if available, else requesting environment facingMode
  try{
    let constraints;
    if(deviceSelect && deviceSelect.value){
      constraints = { video: { deviceId: { exact: deviceSelect.value }, width:{ideal:1280}, height:{ideal:720} } };
    } else {
      // prefer environment (rear)
      constraints = { video: { facingMode: { ideal: 'environment' }, width:{ideal:1280}, height:{ideal:720} } };
    }
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    // ensure we are not opening front camera: check track settings facingMode
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings ? track.getSettings() : {};
    if(settings.facingMode && settings.facingMode.toLowerCase().includes('user')){
      cameraNote.innerText = 'Rear camera unavailable; device opened default camera. Try selecting another camera if available.';
    } else {
      cameraNote.innerText = '';
    }
    video.srcObject = stream;
    await video.play().catch(()=>{});
    enumerateDevicesPreferRear();
  }catch(e){
    console.warn('openRearCamera failed', e);
    cameraNote.innerText = 'Cannot open rear camera. Check permission or try another browser.';
    // fallback: try any video (still avoid front explicitly) - but we try just video:true as last attempt
    try{
      stream = await navigator.mediaDevices.getUserMedia({ video:true });
      video.srcObject = stream; await video.play().catch(()=>{});
    }catch(err){
      cameraNote.innerText = 'Camera not available. Allow camera permission.';
    }
  }
}
openCam.addEventListener('click', ()=> openRearCamera());

/* ---------- close stream ---------- */
function closeStream(){
  if(stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
}

/* ---------- sampling and detection (manual scan only) ---------- */
const tmpCanvas = document.createElement('canvas');
scanBtn.addEventListener('click', ()=> performScan());

function performScan(){
  if(!stream){ alert((LANG && LANG[langSelect.value]) ? LANG[langSelect.value].strings.open_camera_msg || 'Open camera first' : 'Open camera first'); return; }
  const vw = video.videoWidth, vh = video.videoHeight;
  if(!vw || !vh){ alert('Camera not ready'); return; }
  // center crop area ~28%
  const cropW = Math.floor(vw * 0.28);
  const cropH = Math.floor(vh * 0.28);
  const sx = Math.floor((vw - cropW)/2);
  const sy = Math.floor((vh - cropH)/2);
  tmpCanvas.width = cropW; tmpCanvas.height = cropH;
  const ctx = tmpCanvas.getContext('2d');
  try{ ctx.drawImage(video, sx, sy, cropW, cropH, 0,0,cropW,cropH); } catch(e){ console.warn('draw failed', e); return; }
  const img = ctx.getImageData(0,0,cropW,cropH);
  const pixels = sampleImagePixels(img, SAMPLE_PIXEL_COUNT);
  let dominant = null;
  try{ dominant = kmeansDominant(pixels,3); }catch(e){ dominant = null; }
  if(!dominant) dominant = averageColor(pixels);
  const [r,g,b] = dominant;
  swatch.style.background = `rgb(${r},${g},${b})`;
  rgbText.innerText = `R ${r} • G ${g} • B ${b}`;
  const hsv = rgbToHsv(r,g,b);
  hsvText.innerText = `H ${Math.round(hsv[0])}° • S ${Math.round(hsv[1]*100)}% • V ${Math.round(hsv[2]*100)}%`;

  // analyze (mapping to zones per your mapping)
  const zone = detectZone(r,g,b,hsv);
  const germ = computeGerminationPercent(r,g,b,zone);
  updateUI(zone,r,g,b,hsv,germ);
  lastReport = { seed: getSeedName(), r,g,b,hsv, zone, germination_percent: germ, timestamp: new Date().toISOString(), lang: langSelect.value };
  // beep then speak (male)
  beepForZone(zone);
  const alertL = alertLang.value || langSelect.value || 'en';
  setTimeout(()=> speakMaleForZone(zone, alertL), 350);
}

/* ---------- pixel sampling helpers ---------- */
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

/* ---------- simple kmeans (small) ---------- */
function kmeansDominant(pixels,k=3,iter=7){
  if(!pixels || pixels.length===0) return null;
  const centroids = [];
  for(let i=0;i<k;i++) centroids.push(pixels[Math.floor(Math.random()*pixels.length)].slice());
  for(let it=0; it<iter; it++){
    const clusters = Array.from({length:k}, ()=>({sum:[0,0,0],count:0}));
    for(const p of pixels){
      let best=0, bestd=distRgb(p,centroids[0]);
      for(let c=1;c<k;c++){ const d = distRgb(p,centroids[c]); if(d < bestd){ bestd = d; best = c; } }
      clusters[best].sum[0]+=p[0]; clusters[best].sum[1]+=p[1]; clusters[best].sum[2]+=p[2]; clusters[best].count++;
    }
    let moved=false;
    for(let c=0;c<k;c++){
      if(clusters[c].count===0) continue;
      const nr = Math.round(clusters[c].sum[0]/clusters[c].count);
      const ng = Math.round(clusters[c].sum[1]/clusters[c].count);
      const nb = Math.round(clusters[c].sum[2]/clusters[c].count);
      if(nr !== centroids[c][0] || ng !== centroids[c][1] || nb !== centroids[c][2]){ moved=true; centroids[c]=[nr,ng,nb]; }
    }
    if(!moved) break;
  }
  // choose largest cluster
  const counts = new Array(k).fill(0);
  for(const p of pixels){
    let best=0, bestd=distRgb(p, centroids[0]);
    for(let c=1;c<k;c++){ const d = distRgb(p,centroids[c]); if(d<bestd){ bestd=d; best=c; } }
    counts[best]++;
  }
  let maxIdx = 0; for(let i=1;i<k;i++) if(counts[i] > counts[maxIdx]) maxIdx = i;
  return centroids[maxIdx];
}
function distRgb(a,b){ const dr=a[0]-b[0], dg=a[1]-b[1], db=a[2]-b[2]; return Math.sqrt(dr*dr + dg*dg + db*db); }

/* ---------- detection & mapping ---------- */
function detectZone(r,g,b,hsv){
  const h = hsv[0], s = hsv[1], v = hsv[2];
  // dry (purple/violet)
  if((h >= 260 && h <= 320) || (b - r > 45 && b > 110 && s>0.12)) return 'dry';
  // good (pink)
  if(r > 150 && r - g > 20 && r - b > 15){
    const d = distRgb([r,g,b], IDEAL_PINK);
    if(d < 90) return 'good';
  }
  // wet (blue/green)
  if(b > 150 || g > 150) return 'wet';
  if(h >= 300 || h <= 30){
    const d = distRgb([r,g,b], IDEAL_PINK); if(d < 130) return 'good';
  }
  if((h>=180 && h<=260) || (h>=80 && h<=160)) return 'wet';
  return (distRgb([r,g,b], IDEAL_PINK) < 140) ? 'good' : 'unknown';
}

function computeGerminationPercent(r,g,b,zone){
  const d = distRgb([r,g,b], IDEAL_PINK);
  let base = Math.round(Math.max(0, 100 - d));
  if(zone === 'good') base = clamp(base, 60, 98);
  else if(zone === 'dry') base = clamp(Math.round(base * 0.55), 12, 75);
  else if(zone === 'wet') base = clamp(Math.round(base * 0.45), 10, 70);
  else base = clamp(base, 20, 90);
  return base;
}

/* ---------- UI updates & animate germination bar ---------- */
function updateUI(zone,r,g,b,hsv,germ){
  const L = LANG[langSelect.value].strings;
  if(zone === 'dry'){ statusBadge.innerText = L.dry_title; statusBadge.style.color = 'var(--bad)'; detectedState.innerText = L.dry_title; adviceText.innerText = L.dry_desc; }
  else if(zone === 'good'){ statusBadge.innerText = L.good_title; statusBadge.style.color = 'var(--good)'; detectedState.innerText = L.good_title; adviceText.innerText = L.good_desc; }
  else if(zone === 'wet'){ statusBadge.innerText = L.wet_title; statusBadge.style.color = '#0b62a3'; detectedState.innerText = L.wet_title; adviceText.innerText = L.wet_desc; }
  else { statusBadge.innerText = L.unknown_title; detectedState.innerText = L.unknown_title; adviceText.innerText = L.unknown_desc; }
  percentText.innerText = germ + ' %';
  meterFill.style.width = germ + '%';
  // change color by zone
  if(zone==='good') meterFill.style.background = 'linear-gradient(90deg,#8ef07a,#1e7f3f)';
  else if(zone==='dry') meterFill.style.background = 'linear-gradient(90deg,#ffb677,#ff6b6b)';
  else if(zone==='wet') meterFill.style.background = 'linear-gradient(90deg,#7ab9ff,#3b82f6)';
  else meterFill.style.background = 'linear-gradient(90deg,#ddd,#aaa)';
}

/* ---------- beep pattern then TTS ---------- */
function beepForZone(zone){
  ensureAudio();
  if(zone === 'dry'){ beep(480,200); setTimeout(()=>beep(560,160),260); }
  else if(zone === 'wet'){ beep(920,200); setTimeout(()=>beep(760,160),260); }
  else { beep(880,120); }
}
function speakMaleForZone(zone, alertLangCode){
  const S = LANG[alertLangCode].strings;
  let text;
  if(zone === 'dry') text = S.dry_title + '. ' + S.dry_desc;
  else if(zone === 'good') text = S.good_title + '. ' + S.good_desc;
  else if(zone === 'wet') text = S.wet_title + '. ' + S.wet_desc;
  else text = S.unknown_title;
  // try to pick a male voice; fallback to lower pitch
  pickMaleVoiceAndSpeak(text, alertLangCode);
}

/* ---------- select male voice if possible, else default + lower pitch ---------- */
function pickMaleVoiceAndSpeak(text, langCode){
  // ensure voices loaded
  const speakNow = (voices) => {
    let voice = null;
    // try voices matching langCode
    const candidates = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith(langCode.split('-')[0]));
    // male preference keywords
    const maleKeywords = ['male','google uk male','david','mark','man','thomas','raj','deep','arjun'];
    for(const k of maleKeywords){
      const found = candidates.find(v=> v.name && v.name.toLowerCase().includes(k));
      if(found){ voice = found; break; }
    }
    if(!voice && candidates.length) voice = candidates[0];
    const u = new SpeechSynthesisUtterance(text);
    u.lang = (langCode === 'ml' ? 'ml-IN' : (langCode === 'hi' ? 'hi-IN' : 'en-IN'));
    if(voice) u.voice = voice;
    u.pitch = 0.8; u.rate = 1;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  };

  const voices = speechSynthesis.getVoices();
  if(voices.length) speakNow(voices);
  else {
    // voices not loaded yet: wait for event
    speechSynthesis.onvoiceschanged = ()=> {
      const v2 = speechSynthesis.getVoices();
      speakNow(v2);
      speechSynthesis.onvoiceschanged = null;
    };
  }
}

/* ---------- Save, history, download report ---------- */
saveBtn.addEventListener('click', ()=> {
  if(!lastReport) return alert(LANG[langSelect.value].strings.no_report);
  const arr = JSON.parse(localStorage.getItem('ss-history')||'[]');
  arr.unshift(lastReport);
  localStorage.setItem('ss-history', JSON.stringify(arr.slice(0,200)));
  renderHistory();
  alert(LANG[langSelect.value].strings.saved);
});
function renderHistory(){
  const arr = JSON.parse(localStorage.getItem('ss-history')||'[]');
  historyEl.innerHTML = '';
  arr.forEach(r=>{
    const d = document.createElement('div'); d.className='hist-item';
    d.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><div><strong>${r.seed}</strong><div class="small">${new Date(r.timestamp).toLocaleString()}</div></div><div style="text-align:right"><div>${r.germination_percent}%</div><div class="small">${r.zone}</div></div></div>`;
    d.addEventListener('click', ()=> { lastReport = r; updateUI(r.zone,r.r,r.g,r.b,r.hsv,r.germination_percent); swatch.style.background = `rgb(${r.r},${r.g},${r.b})`; });
    historyEl.appendChild(d);
  });
}
renderHistory();

downloadBtn.addEventListener('click', ()=> {
  if(!lastReport) return alert(LANG[langSelect.value].strings.no_report);
  openPrintWindow(lastReport);
});
function openPrintWindow(report){
  const L = report.lang || langSelect.value;
  const S = LANG[L].strings;
  const html = `
  <html><head><title>${S.title} — Report</title>
  <style>body{font-family:Arial;padding:18px;color:#222}h1{color:#1e7f3f}</style></head>
  <body><h1>${S.title} — ${S.download}</h1>
  <div><strong>${S.seed_label}:</strong> ${report.seed}</div>
  <div><strong>Timestamp:</strong> ${new Date(report.timestamp).toLocaleString()}</div>
  <div><strong>Zone:</strong> ${report.zone}</div>
  <div><strong>Germination %:</strong> ${report.germination_percent}%</div>
  <div><strong>RGB:</strong> ${report.r}, ${report.g}, ${report.b}</div>
  <div style="margin-top:12px"><strong>Advice:</strong> ${S[report.zone + '_desc'] || ''}</div>
  <script>window.onload=()=>{ setTimeout(()=>{ window.print(); },400); }</script></body></html>`;
  const w = window.open('', '_blank'); w.document.write(html); w.document.