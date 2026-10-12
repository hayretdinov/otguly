(() => {
"use strict";

const canvas = document.getElementById("gameCanvas");
const engine = new BABYLON.Engine(canvas, true, {
  preserveDrawingBuffer: false,
  stencil: true,
  antialias: true,
  adaptToDeviceRatio: true
});

const $ = (id) => document.getElementById(id);
const hud = $("hud");
const startScreen = $("startScreen");
const modal = $("modal");
const modalTitle = $("modalTitle");
const modalBody = $("modalBody");
const actionHint = $("actionHint");
const minimap = $("minimap");
const miniCtx = minimap.getContext("2d");

const SAVE_KEY = "kapery-3d-save-v1";
const keys = Object.create(null);
const matCache = new WeakMap();

let activeScene = null;
let seaScene = null;
let sea = null;
let landScene = null;
let land = null;
let boardingScene = null;
let boarding = null;
let audioCtx = null;
let toastTimer = 0;
let mapBig = false;

const PORTS = [
  {id:"portroyal", name:"Порт-Ройал", x:-165, z:125, radius:26, port:true, angle:0.25, color:"#668f54"},
  {id:"tortuga", name:"Тортуга", x:105, z:150, radius:23, port:true, angle:2.8, color:"#708c4e"},
  {id:"havana", name:"Гавана", x:-15, z:-175, radius:31, port:true, angle:-0.9, color:"#69945d"},
  {id:"nassau", name:"Нассау", x:185, z:-65, radius:21, port:true, angle:2.3, color:"#76965c"},
  {id:"cartagena", name:"Картахена", x:-200, z:-90, radius:27, port:true, angle:0.6, color:"#63844d"},
  {id:"wild1", name:"Остров Черепа", x:35, z:40, radius:22, port:false, angle:0, color:"#557c48"},
  {id:"wild2", name:"Зелёный риф", x:225, z:105, radius:18, port:false, angle:0, color:"#5e874f"},
  {id:"wild3", name:"Остров Туманов", x:-85, z:210, radius:20, port:false, angle:0, color:"#506f45"}
];

const GOODS = [
  {id:"food", name:"Провизия", base:22},
  {id:"cloth", name:"Ткань", base:42},
  {id:"spice", name:"Пряности", base:78},
  {id:"tools", name:"Инструменты", base:58}
];

const AMMO = [
  {id:"ball", name:"Ядра", damage:12, speed:49, gravity:15, range:90},
  {id:"grape", name:"Картечь", damage:8, speed:44, gravity:18, range:58},
  {id:"chain", name:"Цепь", damage:10, speed:45, gravity:16, range:78},
  {id:"bomb", name:"Бомбы", damage:19, speed:42, gravity:17, range:72}
];

function freshState(hero="female") {
  return {
    hero,
    mode:"SEA",
    gold:1200,
    level:1,
    xp:0,
    xpNext:100,
    shipHp:120,
    shipMaxHp:120,
    charHp:100,
    charMaxHp:100,
    sails:1,
    crew:18,
    soldiers:4,
    cannonLevel:1,
    cannons:6,
    swordLevel:1,
    armorLevel:0,
    pistolLevel:1,
    wood:8,
    meat:4,
    cargo:{food:8, cloth:0, spice:0, tools:0},
    cargoCapacity:45,
    ammo:{ball:120, grape:36, chain:30, bomb:18},
    ammoType:"ball",
    pirateKills:0,
    quest:null,
    seaPos:{x:-120,z:92},
    heading:0.45,
    currentPort:"portroyal",
    shipClass:"Шлюп",
    saveVersion:1
  };
}
let state = freshState();

function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function lerp(a,b,t){ return a+(b-a)*t; }
function dist2(a,b){ const dx=a.x-b.x,dz=a.z-b.z; return Math.hypot(dx,dz); }
function angleWrap(a){ while(a>Math.PI)a-=Math.PI*2; while(a<-Math.PI)a+=Math.PI*2; return a; }
function dirFromHeading(h){ return new BABYLON.Vector3(Math.sin(h),0,Math.cos(h)); }
function rightFromHeading(h){ return new BABYLON.Vector3(Math.cos(h),0,-Math.sin(h)); }

function hex3(s){ return BABYLON.Color3.FromHexString(s); }
function material(scene, key, color, emissive=0, alpha=1) {
  let map = matCache.get(scene);
  if(!map){ map=new Map(); matCache.set(scene,map); }
  const cacheKey = key+"|"+color+"|"+emissive+"|"+alpha;
  if(map.has(cacheKey)) return map.get(cacheKey);
  const m = new BABYLON.StandardMaterial(key, scene);
  m.diffuseColor = hex3(color);
  m.specularColor = new BABYLON.Color3(.18,.18,.18);
  if(emissive) m.emissiveColor = hex3(color).scale(emissive);
  m.alpha = alpha;
  map.set(cacheKey,m);
  return m;
}

function toast(msg, ms=2300) {
  const d=document.createElement("div");
  d.className="toast-item";
  d.textContent=msg;
  $("toast").appendChild(d);
  setTimeout(()=>d.remove(),ms);
}

function ensureAudio(){
  if(!audioCtx){
    try{ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); }catch(_){}
  }
}
function tone(freq=120,dur=.2,type="sine",gain=.15){
  ensureAudio(); if(!audioCtx)return;
  const o=audioCtx.createOscillator(), g=audioCtx.createGain();
  o.type=type; o.frequency.value=freq;
  g.gain.setValueAtTime(gain,audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+dur);
  o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+dur);
}
function cannonSound(){ tone(70,.42,"sawtooth",.18); setTimeout(()=>tone(48,.35,"square",.07),25); }
function pistolSound(){ tone(180,.12,"square",.11); }
function swordSound(){ tone(520,.08,"sawtooth",.055); }

function saveGame(){
  if(!sea || state.mode==="TITLE") return;
  if(sea.player){
    state.seaPos={x:+sea.player.root.position.x.toFixed(2),z:+sea.player.root.position.z.toFixed(2)};
    state.heading=sea.player.heading;
  }
  try{ localStorage.setItem(SAVE_KEY,JSON.stringify(state)); }catch(_){}
}
function loadSave(){
  try{
    const s=JSON.parse(localStorage.getItem(SAVE_KEY)||"null");
    if(s && s.saveVersion===1) state=Object.assign(freshState(s.hero||"female"),s);
    return !!s;
  }catch(_){ return false; }
}
function resetSave(hero){
  state=freshState(hero);
  try{ localStorage.removeItem(SAVE_KEY); }catch(_){}
}

function awardXP(amount){
  state.xp += amount;
  while(state.xp>=state.xpNext){
    state.xp-=state.xpNext;
    state.level++;
    state.xpNext=Math.round(state.xpNext*1.28);
    state.charMaxHp+=8; state.charHp=state.charMaxHp;
    state.shipMaxHp+=6; state.shipHp=Math.min(state.shipMaxHp,state.shipHp+18);
    toast("Новый уровень: "+state.level+"! Характеристики увеличены.",3400);
    tone(660,.25,"sine",.08);
  }
}

function oceanHeight(x,z,t){
  return Math.sin((x+t*8)*.035)*.7 +
         Math.sin((z-t*6)*.05)*.45 +
         Math.sin((x+z+t*3)*.018)*1.2;
}

BABYLON.Effect.ShadersStore["kaperyOceanVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform float time;
varying vec3 vWorldPos;
varying vec3 vNormal;
void main(void){
  vec3 p=position;
  float a=(p.x+time*8.0)*0.035;
  float b=(p.z-time*6.0)*0.05;
  float c=(p.x+p.z+time*3.0)*0.018;
  float h=sin(a)*0.7+sin(b)*0.45+sin(c)*1.2;
  p.y += h;
  float dx=cos(a)*0.7*0.035 + cos(c)*1.2*0.018;
  float dz=cos(b)*0.45*0.05 + cos(c)*1.2*0.018;
  vec3 n=normalize(vec3(-dx,1.0,-dz));
  vWorldPos=(world*vec4(p,1.0)).xyz;
  vNormal=normalize(mat3(world)*n);
  gl_Position=worldViewProjection*vec4(p,1.0);
}`;

BABYLON.Effect.ShadersStore["kaperyOceanFragmentShader"] = `
precision highp float;
varying vec3 vWorldPos;
varying vec3 vNormal;
uniform vec3 cameraPosition;
uniform vec3 sunDirection;
uniform float time;
void main(void){
  vec3 N=normalize(vNormal);
  vec3 V=normalize(cameraPosition-vWorldPos);
  vec3 L=normalize(-sunDirection);
  float fres=pow(1.0-max(dot(N,V),0.0),3.2);
  float spec=pow(max(dot(reflect(-L,N),V),0.0),70.0);
  float rip=0.5+0.5*sin(vWorldPos.x*0.12+vWorldPos.z*0.08+time*2.0);
  vec3 deep=vec3(0.018,0.16,0.22);
  vec3 shallow=vec3(0.055,0.39,0.46);
  vec3 sky=vec3(0.35,0.60,0.70);
  vec3 col=mix(deep,shallow,0.30+0.16*rip);
  col=mix(col,sky,fres*0.72);
  col+=vec3(1.0,0.82,0.52)*spec*1.2;
  gl_FragColor=vec4(col,0.96);
}`;

function createOcean(scene,size=720){
  const ocean=BABYLON.MeshBuilder.CreateGround("ocean",{width:size,height:size,subdivisions:150},scene);
  const sh=new BABYLON.ShaderMaterial("oceanShader",scene,
    {vertex:"kaperyOcean",fragment:"kaperyOcean"},
    {attributes:["position","normal"],uniforms:["world","worldViewProjection","time","cameraPosition","sunDirection"]});
  sh.setFloat("time",0);
  sh.setVector3("sunDirection",new BABYLON.Vector3(-.4,-1,.25));
  sh.backFaceCulling=false;
  ocean.material=sh;
  ocean.isPickable=false;
  return {mesh:ocean,shader:sh};
}

function addSkyLighting(scene){
  scene.clearColor=new BABYLON.Color4(.07,.19,.24,1);
  scene.fogMode=BABYLON.Scene.FOGMODE_EXP2;
  scene.fogColor=new BABYLON.Color3(.10,.24,.28);
  scene.fogDensity=.0018;
  const hemi=new BABYLON.HemisphericLight("hemi",new BABYLON.Vector3(0,1,0),scene);
  hemi.intensity=.88;
  hemi.diffuse=new BABYLON.Color3(.72,.82,.82);
  hemi.groundColor=new BABYLON.Color3(.13,.12,.09);
  const sun=new BABYLON.DirectionalLight("sun",new BABYLON.Vector3(-.45,-1,.3),scene);
  sun.position=new BABYLON.Vector3(80,160,-80);
  sun.intensity=1.05;
}

function makeHouse(scene,parent,x,z,scale=1){
  const wall=BABYLON.MeshBuilder.CreateBox("house",{width:4*scale,height:3*scale,depth:4*scale},scene);
  wall.position.set(x,2.4*scale,z); wall.parent=parent; wall.material=material(scene,"plaster","#d3bd8c");
  const roof=BABYLON.MeshBuilder.CreateCylinder("roof",{diameterTop:0,diameterBottom:6.2*scale,height:2.4*scale,tessellation:4},scene);
  roof.position.set(x,4.6*scale,z); roof.rotation.y=Math.PI/4; roof.parent=parent; roof.material=material(scene,"roof","#8c3f32");
}
function makePalm(scene,parent,x,z,s=1){
  const trunk=BABYLON.MeshBuilder.CreateCylinder("palm",{height:5.5*s,diameter:.55*s,tessellation:8},scene);
  trunk.position.set(x,3*s,z); trunk.parent=parent; trunk.material=material(scene,"trunk","#705130");
  for(let i=0;i<5;i++){
    const leaf=BABYLON.MeshBuilder.CreateSphere("leaf",{diameter:2.2*s,segments:6},scene);
    leaf.scaling.set(1.6,.16,.42); leaf.position.set(x,5.7*s,z); leaf.rotation.y=i*Math.PI*.4; leaf.rotation.z=(i%2?.18:-.18);
    leaf.parent=parent; leaf.material=material(scene,"leaf","#315f35");
  }
}

function createIsland(scene,d){
  const root=new BABYLON.TransformNode("island-"+d.id,scene);
  root.position.set(d.x,0,d.z);

  const sand=BABYLON.MeshBuilder.CreateCylinder("sand",{diameter:d.radius*2.2,height:2.2,tessellation:48},scene);
  sand.position.y=.1; sand.parent=root; sand.material=material(scene,"sand","#c8b176");
  const grass=BABYLON.MeshBuilder.CreateCylinder("grass",{diameter:d.radius*1.78,height:4.0,tessellation:48},scene);
  grass.position.y=1.6; grass.parent=root; grass.material=material(scene,"grass",d.color);
  const hill=BABYLON.MeshBuilder.CreateCylinder("hill",{diameter:d.radius*1.05,height:5.2,tessellation:32},scene);
  hill.position.set(-d.radius*.12,4,d.radius*.08); hill.parent=root; hill.material=material(scene,"hill","#4f7547");

  for(let i=0;i<Math.max(4,Math.floor(d.radius/4));i++){
    const a=(i*2.37+d.x*.01);
    const rr=d.radius*(.25+.45*((i*37)%11)/10);
    makePalm(scene,root,Math.cos(a)*rr,Math.sin(a)*rr,.78+((i*13)%5)*.06);
  }

  let portPos=null;
  if(d.port){
    const pa=d.angle||0;
    const px=Math.sin(pa)*d.radius*.93, pz=Math.cos(pa)*d.radius*.93;
    const outx=Math.sin(pa)*d.radius*1.34, outz=Math.cos(pa)*d.radius*1.34;
    const pier=BABYLON.MeshBuilder.CreateBox("pier",{width:4,height:.45,depth:d.radius*.65},scene);
    pier.parent=root; pier.position.set((px+outx)/2,1.55,(pz+outz)/2); pier.rotation.y=pa;
    pier.material=material(scene,"pier","#6f4a2c");
    portPos={x:d.x+outx,z:d.z+outz};
    for(let i=0;i<4;i++){
      const a=pa+Math.PI*.55+(i-1.5)*.32;
      makeHouse(scene,root,Math.sin(a)*d.radius*.48,Math.cos(a)*d.radius*.48,.72+(.08*i));
    }
    const flagPole=BABYLON.MeshBuilder.CreateCylinder("flagpole",{height:8,diameter:.25,tessellation:8},scene);
    flagPole.parent=root; flagPole.position.set(px*.55,6,pz*.55); flagPole.material=material(scene,"pole","#5c4631");
    const flag=BABYLON.MeshBuilder.CreatePlane("flag",{width:3,height:1.5,sideOrientation:BABYLON.Mesh.DOUBLESIDE},scene);
    flag.parent=root; flag.position.set(px*.55+1.45,8.7,pz*.55); flag.material=material(scene,"flag","#8f242d",.08);
  }
  return {def:d,root,portPos};
}

function createShip(scene,opts={}){
  const root=new BABYLON.TransformNode("ship",scene);
  const scale=opts.scale||1;
  const wood=opts.wood||"#5a3824";
  const trim=opts.trim||"#b48643";
  const sailColor=opts.sail||"#e5d7b5";

  const hull=BABYLON.MeshBuilder.CreateBox("hull",{width:5.4*scale,height:2.7*scale,depth:14*scale},scene);
  hull.position.y=2.3*scale; hull.parent=root; hull.material=material(scene,"hull-"+wood,wood);
  const lower=BABYLON.MeshBuilder.CreateBox("lower",{width:4.1*scale,height:1.7*scale,depth:12.8*scale},scene);
  lower.position.y=.95*scale; lower.parent=root; lower.material=material(scene,"lower-"+wood,"#3f281c");
  const bow=BABYLON.MeshBuilder.CreateCylinder("bow",{diameterTop:0,diameterBottom:5.35*scale,height:5.2*scale,tessellation:4},scene);
  bow.rotation.x=Math.PI/2; bow.rotation.y=Math.PI/4; bow.position.set(0,2.15*scale,8.1*scale); bow.parent=root; bow.material=material(scene,"bow-"+wood,wood);
  const deck=BABYLON.MeshBuilder.CreateBox("deck",{width:4.75*scale,height:.35*scale,depth:13.2*scale},scene);
  deck.position.y=3.72*scale; deck.parent=root; deck.material=material(scene,"deck","#9a6d3d");

  const railL=BABYLON.MeshBuilder.CreateBox("rail",{width:.25*scale,height:.7*scale,depth:12.5*scale},scene);
  railL.position.set(-2.42*scale,4.08*scale,0);railL.parent=root;railL.material=material(scene,"trim-"+trim,trim);
  const railR=railL.clone("railR");railR.position.x=2.42*scale;railR.parent=root;

  const masts=[];
  const sails=[];
  [-2.7*scale,3.2*scale].forEach((z,idx)=>{
    const mast=BABYLON.MeshBuilder.CreateCylinder("mast",{height:(idx?12:14)*scale,diameter:.42*scale,tessellation:10},scene);
    mast.position.set(0,(idx?9:10)*scale,z);mast.parent=root;mast.material=material(scene,"mast","#6d4c2d");masts.push(mast);
    const sail=BABYLON.MeshBuilder.CreatePlane("sail",{width:(idx?5:6.4)*scale,height:(idx?5.3:6.4)*scale,sideOrientation:BABYLON.Mesh.DOUBLESIDE},scene);
    sail.position.set(0,(idx?10:11.3)*scale,z+.15*scale);sail.parent=root;sail.material=material(scene,"sail-"+sailColor,sailColor);
    sails.push(sail);
    const yard=BABYLON.MeshBuilder.CreateCylinder("yard",{height:(idx?6:7.3)*scale,diameter:.22*scale,tessellation:8},scene);
    yard.rotation.z=Math.PI/2;yard.position.set(0,(idx?11.1:12.6)*scale,z);yard.parent=root;yard.material=material(scene,"yard","#6d4c2d");
  });

  const cannons=[];
  const cannonMat=material(scene,"cannon","#24292a",0.08);
  for(const side of [-1,1]){
    for(let i=0;i<6;i++){
      const c=BABYLON.MeshBuilder.CreateCylinder("cannon",{height:1.5*scale,diameter:.34*scale,tessellation:10},scene);
      c.rotation.z=Math.PI/2; c.position.set(side*2.75*scale,3.45*scale,(-4.4+i*1.75)*scale);
      c.parent=root;c.material=cannonMat;cannons.push({mesh:c,side,index:i});
    }
  }

  const flag=BABYLON.MeshBuilder.CreatePlane("shipFlag",{width:2.2*scale,height:1.2*scale,sideOrientation:BABYLON.Mesh.DOUBLESIDE},scene);
  flag.position.set(1.05*scale,15.2*scale,-2.7*scale);flag.parent=root;flag.material=material(scene,"shipflag-"+trim,trim,.08);

  return {
    root, hull, sails, cannons,
    heading:opts.heading||0,
    speed:0,
    hp:opts.hp||100,
    maxHp:opts.hp||100,
    type:opts.type||"player",
    name:opts.name||"Корабль",
    reload:opts.reload||0,
    reloadMax:opts.reloadMax||8,
    speedPenalty:0,
    sunk:false,
    aiTarget:null
  };
}

function setSailVisual(ship,stage){
  const t=stage/3;
  ship.sails.forEach((s,i)=>{
    s.scaling.x=.28+t*.92;
    s.scaling.y=.14+t*.90;
    s.position.y=(i?10:11.3) - (1-t)*2.0;
    s.rotation.y=(1-t)*.04;
  });
}

function puff(scene,pos,color="#9b9b93",scale=1){
  const m=BABYLON.MeshBuilder.CreateSphere("smoke",{diameter:1.2,segments:6},scene);
  m.position.copyFrom(pos); m.material=material(scene,"smoke-"+Math.random(),color,0,.55);
  let age=0;
  const obs=scene.onBeforeRenderObservable.add(()=>{
    const dt=engine.getDeltaTime()/1000; age+=dt;
    m.scaling.setAll(scale*(1+age*2.6)); m.position.y+=dt*.7;
    if(m.material)m.material.alpha=Math.max(0,.55-age*.48);
    if(age>1.15){ scene.onBeforeRenderObservable.remove(obs); m.dispose(); }
  });
}

function createSeaScene(){
  const scene=new BABYLON.Scene(engine);
  addSkyLighting(scene);
  const ocean=createOcean(scene,720);
  const islands=PORTS.map(d=>createIsland(scene,d));

  const camera=new BABYLON.ArcRotateCamera("seaCam",-Math.PI/2,0.88,58,new BABYLON.Vector3(0,0,0),scene);
  camera.lowerRadiusLimit=34;camera.upperRadiusLimit=92;
  camera.lowerBetaLimit=.45;camera.upperBetaLimit=1.2;
  camera.wheelPrecision=12;
  camera.panningSensibility=0;
  camera.attachControl(canvas,true);

  const player=createShip(scene,{type:"player",name:"Каперы",hp:state.shipMaxHp,wood:"#573522",trim:"#c29a50",sail:"#e8dec2"});
  player.root.position.set(state.seaPos.x,1,state.seaPos.z);
  player.heading=state.heading; player.root.rotation.y=player.heading; player.hp=state.shipHp; player.maxHp=state.shipMaxHp;
  setSailVisual(player,state.sails);

  const aiShips=[];
  function spawnAI(type,index){
    const pirate=type==="pirate";
    const d=PORTS[(index*3+2)%PORTS.length];
    const a=(index*1.91)+.7;
    const r=38+((index*17)%60);
    const ship=createShip(scene,{
      type,
      name:pirate?["Чёрный Корсар","Морской Волк","Кровавый Риф","Безымянный"][index%4]:["Св. Мария","Золотая Чайка","Купец Вега","Меркурий"][index%4],
      hp:pirate?95+index*6:78+index*4,
      scale:pirate?1.02:.92,
      wood:pirate?"#35231f":"#665039",
      trim:pirate?"#8e282a":"#b89963",
      sail:pirate?"#8e7e70":"#e6dfc9",
      heading:a
    });
    ship.root.position.set(d.x+Math.sin(a)*r,1,d.z+Math.cos(a)*r);
    ship.routeIndex=(index+2)%PORTS.length;
    ship.reload=2+Math.random()*5;
    aiShips.push(ship);
  }
  for(let i=0;i<4;i++)spawnAI("pirate",i);
  for(let i=0;i<5;i++)spawnAI("merchant",i+4);

  const targetRing=BABYLON.MeshBuilder.CreateTorus("targetRing",{diameter:10,thickness:.35,tessellation:40},scene);
  targetRing.material=material(scene,"targetRing","#e6c36f",.2,.78);targetRing.isVisible=false;

  const cannonballs=[];
  let elapsed=0, shake=0, shakeSeed=0;

  const obj={
    scene,ocean,islands,camera,player,aiShips,targetRing,cannonballs,
    windAngle:.65,windSpeed:1,elapsed:0,shake:0,
    nearest:null, action:null, paused:false
  };

  scene.onBeforeRenderObservable.add(()=>{
    const dt=Math.min(.04,engine.getDeltaTime()/1000);
    elapsed+=dt;obj.elapsed=elapsed;
    ocean.shader.setFloat("time",elapsed);
    ocean.shader.setVector3("cameraPosition",camera.position);

    if(state.mode!=="SEA")return;
    updateSea(obj,dt);

    if(shake>0){
      shake-=dt; shakeSeed+=17.3*dt;
      camera.target.x=player.root.position.x+Math.sin(shakeSeed*19)*shake*.8;
      camera.target.z=player.root.position.z+Math.cos(shakeSeed*23)*shake*.8;
    }else{
      camera.target=BABYLON.Vector3.Lerp(camera.target,new BABYLON.Vector3(player.root.position.x,2.5,player.root.position.z),.12);
    }
    obj.shake=shake;
  });

  obj.addShake=(v)=>{ shake=Math.max(shake,v); };
  return obj;
}

function updateSea(s,dt){
  const p=s.player;
  const uiPaused=!modal.classList.contains("hidden") || !startScreen.classList.contains("hidden");
  if(uiPaused){ updateSeaVisuals(s,dt,false); return; }

  const steer=(keys["KeyA"]||keys["ArrowLeft"]?-1:0)+(keys["KeyD"]||keys["ArrowRight"]?1:0);
  const windDiff=Math.abs(angleWrap(p.heading-s.windAngle));
  const windFactor=.28+.72*((Math.cos(windDiff)+1)/2);
  const targetSpeed=[0,8.5,15.5,23][state.sails]*windFactor*(1-p.speedPenalty);
  p.speed=lerp(p.speed,targetSpeed,1-Math.exp(-dt*1.5));
  const turnRate=(.38+.62*clamp(Math.abs(p.speed)/16,0,1))*.72;
  p.heading+=steer*turnRate*dt*(state.sails===0?.55:1);
  p.root.rotation.y=p.heading;
  const forward=dirFromHeading(p.heading);
  p.root.position.addInPlace(forward.scale(p.speed*dt));

  p.root.position.x=clamp(p.root.position.x,-325,325);
  p.root.position.z=clamp(p.root.position.z,-325,325);

  for(const isl of s.islands){
    const d=dist2(p.root.position,isl.def);
    const min=isl.def.radius+4.0;
    if(d<min){
      const dx=p.root.position.x-isl.def.x,dz=p.root.position.z-isl.def.z;
      const inv=1/(Math.hypot(dx,dz)||1);
      p.root.position.x=isl.def.x+dx*inv*min;
      p.root.position.z=isl.def.z+dz*inv*min;
      p.speed*=.35;
    }
  }

  p.reload=Math.max(0,p.reload-dt);
  if(p.speedPenalty>0)p.speedPenalty=Math.max(0,p.speedPenalty-dt*.05);

  for(const ship of s.aiShips){
    if(ship.sunk)continue;
    updateAIShip(s,ship,dt);
  }

  updateCannonballs(s,dt);
  updateSeaVisuals(s,dt,true);
  updateSeaAction(s);
  updateHUD();
  drawMinimap();
}

function updateSeaVisuals(s,dt,doBobbing=true){
  const t=s.elapsed;
  const all=[s.player,...s.aiShips];
  for(const sh of all){
    if(sh.sunk)continue;
    if(doBobbing){
      const x=sh.root.position.x,z=sh.root.position.z;
      const h=oceanHeight(x,z,t)*.35;
      const hx=oceanHeight(x+3,z,t)-oceanHeight(x-3,z,t);
      const hz=oceanHeight(x,z+4,t)-oceanHeight(x,z-4,t);
      sh.root.position.y=1.05+h;
      sh.root.rotation.z=clamp(-hx*.018,-.07,.07);
      sh.root.rotation.x=clamp(hz*.013,-.05,.05);
    }
  }
  const target=findNearestShip(s.player.root.position,90);
  s.nearest=target;
  if(target){
    s.targetRing.isVisible=true;
    s.targetRing.position.set(target.root.position.x,.55,target.root.position.z);
  }else s.targetRing.isVisible=false;
}

function updateAIShip(s,ship,dt){
  ship.reload=Math.max(0,ship.reload-dt);
  const p=s.player;
  let target=null;

  if(ship.type==="pirate"){
    const dp=dist2(ship.root.position,p.root.position);
    if(dp<115) target={kind:"player",pos:p.root.position};
    else{
      let best=null,bestD=95;
      for(const other of s.aiShips){
        if(other===ship||other.sunk||other.type!=="merchant")continue;
        const d=dist2(ship.root.position,other.root.position);
        if(d<bestD){bestD=d;best=other;}
      }
      if(best)target={kind:"ship",ship:best,pos:best.root.position};
    }
  }

  let targetPos;
  if(target) targetPos=target.pos;
  else{
    const dest=PORTS[ship.routeIndex%PORTS.length];
    targetPos=new BABYLON.Vector3(dest.x,0,dest.z);
    if(dist2(ship.root.position,dest)<dest.radius+18){
      ship.routeIndex=(ship.routeIndex+2+Math.floor(Math.random()*3))%PORTS.length;
    }
  }

  const dx=targetPos.x-ship.root.position.x,dz=targetPos.z-ship.root.position.z;
  const desired=Math.atan2(dx,dz);
  const diff=angleWrap(desired-ship.heading);
  ship.heading+=clamp(diff,-1,1)*dt*(target?.kind?0.52:.34);
  ship.root.rotation.y=ship.heading;

  let speed=ship.type==="pirate"?13.5:10.5;
  if(target && Math.hypot(dx,dz)<48)speed*=.65;
  if(ship.speedPenalty>0){ speed*=.65; ship.speedPenalty=Math.max(0,ship.speedPenalty-dt*.06); }
  ship.speed=lerp(ship.speed,speed,1-Math.exp(-dt*1.25));
  ship.root.position.addInPlace(dirFromHeading(ship.heading).scale(ship.speed*dt));

  for(const isl of s.islands){
    const d=dist2(ship.root.position,isl.def);
    const min=isl.def.radius+4;
    if(d<min){
      const vx=ship.root.position.x-isl.def.x,vz=ship.root.position.z-isl.def.z,inv=1/(Math.hypot(vx,vz)||1);
      ship.root.position.x=isl.def.x+vx*inv*min; ship.root.position.z=isl.def.z+vz*inv*min;
      ship.heading+=.7;
    }
  }

  if(target && ship.reload<=0){
    const d=Math.hypot(dx,dz);
    const f=dirFromHeading(ship.heading);
    const to=new BABYLON.Vector3(dx,0,dz).normalize();
    const broadside=Math.abs(BABYLON.Vector3.Dot(f,to));
    if(d<72 && broadside<.62){
      fireAIBroadside(s,ship,target);
      ship.reload=6.8+Math.random()*3.2;
    }
  }
}

function findNearestShip(pos,max=999){
  if(!sea)return null;
  let best=null,bd=max;
  for(const s of sea.aiShips){
    if(s.sunk)continue;
    const d=dist2(pos,s.root.position);
    if(d<bd){bd=d;best=s;}
  }
  return best;
}

function currentAmmo(){
  return AMMO.find(a=>a.id===state.ammoType)||AMMO[0];
}
function reloadDuration(){
  return clamp(10.4-state.crew*.11-state.cannonLevel*.45,4.2,9.5);
}

function firePlayerBroadside(){
  if(state.mode!=="SEA"||!sea||!modal.classList.contains("hidden"))return;
  const p=sea.player;
  if(p.reload>0){ toast("Пушки ещё перезаряжаются."); return; }
  const ammo=currentAmmo();
  const count=state.cannons;
  if((state.ammo[ammo.id]||0)<count){ toast("Недостаточно боеприпасов: "+ammo.name); return; }

  let target=findNearestShip(p.root.position,ammo.range);
  let side=1;
  if(target){
    const to=target.root.position.subtract(p.root.position);
    side=BABYLON.Vector3.Dot(to,rightFromHeading(p.heading))>=0?1:-1;
  }else side=sea.lastSide===1?-1:1;
  sea.lastSide=side;

  state.ammo[ammo.id]-=count;
  p.reload=p.reloadMax=reloadDuration();
  cannonSound();
  sea.addShake(.34);

  for(let i=0;i<count;i++){
    const delay=i*55+Math.random()*95;
    setTimeout(()=>{
      if(state.mode!=="SEA"||p.sunk)return;
      const right=rightFromHeading(p.heading);
      const f=dirFromHeading(p.heading);
      const zoff=-4.3+i*(8.6/Math.max(1,count-1));
      const muzzle=p.root.position.add(right.scale(side*3.2)).add(f.scale(zoff));
      muzzle.y=4.2;
      const spread=(Math.random()-.5)*.11;
      const aim=right.scale(side).add(f.scale(spread)).normalize();
      const v=aim.scale(ammo.speed*(.94+Math.random()*.12));
      v.y=6.0+Math.random()*1.4;
      spawnBall(sea,muzzle,v,{kind:"player"},ammo);
      puff(sea.scene,muzzle,"#aaa69c",.85);
      sea.addShake(.12+Math.random()*.08);
      if(Math.random()<.45)cannonSound();
    },delay);
  }
  updateHUD();
}

function fireAIBroadside(s,ship,target){
  const right=rightFromHeading(ship.heading);
  const to=target.pos.subtract(ship.root.position);
  const side=BABYLON.Vector3.Dot(to,right)>=0?1:-1;
  const ammo=AMMO[0];
  for(let i=0;i<4;i++){
    setTimeout(()=>{
      if(ship.sunk||state.mode!=="SEA")return;
      const f=dirFromHeading(ship.heading);
      const muzzle=ship.root.position.add(rightFromHeading(ship.heading).scale(side*3)).add(f.scale(-3+i*2));
      muzzle.y=4;
      const aim=target.pos.subtract(ship.root.position);aim.y=0;aim.normalize();
      aim.addInPlace(f.scale((Math.random()-.5)*.15)).normalize();
      const v=aim.scale(42*(.95+Math.random()*.1));v.y=5.8+Math.random();
      spawnBall(s,muzzle,v,{kind:"ai",ship},ammo);
      puff(s.scene,muzzle,"#9e9b92",.7);
    },i*80+Math.random()*70);
  }
}

function spawnBall(s,pos,vel,owner,ammo){
  const m=BABYLON.MeshBuilder.CreateSphere("ball",{diameter:.48,segments:6},s.scene);
  m.position.copyFrom(pos);m.material=material(s.scene,"iron","#171b1b",.08);
  const tail=BABYLON.MeshBuilder.CreateSphere("ember",{diameter:.25,segments:5},s.scene);
  tail.parent=m;tail.position.z=-.25;tail.material=material(s.scene,"ember","#b6422d",.55);
  s.cannonballs.push({mesh:m,vel,owner,ammo,age:0});
}

function updateCannonballs(s,dt){
  for(let i=s.cannonballs.length-1;i>=0;i--){
    const b=s.cannonballs[i];b.age+=dt;
    b.vel.y-=b.ammo.gravity*dt;
    b.mesh.position.addInPlace(b.vel.scale(dt));
    let hit=false;
    if(b.owner.kind!=="player" && !s.player.sunk){
      if(dist2(b.mesh.position,s.player.root.position)<3.6 && Math.abs(b.mesh.position.y-s.player.root.position.y)<4.3){
        damagePlayerShip(b.ammo.damage*(.82+Math.random()*.35),b.ammo);
        hit=true;
      }
    }
    if(!hit){
      for(const sh of s.aiShips){
        if(sh.sunk || (b.owner.ship===sh))continue;
        if(dist2(b.mesh.position,sh.root.position)<3.7 && Math.abs(b.mesh.position.y-sh.root.position.y)<4.4){
          damageAIShip(sh,b.ammo.damage*(.82+Math.random()*.35),b.ammo,b.owner.kind==="player");
          hit=true;break;
        }
      }
    }
    if(hit){
      puff(s.scene,b.mesh.position,"#d5d2c5",.55);
      tone(105,.12,"triangle",.045);
      b.mesh.dispose();s.cannonballs.splice(i,1);continue;
    }
    if(b.mesh.position.y<oceanHeight(b.mesh.position.x,b.mesh.position.z,s.elapsed)*.25+.1 || b.age>5){
      puff(s.scene,b.mesh.position,"#d9edf0",.8);
      b.mesh.dispose();s.cannonballs.splice(i,1);
    }
  }
}

function damagePlayerShip(amount,ammo){
  state.shipHp=Math.max(0,state.shipHp-amount);
  sea.player.hp=state.shipHp;
  if(ammo.id==="chain") sea.player.speedPenalty=clamp(sea.player.speedPenalty+.22,0,.55);
  sea.addShake(.24);
  if(state.shipHp<=0) sinkPlayer();
}

function damageAIShip(ship,amount,ammo,byPlayer){
  ship.hp=Math.max(0,ship.hp-amount);
  if(ammo.id==="chain")ship.speedPenalty=clamp(ship.speedPenalty+.22,0,.55);
  if(ship.hp<=0 && !ship.sunk) sinkAI(ship,byPlayer);
}

function sinkAI(ship,byPlayer){
  ship.sunk=true;
  if(byPlayer){
    const reward=ship.type==="pirate"?180:80;
    state.gold+=reward;awardXP(ship.type==="pirate"?35:12);
    toast(ship.name+" потоплен. +"+reward+" золота");
    if(ship.type==="pirate"){
      state.pirateKills++;
      if(state.quest && state.quest.type==="pirates" && !state.quest.done){
        state.quest.progress++;
        if(state.quest.progress>=state.quest.target){state.quest.done=true;toast("Задание губернатора выполнено!",3500);}
      }
    }
  }
  const root=ship.root;
  let t=0;
  const obs=sea.scene.onBeforeRenderObservable.add(()=>{
    const dt=engine.getDeltaTime()/1000;t+=dt;
    root.position.y-=dt*1.8;root.rotation.z=lerp(root.rotation.z,.72,dt*.45);
    if(t>3.4){
      sea.scene.onBeforeRenderObservable.remove(obs);
      root.setEnabled(false);
      setTimeout(()=>respawnAI(ship),6000+Math.random()*5000);
    }
  });
}

function respawnAI(ship){
  const d=PORTS[Math.floor(Math.random()*PORTS.length)];
  const a=Math.random()*Math.PI*2,r=d.radius+45+Math.random()*60;
  ship.root.position.set(d.x+Math.sin(a)*r,1,d.z+Math.cos(a)*r);
  ship.heading=a+Math.PI;ship.root.rotation.y=ship.heading;ship.root.rotation.z=0;ship.root.rotation.x=0;
  ship.hp=ship.maxHp;ship.sunk=false;ship.root.setEnabled(true);ship.reload=3+Math.random()*5;
}

function sinkPlayer(){
  if(sea.player.sunk)return;
  sea.player.sunk=true;toast("Корабль потерян. Вас подобрали у ближайшего порта.",3500);
  const root=sea.player.root;let t=0;
  const obs=sea.scene.onBeforeRenderObservable.add(()=>{
    const dt=engine.getDeltaTime()/1000;t+=dt;root.position.y-=dt*1.5;root.rotation.z=lerp(root.rotation.z,.75,dt*.4);
    if(t>2.5){
      sea.scene.onBeforeRenderObservable.remove(obs);
      const nearest=[...PORTS].filter(x=>x.port).sort((a,b)=>dist2(root.position,a)-dist2(root.position,b))[0];
      root.position.set(nearest.x,1,nearest.z+nearest.radius+22);root.rotation.z=0;root.rotation.x=0;
      state.shipHp=state.shipMaxHp*.65;root.setEnabled(true);sea.player.sunk=false;
      state.gold=Math.max(0,state.gold-150);toast("Ремонт в порту стоил 150 золота.");
    }
  });
}

function updateSeaAction(s){
  const p=s.player.root.position;
  const t=s.nearest;
  let action=null;
  if(t && t.type==="pirate" && t.hp/t.maxHp<.42 && dist2(p,t.root.position)<13){
    action={type:"board",target:t,text:"E — взять на абордаж"};
  }else{
    let nearIsland=null,bd=999;
    for(const isl of s.islands){
      const d=dist2(p,isl.def);
      if(d<bd){bd=d;nearIsland=isl;}
    }
    if(nearIsland && bd<nearIsland.def.radius+18){
      if(nearIsland.def.port) action={type:"port",island:nearIsland,text:"E — войти в "+nearIsland.def.name};
      else action={type:"land",island:nearIsland,text:"E — высадиться: "+nearIsland.def.name};
    }
  }
  s.action=action;
  if(action){actionHint.textContent=action.text;actionHint.classList.remove("hidden");}
  else actionHint.classList.add("hidden");
}

function seaAction(){
  if(!sea||!sea.action)return;
  const a=sea.action;
  if(a.type==="port")openPort(a.island);
  else if(a.type==="land")enterIsland(a.island);
  else if(a.type==="board")enterBoarding(a.target);
}

function priceFor(portId,goodId){
  const pi=PORTS.findIndex(p=>p.id===portId);
  const gi=GOODS.findIndex(g=>g.id===goodId);
  const wave=((pi*13+gi*7)%9)-4;
  return Math.max(8,Math.round(GOODS[gi].base*(1+wave*.055)));
}
function cargoUsed(){ return GOODS.reduce((n,g)=>n+(state.cargo[g.id]||0),0); }

function openModal(title){
  modalTitle.textContent=title;modalBody.innerHTML="";modal.classList.remove("hidden");
}
function closeModal(){
  modal.classList.add("hidden");
  modalBody.innerHTML="";
}
$("modalClose").addEventListener("click",closeModal);

function button(text,fn,cls=""){
  const b=document.createElement("button");b.textContent=text;if(cls)b.className=cls;b.addEventListener("click",fn);return b;
}
function addInfoGrid(items){
  const g=document.createElement("div");g.className="info-grid";
  for(const [k,v] of items){const d=document.createElement("div");d.innerHTML="<b>"+k+"</b><br>"+v;g.appendChild(d);}
  modalBody.appendChild(g);
}

function openPort(island){
  state.currentPort=island.def.id;
  state.shipHp=Math.min(state.shipMaxHp,state.shipHp+3);
  openModal(island.def.name);
  addInfoGrid([
    ["Корабль",state.shipClass+" · "+Math.round(state.shipHp)+"/"+state.shipMaxHp],
    ["Золото",Math.round(state.gold)],
    ["Груз",cargoUsed()+"/"+state.cargoCapacity],
    ["Экипаж",state.crew+" моряков · "+state.soldiers+" солдат"]
  ]);
  const grid=document.createElement("div");grid.className="menu-grid";
  grid.append(
    button("Рынок",()=>renderMarket(island)),
    button("Верфь",()=>renderShipyard(island)),
    button("Таверна",()=>renderTavern(island)),
    button("Губернатор",()=>renderGovernor(island)),
    button("Высадиться в городе",()=>{closeModal();enterIsland(island);}),
    button("Выйти в море",()=>{closeModal();toast("Курс проложен. Попутного ветра!");},"primary")
  );
  modalBody.appendChild(grid);
}

function renderMarket(island){
  openModal("Рынок — "+island.def.name);
  const note=document.createElement("div");note.className="note";note.textContent="Цены различаются по портам. Купите дешевле и продайте дороже в другом городе.";modalBody.appendChild(note);
  for(const g of GOODS){
    const price=priceFor(island.def.id,g.id);
    const row=document.createElement("div");row.className="shop-row";
    row.innerHTML=`<b>${g.name}</b><span>${price} 🪙</span><span>У вас: ${state.cargo[g.id]||0}</span>`;
    const actions=document.createElement("div");actions.style.display="flex";actions.style.gap="5px";
    const buy=button("+",()=>{
      if(state.gold<price)return toast("Не хватает золота.");
      if(cargoUsed()>=state.cargoCapacity)return toast("Трюм заполнен.");
      state.gold-=price;state.cargo[g.id]=(state.cargo[g.id]||0)+1;renderMarket(island);
    });
    const sell=button("−",()=>{
      if((state.cargo[g.id]||0)<=0)return toast("Этого товара нет.");
      state.cargo[g.id]--;state.gold+=Math.round(price*.92);renderMarket(island);
    });
    actions.append(buy,sell);row.appendChild(actions);modalBody.appendChild(row);
  }
  const ammoRow=document.createElement("div");ammoRow.className="note";
  ammoRow.textContent="Боеприпасы продаются в порту: ядра 8, картечь 11, цепь 14, бомбы 20 золота за штуку.";
  modalBody.appendChild(ammoRow);
  const ammoGrid=document.createElement("div");ammoGrid.className="menu-grid";
  [["ball","Купить 12 ядер",96],["grape","Купить 8 картечи",88],["chain","Купить 6 цепей",84],["bomb","Купить 5 бомб",100]].forEach(([id,label,cost])=>{
    ammoGrid.appendChild(button(label,()=>{if(state.gold<cost)return toast("Не хватает золота.");state.gold-=cost;state.ammo[id]+=id==="ball"?12:id==="grape"?8:id==="chain"?6:5;renderMarket(island);}));
  });
  modalBody.appendChild(ammoGrid);
  modalBody.appendChild(button("← Назад",()=>openPort(island)));
}

function renderShipyard(island){
  openModal("Верфь — "+island.def.name);
  const missing=Math.max(0,state.shipMaxHp-state.shipHp);
  const repair=Math.ceil(missing*2.2);
  addInfoGrid([
    ["Корпус",Math.round(state.shipHp)+"/"+state.shipMaxHp],
    ["Орудия","уровень "+state.cannonLevel+" · "+state.cannons+" на борт"],
    ["Ремонт",repair+" золота"],
    ["Дерево",state.wood]
  ]);
  const g=document.createElement("div");g.className="menu-grid";
  g.append(
    button("Полный ремонт — "+repair+" 🪙",()=>{
      if(repair<=0)return toast("Корпус уже цел.");
      if(state.gold<repair)return toast("Не хватает золота.");
      state.gold-=repair;state.shipHp=state.shipMaxHp;sea.player.hp=state.shipHp;renderShipyard(island);
    },"good"),
    button("Ремонт деревом (5 ед.)",()=>{
      if(state.wood<5)return toast("Нужно 5 дерева.");
      state.wood-=5;state.shipHp=Math.min(state.shipMaxHp,state.shipHp+28);renderShipyard(island);
    }),
    button("Улучшить пушки — "+(450*state.cannonLevel)+" 🪙",()=>{
      const cost=450*state.cannonLevel;if(state.gold<cost)return toast("Не хватает золота.");
      if(state.cannonLevel>=5)return toast("Орудия уже максимального уровня.");
      state.gold-=cost;state.cannonLevel++;state.shipMaxHp+=8;renderShipyard(island);toast("Пушки усилены.");
    }),
    button("Расширить трюм — "+(380+(state.cargoCapacity-45)*12)+" 🪙",()=>{
      const cost=380+(state.cargoCapacity-45)*12;if(state.gold<cost)return toast("Не хватает золота.");
      state.gold-=cost;state.cargoCapacity+=10;renderShipyard(island);
    }),
    button("← Назад",()=>openPort(island))
  );
  modalBody.appendChild(g);
}

function renderTavern(island){
  openModal("Таверна — "+island.def.name);
  const n=document.createElement("div");n.className="note";n.textContent="Хороший экипаж ускоряет перезарядку пушек. Солдаты помогают на абордаже.";modalBody.appendChild(n);
  const g=document.createElement("div");g.className="menu-grid";
  g.append(
    button("Нанять 5 матросов — 180 🪙",()=>{if(state.gold<180)return toast("Не хватает золота.");state.gold-=180;state.crew=Math.min(60,state.crew+5);renderTavern(island);}),
    button("Нанять 3 солдат — 210 🪙",()=>{if(state.gold<210)return toast("Не хватает золота.");state.gold-=210;state.soldiers=Math.min(30,state.soldiers+3);renderTavern(island);}),
    button("Отдохнуть — 60 🪙",()=>{if(state.gold<60)return toast("Не хватает золота.");state.gold-=60;state.charHp=state.charMaxHp;renderTavern(island);}),
    button("← Назад",()=>openPort(island))
  );modalBody.appendChild(g);
}

function renderGovernor(island){
  openModal("Губернатор — "+island.def.name);
  if(!state.quest){
    const n=document.createElement("div");n.className="note";n.innerHTML="Губернатор: <b>«Пираты мешают торговле. Потопите три пиратских корабля.»</b><br>Награда: 900 золота и 180 опыта.";modalBody.appendChild(n);
    modalBody.appendChild(button("Принять задание",()=>{state.quest={type:"pirates",target:3,progress:0,reward:900,xp:180,done:false};renderGovernor(island);},"primary"));
  }else if(state.quest.done){
    const n=document.createElement("div");n.className="note";n.textContent="Задание выполнено. Губернатор готов выдать награду.";modalBody.appendChild(n);
    modalBody.appendChild(button("Получить 900 золота и 180 XP",()=>{state.gold+=state.quest.reward;awardXP(state.quest.xp);state.quest=null;renderGovernor(island);},"good"));
  }else{
    const n=document.createElement("div");n.className="note";n.textContent="Пираты потоплены: "+state.quest.progress+" / "+state.quest.target;modalBody.appendChild(n);
  }
  modalBody.appendChild(button("← Назад",()=>openPort(island)));
}

function showCharacter(){
  openModal("Персонаж и снаряжение");
  addInfoGrid([
    ["Капитан",state.hero==="female"?"Изабель":"Диего"],
    ["Уровень",state.level+" · XP "+state.xp+"/"+state.xpNext],
    ["Здоровье",Math.round(state.charHp)+"/"+state.charMaxHp],
    ["Сабля","уровень "+state.swordLevel],
    ["Броня","уровень "+state.armorLevel],
    ["Пистолет","уровень "+state.pistolLevel],
    ["Дерево",state.wood],
    ["Мясо",state.meat]
  ]);
  const g=document.createElement("div");g.className="menu-grid";
  const sc=260*state.swordLevel,ac=240*(state.armorLevel+1),pc=280*state.pistolLevel;
  g.append(
    button("Улучшить саблю — "+sc+" 🪙",()=>{if(state.gold<sc)return toast("Не хватает золота.");state.gold-=sc;state.swordLevel++;showCharacter();}),
    button("Улучшить броню — "+ac+" 🪙",()=>{if(state.gold<ac)return toast("Не хватает золота.");state.gold-=ac;state.armorLevel++;state.charMaxHp+=7;state.charHp+=7;showCharacter();}),
    button("Улучшить пистолет — "+pc+" 🪙",()=>{if(state.gold<pc)return toast("Не хватает золота.");state.gold-=pc;state.pistolLevel++;showCharacter();})
  );modalBody.appendChild(g);
}

function createHumanoid(scene,kind="player",hero="female"){
  const root=new BABYLON.TransformNode(kind,scene);
  const enemy=kind!=="player"&&kind!=="ally";
  const coat=enemy?(kind==="native"?"#6f5735":"#3f3130"):(hero==="female"?"#7a2d31":"#274d67");
  const skin="#c99570";
  const pants=enemy?"#352e27":"#2c302f";

  const body=BABYLON.MeshBuilder.CreateCylinder("body",{height:2.5,diameterTop:1.35,diameterBottom:1.7,tessellation:10},scene);
  body.position.y=2.75;body.parent=root;body.material=material(scene,"coat-"+coat,coat);
  const head=BABYLON.MeshBuilder.CreateSphere("head",{diameter:1.25,segments:10},scene);
  head.position.y=4.55;head.parent=root;head.material=material(scene,"skin",skin);
  if(!enemy){
    const hair=BABYLON.MeshBuilder.CreateSphere("hair",{diameter:1.32,segments:9},scene);
    hair.scaling.y=.72;hair.position.set(0,4.85,-.13);hair.parent=root;hair.material=material(scene,"hair-"+hero,hero==="female"?"#9a3e27":"#3a2b23");
  }
  const legL=BABYLON.MeshBuilder.CreateBox("leg",{width:.55,height:1.9,depth:.65},scene);
  legL.position.set(-.48,1.05,0);legL.parent=root;legL.material=material(scene,"pants-"+pants,pants);
  const legR=legL.clone("legR");legR.position.x=.48;legR.parent=root;
  const armL=BABYLON.MeshBuilder.CreateBox("arm",{width:.42,height:2.25,depth:.5},scene);
  armL.position.set(-1.02,2.95,0);armL.parent=root;armL.material=material(scene,"armcoat-"+coat,coat);
  const armR=armL.clone("armR");armR.position.x=1.02;armR.parent=root;

  const blade=BABYLON.MeshBuilder.CreateBox("sword",{width:.13,height:2.3,depth:.12},scene);
  blade.position.set(.0,-1.45,.0);blade.parent=armR;blade.material=material(scene,"steel","#bfc9c8",.18);
  const guard=BABYLON.MeshBuilder.CreateBox("guard",{width:.85,height:.12,depth:.12},scene);
  guard.position.set(0,-.35,0);guard.parent=armR;guard.material=material(scene,"guard","#d0a64d",.08);
  armR.rotation.z=-.26;

  const hat=BABYLON.MeshBuilder.CreateCylinder("hat",{height:.25,diameter:1.65,tessellation:16},scene);
  hat.position.y=5.15;hat.parent=root;hat.material=material(scene,"hat","#29231f");
  const crown=BABYLON.MeshBuilder.CreateCylinder("crown",{height:.55,diameterTop:.82,diameterBottom:1.05,tessellation:12},scene);
  crown.position.y=5.46;crown.parent=root;crown.material=material(scene,"hat","#29231f");

  root.metadata={armR,armL,body,blade,kind};
  return root;
}

function createTree(scene,pos){
  const root=new BABYLON.TransformNode("tree",scene);root.position.copyFrom(pos);
  const trunk=BABYLON.MeshBuilder.CreateCylinder("trunk",{height:5.2,diameter:.7,tessellation:8},scene);
  trunk.position.y=2.6;trunk.parent=root;trunk.material=material(scene,"landtrunk","#60472f");
  for(let i=0;i<3;i++){
    const c=BABYLON.MeshBuilder.CreateSphere("crown",{diameter:3.5,segments:7},scene);
    c.position.set((i-1)*1.1,5.4+(i%2)*.5,(i%2?.7:-.5));c.parent=root;c.material=material(scene,"landleaf","#315c35");
  }
  return {root,type:"tree",used:false};
}
function createChest(scene,pos){
  const root=new BABYLON.TransformNode("chest",scene);root.position.copyFrom(pos);
  const b=BABYLON.MeshBuilder.CreateBox("chestBox",{width:2,height:1.1,depth:1.35},scene);
  b.position.y=.65;b.parent=root;b.material=material(scene,"chest","#704622");
  const band=BABYLON.MeshBuilder.CreateBox("band",{width:.28,height:1.17,depth:1.42},scene);
  band.position.y=.67;band.parent=root;band.material=material(scene,"gold","#c5983f",.08);
  return {root,type:"chest",used:false};
}
function createBoar(scene,pos){
  const root=new BABYLON.TransformNode("boar",scene);root.position.copyFrom(pos);
  const body=BABYLON.MeshBuilder.CreateSphere("boarBody",{diameter:2.3,segments:8},scene);
  body.scaling.set(1.35,.75,.8);body.position.y=1;body.parent=root;body.material=material(scene,"boar","#5d4638");
  const head=BABYLON.MeshBuilder.CreateSphere("boarHead",{diameter:1.2,segments:7},scene);
  head.position.set(0,1,1.35);head.parent=root;head.material=material(scene,"boar","#5d4638");
  return root;
}

function randomGroundPos(i,r=23){
  const a=(i*2.399)+.7;const rr=5+((i*17)%100)/100*(r-5);
  return new BABYLON.Vector3(Math.sin(a)*rr,0,Math.cos(a)*rr);
}

function createLandScene(island){
  const scene=new BABYLON.Scene(engine);addSkyLighting(scene);
  scene.fogDensity=.006;
  const ocean=createOcean(scene,180);
  const ground=BABYLON.MeshBuilder.CreateCylinder("land",{diameter:66,height:2.4,tessellation:56},scene);
  ground.position.y=.2;ground.material=material(scene,"land","#4e783e");
  const beach=BABYLON.MeshBuilder.CreateCylinder("beach",{diameter:75,height:1.2,tessellation:56},scene);
  beach.position.y=-.65;beach.material=material(scene,"beach","#c9b274");

  const camera=new BABYLON.ArcRotateCamera("landCam",-Math.PI/2,0.92,28,new BABYLON.Vector3(0,2,0),scene);
  camera.lowerRadiusLimit=22;camera.upperRadiusLimit=42;camera.panningSensibility=0;camera.attachControl(canvas,true);

  const player=createHumanoid(scene,"player",state.hero);player.position.set(0,0,15);
  const resources=[];
  for(let i=0;i<11;i++){const p=randomGroundPos(i,25);if(Math.abs(p.z-15)<5)continue;resources.push(createTree(scene,p));}
  resources.push(createChest(scene,new BABYLON.Vector3(-9,0,-12)));

  const enemies=[];
  const nPirates=island.def.port?3:4;
  for(let i=0;i<nPirates;i++){
    const root=createHumanoid(scene,"pirate","male");root.position.copyFrom(randomGroundPos(i+21,22));
    enemies.push({root,type:"pirate",hp:55+state.level*3,maxHp:55+state.level*3,alive:true,cooldown:0,attack:0});
  }
  if(!island.def.port){
    for(let i=0;i<3;i++){
      const root=createBoar(scene,randomGroundPos(i+41,22));
      enemies.push({root,type:"boar",hp:38,maxHp:38,alive:true,cooldown:0,attack:0});
    }
  }else{
    for(let i=0;i<4;i++)makeHouse(scene,null,-15+i*9,-19+(i%2)*5,.9);
  }
  for(let i=0;i<7;i++){const p=randomGroundPos(i+63,28);makePalm(scene,null,p.x,p.z,.85);}

  const boat=BABYLON.MeshBuilder.CreateBox("landingBoat",{width:4,height:1.1,depth:7},scene);
  boat.position.set(0,.8,29);boat.material=material(scene,"boat","#5a3925");

  const obj={scene,ocean,camera,player,enemies,resources,island,elapsed:0,attackTimer:0,pistolReload:0,action:null};
  scene.onBeforeRenderObservable.add(()=>{
    const dt=Math.min(.04,engine.getDeltaTime()/1000);obj.elapsed+=dt;
    ocean.shader.setFloat("time",obj.elapsed);ocean.shader.setVector3("cameraPosition",camera.position);
    if(state.mode==="LAND")updateLand(obj,dt);
  });
  return obj;
}

function updateLand(l,dt){
  const uiPaused=!modal.classList.contains("hidden");
  if(uiPaused)return;

  l.pistolReload=Math.max(0,l.pistolReload-dt);
  l.attackTimer=Math.max(0,l.attackTimer-dt);
  const mv=new BABYLON.Vector3(
    (keys["KeyD"]?1:0)-(keys["KeyA"]?1:0),
    0,
    (keys["KeyW"]?1:0)-(keys["KeyS"]?1:0)
  );
  if(mv.lengthSquared()>.01){
    mv.normalize();
    const speed=7.2;
    l.player.position.addInPlace(mv.scale(speed*dt));
    const r=Math.hypot(l.player.position.x,l.player.position.z);
    if(r>31){l.player.position.x*=31/r;l.player.position.z*=31/r;}
    l.player.rotation.y=Math.atan2(mv.x,mv.z);
  }
  const arm=l.player.metadata.armR;
  if(l.attackTimer>0){
    const p=1-l.attackTimer/.35;
    arm.rotation.x=-Math.sin(p*Math.PI)*1.5;
    arm.rotation.z=-.26-Math.sin(p*Math.PI)*.55;
  }else{arm.rotation.x=0;arm.rotation.z=-.26;}

  for(const e of l.enemies)updateLandEnemy(l,e,dt);
  l.camera.target=BABYLON.Vector3.Lerp(l.camera.target,l.player.position.add(new BABYLON.Vector3(0,2.2,0)),.14);
  updateLandAction(l);
  updateHUD();drawMinimap();
}

function updateLandEnemy(l,e,dt){
  if(!e.alive)return;
  e.cooldown=Math.max(0,e.cooldown-dt);
  const d=dist2(e.root.position,l.player.position);
  if(d<15){
    const dx=l.player.position.x-e.root.position.x,dz=l.player.position.z-e.root.position.z;
    const len=Math.hypot(dx,dz)||1;
    e.root.rotation.y=Math.atan2(dx,dz);
    if(d>2.2){
      const sp=e.type==="boar"?4.8:3.8;
      e.root.position.x+=dx/len*sp*dt;e.root.position.z+=dz/len*sp*dt;
    }else if(e.cooldown<=0){
      e.cooldown=e.type==="boar"?1.25:1.5;
      const dmg=(e.type==="boar"?10:13)*Math.max(.45,1-state.armorLevel*.1);
      state.charHp=Math.max(0,state.charHp-dmg);
      toast((e.type==="boar"?"Кабан":"Пират")+" наносит "+Math.round(dmg)+" урона.",1000);
      if(state.charHp<=0)landDeath();
    }
  }
}

function landAttack(){
  if(state.mode!=="LAND"||!land||land.attackTimer>0||!modal.classList.contains("hidden"))return;
  land.attackTimer=.35;swordSound();
  let best=null,bd=3.5;
  for(const e of land.enemies){
    if(!e.alive)continue;
    const d=dist2(e.root.position,land.player.position);
    if(d<bd){bd=d;best=e;}
  }
  if(best){
    const dmg=22+state.swordLevel*6+state.level*1.5;
    damageLandEnemy(best,dmg);
  }
}
function landPistol(){
  if(state.mode!=="LAND"||!land||land.pistolReload>0||!modal.classList.contains("hidden"))return;
  let best=null,bd=18;
  for(const e of land.enemies){
    if(!e.alive)continue;
    const d=dist2(e.root.position,land.player.position);
    if(d<bd){bd=d;best=e;}
  }
  if(!best){toast("Нет цели в дальности пистолета.");return;}
  land.pistolReload=Math.max(3.2,6-state.pistolLevel*.45);pistolSound();
  tracer(land.scene,land.player.position.add(new BABYLON.Vector3(0,3.5,0)),best.root.position.add(new BABYLON.Vector3(0,1.5,0)));
  damageLandEnemy(best,32+state.pistolLevel*9);
}
function tracer(scene,a,b){
  const line=BABYLON.MeshBuilder.CreateLines("shot",{points:[a,b]},scene);
  line.color=new BABYLON.Color3(1,.78,.35);
  setTimeout(()=>line.dispose(),85);
}
function damageLandEnemy(e,dmg){
  e.hp-=dmg;
  if(e.hp<=0){
    e.alive=false;e.root.rotation.z=Math.PI/2;e.root.position.y=.45;
    if(e.type==="boar"){state.meat+=2+Math.floor(Math.random()*3);awardXP(12);toast("Получено мясо.");}
    else{const g=35+Math.floor(Math.random()*55);state.gold+=g;awardXP(20);toast("Пират повержен. +"+g+" золота.");}
  }
}
function landDeath(){
  if(!land)return;
  state.charHp=state.charMaxHp;
  state.gold=Math.max(0,state.gold-100);
  toast("Вы потеряли сознание. −100 золота.",3000);
  returnToSea();
}
function updateLandAction(l){
  let action={type:"return",dist:dist2(l.player.position,{x:0,z:29}),text:"E — вернуться на корабль"};
  let bd=action.dist;
  for(const r of l.resources){
    if(r.used)continue;
    const d=dist2(l.player.position,r.root.position);
    if(d<bd){bd=d;action={type:r.type,res:r,dist:d,text:r.type==="tree"?"E — добыть дерево":"E — открыть сундук"};}
  }
  if(bd<3.4){
    l.action=action;actionHint.textContent=action.text;actionHint.classList.remove("hidden");
  }else{l.action=null;actionHint.classList.add("hidden");}
}
function landInteract(){
  if(!land||!land.action)return;
  const a=land.action;
  if(a.type==="return"){returnToSea();return;}
  if(a.res.used)return;
  a.res.used=true;
  if(a.type==="tree"){
    const n=2+Math.floor(Math.random()*4);state.wood+=n;a.res.root.scaling.y=.15;toast("Дерево: +"+n);
  }else{
    const gold=160+Math.floor(Math.random()*260);state.gold+=gold;state.ammo.bomb+=3;toast("Сокровище: +"+gold+" золота, +3 бомбы",3000);
    a.res.root.setEnabled(false);
  }
}

function enterIsland(island){
  closeModal();
  actionHint.classList.add("hidden");
  state.mode="LAND";
  if(landScene){landScene.dispose();landScene=null;}
  land=createLandScene(island);landScene=land.scene;activeScene=landScene;
  updateHUD();toast("Высадка: "+island.def.name);
}
function returnToSea(){
  actionHint.classList.add("hidden");
  state.mode="SEA";activeScene=seaScene;
  if(landScene){landScene.dispose();landScene=null;land=null;}
  if(boardingScene){boardingScene.dispose();boardingScene=null;boarding=null;}
  updateHUD();saveGame();
}

function createBoardingScene(target){
  const scene=new BABYLON.Scene(engine);addSkyLighting(scene);scene.fogDensity=.012;
  const camera=new BABYLON.ArcRotateCamera("boardCam",-Math.PI/2,.86,32,new BABYLON.Vector3(0,2,0),scene);
  camera.lowerRadiusLimit=24;camera.upperRadiusLimit=42;camera.panningSensibility=0;camera.attachControl(canvas,true);

  const water=createOcean(scene,120);
  function deck(x,color){
    const base=BABYLON.MeshBuilder.CreateBox("deck",{width:10,height:1.5,depth:28},scene);
    base.position.set(x,0,0);base.material=material(scene,"deckBoard",color);
    const rail1=BABYLON.MeshBuilder.CreateBox("rail",{width:.35,height:1.5,depth:28},scene);rail1.position.set(x-5.1,1.2,0);rail1.material=material(scene,"railBoard","#5a3825");
    const rail2=rail1.clone("rail2");rail2.position.x=x+5.1;
  }
  deck(-6,"#76502f");deck(6,"#4f3529");
  for(let i=-1;i<=1;i++){
    const plank=BABYLON.MeshBuilder.CreateBox("plank",{width:3.4,height:.35,depth:1.35},scene);
    plank.position.set(0,1.1,i*4);plank.material=material(scene,"plank","#8c6238");
  }

  const player=createHumanoid(scene,"player",state.hero);player.position.set(-6,1,8);
  const allies=[];
  const allyN=Math.max(1,Math.min(4,Math.floor(state.soldiers/3)));
  for(let i=0;i<allyN;i++){
    const r=createHumanoid(scene,"ally",state.hero);r.position.set(-7+(i%2)*2.2,1,4-Math.floor(i/2)*3);allies.push({root:r,hp:55,alive:true,cooldown:0});
  }
  const enemies=[];
  const enemyN=4+Math.min(4,Math.floor(target.maxHp/45));
  for(let i=0;i<enemyN;i++){
    const r=createHumanoid(scene,"pirate","male");r.position.set(6+(i%2?1.4:-1.4),1,-7+Math.floor(i/2)*3.2);
    enemies.push({root:r,hp:50+state.level*3,alive:true,cooldown:0});
  }

  const obj={scene,camera,water,player,allies,enemies,target,elapsed:0,attackTimer:0,pistolReload:0,finished:false};
  scene.onBeforeRenderObservable.add(()=>{
    const dt=Math.min(.04,engine.getDeltaTime()/1000);obj.elapsed+=dt;
    water.shader.setFloat("time",obj.elapsed);water.shader.setVector3("cameraPosition",camera.position);
    if(state.mode==="BOARD")updateBoarding(obj,dt);
  });
  return obj;
}

function enterBoarding(target){
  state.mode="BOARD";actionHint.classList.add("hidden");
  boarding=createBoardingScene(target);boardingScene=boarding.scene;activeScene=boardingScene;
  toast("Абордаж! Очистите палубу противника.",3000);updateHUD();
}
function updateBoarding(b,dt){
  if(b.finished||!modal.classList.contains("hidden"))return;
  b.pistolReload=Math.max(0,b.pistolReload-dt);b.attackTimer=Math.max(0,b.attackTimer-dt);

  const mv=new BABYLON.Vector3((keys["KeyD"]?1:0)-(keys["KeyA"]?1:0),0,(keys["KeyW"]?1:0)-(keys["KeyS"]?1:0));
  if(mv.lengthSquared()>.01){
    mv.normalize();b.player.position.addInPlace(mv.scale(6.4*dt));
    b.player.position.x=clamp(b.player.position.x,-10.2,10.2);b.player.position.z=clamp(b.player.position.z,-12.5,12.5);
    b.player.rotation.y=Math.atan2(mv.x,mv.z);
  }
  const arm=b.player.metadata.armR;
  if(b.attackTimer>0){const p=1-b.attackTimer/.35;arm.rotation.x=-Math.sin(p*Math.PI)*1.5;arm.rotation.z=-.26-Math.sin(p*Math.PI)*.55;}
  else{arm.rotation.x=0;arm.rotation.z=-.26;}

  for(const a of b.allies)updateBoardAlly(b,a,dt);
  for(const e of b.enemies)updateBoardEnemy(b,e,dt);
  b.camera.target=BABYLON.Vector3.Lerp(b.camera.target,b.player.position.add(new BABYLON.Vector3(0,2,0)),.12);
  updateHUD();

  if(!b.enemies.some(e=>e.alive)){
    b.finished=true;setTimeout(()=>boardingVictory(b),400);
  }
}
function nearestAlive(list,pos,max=999){
  let best=null,bd=max;for(const e of list){if(!e.alive)continue;const d=dist2(pos,e.root.position);if(d<bd){bd=d;best=e;}}return best;
}
function updateBoardAlly(b,a,dt){
  if(!a.alive)return;a.cooldown=Math.max(0,a.cooldown-dt);
  const e=nearestAlive(b.enemies,a.root.position,30);if(!e)return;
  const dx=e.root.position.x-a.root.position.x,dz=e.root.position.z-a.root.position.z,d=Math.hypot(dx,dz)||1;
  a.root.rotation.y=Math.atan2(dx,dz);
  if(d>2.1){a.root.position.x+=dx/d*3.6*dt;a.root.position.z+=dz/d*3.6*dt;}
  else if(a.cooldown<=0){a.cooldown=1.4;e.hp-=14+state.level;if(e.hp<=0)killBoardEnemy(e);}
}
function updateBoardEnemy(b,e,dt){
  if(!e.alive)return;e.cooldown=Math.max(0,e.cooldown-dt);
  let tgt={root:b.player,player:true,alive:true};
  let bd=dist2(e.root.position,b.player.position);
  for(const a of b.allies){if(!a.alive)continue;const d=dist2(e.root.position,a.root.position);if(d<bd){bd=d;tgt=a;}}
  const dx=tgt.root.position.x-e.root.position.x,dz=tgt.root.position.z-e.root.position.z,d=Math.hypot(dx,dz)||1;
  e.root.rotation.y=Math.atan2(dx,dz);
  if(d>2.15){e.root.position.x+=dx/d*3.4*dt;e.root.position.z+=dz/d*3.4*dt;}
  else if(e.cooldown<=0){
    e.cooldown=1.35;
    if(tgt.player){
      const dmg=12*Math.max(.45,1-state.armorLevel*.1);state.charHp=Math.max(0,state.charHp-dmg);
      if(state.charHp<=0)boardingDefeat(b);
    }else{
      tgt.hp-=13;if(tgt.hp<=0){tgt.alive=false;tgt.root.rotation.z=Math.PI/2;tgt.root.position.y=.45;}
    }
  }
}
function boardAttack(){
  if(state.mode!=="BOARD"||!boarding||boarding.attackTimer>0||boarding.finished)return;
  boarding.attackTimer=.35;swordSound();
  const e=nearestAlive(boarding.enemies,boarding.player.position,3.4);
  if(e){e.hp-=23+state.swordLevel*6+state.level*1.5;if(e.hp<=0)killBoardEnemy(e);}
}
function boardPistol(){
  if(state.mode!=="BOARD"||!boarding||boarding.pistolReload>0||boarding.finished)return;
  const e=nearestAlive(boarding.enemies,boarding.player.position,17);
  if(!e){toast("Нет цели.");return;}
  boarding.pistolReload=Math.max(3,5.8-state.pistolLevel*.42);pistolSound();
  tracer(boarding.scene,boarding.player.position.add(new BABYLON.Vector3(0,3.5,0)),e.root.position.add(new BABYLON.Vector3(0,3,0)));
  e.hp-=34+state.pistolLevel*9;if(e.hp<=0)killBoardEnemy(e);
}
function killBoardEnemy(e){
  if(!e.alive)return;e.alive=false;e.root.rotation.z=Math.PI/2;e.root.position.y=.45;awardXP(15);state.gold+=20;
}
function boardingDefeat(b){
  if(b.finished)return;b.finished=true;state.charHp=state.charMaxHp;state.gold=Math.max(0,state.gold-180);
  toast("Абордаж проигран. Потеряно 180 золота.",3200);
  setTimeout(returnToSea,1000);
}
function boardingVictory(b){
  openModal("Победа на абордаже");
  const note=document.createElement("div");note.className="note";note.textContent="Палуба захвачена. Выберите судьбу корабля.";modalBody.appendChild(note);
  const g=document.createElement("div");g.className="menu-grid";
  g.append(
    button("Забрать корабль",()=>{
      state.shipClass="Захваченный бриг";state.shipMaxHp+=24;state.shipHp=state.shipMaxHp;state.cargoCapacity+=8;
      state.gold+=320;awardXP(80);sinkAI(b.target,false);closeModal();returnToSea();toast("Новый корабль усилен. +320 золота",3200);
    },"good"),
    button("Потопить и забрать добычу",()=>{
      state.gold+=650;state.wood+=6;awardXP(95);sinkAI(b.target,true);closeModal();returnToSea();toast("Добыча: +650 золота, +6 дерева",3200);
    },"danger")
  );modalBody.appendChild(g);
}

function updateHUD(){
  hud.classList.toggle("hidden",state.mode==="TITLE");
  $("modeLabel").textContent=state.mode==="SEA"?"МОРЕ":state.mode==="LAND"?"ОСТРОВ":"АБОРДАЖ";
  const hp=state.mode==="SEA"?state.shipHp:state.charHp;
  const hm=state.mode==="SEA"?state.shipMaxHp:state.charMaxHp;
  $("hpBar").style.width=(clamp(hp/hm,0,1)*100)+"%";
  $("hpText").textContent=Math.round(hp)+"/"+hm;
  $("sailsText").textContent=state.sails+"/3";
  $("speedText").textContent=state.mode==="SEA"&&sea?Math.round(sea.player.speed):"—";
  $("crewText").textContent=state.crew;
  $("levelText").textContent=state.level;$("xpText").textContent=state.xp+"/"+state.xpNext;
  $("goldText").textContent=Math.round(state.gold);
  const ammo=currentAmmo();$("ammoText").textContent=ammo.name;$("ammoCount").textContent=state.ammo[ammo.id]||0;
  $("windArrow").style.transform="rotate("+((sea?.windAngle||0)*180/Math.PI)+"deg)";

  if(state.mode==="SEA"&&sea){
    const r=sea.player.reload,rm=sea.player.reloadMax||reloadDuration();
    $("reloadBar").style.width=((1-clamp(r/rm,0,1))*100)+"%";
    $("reloadText").textContent=r<=0?"Готово":r.toFixed(1)+" с";
    if(sea.nearest){
      $("targetBox").classList.remove("hidden");
      $("targetName").textContent=sea.nearest.name;
      $("targetDist").textContent=Math.round(dist2(sea.player.root.position,sea.nearest.root.position))+" м";
      $("targetHp").textContent=Math.round(sea.nearest.hp)+"/"+sea.nearest.maxHp;
    }else $("targetBox").classList.add("hidden");
  }else{
    $("reloadBar").style.width="100%";
    $("reloadText").textContent=state.mode==="LAND"?(land&&land.pistolReload>0?"Пистолет "+land.pistolReload.toFixed(1)+" с":"Готово"):(boarding&&boarding.pistolReload>0?"Пистолет "+boarding.pistolReload.toFixed(1)+" с":"Готово");
    $("targetBox").classList.add("hidden");
  }
}

function drawMinimap(){
  const w=minimap.width,h=minimap.height;
  miniCtx.clearRect(0,0,w,h);
  miniCtx.save();miniCtx.translate(w/2,h/2);
  miniCtx.fillStyle="rgba(10,38,47,.92)";miniCtx.beginPath();miniCtx.arc(0,0,w*.48,0,Math.PI*2);miniCtx.fill();
  if(state.mode==="SEA"&&sea){
    const sc=w/700;
    for(const i of PORTS){
      miniCtx.fillStyle=i.port?"#b9a45d":"#6f8f58";
      miniCtx.beginPath();miniCtx.arc(i.x*sc,i.z*sc,Math.max(3,i.radius*sc*.6),0,Math.PI*2);miniCtx.fill();
    }
    for(const sh of sea.aiShips){
      if(sh.sunk)continue;miniCtx.fillStyle=sh.type==="pirate"?"#c65b50":"#d5cda9";
      miniCtx.fillRect(sh.root.position.x*sc-2,sh.root.position.z*sc-2,4,4);
    }
    miniCtx.save();miniCtx.translate(sea.player.root.position.x*sc,sea.player.root.position.z*sc);miniCtx.rotate(-sea.player.heading);
    miniCtx.fillStyle="#f0c968";miniCtx.beginPath();miniCtx.moveTo(0,-6);miniCtx.lineTo(4,5);miniCtx.lineTo(-4,5);miniCtx.closePath();miniCtx.fill();miniCtx.restore();
  }else{
    miniCtx.strokeStyle="rgba(210,194,130,.7)";miniCtx.beginPath();miniCtx.arc(0,0,w*.37,0,Math.PI*2);miniCtx.stroke();
    const obj=state.mode==="LAND"?land:boarding;
    if(obj){
      miniCtx.fillStyle="#f0c968";miniCtx.beginPath();miniCtx.arc(obj.player.position.x*3,obj.player.position.z*3,4,0,Math.PI*2);miniCtx.fill();
      const enemies=obj.enemies||[];miniCtx.fillStyle="#c65b50";
      for(const e of enemies){if(!e.alive)continue;miniCtx.fillRect(e.root.position.x*3-2,e.root.position.z*3-2,4,4);}
    }
  }
  miniCtx.restore();
}

function toggleMap(){
  mapBig=!mapBig;
  if(mapBig){minimap.style.width="360px";minimap.style.height="360px";}
  else{minimap.style.width="210px";minimap.style.height="210px";}
}

function onKeyDown(e){
  keys[e.code]=true;ensureAudio();
  if(e.repeat)return;
  if(e.code==="KeyC"){showCharacter();return;}
  if(e.code==="KeyM"){toggleMap();return;}
  if(!modal.classList.contains("hidden"))return;

  if(state.mode==="SEA"){
    if(e.code==="KeyW"||e.code==="ArrowUp"){state.sails=clamp(state.sails+1,0,3);setSailVisual(sea.player,state.sails);toast("Паруса: "+state.sails+"/3",900);}
    if(e.code==="KeyS"||e.code==="ArrowDown"){state.sails=clamp(state.sails-1,0,3);setSailVisual(sea.player,state.sails);toast("Паруса: "+state.sails+"/3",900);}
    if(e.code==="Space"){e.preventDefault();firePlayerBroadside();}
    if(e.code==="KeyE")seaAction();
    if(/^Digit[1-4]$/.test(e.code)){const idx=+e.code.slice(-1)-1;state.ammoType=AMMO[idx].id;toast("Боеприпас: "+AMMO[idx].name,1100);}
  }else if(state.mode==="LAND"){
    if(e.code==="Space"){e.preventDefault();landAttack();}
    if(e.code==="KeyQ")landPistol();
    if(e.code==="KeyE")landInteract();
  }else if(state.mode==="BOARD"){
    if(e.code==="Space"){e.preventDefault();boardAttack();}
    if(e.code==="KeyQ")boardPistol();
  }
}
window.addEventListener("keydown",onKeyDown);
window.addEventListener("keyup",e=>keys[e.code]=false);
window.addEventListener("blur",()=>{for(const k of Object.keys(keys))keys[k]=false;});
window.addEventListener("resize",()=>engine.resize());
window.addEventListener("beforeunload",saveGame);
setInterval(saveGame,8000);

function startNew(hero){
  resetSave(hero);startScreen.classList.add("hidden");
  state.mode="SEA";
  sea.player.root.position.set(state.seaPos.x,1,state.seaPos.z);sea.player.heading=state.heading;sea.player.root.rotation.y=state.heading;
  sea.player.hp=state.shipHp;sea.player.maxHp=state.shipMaxHp;setSailVisual(sea.player,state.sails);
  activeScene=seaScene;hud.classList.remove("hidden");updateHUD();toast("Добро пожаловать на Карибы, капитан.",2800);
}
function continueGame(){
  loadSave();startScreen.classList.add("hidden");state.mode="SEA";
  sea.player.root.position.set(state.seaPos.x,1,state.seaPos.z);sea.player.heading=state.heading;sea.player.root.rotation.y=state.heading;
  sea.player.hp=state.shipHp;sea.player.maxHp=state.shipMaxHp;setSailVisual(sea.player,state.sails);
  activeScene=seaScene;hud.classList.remove("hidden");updateHUD();toast("Сохранение загружено.");
}

$("femaleBtn").addEventListener("click",()=>startNew("female"));
$("maleBtn").addEventListener("click",()=>startNew("male"));
if(localStorage.getItem(SAVE_KEY))$("continueBtn").classList.remove("hidden");
$("continueBtn").addEventListener("click",continueGame);

state.mode="TITLE";
sea=createSeaScene();seaScene=sea.scene;activeScene=seaScene;
updateHUD();

engine.runRenderLoop(()=>{
  if(activeScene)activeScene.render();
});
})();