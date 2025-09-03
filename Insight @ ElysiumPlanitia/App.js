import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/* -------------------------------------------------------------------------- */
/*                              Assets & fallbacks                             */
/* -------------------------------------------------------------------------- */

const GLB_CANDIDATES = [];
try {
  GLB_CANDIDATES.push(new URL("./24881_Mars_1_6792.glb", import.meta.url).href);
} catch {}
GLB_CANDIDATES.push("/src/24881_Mars_1_6792.glb");

/* -------------------------------- Utilities -------------------------------- */

const clamp01 = (v) => Math.max(0, Math.min(1, v));
function lerp(a, b, t) { return a + (b - a) * t; }
function lerp3(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }
const RAMP = [[0,[0,180,255]],[.35,[0,255,255]],[.70,[255,0,255]],[1,[255,255,255]]];
function rampRGB(v01){const v=clamp01(v01);for(let i=0;i<RAMP.length-1;i++){const[t0,c0]=RAMP[i],[t1,c1]=RAMP[i+1];if(v<=t1){const t=(v-t0)/(t1-t0);return lerp3(c0,c1,t)}}return RAMP.at(-1)[1]}
function rgbStr([r,g,b]){return`rgb(${r|0},${g|0},${b|0})`}
function hash(x,y){const s=Math.sin(x*127.1+y*311.7)*43758.5453123;return s-Math.floor(s)}
function noise2D(x,y){const xi=Math.floor(x),yi=Math.floor(y);const xf=x-xi,yf=y-yi;const tl=hash(xi,yi),tr=hash(xi+1,yi),bl=hash(xi,yi+1),br=hash(xi+1,yi+1);const u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);const top=tl*(1-u)+tr*u,bot=bl*(1-u)+br*u;return top*(1-v)+bot*v}
function fbm(x,y){let v=0,a=.5,f=1;for(let i=0;i<4;i++){v+=a*noise2D(x*f,y*f);a*=.5;f*=2}return v}
function meanToDegFromBins(WD){if(!WD)return null;let sx=0,sy=0,total=0;for(const k in WD){if(k==="most_common")continue;const b=WD[k];if(!b||typeof b.ct!=="number"||typeof b.compass_degrees!=="number")continue;const to=(b.compass_degrees+180)%360;const rad=(90-to)*Math.PI/180;sx+=Math.cos(rad)*b.ct;sy+=Math.sin(rad)*b.ct;total+=b.ct}if(total<=0)return null;const ang=Math.atan2(sy,sx);return(90-ang*180/Math.PI+360)%360}
function makeMarkerSprite(label="InSight",fill="#ff4d6d"){const size=128,c=document.createElement("canvas");c.width=size;c.height=size;const g=c.getContext("2d");g.beginPath();g.arc(size/2,size/2,34,0,Math.PI*2);g.fillStyle="rgba(255,77,109,0.16)";g.fill();g.beginPath();g.arc(size/2,size/2,18,0,Math.PI*2);g.fillStyle=fill;g.fill();g.lineWidth=3;g.strokeStyle="#fff";g.stroke();g.font="bold 24px system-ui, sans-serif";g.fillStyle="#fff";g.textAlign="center";g.textBaseline="top";g.fillText(label,size/2,size/2+24);const tex=new THREE.CanvasTexture(c);const mat=new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false});const s=new THREE.Sprite(mat);s.scale.set(0.18,0.18,1);return s}
function latLonToUV(lat,lonE,{west,east,south,north}){const u=(lonE-west)/(east-west),v=1-(lat-south)/(north-south);return{u:Math.max(0,Math.min(1,u)),v:Math.max(0,Math.min(1,v))}}
function latLonToVec3(lat,lonE,r=1){const phi=THREE.MathUtils.degToRad(90-lat);const theta=THREE.MathUtils.degToRad(lonE-180);const x=r*Math.sin(phi)*Math.cos(theta),y=r*Math.cos(phi),z=r*Math.sin(phi)*Math.sin(theta);return new THREE.Vector3(x,y,z)}

/* --------------------------------- Mock ----------------------------------- */

const MOCK={sol_keys:["778","779","780"],
"778":{Season:"summer",First_UTC:"2021-07-26T00:00:00Z",Last_UTC:"2021-07-26T23:59:59Z",AT:{av:-56.7},PRE:{av:720.1},HWS:{av:5.2},WD:{most_common:{compass_point:"E",compass_degrees:90},N:{ct:2,compass_degrees:0},NE:{ct:5,compass_degrees:45},E:{ct:10,compass_degrees:90},SE:{ct:7,compass_degrees:135}}},
"779":{Season:"summer",First_UTC:"2021-07-27T00:00:00Z",Last_UTC:"2021-07-27T23:59:59Z",AT:{av:-58.1},PRE:{av:718.8},HWS:{av:7.0},WD:{most_common:{compass_point:"ENE",compass_degrees:67.5},N:{ct:1,compass_degrees:0},ENE:{ct:12,compass_degrees:67.5},E:{ct:6,compass_degrees:90},SE:{ct:3,compass_degrees:135}}},
"780":{Season:"summer",First_UTC:"2021-07-28T00:00:00Z",Last_UTC:"2021-07-28T23:59:59Z",AT:{av:-59.4},PRE:{av:719.2},HWS:{av:9.3},WD:{most_common:{compass_point:"ESE",compass_degrees:112.5},NE:{ct:3,compass_degrees:45},E:{ct:6,compass_degrees:90},ESE:{ct:10,compass_degrees:112.5},SE:{ct:6,compass_degrees:135}}}};

function mergeFeeds(oldF={},freshF={},limit=60){
  const ok=Array.isArray(oldF.sol_keys)?oldF.sol_keys:[]; const fk=Array.isArray(freshF.sol_keys)?freshF.sol_keys:[];
  const all=Array.from(new Set([...ok,...fk])).sort((a,b)=>+a-+b);
  const keep=all.slice(-limit); const out={sol_keys:keep};
  keep.forEach(k=>{out[k]=freshF[k]??oldF[k]});
  ["validity_checks","source","sols_checked"].forEach(k=>{if(freshF[k]!=null)out[k]=freshF[k];else if(oldF[k]!=null)out[k]=oldF[k]});
  return out;
}

/* --------------------------------- App ------------------------------------ */

function InSightWindStation({
  apiKey="DEMO_KEY",
  cacheTtlMs=10*60*1000,
  historyLimit=60,
  elysiumTextureUrl="https://upload.wikimedia.org/wikipedia/commons/c/c9/Elysium_Planitia_%28MOLA%29.jpg",
  marsTextureUrl="https://upload.wikimedia.org/wikipedia/commons/4/46/Solarsystemscope_texture_2k_mars.jpg",
  className=""
}){
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(null);
  const [data,setData]=useState(null);
  const [selectedSol,setSelectedSol]=useState(null);
  const [viewMode,setViewMode]=useState("globe"); // "globe" | "map"
  const [reducedMotion,setReducedMotion]=useState(false);
  const [usingMock,setUsingMock]=useState(false);

  // Audio
  const [soundOn,setSoundOn]=useState(false);
  const [audioPlayable,setAudioPlayable]=useState(true);
  const [audioError,setAudioError]=useState("");
  const [useAudioForWind,setUseAudioForWind]=useState(true); // audio -> speed only
  const [audioFileName,setAudioFileName]=useState("");

  const audioRef=useRef(null);
  const audioCtxRef=useRef(null);
  const analyserRef=useRef(null);
  const freqBufRef=useRef(null);
  const timeBufRef=useRef(null);
  const audioObjectUrlRef=useRef(null);
  const fileInputRef=useRef(null);

  const audioStateRef=useRef({vol:1,rate:1}); // keep for future UI
  const audioWindRef=useRef({active:false,speed:0});

  useEffect(()=>{const mq=window.matchMedia?.("(prefers-reduced-motion: reduce)");const apply=()=>setReducedMotion(!!mq?.matches);apply();mq?.addEventListener?.("change",apply);return()=>mq?.removeEventListener?.("change",apply)},[]);

  // ---------- API + cache ----------
  const API=useMemo(()=>`https://api.nasa.gov/insight_weather/?api_key=${apiKey}&feedtype=json&ver=1.0`,[apiKey]);
  const CACHE_KEY=useMemo(()=>`insight_wind_cache_v11_${apiKey}`,[apiKey]);
  const loadCache=useCallback(()=>{try{const raw=localStorage.getItem(CACHE_KEY); if(!raw) return null; const{ts,payload}=JSON.parse(raw); if(Date.now()-ts<cacheTtlMs) return payload;}catch{} return null;},[CACHE_KEY,cacheTtlMs]);
  const saveCache=useCallback((payload)=>{try{localStorage.setItem(CACHE_KEY,JSON.stringify({ts:Date.now(),payload}))}catch{}},[CACHE_KEY]);

  const fetchControllerRef=useRef(null);
  const refetch=useCallback(async()=>{
    setLoading(true); setError(null); setUsingMock(false);
    try{ fetchControllerRef.current?.abort?.(); }catch{}
    const ctrl=new AbortController(); fetchControllerRef.current=ctrl;

    const cached=loadCache();
    if(cached){ setData(cached); setSelectedSol((cached.sol_keys||[]).slice(-1)[0]||null); setLoading(false); }

    try{
      const r=await fetch(API,{signal:ctrl.signal,mode:"cors",cache:"no-store"});
      if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const j=await r.json();
      const merged=mergeFeeds(cached||{},j,historyLimit);
      saveCache(merged); setData(merged); setSelectedSol((merged.sol_keys||[]).slice(-1)[0]||null);
    }catch(e){
      if(!cached){ setError(e?.message||"Failed to load data (using demo)"); setData(MOCK); setSelectedSol("780"); setUsingMock(true); }
    }finally{ setLoading(false); }
  },[API,loadCache,saveCache,historyLimit]);
  useEffect(()=>{ refetch(); return()=>{ try{fetchControllerRef.current?.abort?.()}catch{} }},[refetch]);
  const clearCacheAndRefresh=useCallback(()=>{try{localStorage.removeItem(CACHE_KEY)}catch{} refetch()},[CACHE_KEY,refetch]);

  // ---- derived values for HUD/UI ----
  const sd = data && selectedSol ? data[selectedSol] : null;
  const windSpeed = sd?.HWS?.av ?? 0;
  const toDegHUD = useMemo(() => {
    const m = meanToDegFromBins(sd?.WD);
    if (m != null) return m;
    const f = sd?.WD?.most_common?.compass_degrees;
    return typeof f === "number" ? (f + 180) % 360 : null;
  }, [sd]);
  const sols = useMemo(() => data?.sol_keys || [], [data]);

  // wind for 3D (avoid re-init on sol change)
  const windRef = useRef({ speed: 0, toDeg: null });
  useEffect(() => {
    const m = meanToDegFromBins(sd?.WD);
    const to = m != null
      ? m
      : (typeof sd?.WD?.most_common?.compass_degrees === "number"
          ? (sd.WD.most_common.compass_degrees + 180) % 360
          : null);
    windRef.current = { speed: sd?.HWS?.av ?? 0, toDeg: to };
  }, [sd]);

  /* ----------------------------- audio wiring ----------------------------- */

  const setupAnalyser = useCallback(() => {
    try{
      const el = audioRef.current; if(!el) return;
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtxRef.current;

      try { analyserRef.current?.disconnect(); } catch {}
      const src = ctx.createMediaElementSource(el);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;
      src.connect(analyser);
      analyser.connect(ctx.destination);

      analyserRef.current = analyser;
      freqBufRef.current = new Uint8Array(analyser.frequencyBinCount);
      timeBufRef.current = new Uint8Array(analyser.fftSize);
      setAudioPlayable(true);
      setAudioError("");
    }catch(e){
      setAudioPlayable(false);
      setAudioError("Audio graph error");
    }
  }, []);

  const handleUpload = useCallback((e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (audioObjectUrlRef.current) { try{ URL.revokeObjectURL(audioObjectUrlRef.current) }catch{} audioObjectUrlRef.current=null; }
    const url = URL.createObjectURL(f);
    audioObjectUrlRef.current = url;
    const el = audioRef.current; if (!el) return;
    el.src = url;
    el.loop = true;
    el.preload = "auto";
    el.volume = 1;           // play audibly
    el.playbackRate = 1;
    el.muted = false;
    setAudioFileName(f.name);
    setupAnalyser();
    setAudioPlayable(true);
    setAudioError("");
  }, [setupAnalyser]);

  const kickAudio = async () => {
    const el = audioRef.current; if(!el) return;
    try {
      if (!audioCtxRef.current) setupAnalyser();
      await audioCtxRef.current.resume?.();
      el.muted = false;
      el.volume = 1;         // ensure full volume
      if (el.paused) { el.currentTime=0; await el.play(); }
      setAudioError("");
    } catch {
      setAudioError("Click 🔊 to allow playback.");
    }
  };

  /* --------------------------------- Globe --------------------------------- */

  const globeCanvasRef=useRef(null), globeCleanupRef=useRef(null);
  useEffect(()=>{
    if(viewMode!=="globe"){ globeCleanupRef.current?.(); globeCleanupRef.current=null; return; }
    const canvas=globeCanvasRef.current; if(!canvas) return;

    const scene=new THREE.Scene();
    const camera=new THREE.PerspectiveCamera(45,1,.1,500); camera.position.set(0,0,4.2);
    const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:"high-performance"});
    renderer.setClearColor(0x0b0f14,1);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));

    const ensure=()=>{const w=canvas.clientWidth||canvas.parentElement?.clientWidth||640,h=canvas.clientHeight||canvas.parentElement?.clientHeight||480; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix();};
    ensure(); const ro=new ResizeObserver(ensure); ro.observe(canvas);

    scene.add(new THREE.AmbientLight(0xffffff,.65)); const dir=new THREE.DirectionalLight(0xffffff,.65); dir.position.set(6,10,6); scene.add(dir);

    const R=1.5;
    const planetGroup=new THREE.Group(); scene.add(planetGroup);

    function makeTextLabel(text){const size=256,pad=16,c=document.createElement("canvas");c.width=size;c.height=size;const g=c.getContext("2d");g.font="bold 24px system-ui, sans-serif";const tw=g.measureText(text).width;const w=Math.min(size,tw+pad*2),h=44,x=(size-w)/2,y=(size-h)/2;g.clearRect(0,0,size,size);g.fillStyle="rgba(2,6,23,.75)";g.strokeStyle="#1f2937";g.lineWidth=2;if(g.roundRect)g.roundRect(x,y,w,h,10);else g.rect(x,y,w,h);g.fill();g.stroke();g.fillStyle="#e5e7eb";g.textAlign="center";g.textBaseline="middle";g.fillText(text,size/2,size/2);const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;const mat=new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false});const s=new THREE.Sprite(mat);s.scale.set(.9,.9,1);return s}

    const LOCATIONS=[{id:"elysium",name:"Elysium Planitia",lat:4.5,lonE:135.9,wiki:"https://en.wikipedia.org/wiki/Elysium_Planitia"}];
    const raycaster=new THREE.Raycaster(); const pointer=new THREE.Vector2(9999,9999);
    const labelsGroup=new THREE.Group(); planetGroup.add(labelsGroup);
    const markerMat=new THREE.MeshBasicMaterial({color:0xff4d6d}); const pinGeom=new THREE.SphereGeometry(.02,12,12);

    const addLabels=()=>{LOCATIONS.forEach(loc=>{const pos=latLonToVec3(loc.lat,loc.lonE,R);const normal=pos.clone().normalize();const pin=new THREE.Mesh(pinGeom,markerMat);pin.position.copy(pos);pin.userData={id:loc.id};const label=makeTextLabel(loc.name);label.position.copy(pos.clone().addScaledVector(normal,.25));label.userData={id:loc.id};labelsGroup.add(pin,label)})};

    const normalizeAndAdd=(root)=>{const box=new THREE.Box3().setFromObject(root);const center=box.getCenter(new THREE.Vector3());const size=box.getSize(new THREE.Vector3());const radius=Math.max(size.x,size.y,size.z)*.5||1;const scale=R/radius;root.position.sub(center);root.scale.setScalar(scale);planetGroup.add(root);addLabels();const anchor=latLonToVec3(4.5,135.9,R).normalize();const q=new THREE.Quaternion().setFromUnitVectors(anchor,new THREE.Vector3(0,0,1));planetGroup.quaternion.copy(q)};

    const loader=new GLTFLoader(); let gi=0;
    const loadNext=()=>{ if(gi>=GLB_CANDIDATES.length){
        const sphere=new THREE.Mesh(new THREE.SphereGeometry(R,64,48),new THREE.MeshBasicMaterial({color:0xffffff}));
        new THREE.TextureLoader().load(marsTextureUrl,(t)=>{t.colorSpace=THREE.SRGBColorSpace;sphere.material.map=t;sphere.material.needsUpdate=true});
        normalizeAndAdd(sphere); return;
      }
      const url=GLB_CANDIDATES[gi++]; loader.load(url,(gltf)=>normalizeAndAdd(gltf.scene||gltf.scenes?.[0]),undefined,()=>loadNext());
    };
    loadNext();

    const controls=new OrbitControls(camera,renderer.domElement);
    controls.enableDamping=true; controls.dampingFactor=.08; controls.minDistance=2.5; controls.maxDistance=10; controls.enablePan=false;

    let raf=0,last=performance.now();
    const tick=()=>{const now=performance.now(),dt=Math.min(.05,(now-last)/1000); if(!reducedMotion) planetGroup.rotation.y+=dt*.07;
      labelsGroup.children.forEach(o=>{if(o.isSprite)o.quaternion.copy(camera.quaternion)});
      controls.update(); renderer.render(scene,camera); last=now; raf=requestAnimationFrame(tick)};
    raf=requestAnimationFrame(tick);

    function onPointerMove(e){const rect=renderer.domElement.getBoundingClientRect();pointer.x=((e.clientX-rect.left)/rect.width)*2-1;pointer.y=-((e.clientY-rect.top)/rect.height)*2+1;raycaster.setFromCamera(pointer,camera);const hits=raycaster.intersectObjects(labelsGroup.children,true);renderer.domElement.style.cursor=hits.length?"pointer":"grab"}
    function onClick(){raycaster.setFromCamera(pointer,camera);const hits=raycaster.intersectObjects(labelsGroup.children,true);if(hits.length){const id=hits[0].object.userData.id;if(id==="elysium")setViewMode("map")}}
    renderer.domElement.addEventListener("pointermove",onPointerMove);
    renderer.domElement.addEventListener("click",onClick);

    globeCleanupRef.current=()=>{cancelAnimationFrame(raf);controls.dispose();ro.disconnect();renderer.domElement.removeEventListener("pointermove",onPointerMove);renderer.domElement.removeEventListener("click",onClick);planetGroup.traverse(o=>{if(o.isSprite){o.material.map?.dispose?.();o.material.dispose?.()}if(o.geometry)o.geometry.dispose?.();if(o.material){o.material.map?.dispose?.();o.material.dispose?.()}});renderer.dispose();try{canvas.width=0;canvas.height=0}catch{}};
    return globeCleanupRef.current;
  },[viewMode,reducedMotion,marsTextureUrl]);

  /* ---------------------------------- Map ---------------------------------- */

  const mapCanvasRef=useRef(null),   mapCleanupRef=useRef(null);
  const markerBaseScale=useRef(0.08);

  useEffect(()=>{
    if(viewMode!=="map"||reducedMotion){
      mapCleanupRef.current?.(); mapCleanupRef.current=null;
      const a=audioRef.current; if(a){a.pause(); a.currentTime=a.currentTime;}
      return;
    }
    const canvas=mapCanvasRef.current; if(!canvas) return;

    const scene=new THREE.Scene();
    const camera=new THREE.PerspectiveCamera(45,1,.1,500); camera.position.set(0,0,4.2);
    const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:"high-performance"});
    renderer.outputColorSpace=THREE.SRGBColorSpace; renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    const ensure=()=>{const w=canvas.clientWidth||canvas.parentElement?.clientWidth||640,h=canvas.clientHeight||canvas.parentElement?.clientHeight||480; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix();}; ensure(); const ro=new ResizeObserver(ensure); ro.observe(canvas);

    scene.add(new THREE.AmbientLight(0xffffff,.9)); const dir=new THREE.DirectionalLight(0xffffff,.55); dir.position.set(5,8,5); scene.add(dir);

    const base=new THREE.Mesh(new THREE.PlaneGeometry(1,1,1,1),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.95}));
    scene.add(base);
    const tLoader=new THREE.TextureLoader(); let baseTex=null, baseAspect=3238/3900;
    tLoader.load(elysiumTextureUrl,(t)=>{baseTex=t; t.colorSpace=THREE.SRGBColorSpace; base.material.map=t; base.material.needsUpdate=true; const img=t.image; baseAspect=img&&img.width?img.height/img.width:baseAspect; base.scale.set(3,3*baseAspect,1)});

    const makeLayer=(o)=>{const{opacity=.40,width=.9,fade=.20,noiseScale=1.6,speedScale=.65,count=1400,hueBias=0}=o;const c=document.createElement("canvas");c.width=1024;c.height=1024;const ctx=c.getContext("2d");ctx.fillStyle="rgba(0,0,0,0)";ctx.fillRect(0,0,c.width,c.height);const tex=new THREE.CanvasTexture(c);const mat=new THREE.MeshBasicMaterial({map:tex,transparent:true,opacity,blending:THREE.AdditiveBlending,depthWrite:false});const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1,1,1),mat);mesh.position.z=.01;scene.add(mesh);const particles=Array.from({length:reducedMotion?0:count},()=>({x:Math.random(),y:Math.random()}));return{flowCanvas:c,ctx,tex,mesh,particles,width,fade,noiseScale,speedScale,hueBias}};
    const layers=[makeLayer({opacity:.40,width:.9,fade:.20,noiseScale:1.4,speedScale:.55,count:1200,hueBias:0}),makeLayer({opacity:.30,width:.7,fade:.16,noiseScale:2.2,speedScale:.82,count:900,hueBias:.12})];

    const marker=makeMarkerSprite("InSight"); marker.position.z=.03; scene.add(marker);
    const controls=new OrbitControls(camera,renderer.domElement); controls.enablePan=false; controls.enableDamping=true; controls.dampingFactor=.08; controls.minDistance=2.5; controls.maxDistance=10;

    let half={x:1.5,y:1.25};
    const updateBounds=()=>{half.x=Math.abs(base.scale.x)*.5; half.y=Math.abs(base.scale.y)*.5; layers.forEach(L=>L.mesh.scale.copy(base.scale))};
    const mapBounds={west:125,east:165,south:-10,north:35};
    const uv=latLonToUV(4.5,135.9,mapBounds);
    const placeMarker=()=>{const x=(uv.u-.5)*2*half.x; const y=(.5-uv.v)*2*half.y; marker.position.set(x,y,.03); const s=Math.min(half.x,half.y)*.08; markerBaseScale.current=s; marker.scale.set(s,s,1)};

    let lastT=performance.now(), raf=0;
    const tick=()=>{updateBounds(); placeMarker();

      // ---- Read audio -> compute "speed" only
      const el=audioRef.current, an=analyserRef.current, fb=freqBufRef.current, tb=timeBufRef.current, ctx=audioCtxRef.current;
      let audioActive=false, audioSpeed=0;

      if (useAudioForWind && an && el && !el.paused && ctx && ctx.state==="running") {
        if (fb && tb) {
          an.getByteFrequencyData(fb);
          an.getByteTimeDomainData(tb);

          // RMS -> 0..1
          let sum=0; for(let i=0;i<tb.length;i++){const v=(tb[i]-128)/128; sum+=v*v;}
          const rms=Math.sqrt(sum/tb.length);
          const vNorm=Math.min(1, rms*3.0);   // boost for visual effect
          audioSpeed = 25 * vNorm;
          audioActive = true;
        }
      }
      audioWindRef.current = { active: audioActive, speed: audioSpeed };

      // base wind from data (direction always from data)
      const baseSpd = windRef.current.speed;
      const toDeg   = windRef.current.toDeg ?? ((performance.now()/50)%360);

      // Audio controls speed only
      const spd = (useAudioForWind && audioActive)
        ? lerp(baseSpd, audioSpeed, 0.9)
        : baseSpd;

      // flow layers
      const vNorm = Math.min(spd,25)/25;
      const rad   = (90 - toDeg) * Math.PI / 180;
      const wx = Math.cos(rad), wy = Math.sin(rad);

      layers.forEach(L=>{
        L.ctx.fillStyle=`rgba(0,0,0,${L.fade})`;
        L.ctx.fillRect(0,0,L.flowCanvas.width,L.flowCanvas.height);

        const now=performance.now();
        const dt=Math.min(.05,(now-lastT)/1000);
        const windMag=.22+1.05*vNorm;
        const noiseAmp=.35*(1-.5*vNorm);
        const step=L.speedScale*dt;

        L.ctx.lineWidth=L.width;
        L.ctx.strokeStyle=rgbStr(rampRGB(Math.min(1,vNorm*(1+L.hueBias*.6))));

        L.particles.forEach(p=>{
          const xw=(p.x-.5)*2*half.x, yw=(p.y-.5)*2*half.y;
          const ang=fbm(xw*L.noiseScale+now*.00015, yw*L.noiseScale-now*.00012)*Math.PI*2;
          const nx=Math.cos(ang), ny=Math.sin(ang);
          const dirx=wx*windMag+nx*noiseAmp, diry=wy*windMag+ny*noiseAmp;
          const u0=p.x, v0=p.y; let nxp=p.x+dirx*step, nyp=p.y+diry*step;
          let wrapped=false; if(nxp<0){nxp+=1;wrapped=true}else if(nxp>1){nxp-=1;wrapped=true}
          if(nyp<0){nyp+=1;wrapped=true}else if(nyp>1){nyp-=1;wrapped=true}
          if(!wrapped){const ux=nxp*L.flowCanvas.width,uy=nyp*L.flowCanvas.height; const px=u0*L.flowCanvas.width,py=v0*L.flowCanvas.height; L.ctx.beginPath(); L.ctx.moveTo(px,py); L.ctx.lineTo(ux,uy); L.ctx.stroke()}
          p.x=nxp;p.y=nyp;
        });
        L.tex.needsUpdate=true;
      });

      // marker pulse
      const nowT=performance.now();
      const pulse=.95+Math.abs(Math.sin(nowT*.003))*.12;
      marker.scale.set(markerBaseScale.current*pulse,markerBaseScale.current*pulse,1);
      marker.material.opacity=.9;

      controls.update(); renderer.render(scene,camera);
      lastT=performance.now(); raf=requestAnimationFrame(tick)
    };
    raf=requestAnimationFrame(tick);

    mapCleanupRef.current=()=>{cancelAnimationFrame(raf); controls.dispose(); ro.disconnect(); base.geometry.dispose(); base.material.dispose?.(); if(baseTex) baseTex.dispose?.(); layers.forEach(L=>{L.mesh.geometry.dispose(); L.mesh.material.map?.dispose?.(); L.mesh.material.dispose?.()}); renderer.dispose(); try{canvas.width=0;canvas.height=0}catch{}};
    return mapCleanupRef.current;
  },[viewMode,elysiumTextureUrl,reducedMotion,useAudioForWind]);

  /* ----------------------------------- UI ---------------------------------- */

  const soundDisabled=!audioPlayable||!!audioError;

  return (
    <div className={`grid ${className}`} style={{ display:"grid", gridTemplateColumns:"360px 1fr", height:"100%", gap:0 }}>
      {/* LEFT */}
      <div style={{ borderRight:"1px solid #1f2937", background:"#0c1220", minHeight:0, display:"flex", flexDirection:"column" }}>
        <div style={{ padding:12, borderBottom:"1px solid #1f2937" }}>
          <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"center" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ fontWeight:600, fontSize:14 }}>InSight @ Elysium Planitia — Wind</div>
              {usingMock && <span style={{ fontSize:10, padding:"2px 6px", borderRadius:999, background:"#3b0764", border:"1px solid #581c87" }}>demo</span>}
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <button className="btn" aria-pressed={viewMode==="globe"} onClick={()=>setViewMode("globe")}>Globe</button>
              <button className="btn" aria-pressed={viewMode==="map"} onClick={()=>setViewMode("map")}>Map</button>
              <button className="btn" onClick={clearCacheAndRefresh} title="Refresh">↻</button>
              <button
                className="btn"
                aria-pressed={soundOn}
                onClick={async()=>{ if(soundDisabled) return; const next=!soundOn; setSoundOn(next); if(next) await kickAudio(); else audioRef.current?.pause?.(); }}
                title={soundDisabled ? (audioError||"Upload an audio file") : "Toggle wind audio"}
                disabled={soundDisabled}
                style={soundDisabled?{opacity:.5,cursor:"not-allowed"}:undefined}
              >
                {soundOn?"🔊":"🔇"}
              </button>
              <button className="btn" onClick={()=>fileInputRef.current?.click?.()} title="Upload audio file">Upload</button>
              <input ref={fileInputRef} type="file" accept="audio/*" style={{display:"none"}} onChange={handleUpload}/>
            </div>
          </div>

          <div style={{ fontSize:12, opacity:.85, marginTop:6 }}>
            {loading ? "Loading…" : (error || (selectedSol && sd ? `Sol ${selectedSol} — ${sd.Season||"—"} — ${sd.First_UTC||"—"} → ${sd.Last_UTC||"—"}` : "No data"))}
          </div>

          <div style={{ marginTop:8, display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            <label style={{ fontSize:12, opacity:.85, display:"flex", gap:6, alignItems:"center" }}>
              <input type="checkbox" checked={useAudioForWind} onChange={(e)=>setUseAudioForWind(e.target.checked)} />
              Sync <b>speed</b> with audio
            </label>
            <div style={{ fontSize:11, opacity:.8 }}>{audioFileName ? `• ${audioFileName}` : "• no audio uploaded"}</div>
            {audioError && <div style={{ fontSize:11, color:"#fda4af" }}>— {audioError}</div>}
          </div>
        </div>

        <div style={{ padding:12, overflow:"auto", minHeight:0 }}>
          <Info label="Avg wind speed" value={`${sd?.HWS?.av?.toFixed?.(2) ?? "—"} m/s`} />
          <div style={{ height:8 }} />
          <Info label="Avg temperature" value={`${sd?.AT?.av?.toFixed?.(1) ?? "—"} °C`} />
          <div style={{ height:8 }} />
          <Info label="Avg pressure" value={`${sd?.PRE?.av?.toFixed?.(1) ?? "—"} Pa`} />
          <div style={{ height:8 }} />
          <Info label="Most common dir" value={sd?.WD?.most_common?.compass_point ?? "—"} />
          <div style={{ height:12 }} />
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {sols.map((s)=>(
              <button key={s} className="btn" aria-pressed={s===selectedSol} onClick={()=>setSelectedSol(s)} style={{ height:32 }}>
                Sol {s}
              </button>
            ))}
          </div>

          {/* Credits */}
          <div style={{ marginTop:16, fontSize:11, opacity:.82, lineHeight:1.5 }}>
            <div style={{ fontWeight:600, opacity:.9, marginBottom:4 }}>Credits</div>
            <div>Wind data: NASA InSight — Mars Weather Service API.</div>
            <div>Globe model: NASA 3D Mars (GLB).</div>
            <div>Base map: MOLA shaded relief (NASA/GSFC) via Wikimedia.</div>
            <div>Wind audio: NASA's InSight lander.</div>
          </div>
        </div>
      </div>

      {/* RIGHT */}
      <div style={{ position:"relative", minHeight:0 }}>
        {viewMode==="globe"
          ? <canvas ref={globeCanvasRef} style={{ width:"100%", height:"100%", display:"block", background:"#0b0f14" }} />
          : <>
              <canvas ref={mapCanvasRef} style={{ width:"100%", height:"100%", display:"block", background:"#0b0f14" }} />
              {/* HUD */}
              <div style={{ position:"absolute", top:12, right:12, pointerEvents:"none", color:"#e5e7eb" }}>
                <div style={{ display:"flex", gap:10, alignItems:"center", background:"rgba(0,0,0,0.35)", padding:"8px 10px", borderRadius:10, border:"1px solid #1f2937" }}>
                  <div style={{ width:64, height:64, borderRadius:"50%", border:"1px solid #334155", position:"relative", display:"grid", placeItems:"center" }}>
                    <div style={{ position:"absolute", top:-10, left:"50%", transform:"translateX(-50%)", fontSize:10, letterSpacing:1, opacity:.8 }}>N</div>
                    <div style={{ transform:`rotate(${toDegHUD ?? 0}deg)`, transformOrigin:"center", display:"grid", placeItems:"center" }}>
                      <div style={{ width:2, height:24, background:"#e5e7eb" }} />
                      <div style={{ width:0, height:0, borderLeft:"6px solid transparent", borderRight:"6px solid transparent", borderBottom:"10px solid #e5e7eb", marginTop:-2 }} />
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize:12, opacity:.85 }}>Wind → {toDegHUD != null ? `${Math.round(toDegHUD)}°` : "—"}</div>
                    <div style={{ fontSize:18, fontWeight:600 }}>{(windSpeed ?? 0).toFixed(1)} m/s</div>
                    <div style={{ marginTop:4, width:140, height:8, borderRadius:4, background:"linear-gradient(90deg, rgb(0,180,255) 0%, rgb(0,255,255) 35%, rgb(255,0,255) 70%, rgb(255,255,255) 100%)" }} />
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, opacity:.7 }}><span>0</span><span>25+</span></div>
                  </div>
                </div>
              </div>
            </>
        }

        {/* Hidden audio; src set when you upload */}
        <audio ref={audioRef} playsInline crossOrigin="anonymous" style={{ display:"none" }} />
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div style={{ border:"1px solid #1f2937", borderRadius:12, background:"#0b1220aa", padding:10 }}>
      <div style={{ fontSize:12, opacity:.8 }}>{label}</div>
      <div style={{ fontSize:18, fontWeight:600 }}>{value}</div>
    </div>
  );
}

/* ------------------------------- App wrapper ------------------------------- */

function App() {
  const ENV_KEY =
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_INSIGHT_KEY) ||
    (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_INSIGHT_KEY) ||
    "DEMO_KEY";

  return (
    <div style={{ width:"100%", height:"100vh", background:"#0b0f14", color:"white" }}>
      <InSightWindStation apiKey="E3yrARvpO7o5yH2vrAkEEP7L3tQ4ztRVdpZxPSFk" className="h-full w-full" />
    </div>
  );
}

export default App;
export { InSightWindStation };
