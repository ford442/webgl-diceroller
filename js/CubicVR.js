try{
if(!window){
self.window=self;
self.document={};
self.fakeWindow=true;
self.console={
log:function(){}
};
}
}catch(e){
self.window=self;
self.document={};
self.fakeWindow=true;
self.console={
log:function(){}
};
}
(function(window,document,Math,nop,undef){
var M_TWO_PI=2.0*Math.PI;
var M_HALF_PI=Math.PI/2.0;
var SCRIPT_LOCATION="";
try{
var scriptNodes=document.querySelectorAll("script");
for(var i=0,iMax=scriptNodes.length; i<iMax; i++){
var pos=scriptNodes[i].src.lastIndexOf('/CubicVR.js');
if(pos> -1){
SCRIPT_LOCATION=scriptNodes[i].src.substr(0,pos)+"/";
} //if
}
}catch(e){
} //try
var CubicVR=window['CubicVR']={};
CubicVR.contexts={};
var log;
try{
log=(console !== undefined && console.log)?function(msg){ console.log("CubicVR Log: "+msg); }:function(){};
}catch(ex){
log=nop;
} //try
var enums={
quality:{
LOW:0,MEDIUM:1,HIGH:2
}
};
window['cubicvr']=enums;
function parseEnum(typeBase,e){
if(typeof (typeBase) !== 'object'){
log("enumerator validation failed, invalid type base object.");
return undef;
}
if(e === undef){
return undef;
}else if(typeof (e) === 'number'){
return e;
}else if(typeof (e) === 'string'){
var finiteVal=parseInt(e,10);
if(e !== "" && isFinite(finiteVal)){
return finiteVal;
}
var enumName=e.toUpperCase();
var enumVal=typeBase[enumName];
if(enumVal !== undef){
return enumVal;
}else{
log("enumerator validation failed, unknown enum value: "+e);
var possibles="";
for(var k in typeBase){
if(typeBase.hasOwnProperty(k)){
if(possibles !== ""){
possibles=possibles+", ";
}
possibles=possibles+k.toLowerCase();
}
}
log("possible enum values are: "+possibles);
return undef;
}
}else{
return undef;
}
}
var moduleRegistry={};
var cubicvr_identity=[1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0];
var Core=function(context){
var base=this;
var _context;
if(context){
_context=context+"";
Object.defineProperty(this,"context",{
enumerable:true,configurable:false,get:function(){
return _context;
}
});
}
base.undef=undef;
base.nop=nop;
base.scriptLocation=SCRIPT_LOCATION;
base.GLCore=GLCore;
base.Textures=[];
base.Textures_obj=[];
base.Textures_ref=[];
base.Images=[];
base.ShaderPool=[];
base.log=log;
base.enums=CubicVR.enums;
base.MAX_LIGHTS=6;
function general_extend(superclass,constructor,prototype){
var withoutcon=function(){};
withoutcon.prototype=superclass.prototype;
constructor.prototype=new withoutcon();
for(var k in prototype){
constructor.prototype[k]=prototype[k];
}
return constructor;
}
function extend(superclass,constructor_extend,prototype){
return general_extend(superclass,function(){
superclass.apply(this);
constructor_extend.apply(this,arguments);
},prototype);
}
base.extendClassGeneral=general_extend;
base.extendClass=extend;
base.features={};
base.quality=CubicVR.enums.HIGH;
var featureSet={
low:{
antiAlias:false,lightPerPixel:false,lightShadows:false,texturePerPixel:false,postProcess:false
},medium:{
antiAlias:false,lightPerPixel:true,lightShadows:false,texturePerPixel:false,postProcess:false
},high:{
antiAlias:true,lightPerPixel:true,lightShadows:true,texturePerPixel:true,postProcess:true
}
};
base.features=featureSet.high;
function startModules(){
for(var mod in moduleRegistry){
var extend=moduleRegistry[mod](base);
for(var ext in extend){
if(extend.hasOwnProperty(ext)){
base[ext]=extend[ext];
} //if
} //for
} //for
} //startModules
var GLCore={
CoreShader_vs:null,CoreShader_fs:null,canvas:null,width:null,height:null,fixed_aspect:0.0,fixed_size:null,depth_alpha:false,default_filter:1, // LINEAR_MIP
mainloop:null,shadow_near:0.1,shadow_far:100,soft_shadow:false,fogLinear:false,fogExp:false,fogNoise:false,fogColor:[1,1,1],fogDensity:0.0,fogNear:0.0,fogFar:0.0,resize_active:false,emptyLight:null,resizeList:[],canvasSizeFactor:1
};
GLCore.init=function(gl_in,vs_in,fs_in){
var gl,util=base.util,enums=CubicVR.enums,i;
if(vs_in && fs_in){
vs_in=util.getScriptContents(vs_in);
fs_in=util.getScriptContents(fs_in);
}else{  // default shader handler if no custom override specified
if(window.CubicVRShader.CubicVRCoreVS && window.CubicVRShader.CubicVRCoreFS){
vs_in=window.CubicVRShader.CubicVRCoreVS;
fs_in=window.CubicVRShader.CubicVRCoreFS;
}else{
vs_in=util.getScriptContents(SCRIPT_LOCATION+"CubicVR_Core.vs");
fs_in=util.getScriptContents(SCRIPT_LOCATION+"CubicVR_Core.fs");
}
}
if(gl_in === undef){  // no canvas? no problem!
gl_in=document.createElement("canvas");
if(!gl){
try{
gl=gl_in.getContext("experimental-webgl",{antialias:base.features.antiAlias});
}catch(e1){
return null;
}
}
GLCore.gl=gl;
if(GLCore.fixed_size !== null){
GLCore.width=GLCore.fixed_size[0];
GLCore.height=GLCore.fixed_size[1];
GLCore.resizeElement(gl_in,GLCore.width,GLCore.height);
}else{
GLCore.addResizeable(gl_in);
if(GLCore.canvasSizeFactor !== 1 && gl_in.getContext !== undef){
var nw=Math.round(window.innerWidth*GLCore.canvasSizeFactor),nh=Math.round(window.innerHeight*GLCore.canvasSizeFactor);
GLCore.resizeElement(gl_in,nw,nh);
gl_in.style.top=(window.innerHeight/2-nh/2)+"px";
gl_in.style.left=(window.innerWidth/2-nw/2)+"px";
//           gl_in.style.height="100%";
gl_in.style.position="absolute";
}else{
GLCore.resizeElement(gl_in,window.innerWidth,window.innerHeight);
}
}
document.body.appendChild(gl_in);
}
if(gl_in.getContext !== undef && gl_in.width !== undef && gl_in.height !== undef){
try{
if(!gl) gl=gl_in.getContext("experimental-webgl",{antialias:base.features.antiAlias});
gl.viewport(0,0,gl_in.width,gl_in.height);
GLCore.canvas=gl_in;
GLCore.width=gl_in.width;
GLCore.height=gl_in.height;
gl.clearColor(0.0,0.0,0.0,1.0);
gl.clearDepth(1.0);
gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL);
}catch(e2){}
if(!gl){
return null;
}
}else{
gl=gl_in;
}
GLCore.gl=gl;
GLCore.CoreShader_vs=vs_in;
GLCore.CoreShader_fs=fs_in;
gl.enable(gl.CULL_FACE);
gl.cullFace(gl.BACK);
gl.frontFace(gl.CCW);
for(i=CubicVR.enums.light.type.NULL; i<enums.light.type.MAX; i++){
base.ShaderPool[i]=[];
}
var dummyTex=new base.Texture();
var lightTest=new base.Material();
for(i=0; i<enums.texture.map.MAX; i++){
if(i === enums.texture.map.BUMP) continue; // fix for crashy fglrx driver, todo: check it against newer revisions.
lightTest.setTexture(dummyTex,i);
}
lightTest.opacity=0.5;
var lc=1;
while(1){
if(!lightTest.use(enums.light.type.POINT,lc) || lc === 8){
base.MAX_LIGHTS=lc;
break;
}
lc++;
}
var emptyLight=GLCore.emptyLight=new base.Light(enums.light.type.POINT);
emptyLight.diffuse=[0,0,0];
emptyLight.specular=[0,0,0];
emptyLight.distance=0;
emptyLight.intensity=0;
emptyLight.cutoff=0;
log("Calibrated maximum lights per pass to: "+lc);
for(i=enums.light.type.NULL; i<enums.light.type.MAX; i++){
base.ShaderPool[i]=[];
}
if(GLCore.resizeList.length){
window.addEventListener('resize',function(){ base.GLCore.onResize(); },false);
GLCore.resize_active=true;
}
return gl;
};
GLCore.addResizeable=function(e){
base.GLCore.resizeList.push(e);
};
GLCore.onResize=function(){
var w=window.innerWidth;
var h=window.innerHeight;
if(GLCore.fixed_size !== null){
w=base.GLCore.fixed_size[0];
h=base.GLCore.fixed_size[1];
}
for(var i=0,iMax=base.GLCore.resizeList.length; i<iMax; i++){
GLCore.resizeElement(base.GLCore.resizeList[i],w,h);
}
};
GLCore.setFixedAspect=function(fa_in){
base.GLCore.fixed_aspect=fa_in;
};
GLCore.setFixedSize=function(fs_width,fs_height){
base.GLCore.fixed_size=[fs_width,fs_height];
};
GLCore.getCanvas=function(){
return base.GLCore.canvas;
};
GLCore.resizeElement=function(e,width,height){
var gl=GLCore.gl;
if(GLCore.fixed_aspect !== 0.0){
var aspect_height=width*(1.0/base.GLCore.fixed_aspect);
if(aspect_height>height){
aspect_height=height;
width=height*base.GLCore.fixed_aspect;
}
height=aspect_height;
}
if(e.getContext !== undef){
e.width=width;
e.height=height;
if(!base.GLCore.fixed_size){
e.style.left=((window.innerWidth/2.0-width/2.0) | 0)+"px";
e.style.top=((window.innerHeight/2.0-height/2.0) | 0)+"px";
e.style.position='absolute';
}
gl.viewport(0,0,width,height);
}else{
e.resize(width,height);
}
};
GLCore.setDepthAlpha=function(da,near,far){
GLCore.depth_alpha=da;
GLCore.depth_alpha_near=near;
GLCore.depth_alpha_far=far;
};
GLCore.setDefaultFilter=function(filterType){
GLCore.default_filter=parseEnum(base.enums.texture.filter,filterType);
};
GLCore.setSoftShadows=function(bSoft){
GLCore.soft_shadow=bSoft;
};
GLCore.setFog=function(bFog){
GLCore.fog_enabled=bFog;
};
GLCore.setFogExp=function(fogColor,fogDensity){
GLCore.fog_enabled=true;
GLCore.fogLinear=false;
GLCore.fogExp=true;
GLCore.fogColor=fogColor;
GLCore.fogDensity=fogDensity;
};
GLCore.setNoise=function(fogNoise){
GLCore.fogNoise=fogNoise;
};
GLCore.setFogLinear=function(fogColor,fogNear,fogFar){
GLCore.fog_enabled=true;
GLCore.fogExp=false;
GLCore.fogLinear=true;
GLCore.fogColor=fogColor;
GLCore.fogNear=fogNear;
GLCore.fogFar=fogFar;
};
GLCore.setCanvasSizeFactor=function(csfactor){
GLCore.canvasSizeFactor=csfactor;
};
GLCore.setQuality=function(enum_quality){
enum_quality=parseEnum(enums.quality,enum_quality);
if(enum_quality === enums.quality.HIGH){
base.features=featureSet.high;
}else if(enum_quality === enums.quality.MEDIUM){
base.features=featureSet.medium;
}else if(enum_quality === enums.quality.LOW){
base.features=featureSet.low;
}
base.quality=enum_quality;
return base.features;
};
GLCore.getQuality=function(enum_quality){
return base.features;
};
var initCubicVR=function(options,vs,fs){
var canvas;
var scripts=document.getElementsByTagName("script");
for(var i=0; i<scripts.length; ++i){
var script=scripts[i];
if(!script.getAttribute("data-cubicvr")){
continue;
}
var src=script.getAttribute('src');
if(src){
var xmlHttp=new XMLHttpRequest();
xmlHttp.open('GET',src,false);
xmlHttp.send(null);
if(xmlHttp.status === 200 || xmlHttp.status === 0){
script.text=xmlHttp.responseText;
}
} //if
}
if(typeof (options) === "object"){
if(options.getContext){
canvas=options;
}else{
canvas=options.canvas;
vs=options.vertexShader || vs;
fs=options.fragmentShader || fs;
}
}else if(options){
if(options[0] == "#"){
options=options.substr(1);
}
canvas=document.getElementById(options);
}
startModules();
GLCore.init(canvas,vs,fs);
return GLCore.gl;
}; //initCubicVR
function startUp(canvas,pass,fail,vs,fs){
if(typeof (canvas) === 'string' && canvas.toLowerCase() === "auto"){
canvas=undef;
}
fail=fail || "Sorry, your browser does not appear to support WebGL :-(";
var gl=initCubicVR(canvas,vs,fs);
if(gl){
if(pass && typeof (pass) === 'function'){
pass(gl,base.getCanvas());
}
return gl;
}
if(!gl){
if(fail && typeof (fail) === 'function'){
fail();
}else{
alert(fail);
}
return false;
}
}
base.GLCore=GLCore;
base.init=initCubicVR;
base.start=startUp;
base.addResizeable=GLCore.addResizeable;
base.setFixedAspect=GLCore.setFixedAspect;
base.setFixedSize=GLCore.setFixedSize;
base.setCanvasSizeFactor=GLCore.setCanvasSizeFactor;
base.getCanvas=GLCore.getCanvas;
base.enums=enums;
base.IdentityMatrix=cubicvr_identity;
base.Textures=base.Textures;
base.Textures_obj=base.Textures_obj;
base.Images=base.Images;
base.globalAmbient=[0.1,0.1,0.1];
base.setGlobalAmbient=function(c){
base.globalAmbient=c;
};
base.setGlobalDepthAlpha=GLCore.setDepthAlpha;
base.setDefaultFilter=GLCore.setDefaultFilter;
base.setSoftShadows=GLCore.setSoftShadows;
base.setQuality=GLCore.setQuality;
base.getQuality=GLCore.getQuality;
base.RegisterModule=CubicVR.RegisterModule;
base.getScriptLocation=CubicVR.getScriptLocation;
base.setFogExp=GLCore.setFogExp;
base.setFogLinear=GLCore.setFogLinear;
base.setFogNoise=GLCore.setFogNoise;
base.parseEnum=parseEnum;
}; //Core
CubicVR.init=function(options,vs,fs){
var context,core;
if(options && options.context && typeof options.context === "string"){
context=options.context;
}
core=new Core(context);
if(core.context){
CubicVR.contexts[core.context]=core;
core.init(options,vs,fs);
return core;
}else{
window.CubicVR=CubicVR=core;
core.init(options,vs,fs);
return core.GLCore.gl;
} //if
}; //init
CubicVR.start=function(canvas,pass,fail,vs,fs){
var core=new Core();
window.CubicVR=CubicVR=core;
core.start(canvas,pass,fail,vs,fs);
return core;
}; //start
CubicVR.RegisterModule=function(module_id,module_in){
moduleRegistry[module_id]=module_in;
}; //registerModule
CubicVR.getScriptLocation=function(){
return SCRIPT_LOCATION;
}; //getScriptLocation
CubicVR.enums=enums;
}(window,window.document,Math,function(){}));
window.CubicVRShader={};	// for embedding shaders and keeping context happy
CubicVR.RegisterModule("Math",function(base){
var undef=base.undef;
var cubicvr_identity=[1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0];
var M_TWO_PI=2.0*Math.PI;
var M_HALF_PI=Math.PI/2.0;
var vec2={
equal:function(a,b,epsilon){
if(epsilon === undef) epsilon=0.00000001;
if((a === undef) && (b === undef)){
return true;
}
if((a === undef) || (b === undef)){
return false;
}
return (Math.abs(a[0]-b[0])<epsilon && Math.abs(a[1]-b[1])<epsilon);
}
};
var vec3={
length:function(pt){
var a=pt[0],b=pt[1],c=pt[2];
return Math.sqrt((a*a)+(b*b)+(c*c));
},normalize:function(pt){
var a=pt[0],b=pt[1],c=pt[2];
var d=Math.sqrt((a*a)+(b*b)+(c*c));
if(d){
return [pt[0]/d,pt[1]/d,pt[2]/d];
}
return [0,0,0];
},dot:function(v1,v2){
return v1[0]*v2[0]+v1[1]*v2[1]+v1[2]*v2[2];
},angle:function(v1,v2){
var a=Math.acos((v1[0]*v2[0]+v1[1]*v2[1]+v1[2]*v2[2])/(Math.sqrt(v1[0]*v1[0]+v1[1]*v1[1]+v1[2]*v1[2])*Math.sqrt(v2[0]*v2[0]+v2[1]*v2[1]+v2[2]*v2[2])));
return a;
},cross:function(vectA,vectB){
return [vectA[1]*vectB[2]-vectB[1]*vectA[2],vectA[2]*vectB[0]-vectB[2]*vectA[0],vectA[0]*vectB[1]-vectB[0]*vectA[1]];
},multiply:function(vectA,constB){
return [vectA[0]*constB,vectA[1]*constB,vectA[2]*constB];
},add:function(vectA,vectB){
return [vectA[0]+vectB[0],vectA[1]+vectB[1],vectA[2]+vectB[2]];
},subtract:function(vectA,vectB){
return [vectA[0]-vectB[0],vectA[1]-vectB[1],vectA[2]-vectB[2]];
},equal:function(a,b,epsilon){
if(epsilon === undef) epsilon=0.0000001;
if((a === undef) && (b === undef)){
return true;
}
if((a === undef) || (b === undef)){
return false;
}
return (Math.abs(a[0]-b[0])<epsilon && Math.abs(a[1]-b[1])<epsilon && Math.abs(a[2]-b[2])<epsilon);
},moveViewRelative:function(position,target,xdelta,zdelta,alt_source){
var ang=Math.atan2(zdelta,xdelta);
var cam_ang=Math.atan2(target[2]-position[2],target[0]-position[0]);
var mag=Math.sqrt(xdelta*xdelta+zdelta*zdelta);
var move_ang=cam_ang+ang+M_HALF_PI;
if(typeof (alt_source) === 'object'){
return [alt_source[0]+mag*Math.cos(move_ang),alt_source[1],alt_source[2]+mag*Math.sin(move_ang)];
}
return [position[0]+mag*Math.cos(move_ang),position[1],position[2]+mag*Math.sin(move_ang)];
},trackTarget:function(position,target,trackingSpeed,safeDistance){
var camv=vec3.subtract(target,position);
var dist=camv;
var fdist=vec3.length(dist);
var motionv=camv;
motionv=vec3.normalize(motionv);
motionv=vec3.multiply(motionv,trackingSpeed*(1.0/(1.0/(fdist-safeDistance))));
var ret_pos;
if(fdist>safeDistance){
ret_pos=vec3.add(position,motionv);
}else if(fdist<safeDistance){
motionv=camv;
motionv=vec3.normalize(motionv);
motionv=vec3.multiply(motionv,trackingSpeed*(1.0/(1.0/(Math.abs(fdist-safeDistance)))));
ret_pos=vec3.subtract(position,motionv);
}else{
ret_pos=[position[0],position[1]+motionv[2],position[2]];
}
return ret_pos;
},getClosestTo:function(ptA,ptB,ptTest){
var S,T,U;
S=vec3.subtract(ptB,ptA);
T=vec3.subtract(ptTest,ptA);
U=vec3.add(vec3.multiply(S,vec3.dot(S,T)/vec3.dot(S,S)),ptA);
return U;
},linePlaneIntersect:function(normal,point_on_plane,segment_start,segment_end){
var denom,mu;
var d=-normal[0]*point_on_plane[0]-normal[1]*point_on_plane[1]-normal[2]*point_on_plane[2];
denom=normal[0]*(segment_end[0]-segment_start[0])+normal[1]*(segment_end[1]-segment_start[1])+normal[2]*(segment_end[2]-segment_start[2]);
if(Math.abs(denom)<0.001) return false;
mu=-(d+normal[0]*segment_start[0]+normal[1]*segment_start[1]+normal[2]*segment_start[2])/denom;
return [(segment_start[0]+mu*(segment_end[0]-segment_start[0])),(segment_start[1]+mu*(segment_end[1]-segment_start[1])),(segment_start[2]+mu*(segment_end[2]-segment_start[2]))];
}
};
var triangle={
normal:function(pt1,pt2,pt3,mOut){
if(mOut === undef) mOut=[];
var v10=pt1[0]-pt2[0];
var v11=pt1[1]-pt2[1];
var v12=pt1[2]-pt2[2];
var v20=pt2[0]-pt3[0];
var v21=pt2[1]-pt3[1];
var v22=pt2[2]-pt3[2];
mOut[0]=v11*v22-v12*v21;
mOut[1]=v12*v20-v10*v22;
mOut[2]=v10*v21-v11*v20;
return mOut;
}
};
var mat3={
transpose_inline:function(mat){
var a01=mat[1],a02=mat[2],a12=mat[5];
mat[1]=mat[3];
mat[2]=mat[6];
mat[3]=a01;
mat[5]=mat[7];
mat[6]=a02;
mat[7]=a12;
},vec3_multiply:function(m1,m2,mOut){
if(mOut === undef) mOut=[];
mOut[0]=m2[0]*m1[0]+m2[3]*m1[1]+m2[6]*m1[2];
mOut[1]=m2[1]*m1[0]+m2[4]*m1[1]+m2[7]*m1[2];
mOut[2]=m2[2]*m1[0]+m2[5]*m1[1]+m2[8]*m1[2];
return mOut;
}
};
var mat4={
lookat:function(eyex,eyey,eyez,centerx,centery,centerz,upx,upy,upz){
var forward=[],side=[],up=[];
var m=[];
forward[0]=centerx-eyex;
forward[1]=centery-eyey;
forward[2]=centerz-eyez;
up[0]=upx;
up[1]=upy;
up[2]=upz;
forward=vec3.normalize(forward);
side=vec3.cross(forward,up);
side=vec3.normalize(side);
up=vec3.cross(side,forward);
m=[side[0],up[0],-forward[0],0,side[1],up[1],-forward[1],0,side[2],up[2],-forward[2],0,0,0,0,1];
var t=new base.Transform(m);
t.translate([-eyex,-eyey,-eyez]);
return t.getResult();
},multiply:function(mRight,mLeft,mOut){ // TODO: get these swapped to L,R and fix up usage for consistency
if(mOut === undef) mOut=[];
mOut[0]=mRight[0]*mLeft[0]+mRight[4]*mLeft[1]+mRight[8]*mLeft[2]+mRight[12]*mLeft[3];
mOut[1]=mRight[1]*mLeft[0]+mRight[5]*mLeft[1]+mRight[9]*mLeft[2]+mRight[13]*mLeft[3];
mOut[2]=mRight[2]*mLeft[0]+mRight[6]*mLeft[1]+mRight[10]*mLeft[2]+mRight[14]*mLeft[3];
mOut[3]=mRight[3]*mLeft[0]+mRight[7]*mLeft[1]+mRight[11]*mLeft[2]+mRight[15]*mLeft[3];
mOut[4]=mRight[0]*mLeft[4]+mRight[4]*mLeft[5]+mRight[8]*mLeft[6]+mRight[12]*mLeft[7];
mOut[5]=mRight[1]*mLeft[4]+mRight[5]*mLeft[5]+mRight[9]*mLeft[6]+mRight[13]*mLeft[7];
mOut[6]=mRight[2]*mLeft[4]+mRight[6]*mLeft[5]+mRight[10]*mLeft[6]+mRight[14]*mLeft[7];
mOut[7]=mRight[3]*mLeft[4]+mRight[7]*mLeft[5]+mRight[11]*mLeft[6]+mRight[15]*mLeft[7];
mOut[8]=mRight[0]*mLeft[8]+mRight[4]*mLeft[9]+mRight[8]*mLeft[10]+mRight[12]*mLeft[11];
mOut[9]=mRight[1]*mLeft[8]+mRight[5]*mLeft[9]+mRight[9]*mLeft[10]+mRight[13]*mLeft[11];
mOut[10]=mRight[2]*mLeft[8]+mRight[6]*mLeft[9]+mRight[10]*mLeft[10]+mRight[14]*mLeft[11];
mOut[11]=mRight[3]*mLeft[8]+mRight[7]*mLeft[9]+mRight[11]*mLeft[10]+mRight[15]*mLeft[11];
mOut[12]=mRight[0]*mLeft[12]+mRight[4]*mLeft[13]+mRight[8]*mLeft[14]+mRight[12]*mLeft[15];
mOut[13]=mRight[1]*mLeft[12]+mRight[5]*mLeft[13]+mRight[9]*mLeft[14]+mRight[13]*mLeft[15];
mOut[14]=mRight[2]*mLeft[12]+mRight[6]*mLeft[13]+mRight[10]*mLeft[14]+mRight[14]*mLeft[15];
mOut[15]=mRight[3]*mLeft[12]+mRight[7]*mLeft[13]+mRight[11]*mLeft[14]+mRight[15]*mLeft[15];
return mOut;
},vec4_multiply:function(m1,m2,mOut){
if(mOut === undef) mOut=[];
mOut[0]=m2[0]*m1[0]+m2[4]*m1[1]+m2[8]*m1[2]+m2[12]*m1[3];
mOut[1]=m2[1]*m1[0]+m2[5]*m1[1]+m2[9]*m1[2]+m2[13]*m1[3];
mOut[2]=m2[2]*m1[0]+m2[6]*m1[1]+m2[10]*m1[2]+m2[14]*m1[3];
mOut[3]=m2[3]*m1[0]+m2[7]*m1[1]+m2[11]*m1[2]+m2[15]*m1[3];
return mOut;
},vec3_multiply:function(m1,m2,mOut){
if(mOut === undef) mOut=[];
mOut[0]=m2[0]*m1[0]+m2[4]*m1[1]+m2[8]*m1[2]+m2[12];
mOut[1]=m2[1]*m1[0]+m2[5]*m1[1]+m2[9]*m1[2]+m2[13];
mOut[2]=m2[2]*m1[0]+m2[6]*m1[1]+m2[10]*m1[2]+m2[14];
return mOut;
},perspective:function(fovy,aspect,near,far){
var yFac=Math.tan(fovy*Math.PI/360.0);
var xFac=yFac*aspect;
return [1.0/xFac,0,0,0,0,1.0/yFac,0,0,0,0,-(far+near)/(far-near),-1,0,0,-(2.0*far*near)/(far-near),0];
},ortho:function(left,right,bottom,top,near,far){
return [2/(right-left),0,0,0,0,2/(top-bottom),0,0,0,0,-2/(far-near),0,-(left+right)/(right-left),-(top+bottom)/(top-bottom),-(far+near)/(far-near),1];
},determinant:function(m){
var a0=m[0]*m[5]-m[1]*m[4];
var a1=m[0]*m[6]-m[2]*m[4];
var a2=m[0]*m[7]-m[3]*m[4];
var a3=m[1]*m[6]-m[2]*m[5];
var a4=m[1]*m[7]-m[3]*m[5];
var a5=m[2]*m[7]-m[3]*m[6];
var b0=m[8]*m[13]-m[9]*m[12];
var b1=m[8]*m[14]-m[10]*m[12];
var b2=m[8]*m[15]-m[11]*m[12];
var b3=m[9]*m[14]-m[10]*m[13];
var b4=m[9]*m[15]-m[11]*m[13];
var b5=m[10]*m[15]-m[11]*m[14];
var det=a0*b5-a1*b4+a2*b3+a3*b2-a4*b1+a5*b0;
return det;
},coFactor:function(m,n,out){
},transpose:function(m){
return [m[0],m[4],m[8],m[12],m[1],m[5],m[9],m[13],m[2],m[6],m[10],m[14],m[3],m[7],m[11],m[15]];
},inverse_mat3:function(mat){
var dest=[];
var a00=mat[0],a01=mat[1],a02=mat[2],a10=mat[4],a11=mat[5],a12=mat[6],a20=mat[8],a21=mat[9],a22=mat[10];
var b01=a22*a11-a12*a21,b11=-a22*a10+a12*a20,b21=a21*a10-a11*a20;
var d=a00*b01+a01*b11+a02*b21;
if(!d){ return null; }
var id=1/d;
dest[0]=b01*id;
dest[1]=(-a22*a01+a02*a21)*id;
dest[2]=(a12*a01-a02*a11)*id;
dest[3]=b11*id;
dest[4]=(a22*a00-a02*a20)*id;
dest[5]=(-a12*a00+a02*a10)*id;
dest[6]=b21*id;
dest[7]=(-a21*a00+a01*a20)*id;
dest[8]=(a11*a00-a01*a10)*id;
return dest;
},inverse:function(m,m_inv){
var a0=m[0]*m[5]-m[1]*m[4];
var a1=m[0]*m[6]-m[2]*m[4];
var a2=m[0]*m[7]-m[3]*m[4];
var a3=m[1]*m[6]-m[2]*m[5];
var a4=m[1]*m[7]-m[3]*m[5];
var a5=m[2]*m[7]-m[3]*m[6];
var b0=m[8]*m[13]-m[9]*m[12];
var b1=m[8]*m[14]-m[10]*m[12];
var b2=m[8]*m[15]-m[11]*m[12];
var b3=m[9]*m[14]-m[10]*m[13];
var b4=m[9]*m[15]-m[11]*m[13];
var b5=m[10]*m[15]-m[11]*m[14];
var determinant=a0*b5-a1*b4+a2*b3+a3*b2-a4*b1+a5*b0;
if(determinant !== 0){
if(m_inv === undef) m_inv=[];
m_inv[0]=0+m[5]*b5-m[6]*b4+m[7]*b3;
m_inv[4]=0-m[4]*b5+m[6]*b2-m[7]*b1;
m_inv[8]=0+m[4]*b4-m[5]*b2+m[7]*b0;
m_inv[12]=0-m[4]*b3+m[5]*b1-m[6]*b0;
m_inv[1]=0-m[1]*b5+m[2]*b4-m[3]*b3;
m_inv[5]=0+m[0]*b5-m[2]*b2+m[3]*b1;
m_inv[9]=0-m[0]*b4+m[1]*b2-m[3]*b0;
m_inv[13]=0+m[0]*b3-m[1]*b1+m[2]*b0;
m_inv[2]=0+m[13]*a5-m[14]*a4+m[15]*a3;
m_inv[6]=0-m[12]*a5+m[14]*a2-m[15]*a1;
m_inv[10]=0+m[12]*a4-m[13]*a2+m[15]*a0;
m_inv[14]=0-m[12]*a3+m[13]*a1-m[14]*a0;
m_inv[3]=0-m[9]*a5+m[10]*a4-m[11]*a3;
m_inv[7]=0+m[8]*a5-m[10]*a2+m[11]*a1;
m_inv[11]=0-m[8]*a4+m[9]*a2-m[11]*a0;
m_inv[15]=0+m[8]*a3-m[9]*a1+m[10]*a0;
var inverse_det=1.0/determinant;
m_inv[0]*=inverse_det;
m_inv[1]*=inverse_det;
m_inv[2]*=inverse_det;
m_inv[3]*=inverse_det;
m_inv[4]*=inverse_det;
m_inv[5]*=inverse_det;
m_inv[6]*=inverse_det;
m_inv[7]*=inverse_det;
m_inv[8]*=inverse_det;
m_inv[9]*=inverse_det;
m_inv[10]*=inverse_det;
m_inv[11]*=inverse_det;
m_inv[12]*=inverse_det;
m_inv[13]*=inverse_det;
m_inv[14]*=inverse_det;
m_inv[15]*=inverse_det;
return m_inv;
}
return null;
},identity:function(mOut){
if(mOut == undef){
return [1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0];
}
mOut[0]=1.0;
mOut[1]=0.0;
mOut[2]=0.0;
mOut[3]=0.0;
mOut[4]=0.0;
mOut[5]=1.0;
mOut[6]=0.0;
mOut[7]=0.0;
mOut[8]=0.0;
mOut[9]=0.0;
mOut[10]=1.0;
mOut[11]=0.0;
mOut[12]=0.0;
mOut[13]=0.0;
mOut[14]=0.0;
mOut[15]=1.0;
},translate:function(x,y,z,mOut){
var m=[1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,x,y,z,1.0];
if(mOut === undef) return m;
mat4.multiply(mOut.slice(0),m,mOut);
},rotateAxis:function(r,x,y,z,mOut){   // rotate r about axis x,y,z
var sAng=Math.sin(r*(Math.PI/180.0));
var cAng=Math.cos(r*(Math.PI/180.0));
var m=[cAng+(x*x)*(1.0-cAng),x*y*(1.0-cAng)-z*sAng,x*z*(1.0-cAng)+y*sAng,0,y*x*(1.0-cAng)+z*sAng,cAng+y*y*(1.0-cAng),y*z*(1.0-cAng)-x*sAng,0,z*x*(1.0-cAng)-y*sAng,z*y*(1-cAng)+x*sAng,cAng+(z*z)*(1.0-cAng),0,0,0,0,1];
if(mOut === undef) return m;
mat4.multiply(mOut.slice(0),m,mOut);
},rotate:function(x,y,z,mOut){   // rotate each axis, angles x, y, z in turn
var sAng,cAng;
if(mOut === undef){
mOut=[1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0];
}
if(z !== 0){
sAng=Math.sin(z*(Math.PI/180.0));
cAng=Math.cos(z*(Math.PI/180.0));
mat4.multiply(mOut.slice(0),[cAng,sAng,0.0,0.0,-sAng,cAng,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0],mOut);
}
if(y !== 0){
sAng=Math.sin(y*(Math.PI/180.0));
cAng=Math.cos(y*(Math.PI/180.0));
mat4.multiply(mOut.slice(0),[cAng,0.0,-sAng,0.0,0.0,1.0,0.0,0.0,sAng,0.0,cAng,0.0,0.0,0.0,0.0,1.0],mOut);
}
if(x !== 0){
sAng=Math.sin(x*(Math.PI/180.0));
cAng=Math.cos(x*(Math.PI/180.0));
mat4.multiply(mOut.slice(0),[1.0,0.0,0.0,0.0,0.0,cAng,sAng,0.0,0.0,-sAng,cAng,0.0,0.0,0.0,0.0,1.0],mOut);
}
return mOut;
},scale:function(x,y,z,mOut){
if(mOut === undef) return [x,0.0,0.0,0.0,0.0,y,0.0,0.0,0.0,0.0,z,0.0,0.0,0.0,0.0,1.0];
mat4.multiply(mOut.slice(0),[x,0.0,0.0,0.0,0.0,y,0.0,0.0,0.0,0.0,z,0.0,0.0,0.0,0.0,1.0],mOut);
},transform:function(position,rotation,scale){
var m=mat4.identity();
if(position){
mat4.translate(position[0],position[1],position[2],m);
}
if(rotation){
if(!(rotation[0] === 0 && rotation[1] === 0 && rotation[2] === 0)){
mat4.rotate(rotation[0],rotation[1],rotation[2],m);
}
}
if(scale){
if(!(scale[0] === 1 && scale[1] === 1 && scale[2] === 1)){
mat4.scale(scale[0],scale[1],scale[2],m);
}
}
return m;
}
};
function Transform(init_mat){
return this.clearStack(init_mat);
}
Transform.prototype={
setIdentity:function(){
this.m_stack[this.c_stack]=[1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0];
if(this.valid === this.c_stack && this.c_stack){
this.valid--;
}
return this;
},getIdentity:function(){
return [1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0];
},invalidate:function(){
this.valid=0;
this.result=null;
return this;
},getResult:function(){
var mat4=base.mat4;
if(!this.c_stack){
return this.m_stack[0];
}
var m=cubicvr_identity;
if(this.valid>this.c_stack-1) this.valid=this.c_stack-1;
for(var i=this.valid; i<this.c_stack+1; i++){
m=mat4.multiply(m,this.m_stack[i]);
this.m_cache[i]=m;
}
this.valid=this.c_stack-1;
this.result=this.m_cache[this.c_stack];
return this.result;
},pushMatrix:function(m){
this.c_stack++;
this.m_stack[this.c_stack]=(m?m:cubicvr_identity);
return this;
},popMatrix:function(){
if(this.c_stack === 0){
return;
}
this.c_stack--;
return this;
},clearStack:function(init_mat){
this.m_stack=[];
this.m_cache=[];
this.c_stack=0;
this.valid=0;
this.result=null;
if(init_mat !== undef){
this.m_stack[0]=init_mat;
}else{
this.setIdentity();
}
return this;
},translate:function(x,y,z){
var mat4=base.mat4;
if(typeof (x) === 'object'){
return this.translate(x[0],x[1],x[2]);
}
var m=this.getIdentity();
m[12]=x;
m[13]=y;
m[14]=z;
this.m_stack[this.c_stack]=mat4.multiply(this.m_stack[this.c_stack],m);
if(this.valid === this.c_stack && this.c_stack){
this.valid--;
}
return this;
},scale:function(x,y,z){
var mat4=base.mat4;
if(typeof (x) === 'object'){
return this.scale(x[0],x[1],x[2]);
}
var m=this.getIdentity();
m[0]=x;
m[5]=y;
m[10]=z;
this.m_stack[this.c_stack]=mat4.multiply(this.m_stack[this.c_stack],m);
if(this.valid === this.c_stack && this.c_stack){
this.valid--;
}
return this;
},rotate:function(ang,x,y,z){
var mat4=base.mat4;
if(typeof (ang) === 'object'){
this.rotate(ang[0],1,0,0);
this.rotate(ang[1],0,1,0);
this.rotate(ang[2],0,0,1);
return this;
}
var sAng,cAng;
if(x || y || z){
sAng=Math.sin(-ang*(Math.PI/180.0));
cAng=Math.cos(-ang*(Math.PI/180.0));
}
if(x){
var X_ROT=this.getIdentity();
X_ROT[5]=cAng*x;
X_ROT[9]=sAng*x;
X_ROT[6]=-sAng*x;
X_ROT[10]=cAng*x;
this.m_stack[this.c_stack]=mat4.multiply(X_ROT,this.m_stack[this.c_stack]);
}
if(y){
var Y_ROT=this.getIdentity();
Y_ROT[0]=cAng*y;
Y_ROT[8]=-sAng*y;
Y_ROT[2]=sAng*y;
Y_ROT[10]=cAng*y;
this.m_stack[this.c_stack]=mat4.multiply(Y_ROT,this.m_stack[this.c_stack]);
}
if(z){
var Z_ROT=this.getIdentity();
Z_ROT[0]=cAng*z;
Z_ROT[4]=sAng*z;
Z_ROT[1]=-sAng*z;
Z_ROT[5]=cAng*z;
this.m_stack[this.c_stack]=mat4.multiply(Z_ROT,this.m_stack[this.c_stack]);
}
if(this.valid === this.c_stack && this.c_stack){
this.valid--;
}
return this;
}
};
function Quaternion(){
if(arguments.length === 1){
this.x=arguments[0][0];
this.y=arguments[0][1];
this.z=arguments[0][2];
this.w=arguments[0][3];
}
if(arguments.length === 4){
this.x=arguments[0];
this.y=arguments[1];
this.z=arguments[2];
this.w=arguments[3];
}
}
Quaternion.prototype={
length:function(){
return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w);
},normalize:function(){
var n=Math.sqrt(this.length());
this.x/=n;
this.y/=n;
this.z/=n;
this.w/=n;
},fromMatrix:function(mat){
var t=1+mat[0]+mat[5]+mat[10];
var S,X,Y,Z,W;
if(t>0.00000001){
S=Math.sqrt(t)*2;
X=(mat[9]-mat[6])/S;
Y=(mat[2]-mat[8])/S;
Z=(mat[4]-mat[1])/S;
W=0.25*S;
}else{
if(mat[0]>mat[5] && mat[0]>mat[10]){	// Column 0:
S=Math.sqrt(1.0+mat[0]-mat[5]-mat[10])*2;
X=0.25*S;
Y=(mat[4]+mat[1])/S;
Z=(mat[2]+mat[8])/S;
W=(mat[9]-mat[6])/S;
}else if(mat[5]>mat[10]){			// Column 1:
S=Math.sqrt(1.0+mat[5]-mat[0]-mat[10])*2;
X=(mat[4]+mat[1])/S;
Y=0.25*S;
Z=(mat[9]+mat[6])/S;
W=(mat[2]-mat[8])/S;
}else{						// Column 2:
S=Math.sqrt(1.0+mat[10]-mat[0]-mat[5])*2;
X=(mat[2]+mat[8])/S;
Y=(mat[9]+mat[6])/S;
Z=0.25*S;
W=(mat[4]-mat[1])/S;
}
}
this.x=X;
this.y=Y;
this.z=Z;
this.w=W;
},fromEuler:function(bank,heading,pitch) // x,y,z
{
var c1=Math.cos((Math.PI/180.0)*heading/2.0);
var s1=Math.sin((Math.PI/180.0)*heading/2.0);
var c2=Math.cos((Math.PI/180.0)*pitch/2.0);
var s2=Math.sin((Math.PI/180.0)*pitch/2.0);
var c3=Math.cos((Math.PI/180.0)*bank/2.0);
var s3=Math.sin((Math.PI/180.0)*bank/2.0);
var c1c2=c1*c2;
var s1s2=s1*s2;
this.w=c1c2*c3-s1s2*s3;
this.x=c1c2*s3+s1s2*c3;
this.y=s1*c2*c3+c1*s2*s3;
this.z=c1*s2*c3-s1*c2*s3;
},toEuler:function(){
var sqw=this.w*this.w;
var sqx=this.x*this.x;
var sqy=this.y*this.y;
var sqz=this.z*this.z;
var x=(180/Math.PI)*((Math.atan2(2.0*(this.y*this.z+this.x*this.w),(-sqx-sqy+sqz+sqw))));
var y=(180/Math.PI)*((Math.asin(-2.0*(this.x*this.z-this.y*this.w))));
var z=(180/Math.PI)*((Math.atan2(2.0*(this.x*this.y+this.z*this.w),(sqx-sqy-sqz+sqw))));
return [x,y,z];
},multiply:function(q1,q2){
var selfSet=false;
if(q2 === undef){
q2=q1;
q1=this;
}
var x=q1.x*q2.w+q1.w*q2.x+q1.y*q2.z-q1.z*q2.y;
var y=q1.y*q2.w+q1.w*q2.y+q1.z*q2.x-q1.x*q2.z;
var z=q1.z*q2.w+q1.w*q2.z+q1.x*q2.y-q1.y*q2.x;
var w=q1.w*q2.w-q1.x*q2.x-q1.y*q2.y-q1.z*q2.z;
if(selfSet){
this.x=x;
this.y=y;
this.z=z;
this.w=w;
}else{
return new Quaternion(x,y,z,w);
}
}
};
var aabb={
engulf:function(aabb,point){
if(aabb[0][0]>point[0]){
aabb[0][0]=point[0];
}
if(aabb[0][1]>point[1]){
aabb[0][1]=point[1];
}
if(aabb[0][2]>point[2]){
aabb[0][2]=point[2];
}
if(aabb[1][0]<point[0]){
aabb[1][0]=point[0];
}
if(aabb[1][1]<point[1]){
aabb[1][1]=point[1];
}
if(aabb[1][2]<point[2]){
aabb[1][2]=point[2];
}
},reset:function(aabb,point){
if(point === undefined){
point=[0,0,0];
} //if
aabb[0][0]=point[0];
aabb[0][1]=point[1];
aabb[0][2]=point[2];
aabb[1][0]=point[0];
aabb[1][1]=point[1];
aabb[1][2]=point[2];
},size:function(aabb){
var x=aabb[0][0]<aabb[1][0]?aabb[1][0]-aabb[0][0]:aabb[0][0]-aabb[1][0];
var y=aabb[0][1]<aabb[1][1]?aabb[1][1]-aabb[0][1]:aabb[0][1]-aabb[1][1];
var z=aabb[0][2]<aabb[1][2]?aabb[1][2]-aabb[0][2]:aabb[0][2]-aabb[1][2];
return [x,y,z];
}
};
var plane={
classifyPoint:function(plane,pt){
var dist=(plane[0]*pt[0])+(plane[1]*pt[1])+(plane[2]*pt[2])+(plane[3]);
if(dist<0){
return -1;
}else if(dist>0){
return 1;
}
return 0;
},normalize:function(plane){
var mag=Math.sqrt(plane[0]*plane[0]+plane[1]*plane[1]+plane[2]*plane[2]);
plane[0]=plane[0]/mag;
plane[1]=plane[1]/mag;
plane[2]=plane[2]/mag;
plane[3]=plane[3]/mag;
}
};
var sphere={
intersects:function(sphere,other){
var vec3=base.vec3,spherePos=[sphere[0],sphere[1],sphere[2]],otherPos=[other[0],other[1],other[2]],diff=vec3.subtract(spherePos,otherPos),mag=Math.sqrt(diff[0]*diff[0]+diff[1]*diff[1]+diff[2]*diff[2]),sum_radii=sphere[3]+other[3];
if(mag*mag<sum_radii*sum_radii){
return true;
}
return false;
}
};
var extend={
vec2:vec2,vec3:vec3,mat3:mat3,mat4:mat4,aabb:aabb,plane:plane,sphere:sphere,triangle:triangle,Transform:Transform,Quaternion:Quaternion
};
return extend;
});
CubicVR.RegisterModule("Utility",function(base){
var undef=base.undef;
var log=base.log;
var classBin={};
var jsonBin={};
var util={
multiSplit:function(split_str,split_chars){
var arr=split_str.split(split_chars[0]);
for(var i=1,iMax=split_chars.length; i<iMax; i++){
var sc=split_chars[i];
for(var j=0,jMax=arr.length; j<jMax; j++){
var arsplit=arr[j].trim().split(sc);
var empty=true;
if(arsplit.length>1){
for(var k=0; k<arsplit.length; k++){
if(arsplit[k].trim() !== ""){
arr.splice(j+k,(k === 0)?1:0,arsplit[k]);
if(k){
jMax++;
}
empty=false;
}
}
}else{
arr[j]=arr[j].trim().replace(sc,"");
if(arr[j] !== "") empty=false;
}
if(empty){
arr.splice(j,1);
jMax--;
j--;
}
}
}
return arr;
},getJSONScriptObj:function(id,success){
if(typeof (id) === "string" && id.length>0 && id.charAt(0) === "#"){
var jsonScript=document.getElementById(id.substr(1));
if(jsonScript){
var scriptContents=jsonScript.innerHTML || jsonScript.text;
var jsonObj=JSON.parse(scriptContents);
if(success){
success(jsonObj);
}
return jsonObj;
}
}
return id;
},getScriptContents:function(id){
var shaderScript=document.getElementById(id);
var str="";
var srcUrl="";
if(!shaderScript){
srcUrl=id;
}else{
if(shaderScript.src !== "" || shaderScript.attributes['srcUrl'] !== undef){
srcUrl=(shaderScript.src !== '')?shaderScript.src:(shaderScript.attributes['srcUrl'].value);
}
}
if(srcUrl.length !== 0){
var xmlHttp=new XMLHttpRequest();
if(xmlHttp.overrideMimeType){
xmlHttp.overrideMimeType("application/json");
}
xmlHttp.open('GET',srcUrl,false);
xmlHttp.send(null);
if(xmlHttp.status === 200 || xmlHttp.status === 0){
str=xmlHttp.responseText;
}
}else{
var k=shaderScript.firstChild;
while(k){
if(k.nodeType === 3){
str+=k.textContent;
}
k=k.nextSibling;
}
}
return str;
},xmlNeedsBadgerFish:function(xmlDoc){
var nodeStack=[xmlDoc];
while(nodeStack.length){
var n=nodeStack.pop();
if(n.attributes) if(n.attributes.length){
return true;
}
for(var i=0,iMax=n.childNodes.length; i<iMax; i++){
nodeStack.push(n.childNodes[i]);
}
}
return false;
},getFirstEntry:function(v){
for(var a in v){
if(v.hasOwnProperty(a)){
return v[a];
}
}
},getURIFileType:function(url){   // attempt to get an extension, optional override via ?_ext=json, &_ext=js, ?ext=xml or &ext=dae, etc. for dynamic fetching ..
var lcurl=url.toLowerCase();
var extensionParams=["_ext","ext"];
var extValues={
"json":["js","javascript","json"],"xml":["xml"]
};
function getExtValue(extn){
for(var e in extValues){
if(!extValues.hasOwnProperty(e)) continue;
if(extValues[e].indexOf(extn) !== -1){
return e;
}
}
return undef;
}
// example myFile.js
if(lcurl.indexOf("?") !== -1){  // split query
var arUrl=lcurl.split("?");
lcurl=arUrl[0];
if(arUrl[1]){
var arParam;
if(arUrl[1].indexOf("&") === -1){ // split params
arParam=[arUrl[1]];
}else{
arParam=arUrl[1].split("&");
}
for(var i=0,iMax=arParam.length; i<iMax; i++){ // split values
var p=arParam[i];
if(p.indexOf("=") !== -1){
var arp=p.split("=");
if(extensionParams.indexOf(arp[0]) !== -1){   // test for extension param
var extVal=getExtValue(arp[1]);
if(extVal){
return extVal;
}else{    // soft fail, test below
log("Unable to determine extension type '"+arp[1]+"' provided for URI: ["+url+"], falling back to filename part.");
}
}
}
}
}
}
if(lcurl.indexOf(".") !== -1){  // split by file extension
var arLcurl=lcurl.split(".");
return getExtValue(arLcurl[arLcurl.length-1]);    // grab last in array since URI likely will have them
}
return undef;
},get:function(idOrUrl,classType){  // Let's extend this with a modular architecture for handling direct retrieval of resources perhaps?
var id=null;
var url=null;
var elem=null;
classType=classType || null;
if(idOrUrl === undef){
return undef;
}
if(isFinite(idOrUrl)){
return idOrUrl;
}
if(typeof (idOrUrl) === 'function'){   // pass a function? sure! :)
idOrUrl=idOrUrl(classType);
}
if(typeof (idOrUrl) === 'object'){
if(classType){
if(idOrUrl instanceof classType){
return idOrUrl;
}else{
return new classType(idOrUrl);
}
}
return idOrUrl;
}
if(typeof (idOrUrl) == 'string'){
if(idOrUrl.indexOf("\n") !== -1){  // passed in a multi-line string already?  should probably check for json/xml or pass it back
return idOrUrl;
}else if(idOrUrl[0] == '#'){
id=idOrUrl.substr(1);
elem=document.getElementById(id);
if(elem){
url=elem.src || null;
}
}
if(!elem && !id && !url && idOrUrl){
url=idOrUrl;
}
}
if(elem && !url){
return CubicVR.util.collectTextNode(elem);  // apply JSON text eval here?
}else if(url){
var xml=null;
var json_data=jsonBin[url] || null;
if(!json_data){
var extType=util.getURIFileType(url);
if(extType === undef && !elem){
return url; // nothing else do to here..  should perhaps figure out if the contents are a one-line json or xml string or text URL?
}
if(extType === "json"){
json_data=CubicVR.util.getJSON(url);
}else if(extType === "xml"){
xml=CubicVR.util.getXML(url);
}else{
xml=CubicVR.util.getURL(url);
}
if(xml && xml.childNodes){
json_data=util.getFirstEntry(util.xml2json(xml));
}else if(xml){
json_data=xml;  // pass through text loading, possibly check for json or xml in the string here
}
}
if(json_data && jsonBin[url] === undef){
jsonBin[url]=json_data;
}
if(classType){
if(classBin[url] && classBin[url] instanceof classType){
return classBin[url];
}else if(json_data){
classBin[url]=new classType(json_data);
return classBin[url];
}
}else if(json_data){
return json_data;
}
return url; // else return the url?
}else if(id && !elem){
console.log("Unable to retrieve requested ID: '"+idOrUrl+"'");
return undef;
}else{
return undef;
}
},clearCache:function(){
classBin={};
jsonBin={};
},getURL:function(srcUrl){
try{
var xmlHttp=new XMLHttpRequest();
xmlHttp.open('GET',srcUrl,false);
xmlHttp.send(null);
if(xmlHttp.status === 200 || xmlHttp.status === 0){
if(xmlHttp.responseText.length){
return xmlHttp.responseText;
}else if(xmlHttp.responseXML){
return xmlHttp.responseXML;
}
}
}catch(e){
alert(srcUrl+" failed to load.");
}
return null;
},getXML:function(srcUrl){
try{
var xmlHttp=new XMLHttpRequest();
xmlHttp.open('GET',srcUrl,false);
xmlHttp.overrideMimeType("application/xml");
xmlHttp.send(null);
if(xmlHttp.status === 200 || xmlHttp.status === 0){
return xmlHttp.responseXML;
}
}catch(e){
try{
alert(srcUrl+" failed to load.");
}catch(ex){
throw(e);
}
}
return null;
},getJSON:function(srcUrl){
try{
var xmlHttp=new XMLHttpRequest();
xmlHttp.open('GET',srcUrl,false);
xmlHttp.overrideMimeType("application/json");
xmlHttp.send(null);
if(xmlHttp.status === 200 || xmlHttp.status === 0){
return eval("("+xmlHttp.responseText+")");
}
}catch(e){
try{
alert(srcUrl+" failed to load.");
}catch(ex){
throw(e);
}
}
return null;
},repackArray:function(data,stride,count){
if(data.length !== parseInt(stride,10)*parseInt(count,10)){
log("array repack error, data size !== stride*count: data.length="+data.length+" stride="+stride+" count="+count);
}
var returnData=[];
var c=0;
for(var i=0,iMax=data.length; i<iMax; i++){
var ims=i%stride;
if(ims === 0){
returnData[c]=[];
}
returnData[c][ims]=data[i];
if(ims === stride-1){
c++;
}
}
return returnData;
},collectTextNode:function(tn){
if(!tn){
return "";
}
var s="";
var textNodeChildren=tn.childNodes;
for(var i=0,tnl=textNodeChildren.length; i<tnl; i++){
s+=textNodeChildren[i].nodeValue;
}
return s;
},floatDelimArray:function(float_str,delim){
if(delim != "\n"){
float_str=float_str.replace(/\n/g," ").replace(/^\s+|\s+$/,'');
}
var fa=float_str.split(delim?delim:",");
for(var i=0,imax=fa.length; i<imax; i++){
fa[i]=parseFloat(fa[i]);
}
if(fa[fa.length-1] !== fa[fa.length-1]){
fa.pop();
}
return fa;
},intDelimArray:function(int_str,delim){
if(delim != "\n"){
int_str=int_str.replace(/\n/g," ").replace(/^\s+|\s+$/,'');
}
var fa=int_str.split(delim?delim:",");
for(var i=0,imax=fa.length; i<imax; i++){
fa[i]=parseInt(fa[i],10);
}
if(fa[fa.length-1] !== fa[fa.length-1]){
fa.pop();
}
return fa;
},textDelimArray:function(text_str,delim){
if(delim != "\n"){
text_str=text_str.replace(/\n/g," ").replace(/^\s+|\s+$/,'');
}
var fa=text_str.split(delim?delim:",");
for(var i=0,imax=fa.length; i<imax; i++){
fa[i]=fa[i];
}
return fa;
},xmlstring2json:function(xmlString){
var splitVal=xmlString.replace(/<!--.*?-->/gm,'').replace(/\n/g,' ').split(/(<[^>]*>)([^<]*)/gm);
var whiteSpace=/^\s+$/gm;
var tagId,stack=[],json_stack=[],json={};
var json_root=json;
for(var i=0,iMax=splitVal.length; i<iMax; i++){
var s=splitVal[i];
if(whiteSpace.test(s) || s === "") continue;
if(/<\?\s?xml[^>]*>/.test(s)) continue;
if(/<.*?>/.test(s)){
var tagVal=s.split(/<([^>]*?)(.*)?>/g);
tagId=tagVal[2];
if(tagId[0] !== "/"){
var arTagId=tagId.split(" ");
tagId=arTagId[0];
var tagStr=arTagId.slice(1).join(" ");
stack.push(tagId);
json_stack.push(json);
if(json[tagId] && !(json[tagId] instanceof Array)){
json[tagId]=[json[tagId]];
}else if(!json[tagId]){
json[tagId]={};
json=json[tagId];
}else{
json=json[tagId];
}
if(json instanceof Array){
json.push({});
json=json[json.length-1];
}
if(tagId.substr(tagId.length-1) === "/" || tagStr.substr(tagStr.length-1) === "/"){
tagId="/"+tagId;
}
}
if(tagId[0] === '/'){
tagId=tagId.substr(1);
if(stack.length && stack[stack.length-1] !== tagId){
console.log("Unmatched tag, aborting: "+tagId);
return false;
}else{
stack.pop();
if(json_stack.length){
json=json_stack[json_stack.length-1];
}else{
json=null;
}
json_stack.pop();
}
}
}else{
var parent=json_stack[json_stack.length-1][tagId];
if(parent instanceof Array){
parent.pop();
parent.push(util.parseNumeric(s));
}else{
json_stack[json_stack.length-1][tagId]=util.parseNumeric(s);
}
}
}
return json_root;
},xmlstring2badgerfish:function(xmlString){
var splitVal=xmlString.replace(/<!--.*?-->/gm,'').replace(/\n/g,' ').split(/(<[^>]*>)([^<]*)/gm);
var whiteSpace=/^\s+$/gm;
var tagId,stack=[],json_stack=[],json={};
var json_root=json;
for(var i=0,iMax=splitVal.length; i<iMax; i++){
var s=splitVal[i];
if(whiteSpace.test(s) || s === "") continue;
if(/<\?\s?xml[^>]*>/.test(s)) continue;
if(/<.*?>/.test(s)){
var tagVal=s.split(/<([^>]*?)(.*)?>/g);
tagId=tagVal[2];
if(tagId[0] !== "/"){
var arTagId=tagId.split(" ");
tagId=arTagId[0];
var tagStr=arTagId.slice(1).join(" ");
stack.push(tagId);
json_stack.push(json);
if(json[tagId] && !(json[tagId] instanceof Array)){
json[tagId]=[json[tagId]];
json=json[tagId];
}else if(!json[tagId]){
json[tagId]={};
json=json[tagId];
}else{
json=json[tagId];
}
if(json instanceof Array){
json.push({});
json=json[json.length-1];
}
if(tagId.substr(tagId.length-1) === "/" || tagStr.substr(tagStr.length-1) === "/"){
tagId="/"+tagId;
}
var arAttributeData=util.multiSplit(tagStr,"= ");
var key="";
for(var j=0; j<arAttributeData.length; j++){
var ars=arAttributeData[j];
if(ars[ars.length-1] === "/"){
ars=ars.substr(0,ars.length-1);
}
var isValue=((j%2) === 1);
if(isValue){
if(ars[0] === "'" || ars[0] === '"'){
var quoteChar=ars[0];
ars=ars.substr(1);
while(ars[ars.length-1] !== quoteChar && arAttributeData.length+1<j){
ars=ars+arAttributeData.splice(j+1,1);
}
if(ars[ars.length-1] === quoteChar){
ars=ars.substr(0,ars.length-1);
}
}
json["@"+key]=ars;
}else{
key=ars;
}
}
}
if(tagId[0] === '/'){
tagId=tagId.substr(1);
if(stack.length && stack[stack.length-1] !== tagId){
console.log("Unmatched tag, aborting: "+stack[stack.length-1]);
return false;
}else{
stack.pop();
if(json_stack.length){
json=json_stack[json_stack.length-1];
}else{
json=null;
}
json_stack.pop();
}
}
}else{
json.$=s;
}
}
return json_root;
},xml2badgerfish:function(xmlDoc){
var jsonData={};
var nodeStack=[];
var i,iMax,iMin;
var n;
var j=jsonData;
var cn,tn;
var regEmpty=/^\s+|\s+$/g;
xmlDoc.jsonParent=j;
nodeStack.push(xmlDoc);
while(nodeStack.length){
n=nodeStack.pop();
var tagGroup=null;
j=n.jsonParent;
for(i=0, iMax=n.childNodes.length; i<iMax; i++){
cn=n.childNodes[i];
tn=cn.tagName;
if(tn !== undef){
tagGroup=tagGroup || {};
tagGroup[tn]=tagGroup[tn] || 0;
tagGroup[tn]++;
}
}
if(n.attributes) if(n.attributes.length){
for(i=0, iMax=n.attributes.length; i<iMax; i++){
var att=n.attributes[i];
j["@"+att.name]=att.value;
}
}
for(i=0, iMax=n.childNodes.length; i<iMax; i++){
cn=n.childNodes[i];
tn=cn.tagName;
if(cn.nodeType === 1){
if(tagGroup[tn]>1){
j[tn]=j[tn] || [];
j[tn].push({});
cn.jsonParent=j[tn][j[tn].length-1];
}else{
j[tn]=j[tn] || {};
cn.jsonParent=j[tn];
}
nodeStack.push(cn);
}else if(cn.nodeType === 3){
if(cn.nodeValue.replace(regEmpty,"") !== ""){
j.$=j.$ || "";
j.$+=cn.nodeValue;
}
}
}
}
return jsonData;
},isTextNode:function(tn){
var s="";
var textNodeChildren=tn.childNodes;
for(var i=0,tnl=textNodeChildren.length; i<tnl; i++){
if(textNodeChildren[i].nodeType !== 3 || textNodeChildren[i].childNodes.length) return false;
}
return true;
},parseNumeric:function(str_in){
var arr=null,i,iMax,s;
s=str_in.replace(/(?:(?:^|\n)\s+|\s+(?:$|\n))/g,'').replace(/\n/g,' ').replace(/ *, */gm,',').replace(/\s+/g,' ');   // trim any whitespace or line feeds or double spaces
if(s === "") return s;
if((s.indexOf(" ") !== -1 || s.indexOf(",") !== -1) && /[0-9\.,e\-\+ ]+/g.test(s)){
if(!/[^0-9\-\+]+/g.test(s)){ // int
return parseInt(s,10);
}else if(!/[^0-9\- ]+/g.test(s)){ // long vector space
return util.intDelimArray(s," ");
}else if(!/[^0-9\-,]+/g.test(s)){ // long vector csv
return util.intDelimArray(s,",");
}else if(!/[^0-9\.e\-\+ ]+/g.test(s)){ // float vector space
return util.floatDelimArray(s," ");
}else if(!/[^0-9\.,e\+\-]+/g.test(s)){ // float vector csv
return util.floatDelimArray(s,",");
}else if(!/[^0-9,\-\+ ]+/g.test(s)){ // 2 dimensional long vector space,csv
arr=s.split(" ");
for(i=0, iMax=arr.length; i<iMax; i++){
arr[i]=util.intDelimArray(arr[i],",");
}
return arr;
}else if(!/[^0-9\.,e\-\+ ]+/g.test(s)){ // 2 dimensional float vector space,csv
arr=s.split(" ");
for(i=0, iMax=arr.length; i<iMax; i++){
arr[i]=util.floatDelimArray(arr[i],",");
}
return arr;
}
}
var float_val=parseFloat(s);
if(!isNaN(float_val)){
if(!/[^0-9\-\+]+/g.test(s)){
return parseInt(s,10);
}else{
return float_val;
}
}
return str_in;
},xml2json:function(xmlDoc){
var jsonData={};
var nodeStack=[];
var i,iMax,iMin;
var n;
var j=jsonData;
var cn,tn;
var regEmpty=/^\s+|\s+$/g;
xmlDoc.jsonParent=j;
nodeStack.push(xmlDoc);
while(nodeStack.length){
n=nodeStack.pop();
var tagGroup=null;
j=n.jsonParent;
for(i=0, iMax=n.childNodes.length; i<iMax; i++){
cn=n.childNodes[i];
tn=cn.tagName;
if(tn !== undef){
tagGroup=tagGroup || {};
tagGroup[tn]=tagGroup[tn] || 0;
tagGroup[tn]++;
}
}
for(i=0, iMax=n.childNodes.length; i<iMax; i++){
cn=n.childNodes[i];
tn=cn.tagName;
var isText=util.isTextNode(cn);
if(cn.nodeType === 1){
if(tagGroup[tn]>1){
j[tn]=j[tn] || [];
if(isText){
j[tn].push(util.parseNumeric(util.collectTextNode(cn)));
}else{
j[tn].push({});
cn.jsonParent=j[tn][j[tn].length-1];
}
}else{
if(isText){
j[tn]=util.parseNumeric(util.collectTextNode(cn));
}else{
j[tn]=j[tn] || {};
cn.jsonParent=j[tn];
}
}
if(!isText){
nodeStack.push(cn);
}
}
}
}
return jsonData;
}
};
var extend={
util:util,get:util.get,clearCache:util.clearCache
};
return extend;
});
CubicVR.RegisterModule("Shader",function(base){
var undef=base.undef;
var GLCore=base.GLCore;
var enums=base.enums;
var log=base.log;
var util=base.util;
enums.shader={
map:{
COLOR:1,SPECULAR:2,NORMAL:4,BUMP:8,REFLECT:16,ENVSPHERE:32,AMBIENT:64,ALPHA:128,COLORMAP:256
},uniform:{
MATRIX:0,VECTOR:1,FLOAT:2,ARRAY_VERTEX:3,ARRAY_UV:4,ARRAY_FLOAT:5,INT:6
}
};
var cubicvr_compileShader=function(gl,str,type){
var shader;
if(type === "x-shader/x-fragment"){
shader=gl.createShader(gl.FRAGMENT_SHADER);
}else if(type === "x-shader/x-vertex"){
shader=gl.createShader(gl.VERTEX_SHADER);
}else{
return null;
}
gl.shaderSource(shader,str);
gl.compileShader(shader);
//    }
return shader;
};
var cubicvr_getShader=function(gl,id){
var shaderScript=document.getElementById(id);
if(!shaderScript){
return null;
}
var str="";
var k=shaderScript.firstChild;
while(k){
if(k.nodeType === 3){
str+=k.textContent;
}
k=k.nextSibling;
}
var shader;
if(shaderScript.type === "x-shader/x-fragment"){
shader=gl.createShader(gl.FRAGMENT_SHADER);
}else if(shaderScript.type === "x-shader/x-vertex"){
shader=gl.createShader(gl.VERTEX_SHADER);
}else{
return null;
}
gl.shaderSource(shader,str);
gl.compileShader(shader);
return shader;
};
function Shader(vs_id,fs_id){
var util=base.util;
var vertexShader;
var fragmentShader;
var loadedVertexShader;
var loadedFragmentShader;
var gl=GLCore.gl;
this.uniforms=[];
this.uniform_type=[];
this.uniform_typelist=[];
this.success=true;
this.vertexLog="";
this.fragmentLog="";
if(vs_id.indexOf("\n") !== -1){
loadedVertexShader=vs_id;
vertexShader=cubicvr_compileShader(GLCore.gl,vs_id,"x-shader/x-vertex");
}else{
vertexShader=cubicvr_getShader(GLCore.gl,vs_id);
if(vertexShader === null){
loadedVertexShader=util.getURL(vs_id);
vertexShader=cubicvr_compileShader(GLCore.gl,loadedVertexShader,"x-shader/x-vertex");
}
}
if(!gl.getShaderParameter(vertexShader,gl.COMPILE_STATUS)){
this.vertexLog=gl.getShaderInfoLog(vertexShader);
this.success=false;
}
if(fs_id.indexOf("\n") !== -1){
loadedFragmentShader=fs_id;
fragmentShader=cubicvr_compileShader(GLCore.gl,fs_id,"x-shader/x-fragment");
}else{
fragmentShader=cubicvr_getShader(GLCore.gl,fs_id);
if(fragmentShader === null){
loadedFragmentShader=util.getURL(fs_id);
fragmentShader=cubicvr_compileShader(GLCore.gl,loadedFragmentShader,"x-shader/x-fragment");
}
}
if(!gl.getShaderParameter(fragmentShader,gl.COMPILE_STATUS)){
this.fragmentLog=gl.getShaderInfoLog(fragmentShader);
this.success=false;
}
if(this.success){
this.shader=gl.createProgram();
gl.attachShader(this.shader,vertexShader);
gl.attachShader(this.shader,fragmentShader);
gl.linkProgram(this.shader);
if(!GLCore.gl.getProgramParameter(this.shader,gl.LINK_STATUS)){
log("Error linking shader:\n"+gl.getProgramInfoLog(this.shader));
this.success=false;
}
}else{
var vertexResult=util.multiSplit(this.vertexLog,";\n");
var fragmentResult=util.multiSplit(this.fragmentLog,";\n");
if(vertexResult.length){
this.dumpErrors(vertexResult,loadedVertexShader);
}
if(fragmentResult.length){
this.dumpErrors(fragmentResult,loadedFragmentShader);
}
}
}
Shader.prototype={
isCompiled:function(){
return this.success;
},dumpErrors:function(err,src,prefix){
prefix=prefix || "Error on line";
prefix+=" ";
var errorToken="ERROR: ";
var arrSrc=src.split("\n");
for(var i=0,iMax=err.length; i<iMax; i++){
var s=err[i];
if(s.indexOf(errorToken) === 0){
var errStr=s.substr(errorToken.length).trim();
var errLine=errStr.substr(0,errStr.indexOf(" "));
errStr=errStr.substr(errLine.length);
var arrLine=errLine.split(":");
var lineNum=parseInt(arrLine[1],10);
var srcLine=arrSrc[lineNum-1];
console.log(lineNum+"> "+srcLine);
console.log(prefix+lineNum+", :"+errStr);
}
}
},bindSelf:function(uniform_id){
var t,k,p,v;
if(uniform_id.indexOf(".") !== -1){
if(uniform_id.indexOf("[") !== -1){
t=uniform_id.split("[");
p=t[0];
t=t[1].split("]");
k=t[0];
t=t[1].split(".");
v=t[1];
if(this[p] === undef){
this[p]=[];
}
if(this[p][k] === undef){
this[p][k]={};
}
this[p][k][v]=this.uniforms[uniform_id];
}else{  // untested
t=uniform_id.split(".");
p=t[0];
v=t[1];
if(this[p] === undef){
this[p]={};
}
this[p][v]=this.uniforms[uniform_id];
}
}else if(uniform_id.indexOf("[") !== -1){  // untested
t=uniform_id.split("[");
p=t[0];
t=t[1].split("]");
k=t[0];
if(this[p] === undef){
this[p]=[];
}
this[p][k]=this.uniforms[uniform_id];
}else{
this[uniform_id]=this.uniforms[uniform_id];
}
},addMatrix:function(uniform_id,default_val){
this.use();
this.uniforms[uniform_id]=GLCore.gl.getUniformLocation(this.shader,uniform_id);
this.uniform_type[uniform_id]=enums.shader.uniform.MATRIX;
this.uniform_typelist.push([this.uniforms[uniform_id],this.uniform_type[uniform_id]]);
if(default_val !== undef){
this.setMatrix(uniform_id,default_val);
}
this.bindSelf(uniform_id);
return this.uniforms[uniform_id];
},addVector:function(uniform_id,default_val){
this.use();
this.uniforms[uniform_id]=GLCore.gl.getUniformLocation(this.shader,uniform_id);
this.uniform_type[uniform_id]=enums.shader.uniform.VECTOR;
this.uniform_typelist.push([this.uniforms[uniform_id],this.uniform_type[uniform_id]]);
if(default_val !== undef){
this.setVector(uniform_id,default_val);
}
this.bindSelf(uniform_id);
return this.uniforms[uniform_id];
},addFloat:function(uniform_id,default_val){
this.use();
this.uniforms[uniform_id]=GLCore.gl.getUniformLocation(this.shader,uniform_id);
this.uniform_type[uniform_id]=enums.shader.uniform.FLOAT;
this.uniform_typelist.push([this.uniforms[uniform_id],this.uniform_type[uniform_id]]);
if(default_val !== undef){
this.setFloat(uniform_id,default_val);
}
this.bindSelf(uniform_id);
return this.uniforms[uniform_id];
},addVertexArray:function(uniform_id){
this.use();
this.uniforms[uniform_id]=GLCore.gl.getAttribLocation(this.shader,uniform_id);
this.uniform_type[uniform_id]=enums.shader.uniform.ARRAY_VERTEX;
this.uniform_typelist.push([this.uniforms[uniform_id],this.uniform_type[uniform_id]]);
this.bindSelf(uniform_id);
return this.uniforms[uniform_id];
},addUVArray:function(uniform_id){
this.use();
this.uniforms[uniform_id]=GLCore.gl.getAttribLocation(this.shader,uniform_id);
this.uniform_type[uniform_id]=enums.shader.uniform.ARRAY_UV;
this.uniform_typelist.push([this.uniforms[uniform_id],this.uniform_type[uniform_id]]);
this.bindSelf(uniform_id);
return this.uniforms[uniform_id];
},addFloatArray:function(uniform_id){
this.use();
this.uniforms[uniform_id]=GLCore.gl.getAttribLocation(this.shader,uniform_id);
this.uniform_type[uniform_id]=enums.shader.uniform.ARRAY_FLOAT;
this.uniform_typelist.push([this.uniforms[uniform_id],this.uniform_type[uniform_id]]);
this.bindSelf(uniform_id);
return this.uniforms[uniform_id];
},addInt:function(uniform_id,default_val){
this.use();
this.uniforms[uniform_id]=GLCore.gl.getUniformLocation(this.shader,uniform_id);
this.uniform_type[uniform_id]=enums.shader.uniform.INT;
this.uniform_typelist.push([this.uniforms[uniform_id],this.uniform_type[uniform_id]]);
if(default_val !== undef){
this.setInt(uniform_id,default_val);
}
this.bindSelf(uniform_id);
return this.uniforms[uniform_id];
},use:function(){
GLCore.gl.useProgram(this.shader);
},setMatrix:function(uniform_id,mat){
var u=this.uniforms[uniform_id];
if(u === null){
return;
}
var l=mat.length;
if(l === 16){
GLCore.gl.uniformMatrix4fv(u,false,mat);
}else if(l === 9){
GLCore.gl.uniformMatrix3fv(u,false,mat);
}else if(l === 4){
GLCore.gl.uniformMatrix2fv(u,false,mat);
}
},setInt:function(uniform_id,val){
var u=this.uniforms[uniform_id];
if(u === null){
return;
}
GLCore.gl.uniform1i(u,val);
},setFloat:function(uniform_id,val){
var u=this.uniforms[uniform_id];
if(u === null){
return;
}
GLCore.gl.uniform1f(u,val);
},setVector:function(uniform_id,val){
var u=this.uniforms[uniform_id];
if(u === null){
return;
}
var l=val.length;
if(l == 3){
GLCore.gl.uniform3fv(u,val);
}else if(l == 2){
GLCore.gl.uniform2fv(u,val);
}else{
GLCore.gl.uniform4fv(u,val);
}
},clearArray:function(uniform_id){
var gl=GLCore.gl;
var u=this.uniforms[uniform_id];
if(u === null){
return;
}
gl.disableVertexAttribArray(u);
},bindArray:function(uniform_id,buf){
var gl=GLCore.gl;
var u=this.uniforms[uniform_id];
if(u === null){
return;
}
var t=this.uniform_type[uniform_id];
if(t === enums.shader.uniform.ARRAY_VERTEX){
gl.bindBuffer(gl.ARRAY_BUFFER,buf);
gl.vertexAttribPointer(u,3,gl.FLOAT,false,0,0);
gl.enableVertexAttribArray(u);
}else if(t === enums.shader.uniform.ARRAY_UV){
gl.bindBuffer(gl.ARRAY_BUFFER,buf);
gl.vertexAttribPointer(u,2,gl.FLOAT,false,0,0);
}else if(t === enums.shader.uniform.ARRAY_FLOAT){
gl.bindBuffer(gl.ARRAY_BUFFER,buf);
gl.vertexAttribPointer(u,1,gl.FLOAT,false,0,0);
}
}
};
var shader_util={
tidyScript:function(str){
return str.replace(/\t+/g,' ') // strip tabs
.replace(/\/\/.*$/gm,'')  // strip // comments
.replace(/\/\*(.|\n)*\*\//g,'')  // strip /star star/ comments
.replace(/ +/g,' ') // condense multiple spaces
.replace(/ *\[ */g,'[') // remove spaces from left brackets
.replace(/ *\] */g,']') // remove spaces from right brackets
.replace(/ *; */g,';')  // remove spaces around ;
.replace(/ *$/gm,'')  // strip trailing line spaces
.replace(/^ */gm,''); // strip prefixed line spaces
},getDefines:function(str){
var defines={};
var ar_str=util.multiSplit(str,"\n;");
for(i=0, iMax=ar_str.length; i<iMax; i++){
var s=ar_str[i];
if(s.indexOf("#define") === 0){
var sa=s.split(" ");
if(sa.length>2){
defines[sa[1]]=sa.slice(2).join(" ");
}
}
}
return defines;
},replaceAll:function(str,arr,wrapl,wrapr){
wrapl=wrapl || "";
wrapr=wrapr || "";
for(var i in arr){
if(!arr.hasOwnProperty(i)) continue;
var strval=wrapl+i+wrapr;
while(str.indexOf(strval) !== -1){
str=str.replace(strval,wrapl+arr[i]+wrapr);
}
}
return str;
},getShaderInfo:function(v,f){
var i,iMax,j,jMax,s,sa;
var typeList=["uniform","attribute","varying"];
var ids=[];
var shader_vars={};
var shader_structs={};
var ar_str;
if(f === undef) f="";
v=shader_util.tidyScript(v);
f=shader_util.tidyScript(f);
shader_vars.v_define=shader_util.getDefines(v);
shader_vars.f_define=shader_util.getDefines(f);
v=shader_util.replaceAll(v,shader_vars.v_define,"[","]");
f=shader_util.replaceAll(f,shader_vars.f_define,"[","]");
var str=(v+"\n"+f);
ar_str=util.multiSplit(str,"\n;");
var structList=[];
var start=-1,end=-1;
for(i=0, iMax=ar_str.length; i<iMax; i++){
s=ar_str[i];
if(start === -1 && s.indexOf("struct") === 0){
start=i;
}else if(end === -1 && start !== -1 && s.indexOf("}") !== -1){
end=i+1;
}
if(start !== -1 && end !== -1){
var structStr=ar_str.slice(start,end).join("\n").replace(/(\{|\})/g,"\n").replace(/ +$/gm,"").replace(/^ +/gm,"").replace(/\n\n/gm,"\n");
structList.push({start:start,end:end,struct:structStr.split("\n")});
start= -1;
end= -1;
}
}
for(i=0, iMax=structList.length; i<iMax; i++){
var struct=structList[i].struct;
var structName=null;
for(j=0, jMax=struct.length; j<jMax; j++){
s=struct[j].split(" ");
if(s.length<=1) continue;
if(s[0] == "struct"){
structName=s[1];
shader_structs[structName]={};
}else if(structName){
shader_structs[structName][s[1]]=s[0];
}
}
}
shader_vars.struct=shader_structs;
for(i=0, iMax=typeList.length; i<iMax; i++){
shader_vars[typeList[i]]=[];
}
for(i=0, iMax=ar_str.length; i<iMax; i++){
s=ar_str[i];
for(j=0, jMax=typeList.length; j<jMax; j++){
var typeName=typeList[j];
if(s.indexOf(typeName) === 0){
sa=s.split(" ");
if(sa.length === 3 && sa[0] == typeName){
if(ids.indexOf(sa[2]) === -1){
ids.push(sa[2]);
if(sa[2].indexOf("[") !== -1){
var ar_info=sa[2].split("[");
var arLen=ar_info[1].replace("]","");
var arLenInt=parseInt(arLen,10);
var isNan=(arLenInt !== arLenInt);
if(!isNan){
arLen=arLenInt;
}
shader_vars[typeName].push({name:ar_info[0],type:sa[1],isArray:true,len:arLen});
}else{
shader_vars[typeName].push({name:sa[2],type:sa[1]});
}
}
}
}
}
}
return shader_vars;
},genShaderVarList:function(shaderInfo,vtype){
var shaderVars=shaderInfo[vtype];
var resultList=[];
var i,iMax,j,jMax,svLoc,n;
if(!shaderVars) return [];
for(i=0, iMax=shaderVars.length; i<iMax; i++){
var sv=shaderVars[i];
if(shaderInfo.struct[sv.type]){
var structInfo=shaderInfo.struct[sv.type];
if(structInfo && sv.isArray){
for(j=0, jMax=sv.len; j<jMax; j++){
svLoc=sv.name+"["+j+"]";
for(n in structInfo){
if(!structInfo.hasOwnProperty(n)){
continue;
}
resultList.push({location:svLoc+"."+n,type:structInfo[n],basename:sv.name});
}
}
}else{
for(n in structInfo){
resultList.push({location:sv.name+"."+n,type:structInfo[n],basename:sv.name});
}
}
}else{
if(sv.isArray){
for(j=0, jMax=sv.len; j<jMax; j++){
svLoc=sv.name+"["+j+"]";
resultList.push({location:svLoc,type:sv.type,basename:sv.name});
}
}else{
resultList.push({location:sv.name,type:sv.type,basename:sv.name});
}
}
}
return resultList;
},getShaderVars:function(shaderInfo){
var results={};
results.uniform=shader_util.genShaderVarList(shaderInfo,"uniform");
results.attribute=shader_util.genShaderVarList(shaderInfo,"attribute");
return results;
}
};
function CustomShader(obj_init){
this._update=obj_init.update || null;
this._init=obj_init.init || null;
this._vertex=base.get(obj_init.vertex) || null;
this._fragment=base.get(obj_init.fragment) || null;
this._bindings=[];
this._shader=null;
this._shaderInfo=null;
this._shaderVars=null;
this._initialized=false;
var dpCheck=(this._vertex || "")+(this._fragment || "");
if(dpCheck.trim() !== ""){
this._hasDepthPack=/\s\!?LIGHT_DEPTH_PASS\s/.test(dpCheck);
}else{
this._hasDepthPack=false;
}
}
CustomShader.prototype={
use:function(){
if(this._initialized){
this._shader.use();
}
},getShader:function(){
return this._shader;
},ready:function(){
return this._initialized;
},isReady:function(){
return this._initialized;
},hasDepthPack:function(){
return this._hasDepthPack;
},_init_shader:function(vs_id,fs_id,internal_vars,doSplice,spliceToken){
internal_vars=internal_vars || [];
var vertex_shader=base.util.get(vs_id);
var fragment_shader=base.util.get(fs_id);
spliceToken=spliceToken || "#define customShader_splice";
doSplice=(doSplice === undef)?(this._vertex || this._fragment):doSplice;
if(doSplice){
var vertSplice=vertex_shader.indexOf(spliceToken);
var fragSplice=fragment_shader.indexOf(spliceToken);
if(vertSplice !== -1 && this._vertex){
vertex_shader=vertex_shader.substr(0,vertSplice)+this._vertex;
}
if(fragSplice !== -1 && this._fragment){
fragment_shader=fragment_shader.substr(0,fragSplice)+this._fragment;
}
}
this._shader=new base.Shader(vertex_shader,fragment_shader);
this._shaderInfo=shader_util.getShaderInfo(vertex_shader,fragment_shader);
this._shaderVars=shader_util.getShaderVars(this._shaderInfo);
this._appendShaderVars(this._shaderVars,"uniform",internal_vars);
this._appendShaderVars(this._shaderVars,"attribute",internal_vars);
this._initialized=this._shader.isCompiled();
if(this._initialized && this._init){
this._init(this);
}
},_appendShaderVars:function(varList,utype,internal_vars){
for(var i=0,iMax=this._shaderVars[utype].length; i<iMax; i++){
var sv=this._shaderVars[utype][i];
var svloc=sv.location;
var basename=sv.basename;
if(internal_vars.indexOf(basename) !== -1){
continue;
}else{
}
var svtype=sv.type;
if(svtype === "vec3"){
if(utype === "attribute"){
this._shader.addVertexArray(svloc);
}else{
this._shader.addVector(svloc);
}
}else if(svtype === "vec2"){
if(utype === "attribute"){
this._shader.addUVArray(svloc);
}else{
this._shader.addVector(svloc);
}
}else if(svtype === "float"){
if(utype === "attribute"){
this._shader.addFloatArray(svloc);
}else{
this._shader.addFloat(svloc);
}
}else if(svtype === "sampler2D" || svtype === "int"){
this._shader.addInt(svloc);
}else if(svtype === "mat4" || svtype === "mat3" || svtype === "mat2"){
this._shader.addMatrix(svloc);
}
var binding=this._bindSelf(svloc);
if(svtype == "sampler2D" && binding){
var cs=this;
var gl=GLCore.gl;
binding.set=function(cs,context){
return function(idx,texture){
if(texture !== undef){
gl.activeTexture(gl.TEXTURE0+idx);
gl.bindTexture(GLCore.gl.TEXTURE_2D,base.Textures[texture.tex_id]);
}
context.value=idx;
cs.update(context);
};
}(this,binding);
}
}
},_bindSelf:function(uniform_id){
var t,k,p,v,bindval;
if(this._shader.uniforms[uniform_id] === null) return;
if(uniform_id.indexOf(".") !== -1){
if(uniform_id.indexOf("[") !== -1){
t=uniform_id.split("[");
p=t[0];
t=t[1].split("]");
k=t[0];
t=t[1].split(".");
v=t[1];
if(this[p] === undef){
this[p]=[];
}
if(this[p][k] === undef){
this[p][k]={};
}
bindval={location:this._shader.uniforms[uniform_id],value:null,type:this._shader.uniform_type[uniform_id]};
this[p][k][v]=bindval;
this._bindings.push(bindval);
}else{  // untested
t=uniform_id.split(".");
p=t[0];
v=t[1];
if(this[p] === undef){
this[p]={};
}
bindval={location:this._shader.uniforms[uniform_id],value:null,type:this._shader.uniform_type[uniform_id]};
this[p][v]=bindval;
this._bindings.push(bindval);
}
}else if(uniform_id.indexOf("[") !== -1){  // untested
t=uniform_id.split("[");
p=t[0];
t=t[1].split("]");
k=t[0];
if(this[p] === undef){
this[p]=[];
}
bindval={location:this._shader.uniforms[uniform_id],value:null,type:this._shader.uniform_type[uniform_id]};
this[p][k]=bindval;
this._bindings.push(bindval);
}else{
bindval={location:this._shader.uniforms[uniform_id],value:null,type:this._shader.uniform_type[uniform_id]};
this[uniform_id]=bindval;
this._bindings.push(bindval);
}
if(bindval){
bindval.set=function(cs,context){
return function(value){
context.value=value;
cs.update(context);
};
}(this,bindval);
}
return bindval;
},_doUpdate:function(opt){
if(!this._initialized) return;
if(this._update){
this._update(this,opt);
}else{
for(var i=0,iMax=this._bindings.length; i<iMax; i++){
this.update(this._bindings[i],opt);
}
}
},update:function(bindObj){
if(!this._initialized) return;
var gl=GLCore.gl;
var l;
var val=bindObj.value;
var u=bindObj.location;
if(u === null) return;
if(bindObj.type === enums.shader.uniform.MATRIX){
l=val.length;
if(l === 16){
gl.uniformMatrix4fv(u,false,val);
}else if(l === 9){
gl.uniformMatrix3fv(u,false,val);
}else if(l === 4){
gl.uniformMatrix2fv(u,false,val);
}
}else if(bindObj.type === enums.shader.uniform.INT){
gl.uniform1i(u,val);
}else if(bindObj.type === enums.shader.uniform.VECTOR){
l=val.length;
if(l === 3){
gl.uniform3fv(u,val);
}else if(l === 2){
gl.uniform2fv(u,val);
}else{
gl.uniform4fv(u,val);
}
}else if(bindObj.type === enums.shader.uniform.FLOAT){
gl.uniform1f(u,val);
}else if(bindObj.type === enums.shader.uniform.ARRAY_VERTEX){
gl.bindBuffer(gl.ARRAY_BUFFER,val);
gl.vertexAttribPointer(u,3,gl.FLOAT,false,0,0);
gl.enableVertexAttribArray(u);
}else if(bindObj.type === enums.shader.uniform.ARRAY_UV){
gl.bindBuffer(gl.ARRAY_BUFFER,val);
gl.vertexAttribPointer(u,2,gl.FLOAT,false,0,0);
gl.enableVertexAttribArray(u);
}else if(bindObj.type === enums.shader.uniform.ARRAY_FLOAT){
gl.bindBuffer(gl.ARRAY_BUFFER,val);
gl.vertexAttribPointer(u,1,gl.FLOAT,false,0,0);
gl.enableVertexAttribArray(u);
}
}
};
var extend={
Shader:Shader,shader_util:shader_util,CustomShader:CustomShader
};
return extend;
});
CubicVR.RegisterModule("MainLoop",function(base){
var undef=base.undef;
var nop=function(){};
var enums=base.enums;
var GLCore=base.GLCore;
enums.keyboard={
BACKSPACE:8,
TAB:9,
ENTER:13,
SHIFT:16,
CTRL:17,
ALT:18,
PAUSE:19,
CAPS_LOCK:20,
ESCAPE:27,
SPACE:32,
PAGE_UP:33,
PAGE_DOWN:34,
END:35,
HOME:36,
LEFT_ARROW:37,
UP_ARROW:38,
RIGHT_ARROW:39,
DOWN_ARROW:40,
INSERT:45,
DELETE:46,
KEY_0:48,
KEY_1:49,
KEY_2:50,
KEY_3:51,
KEY_4:52,
KEY_5:53,
KEY_6:54,
KEY_7:55,
KEY_8:56,
KEY_9:57,
KEY_A:65,
KEY_B:66,
KEY_C:67,
KEY_D:68,
KEY_E:69,
KEY_F:70,
KEY_G:71,
KEY_H:72,
KEY_I:73,
KEY_J:74,
KEY_K:75,
KEY_L:76,
KEY_M:77,
KEY_N:78,
KEY_O:79,
KEY_P:80,
KEY_Q:81,
KEY_R:82,
KEY_S:83,
KEY_T:84,
KEY_U:85,
KEY_V:86,
KEY_W:87,
KEY_X:88,
KEY_Y:89,
KEY_Z:90,
LEFT_META:91,
RIGHT_META:92,
SELECT:93,
NUMPAD_0:96,
NUMPAD_1:97,
NUMPAD_2:98,
NUMPAD_3:99,
NUMPAD_4:100,
NUMPAD_5:101,
NUMPAD_6:102,
NUMPAD_7:103,
NUMPAD_8:104,
NUMPAD_9:105,
MULTIPLY:106,
ADD:107,
SUBTRACT:109,
DECIMAL:110,
DIVIDE:111,
F1:112,
F2:113,
F3:114,
F4:115,
F5:116,
F6:117,
F7:118,
F8:119,
F9:120,
F10:121,
F11:122,
F12:123,
NUM_LOCK:144,
SCROLL_LOCK:145,
SEMICOLON:186,
EQUALS:187,
COMMA:188,
DASH:189,
PERIOD:190,
FORWARD_SLASH:191,
GRAVE_ACCENT:192,
OPEN_BRACKET:219,
BACK_SLASH:220,
CLOSE_BRACKET:221,
SINGLE_QUOTE:222
};
function Timer(){
this.time_elapsed=0;
this.system_milliseconds=0;
this.start_time=0;
this.end_time=0;
this.last_update=0;
this.paused_time=0;
this.offset=0;
this.paused_state=0;
}
Timer.prototype={
start:function(){
this.update();
this.num_updates=0;
this.start_time=this.system_milliseconds;
this.last_update=this.start_time;
this.paused_state=false;
this.lock_state=false;
this.lock_rate=0;
this.paused_time=0;
this.offset=0;
},stop:function(){
this.end_time=this.system_milliseconds;
},reset:function(){
this.start();
},lockFramerate:function(f_rate){
this.lock_rate=1.0/f_rate;
this.lock_state=true;
},unlock:function(){
var msec_tmp=this.system_milliseconds;
this.lock_state=false;
this.update();
this.last_update=this.system_milliseconds-this.lock_rate;
this.offset+=msec_tmp-this.system_milliseconds;
this.lock_rate=0;
},locked:function(){
return this.lock_state;
},update:function(){
this.num_updates++;
this.last_update=this.system_milliseconds;
if(this.lock_state){
this.system_milliseconds+=(this.lock_rate*1000) | 0;
}else{
this.system_milliseconds=Date.now();
}
if(this.paused_state) this.paused_time+=this.system_milliseconds-this.last_update;
this.time_elapsed=this.system_milliseconds-this.start_time-this.paused_time+this.offset;
},getMilliseconds:function(){
return this.time_elapsed;
},getSeconds:function(){
return this.getMilliseconds()/1000.0;
},setMilliseconds:function(milliseconds_in){
this.offset-=(this.system_milliseconds-this.start_time-this.paused_time+this.offset)-milliseconds_in;
},setSeconds:function(seconds_in){
this.setMilliseconds((seconds_in*1000.0) | 0);
},getLastUpdateSeconds:function(){
return this.getLastUpdateMilliseconds()/1000.0;
},getLastUpdateMilliseconds:function(){
return this.system_milliseconds-this.last_update;
},getTotalMilliseconds:function(){
return this.system_milliseconds-this.start_time;
},getTotalSeconds:function(){
return this.getTotalMilliseconds()/1000.0;
},getNumUpdates:function(){
return this.num_updates;
},setPaused:function(pause_in){
this.paused_state=pause_in;
},getPaused:function(){
return this.paused_state;
}
};
function MainLoopRequest(){
var gl=GLCore.gl;
if(base.GLCore.mainloop === null) return;
if(window.requestAnimationFrame){
window.requestAnimationFrame(MainLoopRequest);
}
base.GLCore.mainloop.interval();
}
function setMainLoop(ml){
base.GLCore.mainloop=ml;
}
function MainLoop(mlfunc,doclear,noloop){
if(window.requestAnimationFrame === undef){
window.requestAnimationFrame=window.webkitRequestAnimationFrame || window.mozRequestAnimationFrame || window.oRequestAnimationFrame || window.msRequestAnimationFrame || null;
}
if(base.GLCore.mainloop !== null){
if(!(window.requestAnimationFrame) && base.GLCore.mainloop){
clearInterval(base.GLCore.mainloop.interval);
}
base.GLCore.mainloop=null;
}
if(mlfunc === null){
base.GLCore.mainloop=null;
return;
}
var renderList=this.renderList=[];
var renderStack=this.renderStack=[{
scenes:[],update:function(){},start:function(){},stop:function(){}
}];
var timer=new Timer();
timer.start();
this.timer=timer;
this.func=mlfunc;
this.doclear=(doclear !== undef)?doclear:true;
base.GLCore.mainloop=this;
if(GLCore.resizeList.length && !base.GLCore.resize_active){
window.addEventListener('resize',function(){
base.GLCore.onResize();
},false);
base.GLCore.resize_active=true;
}
var loopFunc=function(){
return function(){
var gl=base.GLCore.gl;
timer.update();
if(base.GLCore.mainloop.doclear){
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
} //if
mlfunc(timer,base.GLCore.gl);
var sceneGroup=renderStack[renderStack.length-1],renderList=sceneGroup.scenes;
if(sceneGroup.update){
sceneGroup.update(timer,gl);
}
if(renderList){
for(var i=0,l=renderList.length; i<l; ++i){
var scene=renderList[i];
if(scene.paused) continue;
if(scene.update){
scene.update(timer,base.GLCore.gl);
} //if
scene.render();
} //for
} //if
};
}(); //loopFunc
if(!noloop){
if(window.requestAnimationFrame){
this.interval=loopFunc;
window.requestAnimationFrame(MainLoopRequest);
}else{
this.interval=setInterval(loopFunc,20);
} //if
}else{
this.loopFunc=loopFunc;
} //if
} //MainLoop
MainLoop.prototype={
setPaused:function(state){
this.timer.setPaused(state);
},getPaused:function(){
return this.timer.getPaused();
},setTimerSeconds:function(time_in){
this.timer.setSeconds(time_in);
},getTimerSeconds:function(){
return this.timer.getSeconds();
},resetTimer:function(){
this.timer.reset();
},addScene:function(scene,update,paused){
var sceneGroup=this.renderStack[this.renderStack.length-1];
sceneGroup.scenes.push(scene);
return scene;
},pushSceneGroup:function(options){
options.scenes=options.scenes || [];
this.renderStack.push(options);
for(var i=0; i<options.scenes.length; ++i){
options.scenes[i].enable();
} //for
if(options.start){
options.start();
}
},popSceneGroup:function(){
var sceneGroup=this.renderStack[this.renderStack.length-1];
for(var i=0; i<sceneGroup.scenes.length; ++i){
sceneGroup.scenes[i].disable();
} //for
if(this.renderStack.length>1){
this.renderStack.pop();
} //if
if(sceneGroup.stop){
sceneGroup.stop();
}
},getScene:function(name){
var sceneGroup=renderStack[renderStack.length-1];
var scene;
for(var i=0,l=sceneGroup.scenes.length; i<l; ++i){
if(sceneGroup.scenes[i].scene.name === name){
scene=sceneGroup.scenes[i];
break;
} //if
} //for
return scene;
},resumeScene:function(scene){
if(typeof (scene) === "string"){
scene=this.getScene(scene);
} //if
scene.enable();
scene.paused=false;
},pauseScene:function(scene){
if(typeof (scene) === "string"){
scene=this.getScene(scene);
} //if
scene.paused=true;
scene.disable();
},removeScene:function(scene){
var sceneGroup=renderStack[renderStack.length-1];
if(typeof (scene) === "string"){
scene=this.getScene(scene);
} //if
var idx=sceneGroup.scenes.indexOf(scene);
if(idx> -1){
sceneGroup.scenes.splice(idx,1);
} //if
return scene;
},runOnce:function(){
this.loopFunc();
}
};
function MouseViewController(canvas,cam_in,callback_obj){
this.canvas=canvas;
this.camera=cam_in;
this.mpos=[0,0];
this.mdown=false;
var ctx=this;
this.mEvents={};
this.keyState=[];
for(var i in enums.keyboard){
this.keyState[i]=false;
}
this.onMouseDown=function(){
return function(ev){
ctx.mdown=true;
ctx.mpos=[ev.pageX-ev.target.offsetLeft,ev.pageY-ev.target.offsetTop];
if(ctx.mEvents.mouseDown) ctx.mEvents.mouseDown(ctx,ctx.mpos,ctx.keyState);
};
}();
this.onMouseUp=function(){
return function(ev){
ctx.mdown=false;
ctx.mpos=[ev.pageX-ev.target.offsetLeft,ev.pageY-ev.target.offsetTop];
if(ctx.mEvents.mouseUp) ctx.mEvents.mouseUp(ctx,ctx.mpos,ctx.keyState);
};
}();
this.onMouseMove=function(){
return function(ev){
var mdelta=[];
var npos=[ev.pageX-ev.target.offsetLeft,ev.pageY-ev.target.offsetTop];
mdelta[0]=npos[0]-ctx.mpos[0];
mdelta[1]=npos[1]-ctx.mpos[1];
ctx.mpos=npos;
if(ctx.mEvents.mouseMove) ctx.mEvents.mouseMove(ctx,ctx.mpos,mdelta,ctx.keyState);
};
}();
this.onMouseWheel=function(){
return function(ev){
var delta=ev.wheelDelta?ev.wheelDelta:(-ev.detail*100.0);
if(ctx.mEvents.mouseWheel) ctx.mEvents.mouseWheel(ctx,ctx.mpos,delta,ctx.keyState);
};
}();
this.onKeyDown=function(){
return function(ev){
var keyCode=ev.keyCode;
var kpResult=null;
if(ctx.mEvents.keyPress){
kpResult=ctx.mEvents.keyPress(ctx,ctx.mpos,keyCode,ctx.keyState);
if(kpResult !== undef){
ctx.keyState[keyCode]= !!kpResult;
}else{
ctx.keyState[keyCode]=true;
}
}else{
ctx.keyState[keyCode]=true;
}
if(!ctx.keyState[keyCode]){
return;
}
if(ctx.mEvents.keyDown){
kpResult=ctx.mEvents.keyDown(ctx,ctx.mpos,keyCode,ctx.keyState);
if(kpResult !== undef){
ctx.keyState[keyCode]= !!kpResult;
}else{
ctx.keyState[keyCode]=true;
}
}
};
}();
this.onKeyUp=function(){
return function(ev){
var keyCode=ev.keyCode;
if(ctx.mEvents.keyUp){
ctx.mEvents.keyUp(ctx,ctx.mpos,keyCode,ctx.keyState);
}
ctx.keyState[keyCode]=false;
};
}();
this.eventDefaults={
mouseMove:function(ctx,mpos,mdelta,keyState){
if(!ctx.mdown) return;
ctx.orbitView(mdelta);
},mouseWheel:function(ctx,mpos,wdelta,keyState){
ctx.zoomView(wdelta);
},mouseDown:null,mouseUp:null,keyDown:null,keyUp:null,keyPress:null
};
if(callback_obj !== false) this.setEvents((callback_obj === undef)?this.eventDefaults:callback_obj);
this.bind();
}
MouseViewController.prototype={
isKeyPressed:function(keyCode){
return this.keyState[keyCode];
},setEvents:function(callback_obj){
this.mEvents={};
for(var i in callback_obj){
this.bindEvent(i,callback_obj[i]);
}
},orbitView:function(mdelta){
var vec3=base.vec3;
var dv=vec3.subtract(this.camera.target,this.camera.position);
var dist=vec3.length(dv);
this.camera.position=vec3.moveViewRelative(this.camera.position,this.camera.target,-dist*mdelta[0]/300.0,0);
this.camera.position[1]+=dist*mdelta[1]/300.0;
this.camera.position=vec3.add(this.camera.target,vec3.multiply(vec3.normalize(vec3.subtract(this.camera.position,this.camera.target)),dist));
},panView:function(mdelta,horiz){
var vec3=base.vec3;
if(!horiz) horiz=false;
var dv=vec3.subtract(this.camera.target,this.camera.position);
var dist=vec3.length(dv);
var oldpos=this.camera.position;
if(horiz){
this.camera.position=vec3.moveViewRelative(this.camera.position,this.camera.target,-dist*mdelta[0]/300.0,-dist*mdelta[1]/300.0);
}else{ // vertical
this.camera.position=vec3.moveViewRelative(this.camera.position,this.camera.target,-dist*mdelta[0]/300.0,0);
this.camera.position[1]+=dist*mdelta[1]/300.0;
}
var cam_delta=vec3.subtract(this.camera.position,oldpos);
this.camera.target=vec3.add(this.camera.target,cam_delta);
},zoomView:function(delta,zmin,zmax){
var vec3=base.vec3;
var dv=vec3.subtract(this.camera.target,this.camera.position);
var dist=vec3.length(dv);
dist-=delta/1000.0;
if(!zmin) zmin=0.1;
if(!zmax) zmax=1000.0;
if(dist<zmin) dist=zmin;
if(dist>zmax) dist=zmax;
this.camera.position=vec3.add(this.camera.target,vec3.multiply(vec3.normalize(vec3.subtract(this.camera.position,this.camera.target)),dist));
},bindEvent:function(event_id,event_func){
if(event_func === undef){
this.mEvents[event_id]=this.eventDefaults[event_id];
}else{
this.mEvents[event_id]=event_func;
}
},unbindEvent:function(event_id){
this.bindEvent(event_id,null);
},bind:function(){
this.canvas.addEventListener('mousemove',this.onMouseMove,false);
this.canvas.addEventListener('mousedown',this.onMouseDown,false);
this.canvas.addEventListener('mouseup',this.onMouseUp,false);
this.canvas.addEventListener('mousewheel',this.onMouseWheel,false);
this.canvas.addEventListener('DOMMouseScroll',this.onMouseWheel,false);
window.addEventListener('keydown',this.onKeyDown,false);
window.addEventListener('keyup',this.onKeyUp,false);
},unbind:function(){
this.canvas.removeEventListener('mousemove',this.onMouseMove,false);
this.canvas.removeEventListener('mousedown',this.onMouseDown,false);
this.canvas.removeEventListener('mouseup',this.onMouseUp,false);
this.canvas.removeEventListener('mousewheel',this.onMouseWheel,false);
this.canvas.removeEventListener('DOMMouseScroll',this.onMouseWheel,false);
window.removeEventListener('keydown',this.onKeyDown,false);
window.removeEventListener('keyup',this.onKeyUp,false);
},setCamera:function(cam_in){
this.camera=cam_in;
},getMousePosition:function(){
return this.mpos;
}
};
var exports={
Timer:Timer,MainLoop:MainLoop,MouseViewController:MouseViewController,setMainLoop:setMainLoop,keyboard:enums.keyboard
};
return exports;
});
CubicVR.RegisterModule("Texture",function(base){
var GLCore=base.GLCore;
var enums=base.enums;
var undef=base.undef;
var log=base.log;
enums.texture={
map:{
COLOR:0,ENVSPHERE:1,NORMAL:2,BUMP:3,REFLECT:4,SPECULAR:5,AMBIENT:6,ALPHA:7,MAX:8
},filter:{
LINEAR:0,LINEAR_MIP:1,NEAREST:2,NEAREST_MIP:3
}
};
function checkIsPOT(w,h){
if(w === 1 || h === 1){
return false;
}else{
if(w !== 1){
while((w%2) === 0){
w/=2;
}
}
if(h !== 1){
while((h%2) === 0){
h/=2;
}
}
if(w>1){
return false;
}
if(h>1){
return false;
}
}
return true;
}
var DeferredLoadTexture=function(img_path,filter_type){
this.img_path=img_path;
this.filter_type=filter_type;
}; //DefferedLoadTexture
DeferredLoadTexture.prototype={
getTexture:function(deferred_bin,binId){
return new Texture(this.img_path,this.filter_type,deferred_bin,binId);
} //getTexture
};
var Texture=function(img_path,filter_type,deferred_bin,binId,ready_func){
var gl=GLCore.gl;
this.tex_id=base.Textures.length;
this.filterType= -1;
this.onready=ready_func;
this.loaded=false;
base.Textures[this.tex_id]=gl.createTexture();
base.Textures_obj[this.tex_id]=this;
if(img_path){
if(typeof (img_path) === 'string'){
base.Images[this.tex_id]=new Image();
}else if(typeof (img_path) === 'object' && img_path.nodeName === 'IMG'){
base.Images[this.tex_id]=img_path;
} //if
base.Textures_ref[img_path]=this.tex_id;
}
gl.bindTexture(gl.TEXTURE_2D,base.Textures[this.tex_id]);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
if(img_path){
var texId=this.tex_id;
var filterType=(filter_type !== undef)?filter_type:GLCore.default_filter;
var that=this;
base.Images[this.tex_id].onload=function(e){
gl.bindTexture(gl.TEXTURE_2D,base.Textures[texId]);
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
var img=base.Images[texId];
gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
var isPOT=checkIsPOT(img.width,img.height);
if(isPOT){
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
}else{
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
}
if(base.Textures_obj[texId].filterType === -1){
if(!isPOT){
if(filterType === enums.texture.filter.LINEAR_MIP){
filterType=enums.texture.filter.LINEAR;
}
}else{
filterType=enums.texture.filter.LINEAR_MIP;
}
if(base.Textures_obj[texId].filterType === -1){
base.Textures_obj[texId].setFilter(filterType);
}
}else{
base.Textures_obj[texId].setFilter(base.Textures_obj[texId].filterType);
}
if(that.onready){
that.onready();
} //if
gl.bindTexture(gl.TEXTURE_2D,null);
that.loaded=true;
};
if(!deferred_bin){
if(typeof (img_path) === 'string'){
base.Images[this.tex_id].src=img_path;
} //if
}else{
base.Images[this.tex_id].deferredSrc=img_path;
deferred_bin.addImage(binId,img_path,base.Images[this.tex_id]);
}
}
this.active_unit= -1;
};
Texture.prototype={
setFilter:function(filterType){
if(this.tex_id> -1){
var gl=base.GLCore.gl;
gl.bindTexture(gl.TEXTURE_2D,base.Textures[this.tex_id]);
if(filterType === enums.texture.filter.LINEAR){
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
}else if(filterType === enums.texture.filter.LINEAR_MIP){
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_NEAREST);
gl.generateMipmap(gl.TEXTURE_2D);
}else if(filterType === enums.texture.filter.NEAREST){
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
}else if(filterType === enums.texture.filter.NEAREST_MIP){
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST_MIPMAP_LINEAR);
gl.generateMipmap(gl.TEXTURE_2D);
}
this.filterType=filterType;
}
},use:function(tex_unit){
if(this.tex_id> -1){
GLCore.gl.activeTexture(tex_unit);
GLCore.gl.bindTexture(GLCore.gl.TEXTURE_2D,base.Textures[this.tex_id]);
this.active_unit=tex_unit;
}
},clear:function(){
if(this.tex_id> -1 && this.active_unit !== -1){
GLCore.gl.activeTexture(this.active_unit);
GLCore.gl.bindTexture(GLCore.gl.TEXTURE_2D,null);
this.active_unit= -1;
}
},destroy:function(){
var gl=base.GLCore.gl;
if(this.tex_id> -1 && base.Textures[this.tex_id]){
gl.deleteTexture(base.Textures[this.tex_id]);
delete base.Textures_obj[this.tex_id];
this.tex_id= -1;
}
}
};
function CanvasTexture(options){
var gl=base.GLCore.gl;
if(options.nodeName === 'CANVAS' || options.nodeName === 'IMG' || options.nodeName === 'VIDEO'){
this.canvasSource=options;
}else{
this.canvasSource=document.createElement('CANVAS');
if(options.width === undefined || options.height === undefined){
throw new Error('Width and height must be specified for generating a new CanvasTexture.');
} //if
this.canvasSource.width=options.width;
this.canvasSource.height=options.height;
this.canvasContext=this.canvasSource.getContext('2d');
} //if
this.updateFunction=options.update;
this.texture=new base.Texture();
this.setFilter=this.texture.setFilter;
this.clear=this.texture.clear;
this.use=this.texture.use;
this.tex_id=this.texture.tex_id;
this.filterType=this.texture.filterType;
var c=this.canvasSource;
if(!c.height || !c.width){
log("Warning - CanvasTexture input has no initial width and height, edges clamped.");
}
if(!c.height || !c.width || !checkIsPOT(c.width,c.height)){
this.setFilter(enums.texture.filter.LINEAR);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
}else{
this.setFilter(enums.texture.filter.LINEAR_MIP);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
}
if(options.nodeName === 'IMG'){
this.update();
} //if
} //CanvasTexture
CanvasTexture.prototype={
update:function(){
if(this.updateFunction){
this.updateFunction(this.canvasSource,this.canvasContext);
} //if
var gl=base.GLCore.gl;
gl.bindTexture(gl.TEXTURE_2D,base.Textures[this.texture.tex_id]);
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.canvasSource);
if(this.filterType === enums.texture.filter.LINEAR_MIP){
gl.generateMipmap(gl.TEXTURE_2D);
}
gl.bindTexture(gl.TEXTURE_2D,null);
} //CanvasTexture.update
};
function PdfTexture(page,options){
if(!page){
throw("PDF Texture Error: page is null.");
}
var self=this,gl=base.GLCore.gl,canvas=this.canvasSource=document.createElement('canvas'),ctx;
canvas.mozOpaque=true;
canvas.width=options.width;
canvas.height=options.height;
ctx=this.canvasContext=canvas.getContext('2d');
ctx.save();
ctx.fillStyle='rgb(255, 255, 255)';
ctx.fillRect(0,0,canvas.width,canvas.height);
ctx.restore();
page.startRendering(ctx,function(){ self.update(); });
this.texture=new base.Texture();
this.updateFunction=options.update || function(){};
this.setFilter=this.texture.setFilter;
this.clear=this.texture.clear;
this.use=this.texture.use;
this.tex_id=this.texture.tex_id;
this.filterType=this.texture.filterType;
if(!checkIsPOT(canvas.width,canvas.height)){
this.setFilter(enums.texture.filter.LINEAR);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
}else{
this.setFilter(enums.texture.filter.LINEAR_MIP);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
}
}
PdfTexture.prototype={
update:function(){
this.updateFunction(this.canvasSource,this.canvasContext);
var gl=base.GLCore.gl;
gl.bindTexture(gl.TEXTURE_2D,base.Textures[this.texture.tex_id]);
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.canvasSource);
if(this.filterType === enums.texture.filter.LINEAR_MIP){
gl.generateMipmap(gl.TEXTURE_2D);
}
gl.bindTexture(gl.TEXTURE_2D,null);
}
};
function TextTexture(text,options){
var color=(options && options.color) || '#FFFFFF';
var bgcolor=(options && options.bgcolor);
var font=(options && options.font) || '18pt Arial';
var align=(options && options.align) || 'start';
var y=(options && options.y) || 0;
var width=(options && options.width) || undef;
var height=(options && options.height) || undef;
var i;
var canvas=document.createElement('CANVAS');
var ctx=canvas.getContext('2d');
var x;
var lines=0;
if(typeof (text) === 'string'){
lines=1;
}else{
lines=text.length;
} //if
ctx.font=font;
var lineHeight=(options && options.lineHeight) || ctx.measureText('OO').width;
var widest;
if(lines === 1){
widest=ctx.measureText(text).width;
}else{
widest=0;
for(i=0; i<lines; ++i){
var w=ctx.measureText(text[i]).width;
if(w>widest){
widest=w;
} //if
} //for
} //if
canvas.width=width || widest;
canvas.height=height || lineHeight*lines;
if(bgcolor){
ctx.fillStyle=bgcolor;
ctx.fillRect(0,0,canvas.width,canvas.height);
} //if
ctx.fillStyle=color;
ctx.font=font;
ctx.textAlign=align;
ctx.textBaseline='top';
if(lines === 1){
x=(options && options.x) || align === 'center'?canvas.width/2:align === 'right'?canvas.width:0;
ctx.fillText(text,x,y);
}else{
for(i=0; i<lines; ++i){
x=(options && options.x) || align === 'center'?canvas.width/2:align === 'right'?canvas.width:0;
ctx.fillText(text[i],x,y+i*lineHeight);
} //for
} //if
ctx.fill();
this.use=CanvasTexture.prototype.use;
this.clear=CanvasTexture.prototype.clear;
this.update=CanvasTexture.prototype.update;
CanvasTexture.apply(this,[canvas]);
this.update();
this.canvasSource=canvas=ctx=null;
} //TextTexture
function PJSTexture(pjsURL,width,height){
var util=base.util;
var gl=base.GLCore.gl;
this.texture=new base.Texture();
this.canvas=document.createElement("CANVAS");
this.canvas.width=width;
this.canvas.height=height;
this.pjs=new Processing(this.canvas,base.util.getURL(pjsURL));
this.pjs.noLoop();
this.pjs.redraw();
this.setFilter=this.texture.setFilter;
this.clear=this.texture.clear;
this.use=this.texture.use;
this.tex_id=this.texture.tex_id;
this.filterType=this.texture.filterType;
if(!checkIsPOT(this.canvas.width,this.canvas.height)){
this.setFilter(enums.texture.filter.LINEAR);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
}else{
this.setFilter(enums.texture.filter.LINEAR_MIP);
}
}
PJSTexture.prototype={
update:function(){
var gl=base.GLCore.gl;
this.pjs.redraw();
gl.bindTexture(gl.TEXTURE_2D,base.Textures[this.texture.tex_id]);
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.canvas);
if(this.filterType === enums.texture.filter.LINEAR_MIP){
gl.generateMipmap(gl.TEXTURE_2D);
}
gl.bindTexture(gl.TEXTURE_2D,null);
}
};
function NormalMapGen(inTex,width,height){
var gl=GLCore.gl;
this.width=width;
this.height=height;
this.srcTex=inTex;
this.outTex=new base.RenderBuffer(width,height);
var isPOT=checkIsPOT(width,height),vTexel=[1.0/width,1.0/height,0];
this.outputBuffer=new base.RenderBuffer(width,height,false);
this.fsQuad=base.fsQuad.make(width,height);
var vs=["attribute vec3 aVertex;","attribute vec2 aTex;","varying vec2 vTex;","void main(void)","{","  vTex = aTex;","  vec4 vPos = vec4(aVertex.xyz,1.0);","  gl_Position = vPos;","}"].join("\n");
shaderNMap=new base.Shader(vs,["#ifdef GL_ES","precision highp float;","#endif","uniform sampler2D srcTex;","varying vec2 vTex;","uniform vec3 texel;","void main(void)","{"," vec3 color;"," color.r = (texture2D(srcTex,vTex + vec2(texel.x,0)).r-texture2D(srcTex,vTex + vec2(-texel.x,0)).r)/2.0 + 0.5;"," color.g = (texture2D(srcTex,vTex + vec2(0,-texel.y)).r-texture2D(srcTex,vTex + vec2(0,texel.y)).r)/2.0 + 0.5;"," color.b = 1.0;"," gl_FragColor.rgb = color;"," gl_FragColor.a = 1.0;","}"].join("\n"));
shaderNMap.use();
shaderNMap.addUVArray("aTex");
shaderNMap.addVertexArray("aVertex");
shaderNMap.addInt("srcTex",0);
shaderNMap.addVector("texel");
shaderNMap.setVector("texel",vTexel);
this.shaderNorm=shaderNMap;
this.setFilter=this.outputBuffer.texture.setFilter;
this.clear=this.outputBuffer.texture.clear;
this.use=this.outputBuffer.texture.use;
this.tex_id=this.outputBuffer.texture.tex_id;
this.filterType=this.outputBuffer.texture.filterType;
this.outTex.use(gl.TEXTURE0);
//    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
this.setFilter(enums.texture.filter.LINEAR);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
}
NormalMapGen.prototype={
update:function(){
var gl=GLCore.gl;
var dims=gl.getParameter(gl.VIEWPORT);
this.outputBuffer.use();
gl.viewport(0,0,this.width,this.height);
gl.clearColor(0.0,0.0,0.0,1.0);
gl.clear(gl.COLOR_BUFFER_BIT);
this.srcTex.use(gl.TEXTURE0);
base.fsQuad.render(this.shaderNorm,this.fsQuad); // copy the output buffer to the screen via fullscreen quad
gl.bindFramebuffer(gl.FRAMEBUFFER,null);
gl.viewport(dims[0],dims[1],dims[2],dims[3]);
}
};
function RenderTexture(width,height,depth){
var gl=GLCore.gl;
this.width=width;
this.height=height;
this.outTex=new base.RenderBuffer(width,height,depth);
this.texture=this.outTex.texture;
var isPOT=checkIsPOT(width,height);
this.setFilter=this.outTex.texture.setFilter;
this.clear=this.outTex.texture.clear;
this.use=this.outTex.texture.use;
this.tex_id=this.outTex.texture.tex_id;
this.filterType=this.outTex.texture.filterType;
this.texture.use(gl.TEXTURE0);
if(!isPOT){
this.setFilter(enums.texture.filter.LINEAR);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
}else{
this.setFilter(enums.texture.filter.LINEAR);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
}
this.dims=[width,height];
this.depth=depth?true:false;
}
RenderTexture.prototype={
begin:function(){
var gl=GLCore.gl;
this.dims=gl.getParameter(gl.VIEWPORT);
this.outTex.use();
gl.viewport(0,0,this.width,this.height);
if(this.depth){
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
}else{
gl.clear(gl.COLOR_BUFFER_BIT);
}
},end:function(){
var gl=GLCore.gl;
gl.bindFramebuffer(gl.FRAMEBUFFER,null);
gl.viewport(this.dims[0],this.dims[1],this.dims[2],this.dims[3]);
}
};
function SceneRenderTexture(scene,camera){
this.scene=scene;
this.renderTex=new RenderTexture(camera?camera.width:scene.camera.width,camera?camera.height:scene.camera.height,true);
this.setFilter=this.renderTex.texture.setFilter;
this.clear=this.renderTex.texture.clear;
this.use=this.renderTex.texture.use;
this.tex_id=this.renderTex.texture.tex_id;
this.filterType=this.renderTex.texture.filterType;
}
SceneRenderTexture.prototype={
update:function(){
this.renderTex.begin();
this.scene.updateShadows();
this.scene.render();
this.renderTex.end();
}
};
var extend={
Texture:Texture,DeferredLoadTexture:DeferredLoadTexture,CanvasTexture:CanvasTexture,PdfTexture:PdfTexture,TextTexture:TextTexture,PJSTexture:PJSTexture,NormalMapGen:NormalMapGen,RenderTexture:RenderTexture,SceneRenderTexture:SceneRenderTexture
};
return extend;
});
CubicVR.RegisterModule("Material",function(base){
var undef=base.undef;
var GLCore=base.GLCore;
var enums=base.enums;
var util=base.util;
var failSafeShader=null;
function Material(obj_init){
this.initialized=false;
this.dirtyFlag=false;
this.blendEnabled=false;
this.textures=[];
this.shader=[];
obj_init=base.get(obj_init) || {};
this.customShader=obj_init?(obj_init.shader || null):null;
if(failSafeShader === null){
failSafeShader=new base.CustomShader({
vertex:["precision lowp float; \nattribute vec3 vertexPosition; uniform mat4 matrixModelView; uniform mat4 matrixProjection; uniform mat4 matrixObject;","void main(void) { gl_Position = matrixProjection * matrixModelView * matrixObject * vec4(vertexPosition,1.0); }"].join("\n"),fragment:"precision lowp float; \nvoid main(void) { gl_FragColor = vec4(1.0,0.0,1.0,1.0); }\n"
});
failSafeShader._init_shader(failSafeShader._vertex,failSafeShader._fragment,false);
}
if(this.customShader && !this.customShader._init_shader && typeof (this.customShader) === 'object'){
this.customShader=new base.CustomShader(this.customShader);
}
this.diffuse=obj_init.diffuse || [1.0,1.0,1.0];
this.specular=obj_init.specular || [0.1,0.1,0.1];
this.color=obj_init.color || [1,1,1];
this.ambient=obj_init.ambient || [0,0,0];
this.name=obj_init.name || null;
this.visible=(obj_init.visible !== undef)?obj_init.visible:true;
this.friction=(obj_init.friction !== undef)?obj_init.friction:0.3;
this.collision=(obj_init.visible !== undef)?obj_init.collision:true;
this.opacity=(obj_init.opacity === undef)?1.0:obj_init.opacity;
this.shininess=(obj_init.shininess === undef)?1.0:obj_init.shininess;
this.max_smooth=(obj_init.max_smooth === undef)?60.0:obj_init.max_smooth;
this.env_amount=(obj_init.env_amount === undef)?0.75:obj_init.env_amount;
this.morph=(obj_init.morph === undef)?false:obj_init.morph;
this.color_map=(obj_init.colorMap === undef)?false:obj_init.colorMap;
this.uvOffset=(obj_init.uvOffset === undef)?[0,0]:obj_init.uvOffset;
this.noFog=(obj_init.noFog === undef)?false:obj_init.noFog;
if(obj_init.textures){
for(var i in obj_init.textures){
this.setTexture(obj_init.textures[i],i);
}
}
}
var basicTex=[enums.texture.map.REFLECT,enums.texture.map.SPECULAR,enums.texture.map.NORMAL,enums.texture.map.BUMP];
var renderBindState=[];
var material_internal_vars=["textureColor","textureEnvSphere","textureNormal","textureBump","textureReflect","textureSpecular","textureAmbient","textureAlpha","matrixModelView","matrixProjection","matrixObject","matrixNormal","vertexPosition","vertexNormal","vertexColor","vertexTexCoord","materialTexOffset","vertexMorphPosition","vertexMorphNormal","materialMorphWeight","lightDiffuse","lightSpecular","lightIntensity","lightDistance","lightPosition","lightDirection","lightCutOffAngle","lightShadowMap","lightProjectionMap","lightDepthClip","lightShadowMatrix","lightAmbient","materialDiffuse","materialColor","materialAmbient","materialSpecular","materialShininess","materialEnvironment","materialAlpha","postDepthInfo"];
Material.prototype={
clone:function(){
var newMat=new base.Material({
diffuse:this.diffuse,specular:this.specular,color:this.color,ambient:this.ambient,opacity:this.opacity,shininess:this.shininess,max_smooth:this.max_smooth,env_amount:this.env_amount,morph:this.morph,colorMap:this.color_map,visible:this.visible,friction:this.friction,collision:this.collision,name:this.name
});
for(var i in this.textures){
if(!this.textures.hasOwnProperty(i)) continue;
newMat.setTexture(this.textures[i],i);
}
return newMat;
},setVisibility:function(vis){
this.visible=vis;
},getVisibility:function(){
return this.visible;
},setCollision:function(cval){
this.collision=cval;
},getCollision:function(){
return this.collision;
},setFriction:function(fval){
this.friction=fval;
},getFriction:function(){
return this.friction;
},setTexture:function(tex,tex_type){
if(!tex) return;
tex_type=base.parseEnum(enums.texture.map,tex_type) || 0;
if(!base.features.texturePerPixel){
if(basicTex.indexOf(tex_type) !== -1){
return;
}
}
if(!tex.use && typeof (tex) === "string"){
tex=(base.Textures_ref[tex] !== undef)?base.Textures_obj[base.Textures_ref[tex]]:(new base.Texture(tex));
}
this.textures[tex_type]=tex;
},calcShaderMask:function(){
var shader_mask=0;
shader_mask=shader_mask+((typeof (this.textures[enums.texture.map.COLOR]) === 'object')?enums.shader.map.COLOR:0);
shader_mask=shader_mask+((typeof (this.textures[enums.texture.map.SPECULAR]) === 'object')?enums.shader.map.SPECULAR:0);
shader_mask=shader_mask+((typeof (this.textures[enums.texture.map.NORMAL]) === 'object')?enums.shader.map.NORMAL:0);
shader_mask=shader_mask+((typeof (this.textures[enums.texture.map.BUMP]) === 'object')?enums.shader.map.BUMP:0);
shader_mask=shader_mask+((typeof (this.textures[enums.texture.map.REFLECT]) === 'object')?enums.shader.map.REFLECT:0);
shader_mask=shader_mask+((typeof (this.textures[enums.texture.map.ENVSPHERE]) === 'object')?enums.shader.map.ENVSPHERE:0);
shader_mask=shader_mask+((typeof (this.textures[enums.texture.map.AMBIENT]) === 'object')?enums.shader.map.AMBIENT:0);
shader_mask=shader_mask+((typeof (this.textures[enums.texture.map.ALPHA]) === 'object')?enums.shader.map.ALPHA:0);
shader_mask=shader_mask+((this.opacity !== 1.0)?enums.shader.map.ALPHA:0);
shader_mask=shader_mask+(this.color_map?enums.shader.map.COLORMAP:0);
if(this.opacity !== 1.0) this.blendEnabled=true;
return shader_mask;
},getShaderHeader:function(light_type,light_count){
return ((light_count !== undef)?("#define LIGHT_COUNT "+light_count+"\n"):"")+"#define TEXTURE_COLOR "+((typeof (this.textures[enums.texture.map.COLOR]) === 'object')?1:0)+"\n#define TEXTURE_SPECULAR "+((typeof (this.textures[enums.texture.map.SPECULAR]) === 'object')?1:0)+"\n#define TEXTURE_NORMAL "+((typeof (this.textures[enums.texture.map.NORMAL]) === 'object')?1:0)+"\n#define TEXTURE_BUMP "+((typeof (this.textures[enums.texture.map.BUMP]) === 'object')?1:0)+"\n#define TEXTURE_REFLECT "+((typeof (this.textures[enums.texture.map.REFLECT]) === 'object')?1:0)+"\n#define TEXTURE_ENVSPHERE "+((typeof (this.textures[enums.texture.map.ENVSPHERE]) === 'object')?1:0)+"\n#define TEXTURE_AMBIENT "+((typeof (this.textures[enums.texture.map.AMBIENT]) === 'object')?1:0)+"\n#define TEXTURE_ALPHA "+((typeof (this.textures[enums.texture.map.ALPHA]) === 'object')?1:0)+"\n#define MATERIAL_ALPHA "+((this.opacity !== 1.0)?1:0)+"\n#define LIGHT_IS_POINT "+((light_type === enums.light.type.POINT)?1:0)+"\n#define LIGHT_IS_DIRECTIONAL "+((light_type === enums.light.type.DIRECTIONAL)?1:0)+"\n#define LIGHT_IS_SPOT "+(((light_type === enums.light.type.SPOT) || (light_type === enums.light.type.SPOT_SHADOW) || (light_type === enums.light.type.SPOT_SHADOW_PROJECTOR))?1:0)+"\n#define LIGHT_SHADOWED "+(((light_type === enums.light.type.SPOT_SHADOW) || (light_type === enums.light.type.SPOT_SHADOW_PROJECTOR) || (light_type === enums.light.type.AREA))?1:0)+"\n#define LIGHT_IS_PROJECTOR "+(((light_type === enums.light.type.SPOT_SHADOW_PROJECTOR))?1:0)+"\n#define LIGHT_SHADOWED_SOFT "+(GLCore.soft_shadow?1:0)+"\n#define LIGHT_IS_AREA "+((light_type === enums.light.type.AREA)?1:0)+"\n#define LIGHT_DEPTH_PASS "+((light_type === enums.light.type.DEPTH_PACK)?1:0)+"\n#define FX_DEPTH_ALPHA "+(GLCore.depth_alpha?1:0)+"\n#define VERTEX_MORPH "+(this.morph?1:0)+"\n#define VERTEX_COLOR "+(this.color_map?1:0)+"\n#define FOG_ENABLED "+((GLCore.fog_enabled && !this.noFog)?1:0)+"\n#define USE_FOG_EXP "+(GLCore.fogExp?1:0)+"\n#define USE_FOG_LINEAR "+(GLCore.fogLinear?1:0)+"\n#define LIGHT_PERPIXEL "+(base.features.lightPerPixel?1:0)+"\n\n";
},bindObject:function(obj_in,light_shader){
var gl=GLCore.gl;
var u=light_shader;
var up=u.vertexPosition;
var uv=u.vertexTexCoord;
var un=u.vertexNormal;
var uc=u.vertexColor;
gl.bindBuffer(gl.ARRAY_BUFFER,obj_in.compiled.gl_points);
gl.vertexAttribPointer(up,3,gl.FLOAT,false,0,0);
gl.enableVertexAttribArray(up);
if(uv !== null && obj_in.compiled.gl_uvs !== null && uv !== -1){
gl.bindBuffer(gl.ARRAY_BUFFER,obj_in.compiled.gl_uvs);
gl.vertexAttribPointer(uv,2,gl.FLOAT,false,0,0);
gl.enableVertexAttribArray(uv);
}
renderBindState.uv=uv;
if(un !== null && obj_in.compiled.gl_normals !== null && un !== -1){
gl.bindBuffer(gl.ARRAY_BUFFER,obj_in.compiled.gl_normals);
gl.vertexAttribPointer(un,3,gl.FLOAT,false,0,0);
gl.enableVertexAttribArray(un);
}
renderBindState.un=un;
if(uc !== null && obj_in.compiled.gl_colors !== null && uc !== -1){
gl.bindBuffer(gl.ARRAY_BUFFER,obj_in.compiled.gl_colors);
gl.vertexAttribPointer(uc,3,gl.FLOAT,false,0,0);
gl.enableVertexAttribArray(uc);
}
renderBindState.uc=uc;
if(obj_in.morphTarget){
up=u.vertexMorphPosition;
un=u.vertexMorphNormal;
gl.bindBuffer(gl.ARRAY_BUFFER,obj_in.morphTarget.gl_points);
gl.vertexAttribPointer(up,3,gl.FLOAT,false,0,0);
gl.enableVertexAttribArray(up);
//      gl.enableVertexAttribArray(uv);
if(un !== null && obj_in.morphTarget.gl_normals !== null && un !== -1){
gl.bindBuffer(gl.ARRAY_BUFFER,obj_in.morphTarget.gl_normals);
gl.vertexAttribPointer(un,3,gl.FLOAT,false,0,0);
gl.enableVertexAttribArray(un);
}
gl.uniform1f(u.materialMorphWeight,obj_in.morphWeight);
}
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,obj_in.compiled.gl_elements);
},clearObject:function(obj_in,light_shader){
var gl=GLCore.gl;
if(renderBindState.uv !== undef && renderBindState.uv !== -1){
gl.disableVertexAttribArray(renderBindState.uv);
}
if(renderBindState.un !== undef && renderBindState.un !== -1){
gl.disableVertexAttribArray(renderBindState.un);
}
if(renderBindState.uc !== undef && renderBindState.uc !== -1){
gl.disableVertexAttribArray(renderBindState.uc);
}
var u=light_shader;
if(obj_in.morphTarget && u){
up=u.vertexMorphPosition;
gl.disableVertexAttribArray(up);
un=u.vertexMorphNormal;
if(un !== null && obj_in.compiled.gl_normals !== null && un !== -1){
gl.disableVertexAttribArray(un);
}
}
},use:function(light_type,num_lights){
var m;
var gl=GLCore.gl;
var thistex=this.textures;
var success=true;
num_lights=num_lights || 0;
light_type=light_type || 0;
if(!this.shader[light_type]){
this.shader[light_type]=[];
}
var sh=this.shader[light_type][num_lights];
var noCustomDepthPack=this.customShader && light_type === enums.light.type.DEPTH_PACK && !this.customShader.hasDepthPack();
if(sh && this.opacity !== 1.0 && this.blendEnabled !== true){
this.dirtyFlag=true;
}
if(this.dirtyFlag === true){
sh=null;
this.dirtyFlag=false;
}
if(!sh){
var smask=this.calcShaderMask(light_type);
if(!this.customShader || noCustomDepthPack){
if(!base.ShaderPool[light_type][smask]){
base.ShaderPool[light_type][smask]=[];
}
sh=base.ShaderPool[light_type][smask][num_lights];
}
if(!sh){
var hdr=this.getShaderHeader(light_type,num_lights);
var vs=hdr+GLCore.CoreShader_vs;
var fs=hdr+GLCore.CoreShader_fs;
if(this.customShader && !noCustomDepthPack){
if(!this.customShader._initialized){
this.customShader._init_shader(vs,fs,material_internal_vars);
sh=this.customShader.getShader();
if(!sh.isCompiled()){
success=false;
sh=failSafeShader.getShader();
}
}
}else{
sh=new base.Shader(vs,fs);
if(!sh.isCompiled()){
success=false;
sh=failSafeShader.getShader();
}
base.ShaderPool[light_type][smask][num_lights]=sh;
}
m=0;
if(light_type !== enums.light.type.DEPTH_PACK){
if((light_type === enums.light.type.SPOT_SHADOW) || (light_type === enums.light.type.SPOT_SHADOW_PROJECTOR) || (light_type === enums.light.type.AREA)){
m+=num_lights;  // leave room for shadow map..
if(light_type === enums.light.type.SPOT_SHADOW_PROJECTOR){
m+=num_lights; // leave room for projectors
}
}
if(typeof (thistex[enums.texture.map.COLOR]) === 'object'){
sh.addInt("textureColor",m++);
}
if(typeof (thistex[enums.texture.map.ENVSPHERE]) === 'object'){
sh.addInt("textureEnvSphere",m++);
}
if(typeof (thistex[enums.texture.map.NORMAL]) === 'object'){
sh.addInt("textureNormal",m++);
}
if(typeof (thistex[enums.texture.map.BUMP]) === 'object'){
sh.addInt("textureBump",m++);
}
if(typeof (thistex[enums.texture.map.REFLECT]) === 'object'){
sh.addInt("textureReflect",m++);
}
if(typeof (thistex[enums.texture.map.SPECULAR]) === 'object'){
sh.addInt("textureSpecular",m++);
}
if(typeof (thistex[enums.texture.map.AMBIENT]) === 'object'){
sh.addInt("textureAmbient",m++);
}
}
if(typeof (thistex[enums.texture.map.ALPHA]) === 'object'){
sh.addInt("textureAlpha",m++);
}
sh.addMatrix("matrixModelView");
sh.addMatrix("matrixProjection");
sh.addMatrix("matrixObject");
sh.addMatrix("matrixNormal");
sh.addVertexArray("vertexPosition");
sh.addVertexArray("vertexNormal");
if(this.color_map){
sh.addVertexArray("vertexColor");
}
if(this.morph){
sh.addVertexArray("vertexMorphPosition");
sh.addVertexArray("vertexMorphNormal");
sh.addFloat("materialMorphWeight",0.0);
}
for(var mLight=0; mLight<num_lights; mLight++){
sh.addVector("lightDiffuse["+mLight+"]");
sh.addVector("lightSpecular["+mLight+"]");
sh.addFloat("lightIntensity["+mLight+"]");
sh.addFloat("lightDistance["+mLight+"]");
sh.addVector("lightPosition["+mLight+"]");
sh.addVector("lightDirection["+mLight+"]");
if((light_type === enums.light.type.SPOT_SHADOW) || (light_type === enums.light.type.SPOT_SHADOW_PROJECTOR) || (light_type === enums.light.type.SPOT)){
sh.addFloat("lightCutOffAngle["+mLight+"]");
}
if((light_type === enums.light.type.SPOT_SHADOW) || (light_type === enums.light.type.SPOT_SHADOW_PROJECTOR) || (light_type === enums.light.type.AREA)){
sh.addInt("lightShadowMap["+mLight+"]");
if(light_type === enums.light.type.SPOT_SHADOW_PROJECTOR){
sh.addInt("lightProjectionMap["+mLight+"]");
}
sh.addVector("lightDepthClip["+mLight+"]");
sh.addMatrix("lightShadowMatrix["+mLight+"]");
}
}
if(light_type !== enums.light.type.DEPTH_PACK){  // not needed for depth packing stage
sh.addVector("lightAmbient");
sh.addVector("materialDiffuse");
sh.addVector("materialColor");
sh.addVector("materialAmbient");
sh.addVector("materialSpecular");
sh.addFloat("materialShininess");
sh.addFloat("materialEnvironment");
} // !DEPTH_PACK
sh.addFloat("materialAlpha");
if(GLCore.depth_alpha || (light_type === enums.light.type.DEPTH_PACK) || (light_type === enums.light.type.SPOT_SHADOW) || (light_type === enums.light.type.SPOT_SHADOW_PROJECTOR) || (light_type === enums.light.type.AREA)){
sh.addVector("postDepthInfo");
}
sh.addUVArray("vertexTexCoord");
sh.addVector("materialTexOffset");
if(GLCore.fog_enabled && !this.noFog){
sh.addVector("fogColor",GLCore.fogColor);
sh.addFloat("fogDensity",GLCore.fogDensity);
sh.addFloat("fogNear",GLCore.fogNear);
sh.addFloat("fogFar",GLCore.fogFar);
}
}
this.shader[light_type][num_lights]=sh;
sh.use();
if(sh.materialTexOffset != -1) gl.uniform2fv(sh.materialTexOffset,[0,0]);
if(this.customShader){
this.customShader._doUpdate({material:this});
}
}else{
success=(sh !== failSafeShader);
sh.use();
if(this.customShader && !noCustomDepthPack){
this.customShader._doUpdate({material:this});
}
}
m=0;
var t;
if(light_type !== enums.light.type.DEPTH_PACK){
if((light_type === enums.light.type.SPOT_SHADOW) || (light_type === enums.light.type.SPOT_SHADOW_PROJECTOR) || (light_type === enums.light.type.AREA)){
m+=num_lights;  // leave room for shadow map..
if(light_type === enums.light.type.SPOT_SHADOW_PROJECTOR){  // projector texture reserved
m+=num_lights;
}
}
if(!!(t=thistex[enums.texture.map.COLOR])){
t.use(GLCore.gl.TEXTURE0+m);
m++;
}
if(!!(t=thistex[enums.texture.map.ENVSPHERE])){
t.use(GLCore.gl.TEXTURE0+m);
m++;
gl.uniform1f(sh.materialEnvironment,this.env_amount);
}
if(!!(t=thistex[enums.texture.map.NORMAL])){
t.use(GLCore.gl.TEXTURE0+m);
m++;
}
if(!!(t=thistex[enums.texture.map.BUMP])){
t.use(GLCore.gl.TEXTURE0+m);
m++;
}
if(!!(t=thistex[enums.texture.map.REFLECT])){
t.use(GLCore.gl.TEXTURE0+m);
m++;
}
if(!!(t=thistex[enums.texture.map.SPECULAR])){
t.use(GLCore.gl.TEXTURE0+m);
m++;
}
if(!!(t=thistex[enums.texture.map.AMBIENT])){
t.use(GLCore.gl.TEXTURE0+m);
m++;
}
}
if(!!(t=thistex[enums.texture.map.ALPHA])){
t.use(GLCore.gl.TEXTURE0+m);
m++;
}
if(GLCore.fog_enabled && !this.noFog){
gl.uniform3fv(sh.fogColor,GLCore.fogColor);
gl.uniform1f(sh.fogDensity,GLCore.fogDensity);
gl.uniform1f(sh.fogNear,GLCore.fogNear);
gl.uniform1f(sh.fogFar,GLCore.fogFar);
}
if(light_type !== enums.light.type.DEPTH_PACK){
gl.uniform3fv(sh.materialColor,this.color);
gl.uniform3fv(sh.materialDiffuse,this.diffuse);
gl.uniform3fv(sh.materialAmbient,this.ambient);
gl.uniform3fv(sh.materialSpecular,this.specular);
gl.uniform1f(sh.materialShininess,this.shininess*128.0);
gl.uniform3fv(sh.lightAmbient,base.globalAmbient);
if(this.opacity !== 1.0){
gl.uniform1f(sh.materialAlpha,this.opacity);
}
if(GLCore.depth_alpha || (light_type === enums.light.type.SPOT_SHADOW) || (light_type === enums.light.type.SPOT_SHADOW_PROJECTOR) || (light_type === enums.light.type.AREA)){
gl.uniform3fv(sh.postDepthInfo,[GLCore.depth_alpha_near,GLCore.depth_alpha_far,0.0]);
}
}else{ // Depth Pack
gl.uniform3fv(sh.postDepthInfo,[GLCore.shadow_near,GLCore.shadow_far,0.0]);
}
if(sh.materialTexOffset) gl.uniform2fv(sh.materialTexOffset,this.uvOffset);
return success;
}
};
var extend={
Material:Material
};
return extend;
});
CubicVR.RegisterModule("Mesh",function(base){
var undef=base.undef;
var GLCore=base.GLCore;
var log=base.log;
function parseTransform(t){
if(t === undef) return undef;
if(typeof (t) === 'array'){
return t;
}
if(typeof (t) === 'object'){
if(!!t.getResult){
return t.getResult();
}else if(!!t.position || !!t.rotation || !!t.scale){
return base.mat4.transform(t.position,t.rotation,t.scale);
}else{
return undef;
}
}
}
function Face(){
this.points=[];
this.point_normals=[];
this.point_colors=[];
this.uvs=[];
this.normal=[0,0,0];
this.material=0;
this.segment=0;
}
Face.prototype={
setUV:function(uvs,point_num){
if(point_num !== undef){
this.uvs[point_num]=uvs;
}else{
if(uvs.length !== 2){
this.uvs=uvs;
}else{
this.uvs.push(uvs);
}
}
},setColor:function(color,point_num){
if(point_num !== undef){
this.point_colors[point_num]=color;
}else{
if(typeof (color[0]) !== 'number'){
this.point_colors=color;
}else{
this.point_colors.push(color);
}
}
},flip:function(){
for(var i=0,iMax=this.point_normals.length; i<iMax; i++){
this.point_normals[i]=[-this.point_normals[i][0],-this.point_normals[i][1],-this.point_normals[i][2]];
}
this.points.reverse();
this.point_normals.reverse();
this.uvs.reverse();
this.normal=[-this.normal[0],-this.normal[1],-this.normal[2]];
}
};
function Mesh(obj_init){
this.compiled=null; // VBO data
this.materials=[];
this.bb=null;
this.instanceMaterials=null;
this.edges=null;
this.faces=[]; // faces with point references
this.points=[]; // point list
this.currentFace= -1; // start with no faces
this.currentMaterial=0; // null material
this.currentSegment=0; // default segment
this.morphTargets=null;
this.morphTarget=null;
this.morphWeight=0.0;
this.morphSourceIndex= -1;
this.morphTargetIndex= -1;
this.originBuffer=null;
obj_init=base.get(obj_init) || {};
if(obj_init instanceof base.Mesh){
this.booleanAdd(obj_init);
obj_init._clones=obj_init._clones || 1;
obj_init._clones++;
if(obj_init.name){
this.name=obj_init.name+"_copy"+obj_init._clones;
}else{
this.name=null;
}
return;
}
this.name=obj_init.name || null;
this.dynamic=obj_init.dynamic || false;
if(obj_init.material){
var material=obj_init.material;
if(material.length){
this.materials=material;
}else if(typeof (material) === 'object'){
if(material.use){
this.setFaceMaterial(material);
}else{
this.setFaceMaterial(new base.Material(material));
}
}
}
if(obj_init.points){
this.build(obj_init);
}
if(obj_init.part){
this.build(obj_init.part);
}else if(obj_init.parts){
this.build(obj_init.parts);
}
this.primitives=obj_init.primitives || obj_init.primitive || null;
if((this.primitives && !this.primitives.length) || typeof (this.primitives) === 'string'){
this.primitives=[this.primitives];
}
if(this.primitives && this.primitives.length){
for(var i=0,iMax=this.primitives.length; i<iMax; i++){
var prim=this.primitives[i];
if(typeof (prim) === 'string'){
prim=base.get(prim);
}
var prim_func=base.primitives[prim.type];
if(prim.type && !!prim_func){
this.booleanAdd(prim_func(prim));
}else if(prim.type){
log("Mesh error, primitive "+(prim.type)+" is unknown.");
var possibles="";
for(var k in base.primitives){
if(base.primitives.hasOwnProperty(k)){
if(possibles !== ""){
possibles+=", ";
}
possibles+=k;
}
}
log("Available primitive types are: "+possibles);
}else{
log("Mesh error, primitive "+(i+1)+" lacks type.");
}
}
}
this.buildWireframe=obj_init.buildWireframe || obj_init.wireframe || (!!obj_init.wireframeMaterial) || obj_init.triangulateWireframe || false;
this.triangulateWireframe=obj_init.triangulateWireframe || null;
this.wireframeMaterial=base.get(obj_init.wireframeMaterial,base.Material) || null;
this.wireframe=obj_init.wireframe || false;
if(obj_init.flipFaces && this.faces.length){
this.flipFaces();
}
if(obj_init.prepare || obj_init.compile && this.faces.length){
this.prepare();
}
if(obj_init.clean || obj_init.compile && this.faces.length && !this.dynamic){
this.clean();
}
if(obj_init.calcNormals && !obj_init.compile && !obj_init.prepare){
this.calcNormals();
}
}
Mesh.prototype={
setWireframe:function(wireframe_in){
this.wireframe=wireframe_in;
},isWireframe:function(){
return this.wireframe;
},setWireframeMaterial:function(wireframe_mat){
this.wireframeMaterial=wireframe_mat;
},build:function(parts,points){
var j,jMax;
if(typeof (parts) === 'string'){
parts=base.get(parts);
}
if(parts && !parts.length){
parts=[parts];
}
var ptBaseOfs=0,ptOfs=0;
var faceOfs=this.faces.length;
if(points && points.length){
ptBaseOfs=this.points.length;
this.points.concat(points);
}
for(var i=0,iMax=parts.length; i<iMax; i++){
var part=parts[i];
var material=part.material;
var part_points=part.points;
var faces=part.faces;
var uv=part.uv;
var color=part.color;
var segment=part.segment || null;
if(segment !== null){
this.setSegment(parseInt(segment,10));
}
if(part_points && part_points.length){
ptOfs=this.points.length;
this.points=this.points.concat(part_points);
if(faces && faceOfs){
faces=faces.slice(0);
for(var a=0,aMax=faces.length; a<aMax; a++){
var face=faces[a];
for(var b=0,bMax=faces.length; b<bMax; b++){
face[b]+=faceOfs;
}
}
}
}else{
ptOfs=ptBaseOfs;
}
if(material){
if(material.length){
this.materials=material;
}else if(typeof (material) === 'object'){
if(material.use){
this.setFaceMaterial(material);
}else{
this.setFaceMaterial(new base.Material(material));
}
}
}
if(faces && faces.length){
this.addFace(faces);
}
if(faces && uv && typeof (uv) === 'object'){
var mapper=null;
if(uv.length && uv.length === faces.length){
if(uv.length === faces.length){
for(j=0, jMax=uv.length; j<jMax; j++){
this.faces[j+faceOfs].setUV(uv[j]);
}
}else{
log("Mesh error in part, face count: "+faces.length+", uv count:"+uv.length);
}
}else{
mapper=uv.apply?uv:(new base.UVMapper(uv));
}
if(mapper){
mapper.apply(this,this.currentMaterial,this.currentSegment,faceOfs,this.faces.length-faceOfs);
}
}
if(faces && color && typeof (color) === 'object'){
if(color.length && color.length === faces.length){
for(j=0, jMax=color.length; j<jMax; j++){
this.faces[j+faceOfs].setColor(color[j]);
}
this.materials[this.currentMaterial].colorMap=true;
}else{
log("Mesh error in part, face count: "+faces.length+", color count:"+color.length);
}
}
}
return this;
},showAllSegments:function(){
for(var i in this.segment_state){
if(this.segment_state.hasOwnProperty(i)){
this.segment_state[i]=true;
}
}
},hideAllSegments:function(){
for(var i in this.segment_state){
if(this.segment_state.hasOwnProperty(i)){
this.segment_state[i]=false;
}
}
},setSegment:function(i,val){
if(val !== undef){
this.segment_state[i]=val;
}else{
this.currentSegment=i;
}
},addPoint:function(p){
if(p.length !== 3 || typeof (p[0]) === 'object'){
for(var i=0,iMax=p.length; i<iMax; i++){
this.points.push(p[i]);
}
}else{
this.points.push(p);
}
return this.points.length-1;
},getMaterialIndex:function(mat){
return this.materials.indexOf(mat);
},setFaceMaterial:function(mat,facenum){
var mat_id;
if(typeof (mat) == 'number'){
mat_id=mat;
}else{
mat_id=this.materials.indexOf(mat);
if(mat_id === -1){
this.materials.push(mat);
mat_id=this.materials.length-1;
}
}
if(facenum !== undef){
if(this.faces[facenum] !== undef){
this.faces[facenum].material=mat_id;
}
}else{
this.currentMaterial=mat_id;
}
return this;
},addFace:function(p_list,face_num,face_mat,face_seg){
if(typeof (p_list[0]) !== 'number'){
for(var i=0,iMax=p_list.length; i<iMax; i++){
this.addFace(p_list[i]);
}
return;
}
if(face_num === undef){
this.currentFace=this.faces.length;
this.faces.push(new Face());
}else{
if(this.faces[face_num] === undef){
this.faces[face_num]=new Face();
}
this.currentFace=face_num;
}
if(typeof (p_list) === 'object'){
this.faces[this.currentFace].points=p_list;
}
if(face_mat !== undef){
this.setFaceMaterial(face_mat,this.currentFace);
}else{
this.faces[this.currentFace].material=this.currentMaterial;
}
if(face_seg !== undef){
this.faces[this.currentFace].segment=face_seg;
}else{
this.faces[this.currentFace].segment=this.currentSegment;
}
return this.currentFace;
},flipFaces:function(){
for(var i=0,iMax=this.faces.length; i<iMax; i++){
this.faces[i].flip();
}
},triangulateQuads:function(){
for(var i=0,iMax=this.faces.length; i<iMax; i++){
if(this.faces[i].points.length === 4){
var p=this.faces.length;
this.addFace([this.faces[i].points[2],this.faces[i].points[3],this.faces[i].points[0]],this.faces.length,this.faces[i].material,this.faces[i].segment);
this.faces[i].points.pop();
this.faces[p].normal=this.faces[i].normal.slice(0);
if(this.faces[i].point_colors.length === 4){
this.faces[p].setColor(this.faces[i].point_colors[2],0);
this.faces[p].setColor(this.faces[i].point_colors[3],1);
this.faces[p].setColor(this.faces[i].point_colors[0],2);
this.faces[i].point_colors.pop();
}
if(this.faces[i].uvs.length === 4){
this.faces[p].setUV(this.faces[i].uvs[2],0);
this.faces[p].setUV(this.faces[i].uvs[3],1);
this.faces[p].setUV(this.faces[i].uvs[0],2);
this.faces[i].uvs.pop();
}
if(this.faces[i].point_normals.length === 4){
this.faces[p].point_normals[0]=this.faces[i].point_normals[2];
this.faces[p].point_normals[1]=this.faces[i].point_normals[3];
this.faces[p].point_normals[2]=this.faces[i].point_normals[0];
this.faces[i].point_normals.pop();
}
}
}
return this;
},booleanAdd:function(objAdd,transform){
var mat4=base.mat4;
var pofs=this.points.length;
var fofs=this.faces.length;
var i,j,iMax,jMax;
transform=parseTransform(transform);
if(objAdd.wireframeMaterial){
this.wireframeMaterial=objAdd.wireframeMaterial;
}
if(transform !== undef){
var m=transform;
for(i=0, iMax=objAdd.points.length; i<iMax; i++){
this.addPoint(mat4.vec3_multiply(objAdd.points[i],m));
}
}else{
for(i=0, iMax=objAdd.points.length; i<iMax; i++){
this.addPoint([objAdd.points[i][0],objAdd.points[i][1],objAdd.points[i][2]]);
}
}
var matMap=[];
for(i=0, iMax=objAdd.materials.length; i<iMax; i++){
var mindex=this.materials.indexOf(objAdd.materials[i]);
if(mindex === -1){
this.materials.push(objAdd.materials[i]);
matMap[i]=this.materials.length-1;
}else{
matMap[i]=mindex;
}
}
for(i=0, iMax=objAdd.faces.length; i<iMax; i++){
var newFace=[];
for(j=0, jMax=objAdd.faces[i].points.length; j<jMax; j++){
newFace.push(objAdd.faces[i].points[j]+pofs);
}
var nFaceNum=this.addFace(newFace);
var nFace=this.faces[nFaceNum];
nFace.segment=objAdd.faces[i].segment;
nFace.material=matMap[objAdd.faces[i].material];
if(nFace.material === undef) nFace.material=0;
for(j=0, jMax=objAdd.faces[i].uvs.length; j<jMax; j++){
nFace.uvs[j]=[objAdd.faces[i].uvs[j][0],objAdd.faces[i].uvs[j][1]];
}
for(j=0, jMax=objAdd.faces[i].point_normals.length; j<jMax; j++){
nFace.point_normals[j]=[objAdd.faces[i].point_normals[j][0],objAdd.faces[i].point_normals[j][1],objAdd.faces[i].point_normals[j][2]];
}
}
return this;
},calcFaceNormals:function(face_start,face_end){
var vec3=base.vec3;
var triangle=base.triangle;
var i=0,iMax=this.faces.length;
var face,points=this.points,fp;
if(face_start){
i=face_start;
}
if(face_end){
iMax=face_end+1;
}
for(; i<iMax; i++){
face=this.faces[i];
fp=face.points;
if(fp.length<3){
face.normal=[0,0,0];
continue;
}
vec3.normalize(triangle.normal(points[fp[0]],points[fp[1]],points[fp[2]],face.normal));
}
return this;
},getMaterial:function(m_name){
if(!isNaN(parseInt(m_name,10))){
return this.materials[i];
}
for(var i=0,iMax=this.materials.length; i<iMax; i++){
if(this.materials[i].name === m_name){
return this.materials[i];
}
}
return null;
},getMaterials:function(){
return this.materials;
},bindInstanceMaterials:function(mat_inst){
this.instanceMaterials=mat_inst;
},calcNormals:function(outNormalMapRef){
var vec3=base.vec3;
var updateMap=false;
var normalMapRef_out;
if(this.dynamic){
normalMapRef_out=[];
outNormalMapRef=outNormalMapRef || {};
}
if(outNormalMapRef !== undef){
normalMapRef_out=[];
updateMap=true;
}
this.calcFaceNormals();
var i,j,k,iMax,jMax,kMax;
var point_smoothRef=new Array(this.points.length);
for(i=0, iMax=point_smoothRef.length; i<iMax; i++){
point_smoothRef[i]=[];
}
var numFaces=this.faces.length;
for(i=0; i<numFaces; i++){
var numFacePoints=this.faces[i].points.length;
for(j=0; j<numFacePoints; j++){
var idx=this.faces[i].points[j];
point_smoothRef[idx].push([i,j]);
}
}
for(i=0, iMax=this.points.length; i<iMax; i++){
var numPts=point_smoothRef[i].length;
for(j=0; j<numPts; j++){
var ptCount=1;
var faceNum=point_smoothRef[i][j][0];
var pointNum=point_smoothRef[i][j][1];
var max_smooth=this.materials.length?this.materials[this.faces[faceNum].material].max_smooth:60.0;
var thisFace=this.faces[faceNum];
if(updateMap){
if(normalMapRef_out[faceNum] === undef){
normalMapRef_out[faceNum]=[];
}
if(normalMapRef_out[faceNum][pointNum] === undef){
normalMapRef_out[faceNum][pointNum]=[];
}
}
var tmpNorm=new Array(3);
tmpNorm[0]=thisFace.normal[0];
tmpNorm[1]=thisFace.normal[1];
tmpNorm[2]=thisFace.normal[2];
if(max_smooth !== 0){
for(k=0; k<numPts; k++){
if(j === k){
continue;
}
var faceRefNum=point_smoothRef[i][k][0];
var thisFaceRef=this.faces[faceRefNum];
var ang=vec3.angle(thisFaceRef.normal,thisFace.normal);
if((ang !== ang) || ((ang*(180.0/Math.PI))<=max_smooth)){
if(updateMap){
normalMapRef_out[faceNum][pointNum].push(faceRefNum);
}
tmpNorm[0]+=thisFaceRef.normal[0];
tmpNorm[1]+=thisFaceRef.normal[1];
tmpNorm[2]+=thisFaceRef.normal[2];
ptCount++;
}
}
}
tmpNorm[0]/=ptCount;
tmpNorm[1]/=ptCount;
tmpNorm[2]/=ptCount;
this.faces[faceNum].point_normals[pointNum]=vec3.normalize(tmpNorm);
}
}
if(updateMap){
var normTotal=0;
for(i=0, iMax=normalMapRef_out.length; i<iMax; i++){
for(j=0, jMax=normalMapRef_out[i].length; j<jMax; j++){
normTotal+=normalMapRef_out[i][j].length;
}
}
var hasSegments=this.segments && (this.segments.length>1);
if(!outNormalMapRef.faceCount) outNormalMapRef.faceCount=new Uint8Array(this.faces.length*3);
if(!outNormalMapRef.faceNorm) outNormalMapRef.faceNorm=new Uint16Array(normTotal);
if(!outNormalMapRef.faceNormIdx) outNormalMapRef.faceNormIdx=new Uint16Array(this.faces.length);
var c=0;
for(i=0, iMax=this.faces.length; i<iMax; i++){
for(j=0; j<3; j++){
var nmij=normalMapRef_out[i][j];
outNormalMapRef.faceCount[i*3+j]=nmij?nmij.length:0;
outNormalMapRef.faceNormIdx[i]=c;
if(nmij) for(k=0, kMax=nmij.length; k<kMax; k++){
outNormalMapRef.faceNorm[c++]=normalMapRef_out[i][j][k];
} else{
c++;
}
}
}
this.normalMapRef=outNormalMapRef;
}
return this;
},recalcNormals:function(normalMapRef,options){
var faceNum,faceMax,pointNum,pMax,i,l,n,a,b,c,nc,pn,oRef,oFace,face,faceMapRef,nCount;
normalMapRef=normalMapRef || this.normalMapRef;
if(!normalMapRef) return;
var hasSegments=(options.segments !== undef)?true:false;
var segments=options.segments;
this.calcFaceNormals();
var refIdx=0;
var faceIdx=0;
var rc=0;
var on;
if(hasSegments){
var dm=this.dynamicData.VBO.dynamicMap;
var faceNormIdx=normalMapRef.faceNormIdx;
for(var seg=0,segMax=segments.length; seg<segMax; seg++){
var dmSeg=dm.segmentMap[segments[seg]];
for(var idx=0,idxMax=dmSeg.length; idx<idxMax; idx++){
faceNum=dmSeg[idx];
face=this.faces[faceNum];
on=face.normal;
refIdx=faceNormIdx[faceNum];
for(j=0; j<3; j++){
pn=face.point_normals[j];
a=on[0];
b=on[1];
c=on[2];
nCount=normalMapRef.faceCount[faceNum*3+j];
for(i=0, iMax=nCount; i<iMax; i++){
oRef=normalMapRef.faceNorm[refIdx+i];
oFace=this.faces[oRef];
n=oFace.normal;
a+=n[0];
b+=n[1];
c+=n[2];
}
if(nCount){
nc=nCount+1;
a/=nc;
b/=nc;
c/=nc;
l=Math.sqrt(a*a+b*b+c*c);
a/=l;
b/=l;
c/=l;
pn[0]=a;
pn[1]=b;
pn[2]=c;
}else{
rc++;
}
}
}
}
}else{
for(faceNum=0, faceMax=this.faces.length; faceNum<faceMax; faceNum++){
face=this.faces[faceNum];
on=face.normal;
for(j=0; j<3; j++){
pn=face.point_normals[j];
a=on[0];
b=on[1];
c=on[2];
nCount=normalMapRef.faceCount[faceIdx++];
for(i=0, iMax=nCount; i<iMax; i++){
oRef=normalMapRef.faceNorm[refIdx++];
oFace=this.faces[oRef];
n=oFace.normal;
a+=n[0];
b+=n[1];
c+=n[2];
}
if(nCount){
nc=nCount+1;
a/=nc;
b/=nc;
c/=nc;
l=Math.sqrt(a*a+b*b+c*c);
a/=l;
b/=l;
c/=l;
pn[0]=a;
pn[1]=b;
pn[2]=c;
}else{
rc++;
}
}
}
}
return this;
},removeDoubles:function(tolerance){
var newPoints=[];
var remap=[];
var i,iMax,j,jMax;
for(i=0, iMax=this.points.length; i<iMax; i++){
var foundPt=-1;
var searchPt=this.points[i];
for(j=0, jMax=newPoints.length; j<jMax; j++){
var findPt=newPoints[j];
if(base.vec3.equal(searchPt,findPt,tolerance)){
foundPt=j;
break;
}
}
if(foundPt != -1){
remap[i]=foundPt;
}else{
remap[i]=newPoints.length;
newPoints.push(this.points[i]);
}
}
this.points=newPoints;
for(i=0, iMax=this.faces.length; i<iMax; i++){
var face=this.faces[i];
for(j=0, jMax=face.points.length; j<jMax; j++){
face.points[j]=remap[face.points[j]];
}
}
return this;
},buildEdges:function(){
var i,j,iMax,jMax;
var edges=[];
var edge_result=[];
for(i=0, iMax=this.faces.length; i<iMax; i++){
var face=this.faces[i];
for(j=0, jMax=face.points.length; j<jMax; j++){
var pta,ptb,segId;
segId=face.segment;
matId=face.material;
if(j){
ptb=face.points[j];
pta=face.points[j-1];
}else{
ptb=face.points[j];
pta=face.points[jMax-1];
}
edges[pta]=edges[pta] || {};
edges[pta][matId]=edges[pta][matId] || {};
edges[pta][matId][segId]=edges[pta][matId][segId] || {};
if(!edges[pta][matId][segId][ptb] && !(edges[ptb] && edges[ptb][matId][segId][pta])){
edge_result.push([matId,segId,pta,ptb]);
}
}
}
this.edges=edge_result;
return this;
},subdivide:function(level,catmull){ // catmull-clark subdivision with alternate regular subdivision if catmull===false
var vec3=base.vec3;
catmull=(catmull === undef)?true:catmull;
if(level === undef){
level=1;
}
if(level === 0){
return;
}
var i,j,iMax,jMax,k,kMax,face,edge;
var edges={};
var point_face_list=[];
var point_edge_list=[];
var pointCount=this.points.length;
var faceCount=this.faces.length;
var face_points=[];
var face_point_uv=[];
var face_point_color=[];
var face_point_normal=[];
for(i=0, iMax=faceCount; i<iMax; i++){
face=this.faces[i];
if(face.points && (face.points.length === 3 || face.points.length === 4)){
var face_point=[0,0,0];
for(j=0, jMax=face.points.length; j<jMax; j++){
var addPoint=this.points[face.points[j]];
face_point[0]+=addPoint[0];
face_point[1]+=addPoint[1];
face_point[2]+=addPoint[2];
}
face_point[0]/=jMax;
face_point[1]/=jMax;
face_point[2]/=jMax;
face_points[i]=this.addPoint(face_point);
if(face.uvs.length === face.points.length){
var face_uv=[0,0];
for(j=0, jMax=face.uvs.length; j<jMax; j++){
var point_uv=face.uvs[j];
face_uv[0]+=point_uv[0];
face_uv[1]+=point_uv[1];
}
face_uv[0]/=jMax;
face_uv[1]/=jMax;
face_point_uv[i]=face_uv;
}
if(face.point_colors.length === face.points.length){
var face_color=[0,0,0];
for(j=0, jMax=face.point_colors.length; j<jMax; j++){
var point_color=face.point_colors[j];
face_color[0]+=point_color[0];
face_color[1]+=point_color[1];
face_color[2]+=point_color[2];
}
face_color[0]/=jMax;
face_color[1]/=jMax;
face_color[2]/=jMax;
face_point_color[i]=face_color;
}
if(face.point_normals.length === face.points.length){
var face_normal=[0,0,0];
for(j=0, jMax=face.point_normals.length; j<jMax; j++){
var point_normal=face.point_normals[j];
face_normal[0]+=point_normal[0];
face_normal[1]+=point_normal[1];
face_normal[2]+=point_normal[2];
}
face_normal[0]/=jMax;
face_normal[1]/=jMax;
face_normal[2]/=jMax;
face_point_normal[i]=face_normal;
}
}
}
for(i=0, iMax=this.faces.length; i<iMax; i++){
face=this.faces[i];
for(j=0, jMax=face.points.length; j<jMax; j++){
var pta,ptb,fpa,fpb;
if(j){
fpa=j;
fpb=j-1;
}else{
fpa=j;
fpb=jMax-1;
}
ptb=face.points[fpa];
pta=face.points[fpb];
edges[pta]=edges[pta] || {};
point_face_list[pta]=point_face_list[pta] || [];
point_face_list[pta].push(i);
if(edges[pta][ptb] !== undef){
}
edges[pta][ptb]={face:i,a:pta,b:ptb,fpa:fpa,fpb:fpb};
}
}
for(i in edges){
if(!edges.hasOwnProperty(i)) continue;
for(j in edges[i]){
if(!edges[i].hasOwnProperty(j)) continue;
var edgeA=edges[i][j];
var edgeB=edges[j][i];
if(edgeB === undef){
log("Mesh.subdivide error. Hole at face #"+edgeA.face+", Edge:["+edgeA.fpa+"->"+edgeA.fpb+"], holes not yet supported; perhaps use Mesh.removeDoubles()?");
return;
}
if(!edgeA.edge_point){
var edge_avg=vec3.multiply(vec3.add(this.points[edgeA.a],this.points[edgeA.b]),0.5);
if(catmull){
var face_avg=vec3.multiply(vec3.add(this.points[face_points[edgeA.face]],this.points[face_points[edgeB.face]]),0.5);
edgeA.edge_point=vec3.multiply(vec3.add(edge_avg,face_avg),0.5);
}else{
edgeA.edge_point=edge_avg;
}
edgeB.edge_point=edgeA.edge_point;
edgeA.edge_avg=edge_avg;
edgeB.edge_avg=edge_avg;
edgeA.ep_idx=this.addPoint(edgeA.edge_point);
edgeB.ep_idx=edgeA.ep_idx;
}
point_edge_list[edgeA.a]=point_edge_list[edgeA.a] || [];
point_edge_list[edgeA.a].push(edgeA.edge_avg);
var edge_uvs=this.faces[edgeA.face].uvs;
if(edge_uvs.length){
var uv_a=edge_uvs[edgeA.fpa];
var uv_b=edge_uvs[edgeA.fpb];
edgeA.uv=[(uv_a[0]+uv_b[0])/2,(uv_a[1]+uv_b[1])/2];
}
var edge_colors=this.faces[edgeA.face].point_colors;
if(edge_colors.length){
var color_a=edge_colors[edgeA.fpa];
var color_b=edge_colors[edgeA.fpb];
edgeA.color=vec3.multiply(vec3.add(color_a,color_b),0.5);
}
var edge_normals=this.faces[edgeA.face].point_normals;
if(edge_normals.length){
var normal_a=edge_normals[edgeA.fpa];
var normal_b=edge_normals[edgeA.fpb];
edgeA.normal=vec3.normalize(vec3.multiply(vec3.add(normal_a,normal_b),0.5));
}
}
}
if(catmull){
var point_face_average=[];
for(i=0, iMax=pointCount; i<iMax; i++){
var pointFaceAvg=[0,0,0];
if(!point_face_list[i]) continue;
for(j=0, jMax=point_face_list[i].length; j<jMax; j++){
var addFacePoint=this.points[face_points[point_face_list[i][j]]];
pointFaceAvg[0]+=addFacePoint[0];
pointFaceAvg[1]+=addFacePoint[1];
pointFaceAvg[2]+=addFacePoint[2];
}
pointFaceAvg[0]/=jMax;
pointFaceAvg[1]/=jMax;
pointFaceAvg[2]/=jMax;
point_face_average[i]=pointFaceAvg;
}
var point_edge_average=[];
for(i=0, iMax=pointCount; i<iMax; i++){
var pointEdgeAvg=[0,0,0];
if(!point_edge_list[i]) continue;
for(j=0, jMax=point_edge_list[i].length; j<jMax; j++){
var addEdgePoint=point_edge_list[i][j];
pointEdgeAvg[0]+=addEdgePoint[0];
pointEdgeAvg[1]+=addEdgePoint[1];
pointEdgeAvg[2]+=addEdgePoint[2];
}
pointEdgeAvg[0]/=jMax;
pointEdgeAvg[1]/=jMax;
pointEdgeAvg[2]/=jMax;
point_edge_average[i]=pointEdgeAvg;
}
for(i=0, iMax=pointCount; i<iMax; i++){
if(!point_face_list[i]) continue;
var n=point_face_list[i].length;
var pt=this.points[i];
var m1=(n-3)/n;
var m2=1.0/n;
var m3=2.0/n;
var newPoint=vec3.multiply(pt,m1);
newPoint=vec3.add(newPoint,vec3.multiply(point_face_average[i],m2));
newPoint=vec3.add(newPoint,vec3.multiply(point_edge_average[i],m3));
this.points[i]=newPoint;
}
}
for(i=0; i<faceCount; i++){
face=this.faces[i];
if(face.points.length !== 3 && face.points.length !== 4) continue;
var opt=face.points.slice(0);
var ouv=face.uvs.slice(0);
var oc=face.point_colors.slice(0);
var on=face.point_normals.slice(0);
var hasUV=ouv.length === opt.length;
var hasColor=oc.length === opt.length;
var hasNormal=on.length === opt.length;
var omat=face.material;
var faceNum,e1,e2;
if(opt.length === 3){
this.setFaceMaterial(omat);
e1=edges[opt[0]][opt[1]];
e2=edges[opt[2]][opt[0]];
this.addFace([opt[0],e1.ep_idx,face_points[i],e2.ep_idx],i);
if(hasUV) this.faces[i].uvs=[ouv[0],e1.uv,face_point_uv[i],e2.uv];
if(hasColor) this.faces[i].point_colors=[oc[0],e1.color,face_point_color[i],e2.color];
if(hasNormal) this.faces[i].point_normals=[on[0],e1.normal,face_point_normal[i],e2.normal];
e1=edges[opt[1]][opt[2]];
e2=edges[opt[0]][opt[1]];
faceNum=this.addFace([opt[1],e1.ep_idx,face_points[i],e2.ep_idx]);
if(hasUV) this.faces[faceNum].uvs=[ouv[1],e1.uv,face_point_uv[i],e2.uv];
if(hasColor) this.faces[faceNum].point_colors=[oc[1],e1.color,face_point_color[i],e2.color];
if(hasNormal) this.faces[faceNum].point_normals=[on[1],e1.normal,face_point_normal[i],e2.normal];
e1=edges[opt[2]][opt[0]];
e2=edges[opt[1]][opt[2]];
faceNum=this.addFace([opt[2],e1.ep_idx,face_points[i],e2.ep_idx]);
if(hasUV) this.faces[faceNum].uvs=[ouv[2],e1.uv,face_point_uv[i],e2.uv];
if(hasColor) this.faces[faceNum].point_colors=[oc[2],e1.color,face_point_color[i],e2.color];
if(hasNormal) this.faces[faceNum].point_normals=[on[2],e1.normal,face_point_normal[i],e2.normal];
}else{
this.setFaceMaterial(omat);
e1=edges[opt[0]][opt[1]];
e2=edges[opt[3]][opt[0]];
this.addFace([opt[0],e1.ep_idx,face_points[i],e2.ep_idx],i);
if(hasUV) this.faces[i].uvs=[ouv[0],e1.uv,face_point_uv[i],e2.uv];
if(hasColor) this.faces[i].point_colors=[oc[0],e1.color,face_point_color[i],e2.color];
if(hasNormal) this.faces[i].point_normals=[on[0],e1.normal,face_point_normal[i],e2.normal];
e1=edges[opt[1]][opt[2]];
e2=edges[opt[0]][opt[1]];
faceNum=this.addFace([opt[1],e1.ep_idx,face_points[i],e2.ep_idx]);
if(hasUV) this.faces[faceNum].uvs=[ouv[1],e1.uv,face_point_uv[i],e2.uv];
if(hasColor) this.faces[faceNum].point_colors=[oc[1],e1.color,face_point_color[i],e2.color];
if(hasNormal) this.faces[faceNum].point_normals=[on[1],e1.normal,face_point_normal[i],e2.normal];
e1=edges[opt[2]][opt[3]];
e2=edges[opt[1]][opt[2]];
faceNum=this.addFace([opt[2],e1.ep_idx,face_points[i],e2.ep_idx]);
if(hasUV) this.faces[faceNum].uvs=[ouv[2],e1.uv,face_point_uv[i],e2.uv];
if(hasColor) this.faces[faceNum].point_colors=[oc[2],e1.color,face_point_color[i],e2.color];
if(hasNormal) this.faces[faceNum].point_normals=[on[2],e1.normal,face_point_normal[i],e2.normal];
e1=edges[opt[3]][opt[0]];
e2=edges[opt[2]][opt[3]];
faceNum=this.addFace([opt[3],e1.ep_idx,face_points[i],e2.ep_idx]);
if(hasUV) this.faces[faceNum].uvs=[ouv[3],e1.uv,face_point_uv[i],e2.uv];
if(hasColor) this.faces[faceNum].point_colors=[oc[3],e1.color,face_point_color[i],e2.color];
if(hasNormal) this.faces[faceNum].point_normals=[on[3],e1.normal,face_point_normal[i],e2.normal];
}
}
level--;
if(level !== 0){
this.subdivide(level,catmull);
return;
}
return this;
},removeInternals:function(){
var vec3=base.vec3;
var i,j,iMax,jMax,k,kMax,face,edge;
var edges={};
var pointCount=this.points.length;
var faceCount=this.faces.length;
var pta,ptb,fpa,fpb;
for(i=0, iMax=this.faces.length; i<iMax; i++){
face=this.faces[i];
for(j=0, jMax=face.points.length; j<jMax; j++){
if(j){
fpa=j;
fpb=j-1;
}else{
fpa=j;
fpb=jMax-1;
}
pta=face.points[fpa];
ptb=face.points[fpb];
edges[pta]=edges[pta] || {};
if(edges[pta][ptb] === undef){
edges[pta][ptb]=[i];
}else{
edges[pta][ptb].push(i);
}
}
}
var edgeFunc=function(i){
return (edges[ptb][pta].indexOf(i) !== -1);
};
for(i=0; i<faceCount; i++){
var edgeCount=0;
face=this.faces[i];
var edgelist=null;
for(j=0, jMax=face.points.length; j<jMax; j++){
if(j){
fpa=j;
fpb=j-1;
}else{
fpa=j;
fpb=jMax-1;
}
pta=face.points[fpa];
ptb=face.points[fpb];
if(!edgelist){
edgelist=edges[ptb][pta];
}else{
edgelist=edgelist.filter(edgeFunc);
}
}
if(edgelist.length){
this.faces.splice(i,1);
faceCount--;
i--;
}
}
return this;
},prepare:function(doClean){
if(doClean === undef){
doClean=true;
}
if(this.buildWireframe && !this.triangulateWireframe){
this.buildEdges();
}
this.triangulateQuads().calcNormals();
if(this.buildWireframe && this.triangulateWireframe){
this.buildEdges();
}
this.compile();
if(doClean && !this.dynamic){
this.clean();
}
return this;
},clean:function(){
var i,iMax;
for(i=0, iMax=this.points.length; i<iMax; i++){
delete (this.points[i]);
this.points[i]=null;
}
this.points=[];
for(i=0, iMax=this.faces.length; i<iMax; i++){
delete (this.faces[i].points);
delete (this.faces[i].point_normals);
delete (this.faces[i].uvs);
delete (this.faces[i].normal);
delete (this.faces[i]);
this.faces[i]=null;
}
this.faces=[];
return this;
},compileMap:function(tolerance){
var vec3=base.vec3;
var vec2=base.vec2;
if(tolerance === undef) tolerance=0.00001;
var compileMap={
segments:[],bounds:[]
};
var compileRef=[];
var i,j,k,x,y,iMax,kMax,yMax,matId,segId;
if(!this.materials.length) this.materials.push(new base.Material());
for(i=0, iMax=this.materials.length; i<iMax; i++){
compileRef[i]=[];
}
for(i=0, iMax=this.faces.length; i<iMax; i++){
if(this.faces[i].points.length === 3){
matId=this.faces[i].material;
segId=this.faces[i].segment;
if(compileRef[matId][segId] === undef){
compileRef[matId][segId]=[];
compileMap.segments.push(segId);
}
compileRef[matId][segId].push(i);
}
}
var vtxRef=[];
var idxCount=0;
var hasUV=false;
var hasNorm=false;
var hasColor=false;
var faceNum;
for(i=0, iMax=compileRef.length; i<iMax; i++){
for(j in compileRef[i]){
if(compileRef[i].hasOwnProperty(j)){
for(k=0; k<compileRef[i][j].length; k++){
faceNum=compileRef[i][j][k];
hasUV=hasUV || (this.faces[faceNum].uvs.length !== 0);
hasNorm=hasNorm || (this.faces[faceNum].point_normals.length !== 0);
hasColor=hasColor || (this.faces[faceNum].point_colors.length !== 0);
}
}
}
}
if(hasUV){
for(i=0; i<this.faces.length; i++){
if(!this.faces[i].uvs.length){
for(j=0; j<this.faces[i].points.length; j++){
this.faces[i].uvs.push([0,0]);
}
}
}
}
if(hasNorm){
for(i=0; i<this.faces.length; i++){
if(!this.faces[i].point_normals.length){
for(j=0; j<this.faces[i].points.length; j++){
this.faces[i].point_normals.push([0,0,0]);
}
}
}
}
if(hasColor){
for(i=0; i<this.faces.length; i++){
if(!this.faces[i].point_colors.length){
for(j=0; j<this.faces[i].points.length; j++){
this.faces[i].point_colors.push([0,0,0]);
}
}
}
}
var pVisitor=[];
for(i=0, iMax=compileRef.length; i<iMax; i++){
for(j in compileRef[i]){
if(compileRef[i].hasOwnProperty(j)){
for(k=0, kMax=compileRef[i][j].length; k<kMax; k++){
faceNum=compileRef[i][j][k];
var found=false;
for(x=0; x<3; x++){
var ptNum=this.faces[faceNum].points[x];
var foundPt=-1;
if(vtxRef[ptNum] !== undef){
for(y=0, yMax=vtxRef[ptNum].length; y<yMax; y++){
var oFace=vtxRef[ptNum][y][0]; // faceNum
var oPoint=vtxRef[ptNum][y][1]; // pointNum
var oIndex=vtxRef[ptNum][y][2]; // index
foundPt=oIndex;
if(hasNorm){
foundPt=(vec3.equal(this.faces[oFace].point_normals[oPoint],this.faces[faceNum].point_normals[x],tolerance))?foundPt:-1;
}
if(hasUV){
foundPt=(vec2.equal(this.faces[oFace].uvs[oPoint],this.faces[faceNum].uvs[x],tolerance))?foundPt:-1;
}
if(hasColor){
foundPt=(vec3.equal(this.faces[oFace].point_colors[oPoint],this.faces[faceNum].point_colors[x],tolerance))?foundPt:-1;
}
}
}
if(foundPt !== -1){
if(compileMap.elements === undef){
compileMap.elements=[];
}
if(compileMap.elements[i] === undef){
compileMap.elements[i]=[];
}
if(compileMap.elements[i][j] === undef){
compileMap.elements[i][j]=[];
}
compileMap.elements[i][j].push(foundPt);
}else{
if(compileMap.points === undef){
compileMap.points=[];
}
compileMap.points.push(ptNum);
if(compileMap.bounds.length === 0){
compileMap.bounds[0]=[this.points[ptNum][0],this.points[ptNum][1],this.points[ptNum][2]];
compileMap.bounds[1]=[this.points[ptNum][0],this.points[ptNum][1],this.points[ptNum][2]];
}else{
if(this.points[ptNum][0]<compileMap.bounds[0][0]){
compileMap.bounds[0][0]=this.points[ptNum][0];
}
if(this.points[ptNum][1]<compileMap.bounds[0][1]){
compileMap.bounds[0][1]=this.points[ptNum][1];
}
if(this.points[ptNum][2]<compileMap.bounds[0][2]){
compileMap.bounds[0][2]=this.points[ptNum][2];
}
if(this.points[ptNum][0]>compileMap.bounds[1][0]){
compileMap.bounds[1][0]=this.points[ptNum][0];
}
if(this.points[ptNum][1]>compileMap.bounds[1][1]){
compileMap.bounds[1][1]=this.points[ptNum][1];
}
if(this.points[ptNum][2]>compileMap.bounds[1][2]){
compileMap.bounds[1][2]=this.points[ptNum][2];
}
}
if(hasNorm){
if(compileMap.normals === undef){
compileMap.normals=[];
}
compileMap.normals.push([faceNum,x]);
}
if(hasColor){
if(compileMap.colors === undef){
compileMap.colors=[];
}
compileMap.colors.push([faceNum,x]);
}
if(hasUV){
if(compileMap.uvs === undef){
compileMap.uvs=[];
}
compileMap.uvs.push([faceNum,x]);
}
if(compileMap.elements === undef){
compileMap.elements=[];
}
if(compileMap.elements[i] === undef){
compileMap.elements[i]=[];
}
if(compileMap.elements[i][j] === undef){
compileMap.elements[i][j]=[];
}
compileMap.elements[i][j].push(idxCount);
if(vtxRef[ptNum] === undef){
vtxRef[ptNum]=[];
}
vtxRef[ptNum].push([faceNum,x,idxCount]);
idxCount++;
}
}
}
}
}
}
if(this.edges){
compileMap.line_elements=[];
for(i=0, iMax=this.edges.length; i<iMax; i++){
var edge=this.edges[i];
matId=edge[0];
segId=edge[1];
var ptA=edge[2];
var ptB=edge[3];
compileMap.line_elements[matId]=compileMap.line_elements[matId] || [];
compileMap.line_elements[matId][segId]=compileMap.line_elements[matId][segId] || [];
compileMap.line_elements[matId][segId].push(vtxRef[ptA][0][2]);
compileMap.line_elements[matId][segId].push(vtxRef[ptB][0][2]);
}
}
compileMap.dynamic=this.dynamic;
return compileMap;
},compileVBO:function(compileMap,doElements,doVertex,doNormal,doUV,doColor,doLines,doDynamic){
if(typeof (doElements) == 'object'){
doElements=(doElements.element !== undef)?doElements.element:true;
doVertex=(doElements.vertex !== undef)?doElements.vertex:true;
doColor=(doElements.color !== undef)?doElements.color:true;
doNormal=(doElements.normal !== undef)?doElements.normal:true;
doUV=(doElements.uv !== undef)?doElements.uv:true;
doLines=(doElements.lines !== undef)?doElements.lines:(!!compileMap.line_elements);
doDynamic=(doElements.dynamic !== undef)?doElements.dynamic:compileMap.dynamic;
}else{
if(doElements === undef) doElements=true;
if(doVertex === undef) doVertex=true;
if(doColor === undef) doColor=true;
if(doNormal === undef) doNormal=true;
if(doUV === undef) doUV=true;
if(doLines === undef) doLines=(!!compileMap.line_elements);
if(doDynamic === undef) doDynamic=compileMap.dynamic;
}
var compiled={},numPoints,ofs,ptIdx,i,j,jctr,iMax,k,kMax,emap,dynamicMap,step,sourceIndex;
if(doDynamic){
dynamicMap={
points:new Int16Array(compileMap.points.length),face_points:new Int16Array(compileMap.points.length*2),segments:null
};
compiled.dynamicMap=dynamicMap;
compiled.dynamic=true;
}
if(compileMap.points && doVertex){
numPoints=compileMap.points.length;
compiled.vbo_points=new Float32Array(numPoints*3);
for(i=0, iMax=numPoints; i<iMax; i++){
ptIdx=compileMap.points[i];
compiled.vbo_points[i*3]=this.points[ptIdx][0];
compiled.vbo_points[i*3+1]=this.points[ptIdx][1];
compiled.vbo_points[i*3+2]=this.points[ptIdx][2];
if(doDynamic){
dynamicMap.points[i]=ptIdx;
}
}
}
if(doDynamic){
sourceIndex=compileMap.normals || compileMap.colors || compileMap.uvs;
for(i=0, iMax=sourceIndex.length; i<iMax; i++){
ptIdx=sourceIndex[i];
dynamicMap.face_points[i*2]=ptIdx[0];
dynamicMap.face_points[i*2+1]=ptIdx[1];
}
}
if(compileMap.normals && doNormal){
numPoints=compileMap.normals.length;
compiled.vbo_normals=new Float32Array(numPoints*3);
ofs=0;
for(i=0, iMax=numPoints; i<iMax; i++){
ptIdx=compileMap.normals[i];
compiled.vbo_normals[ofs++]=this.faces[ptIdx[0]].point_normals[ptIdx[1]][0];
compiled.vbo_normals[ofs++]=this.faces[ptIdx[0]].point_normals[ptIdx[1]][1];
compiled.vbo_normals[ofs++]=this.faces[ptIdx[0]].point_normals[ptIdx[1]][2];
}
}
if(compileMap.colors && doColor){
numPoints=compileMap.colors.length;
compiled.vbo_colors=new Float32Array(numPoints*3);
ofs=0;
for(i=0, iMax=numPoints; i<iMax; i++){
ptIdx=compileMap.colors[i];
compiled.vbo_colors[ofs++]=this.faces[ptIdx[0]].point_colors[ptIdx[1]][0];
compiled.vbo_colors[ofs++]=this.faces[ptIdx[0]].point_colors[ptIdx[1]][1];
compiled.vbo_colors[ofs++]=this.faces[ptIdx[0]].point_colors[ptIdx[1]][2];
}
}
if(compileMap.uvs && doUV){
numPoints=compileMap.uvs.length;
compiled.vbo_uvs=new Float32Array(numPoints*2);
ofs=0;
for(i=0, iMax=numPoints; i<iMax; i++){
ptIdx=compileMap.uvs[i];
compiled.vbo_uvs[ofs++]=this.faces[ptIdx[0]].uvs[ptIdx[1]][0];
compiled.vbo_uvs[ofs++]=this.faces[ptIdx[0]].uvs[ptIdx[1]][1];
}
}
if(doElements){
compiled.elements_ref=[];
compiled.vbo_elements=[];
for(i=0, iMax=compileMap.elements.length; i<iMax; i++){
compiled.elements_ref[i]=[];
jctr=0;
for(j in compileMap.elements[i]){
if(compileMap.elements[i].hasOwnProperty(j)){
emap=compileMap.elements[i][j];
for(k=0, kMax=emap.length; k<kMax; k++){
compiled.vbo_elements.push(emap[k]);
}
compiled.elements_ref[i][jctr]=[j | 0,emap.length | 0];
jctr++;
}
}
}
compiled.vbo_elements=new Uint16Array(compiled.vbo_elements);
}
if(doLines){
compiled.line_elements_ref=[];
compiled.vbo_line_elements=[];
for(i=0, iMax=compileMap.line_elements.length; i<iMax; i++){
compiled.line_elements_ref[i]=[];
jctr=0;
for(j in compileMap.line_elements[i]){
if(compileMap.line_elements[i].hasOwnProperty(j)){
emap=compileMap.line_elements[i][j];
for(k=0, kMax=emap.length; k<kMax; k++){
compiled.vbo_line_elements.push(emap[k]);
}
compiled.line_elements_ref[i][jctr]=[j | 0,emap.length | 0];
jctr++;
}
}
}
compiled.vbo_line_elements=new Uint16Array(compiled.vbo_line_elements);
}
compiled.segments=compileMap.segments;
compiled.bounds=compileMap.bounds;
if(doDynamic && compileMap.segments.length>1){
var segmentMap=[];
var segId;
sourceIndex=dynamicMap.points;
for(i=0, iMax=sourceIndex.length; i<iMax; i++){
ptIdx=sourceIndex[i];
var f=dynamicMap.face_points[i*2];
segId=this.faces[f].segment || 0;
if(segmentMap[segId] === undef){
segmentMap[segId]=[];
}
segmentMap[segId].push(i);
}
compiled.dynamicMap.segmentMap=segmentMap;
}
return compiled;
},updateVBO:function(VBO,options){
if(!VBO.dynamic) return false;
var i,iMax;
var dm=VBO.dynamicMap;
var doPoint=options.points && !!VBO.vbo_points;
var doNormal=options.normals && !!VBO.vbo_normals;
var doUV=options.uvs && !!VBO.vbo_uvs;
var doColor=options.colors && !!VBO.vbo_colors;
var hasSegments=(options.segments !== undef)?true:false;
var segments=options.segments;
var pt,face,fp;
if(hasSegments){
for(var seg=0,segMax=segments.length; seg<segMax; seg++){
var dmSeg=dm.segmentMap[segments[seg]];
for(var idx=0,idxMax=dmSeg.length; idx<idxMax; idx++){
i=dmSeg[idx];
face=this.faces[dm.face_points[i*2]];
fp=dm.face_points[i*2+1];
if(doPoint){
pt=this.points[dm.points[i]];
VBO.vbo_points[i*3]=pt[0];
VBO.vbo_points[i*3+1]=pt[1];
VBO.vbo_points[i*3+2]=pt[2];
}
if(doNormal){
pt=face.point_normals[fp];
VBO.vbo_normals[i*3]=pt[0];
VBO.vbo_normals[i*3+1]=pt[1];
VBO.vbo_normals[i*3+2]=pt[2];
}
if(doColor){
pt=face.point_colors[fp];
VBO.vbo_colors[i*3]=pt[0];
VBO.vbo_colors[i*3+1]=pt[1];
VBO.vbo_colors[i*3+2]=pt[2];
}
if(doUV){
pt=face.uvs[fp];
VBO.vbo_uvs[i*2]=pt[0];
VBO.vbo_uvs[i*2+1]=pt[1];
}
}
}
}else{
for(i=0, iMax=dm.points.length; i<iMax; i++){
face=this.faces[dm.face_points[i*2]];
fp=dm.face_points[i*2+1];
if(doPoint){
pt=this.points[dm.points[i]];
VBO.vbo_points[i*3]=pt[0];
VBO.vbo_points[i*3+1]=pt[1];
VBO.vbo_points[i*3+2]=pt[2];
}
if(doNormal){
pt=face.point_normals[fp];
VBO.vbo_normals[i*3]=pt[0];
VBO.vbo_normals[i*3+1]=pt[1];
VBO.vbo_normals[i*3+2]=pt[2];
}
if(doColor){
pt=face.point_colors[fp];
VBO.vbo_colors[i*3]=pt[0];
VBO.vbo_colors[i*3+1]=pt[1];
VBO.vbo_colors[i*3+2]=pt[2];
}
if(doUV){
pt=face.uvs[fp];
VBO.vbo_uvs[i*2]=pt[0];
VBO.vbo_uvs[i*2+1]=pt[1];
}
}
}
return this;
},rebufferVBO:function(VBO,buffer,opt){
var gl=GLCore.gl;
var hasSegments=(opt.segments !== undef)?true:false;
var segments=opt.segments;
if(opt.points){
gl.bindBuffer(gl.ARRAY_BUFFER,buffer.gl_points);
gl.bufferData(gl.ARRAY_BUFFER,VBO.vbo_points,gl.DYNAMIC_DRAW);
}
if(opt.normals && VBO.vbo_normals){
gl.bindBuffer(gl.ARRAY_BUFFER,buffer.gl_normals);
gl.bufferData(gl.ARRAY_BUFFER,VBO.vbo_normals,gl.DYNAMIC_DRAW);
}
if(opt.uvs && VBO.vbo_uvs){
gl.bindBuffer(gl.ARRAY_BUFFER,buffer.gl_uvs);
gl.bufferData(gl.ARRAY_BUFFER,VBO.vbo_uvs,gl.DYNAMIC_DRAW);
}
if(opt.colors && VBO.vbo_colors){
gl.bindBuffer(gl.ARRAY_BUFFER,buffer.gl_colors);
gl.bufferData(gl.ARRAY_BUFFER,VBO.vbo_colors,gl.DYNAMIC_DRAW);
}
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,null);
return this;
},bufferVBO:function(VBO,baseBuffer){
var gl=GLCore.gl;
var buffer={};
if(baseBuffer === undef) baseBuffer={};
buffer.gl_points=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,buffer.gl_points);
gl.bufferData(gl.ARRAY_BUFFER,VBO.vbo_points,gl.STATIC_DRAW);
if(VBO.vbo_normals){
buffer.gl_normals=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,buffer.gl_normals);
gl.bufferData(gl.ARRAY_BUFFER,VBO.vbo_normals,gl.STATIC_DRAW);
}else{
buffer.gl_normals=baseBuffer.gl_normals?baseBuffer.gl_normals:null;
}
if(VBO.vbo_uvs){
buffer.gl_uvs=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,buffer.gl_uvs);
gl.bufferData(gl.ARRAY_BUFFER,VBO.vbo_uvs,gl.STATIC_DRAW);
}else{
buffer.gl_uvs=baseBuffer.gl_uvs?baseBuffer.gl_uvs:null;
}
if(VBO.vbo_colors){
buffer.gl_colors=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,buffer.gl_colors);
gl.bufferData(gl.ARRAY_BUFFER,VBO.vbo_colors,gl.STATIC_DRAW);
}else{
buffer.gl_colors=baseBuffer.gl_colors?baseBuffer.gl_colors:null;
}
if(!VBO.vbo_elements && baseBuffer.gl_elements){
buffer.gl_elements=baseBuffer.gl_elements;
buffer.elements_ref=baseBuffer.elements_ref;
}else{
buffer.gl_elements=gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffer.gl_elements);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,VBO.vbo_elements,gl.STATIC_DRAW);
buffer.elements_ref=VBO.elements_ref;
}
if(!VBO.vbo_line_elements && baseBuffer.gl_line_elements){
buffer.gl_line_elements=baseBuffer.gl_line_elements;
buffer.line_elements_ref=baseBuffer.line_elements_ref;
}else{
buffer.gl_line_elements=gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffer.gl_line_elements);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,VBO.vbo_line_elements,gl.STATIC_DRAW);
buffer.line_elements_ref=VBO.line_elements_ref;
}
buffer.segments=VBO.segments;
buffer.bounds=VBO.bounds;
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,null);
return buffer;
},update:function(opt){
opt=opt || {};
var doPoint=opt.points || opt.point || opt.vertex || opt.vertices || opt.all || true;
var doUV=opt.uvs || opt.uv || opt.texture || opt.all || false;
var doNormal=opt.normals || opt.normal || opt.all || true;
var doColor=opt.colors || opt.color || opt.all || false;
var segments=opt.segments || opt.segment;
if(segments !== undef && segments.length === undef){
segments=[segments];
}
if(!this.dynamic){
log("Mesh not defined as dynamic, cannot update.");
return false;
}
if(doNormal && this.normalMapRef){
this.recalcNormals(undef,{segments:segments});
}
var options={points:doPoint,uvs:doUV,normals:doNormal,colors:doColor,segments:segments};
this.updateVBO(this.dynamicData.VBO,options);
this.rebufferVBO(this.dynamicData.VBO,this.dynamicData.buffer,options);
},bindBuffer:function(vbo_buffer){
if(this.originBuffer === null){
this.originBuffer=vbo_buffer;
}
this.compiled=vbo_buffer;
this.segment_state=[];
for(var i=0,iMax=vbo_buffer.segments.length; i<iMax; i++){
this.segment_state[vbo_buffer.segments[i]]=true;
}
this.bb=vbo_buffer.bounds;
},compile:function(tolerance){
if(this.faces.length>0 && this.points.length>0){
var VBO=this.compileVBO(this.compileMap(tolerance));
var buffer=this.bufferVBO(VBO);
this.bindBuffer(buffer);
if(this.dynamic){
this.sourcePoints=[];
for(var i=0,iMax=this.points.length; i<iMax; i++){
this.sourcePoints[i]=this.points[i].slice(0);
}
this.dynamicData={
VBO:VBO,buffer:buffer
};
}
}
return this;
},addMorphTarget:function(targetBuffer){
if(this.morphTargets === null){
this.morphTargets=[];
}
this.morphTargets.push(targetBuffer);
},setMorphSource:function(idx){
if(this.morphSourceIndex === idx) return;
this.morphSourceIndex=idx;
this.bindBuffer(this.morphTargets[idx]);
},setMorphTarget:function(idx){
if(this.morphTargetIndex === idx) return;
this.morphTargetIndex=idx;
this.morphTarget=this.morphTargets[idx];
},setMorphWeight:function(weight){
this.morphWeight=weight;
},morphTargetCount:function(){
return (this.morphTargets !== null)?this.morphTargets.length:0;
}
};
var exports={
Mesh:Mesh,Face:Face
};
return exports;
});
CubicVR.RegisterModule("UVMapper",function(base){
var undef=base.undef;
var GLCore=base.GLCore;
var enums=base.enums;
var util=base.util;
var M_TWO_PI=2.0*Math.PI;
var M_HALF_PI=Math.PI/2.0;
enums.uv={
axis:{
X:0,Y:1,Z:2
},projection:{
UV:0,PLANAR:1,CYLINDRICAL:2,SPHERICAL:3,CUBIC:4,SKY:5
}
};
var xyz_to_h=function(x,y,z){
var h;
if(x === 0 && z === 0){
h=0;
}else{
if(z === 0){
h=(x<0)?M_HALF_PI:-M_HALF_PI;
}else if(z<0){
h=-Math.atan(x/z)+Math.PI;
}else{
h= -Math.atan(x/z);
}
}
return h;
};
var xyz_to_hp=function(x,y,z){
var h,p;
if(x === 0 && z === 0){
h=0;
if(y !== 0){
p=(y<0)?-M_HALF_PI:M_HALF_PI;
}else{
p=0;
}
}else{
if(z === 0){
h=(x<0)?M_HALF_PI:-M_HALF_PI;
}else if(z<0){
h=-Math.atan(x/z)+Math.PI;
}else{
h= -Math.atan(x/z);
}
x=Math.sqrt(x*x+z*z);
if(x === 0){
p=(y<0)?-M_HALF_PI:M_HALF_PI;
}else{
p=Math.atan(y/x);
}
}
return [h,p];
};
function UVMapper(obj_in){
obj_in=base.get(obj_in) || {};
this.rotation=(obj_in.rotation === undef)?[0,0,0]:obj_in.rotation;
this.scale=(obj_in.scale === undef)?[1,1,1]:obj_in.scale;
this.center=(obj_in.center === undef)?[0,0,0]:obj_in.center;
this.projection_mode=(obj_in.projectionMode === undef)?enums.uv.projection.PLANAR:base.parseEnum(enums.uv.projection,obj_in.projectionMode);
this.projection_axis=(obj_in.projectionAxis === undef)?enums.uv.axis.X:base.parseEnum(enums.uv.axis,obj_in.projectionAxis);
this.wrap_w_count=(obj_in.wrapW === undef)?1:obj_in.wrapW;
this.wrap_h_count=(obj_in.wrapH === undef)?1:obj_in.wrapH;
}
UVMapper.prototype={
setRotation:function(rotation){
this.rotation=rotation;
},setScale:function(scale){
this.scale=scale;
},setCenter:function(center){
this.center=center;
},setProjectionAxis:function(projection_axis){
this.projection_axis=projection_axis;
},setProjectionMode:function(projection_mode){
this.projection_mode=projection_mode;
},setWrapW:function(wrap_w){
this.wrap_w_count=wrap_w;
},setWrapH:function(wrap_h){
this.wrap_h_count=wrap_h;
},apply:function(obj,mat_num,seg_num,start_face,end_face){
var mat4=base.mat4;
var u,v,s,t,lat,lon;
var trans=new base.Transform();
var transformed=false;
var t_result=null;
if(this.center[0] || this.center[1] || this.center[2]){
trans.translate(-this.center[0],-this.center[1],-this.center[2]);
transformed=true;
}
if(this.rotation[0] || this.rotation[1] || this.rotation[2]){
if(this.rotation[0]){
trans.rotate(this.rotation[2],0,0,1);
}
if(this.rotation[1]){
trans.rotate(this.rotation[1],0,1,0);
}
if(this.rotation[2]){
trans.rotate(this.rotation[0],1,0,0);
}
transformed=true;
}
if(transformed){
t_result=trans.getResult();
}
if(typeof (mat_num) === 'object'){
mat_num=obj.materials.indexOf(mat_num);
}
var i=0,iMax=obj.faces.length;
if(start_face){
i=start_face;
}
if(end_face){
iMax=end_face+1;
}
for(; i<iMax; i++){
if(obj.faces[i].material !== mat_num){
continue;
}
if(seg_num !== undef){
if(obj.faces[i].segment !== seg_num){
continue;
}
}
var nx,ny,nz;
if(this.projection_mode === enums.uv.projection.CUBIC || this.projection_mode === enums.uv.projection.SKY){
nx=Math.abs(obj.faces[i].normal[0]);
ny=Math.abs(obj.faces[i].normal[1]);
nz=Math.abs(obj.faces[i].normal[2]);
}
var latlon_cache=[];
for(var j=0,jMax=obj.faces[i].points.length; j<jMax; j++){
var pta=obj.faces[i].points[j],ptb=obj.faces[i].points[(j+1)%3],ptc=obj.faces[i].points[(j+2)%3],uvpoint=obj.points[pta],uvpointb=obj.points[ptb],uvpointc=obj.points[ptc],p_axis;
if(transformed){
uvpoint=mat4.vec3_multiply(uvpoint,t_result);
}
var p_mode=this.projection_mode;
if(p_mode === enums.uv.projection.SKY){
var mapping=obj.sky_mapping;
if(nx>=ny && nx>=nz){
s=uvpoint[2]/(this.scale[2])+this.scale[2]/2;
t=-uvpoint[1]/(this.scale[1])+this.scale[1]/2;
if(obj.faces[i].normal[0]<0){
s=(mapping[2][2]-mapping[2][0])*(1-s);
t=1-((mapping[2][3]-mapping[2][1])*(t));
s+=mapping[2][0];
t+=mapping[2][1];
}else{
s=(mapping[3][2]-mapping[3][0])*(s);
t=1-((mapping[3][3]-mapping[3][1])*(t));
s+=mapping[3][0];
t+=mapping[3][1];
} //if
} //if
if(ny>=nx && ny>=nz){
s=uvpoint[0]/(this.scale[0])+this.scale[0]/2;
t=-uvpoint[2]/(this.scale[2])+this.scale[2]/2;
if(obj.faces[i].normal[1]<0){
s=((mapping[1][2]-mapping[1][0])*(s));
t=1-((mapping[1][3]-mapping[1][1])*(t));
s+=mapping[1][0];
t-=mapping[1][1];
}else{
s=((mapping[0][2]-mapping[0][0])*(s));
t=1-((mapping[0][3]-mapping[0][1])*(t));
s+=mapping[0][0];
t-=mapping[0][1];
} //if
} //if
if(nz>=nx && nz>=ny){
s=uvpoint[0]/(this.scale[0])+this.scale[0]/2;
t=uvpoint[1]/(this.scale[1])+this.scale[1]/2;
if(obj.faces[i].normal[2]<0){
s=((mapping[4][2]-mapping[4][0])*(s));
t=1-((mapping[4][3]-mapping[4][1])*(1-t));
s+=mapping[4][0];
t-=mapping[4][1];
}else{
s=((mapping[5][2]-mapping[5][0])*(1-s));
t=1-((mapping[5][3]-mapping[5][1])*(1-t));
s+=mapping[5][0];
t+=mapping[5][1];
} //if
} //if
obj.faces[i].setUV([s,t],j);
}else if(p_mode === enums.uv.projection.CUBIC){
if(nx>=ny && nx>=nz){
s=uvpoint[2]/this.scale[2]+0.5;
t=uvpoint[1]/this.scale[1]+0.5;
}
if(ny>=nx && ny>=nz){
s=-uvpoint[0]/this.scale[0]+0.5;
t=uvpoint[2]/this.scale[2]+0.5;
}
if(nz>=nx && nz>=ny){
s=-uvpoint[0]/this.scale[0]+0.5;
t=uvpoint[1]/this.scale[1]+0.5;
}
if(obj.faces[i].normal[0]>0){
s= -s;
}
if(obj.faces[i].normal[1]<0){
s= -s;
}
if(obj.faces[i].normal[2]>0){
s= -s;
}
obj.faces[i].setUV([s,t],j);
}else if(p_mode === enums.uv.projection.PLANAR){
s=((this.projection_axis === enums.uv.axis.X)?uvpoint[2]/this.scale[2]+0.5:-uvpoint[0]/this.scale[0]+0.5);
t=((this.projection_axis === enums.uv.axis.Y)?uvpoint[2]/this.scale[2]+0.5:uvpoint[1]/this.scale[1]+0.5);
obj.faces[i].setUV([s,t],j);
}else if(p_mode === enums.uv.projection.CYLINDRICAL){
p_axis=this.projection_axis;
if(p_axis === enums.uv.axis.X){
lon=xyz_to_h(uvpoint[2],uvpoint[0],-uvpoint[1]);
t=-uvpoint[0]/this.scale[0]+0.5;
}else if(p_axis === enums.uv.axis.Y){
lon=xyz_to_h(-uvpoint[0],uvpoint[1],uvpoint[2]);
t=-uvpoint[1]/this.scale[1]+0.5;
}else if(p_axis === enums.uv.axis.Z){
lon=xyz_to_h(-uvpoint[0],uvpoint[2],-uvpoint[1]);
t=-uvpoint[2]/this.scale[2]+0.5;
} //if
lon=1.0-lon/(M_TWO_PI);
if(this.wrap_w_count !== 1.0){
lon=lon*this.wrap_w_count;
}
u=lon;
v=t;
obj.faces[i].setUV([u,v],j);
}else if(p_mode === enums.uv.projection.SPHERICAL){
var latlon,latlonb,latlonc;
p_axis=this.projection_axis;
if(p_axis === enums.uv.axis.X){
if(latlon_cache[pta]) latlon=latlon_cache[pta]; else latlon=xyz_to_hp(uvpoint[2],uvpoint[0],-uvpoint[1]);
if(!latlon_cache[pta]) latlon_cache[pta]=latlon;
if(latlon_cache[ptb]) latlonb=latlon_cache[ptb]; else latlonb=xyz_to_hp(uvpointb[2],uvpointb[0],-uvpointb[1]);
if(!latlon_cache[ptb]) latlon_cache[ptb]=latlonb;
if(latlon_cache[ptc]) latlonc=latlon_cache[ptc]; else latlonc=xyz_to_hp(uvpointc[2],uvpointc[0],-uvpointc[1]);
if(!latlon_cache[ptc]) latlon_cache[ptc]=latlonc;
}else if(p_axis === enums.uv.axis.Y){
if(latlon_cache[pta]) latlon=latlon_cache[pta]; else latlon=xyz_to_hp(uvpoint[0],-uvpoint[1],uvpoint[2]);
if(!latlon_cache[pta]) latlon_cache[pta]=latlon;
if(latlon_cache[ptb]) latlonb=latlon_cache[ptb]; else latlonb=xyz_to_hp(uvpointb[0],-uvpointb[1],uvpointb[2]);
if(!latlon_cache[ptb]) latlon_cache[ptb]=latlonb;
if(latlon_cache[ptc]) latlonc=latlon_cache[ptc]; else latlonc=xyz_to_hp(uvpointc[0],-uvpointc[1],uvpointc[2]);
if(!latlon_cache[ptc]) latlon_cache[ptc]=latlonc;
}else if(p_axis === enums.uv.axis.Z){
if(latlon_cache[pta]) latlon=latlon_cache[pta]; else latlon=xyz_to_hp(-uvpoint[0],uvpoint[2],-uvpoint[1]);
if(!latlon_cache[pta]) latlon_cache[pta]=latlon;
if(latlon_cache[ptb]) latlonb=latlon_cache[ptb]; else latlonb=xyz_to_hp(-uvpointb[0],uvpointb[2],-uvpointb[1]);
if(!latlon_cache[ptb]) latlon_cache[ptb]=latlonb;
if(latlon_cache[ptc]) latlonc=latlon_cache[ptc]; else latlonc=xyz_to_hp(-uvpointc[0],uvpointc[2],-uvpointc[1]);
if(!latlon_cache[ptc]) latlon_cache[ptc]=latlonc;
} //if
if(Math.abs(latlon[0]-latlonb[0])>M_HALF_PI && Math.abs(latlon[0]-latlonc[0])>M_HALF_PI){
if(latlon[0]>latlonb[0] && latlon[0]>latlonc[0]){
latlon[0]-=M_TWO_PI;
}else{
latlon[0]+=M_TWO_PI;
}
}
if(Math.abs(latlon[1]-latlonb[1])>M_HALF_PI && Math.abs(latlon[1]-latlonc[1])>M_HALF_PI){
if(latlon[1]>latlonb[1] && latlon[1]>latlonc[1]){
latlon[1]-=M_TWO_PI;
}else{
latlon[1]+=M_TWO_PI;
}
}
lon=1.0-latlon[0]/M_TWO_PI;
lat=0.5-latlon[1]/Math.PI;
if(this.wrap_w_count !== 1.0){
lon=lon*this.wrap_w_count;
}
if(this.wrap_h_count !== 1.0){
lat=lat*this.wrap_h_count;
}
u=lon;
v=lat;
obj.faces[i].setUV([u,v],j);
}else{
//default:
u=0;
v=0;
obj.faces[i].setUV([u,v],j);
} //if
} //for
} //for - faces
return this;
}
};
var extend={
UVMapper:UVMapper
};
return extend;
});
CubicVR.RegisterModule("Renderer",function(base){
var undef=base.undef;
var enums=base.enums;
var GLCore=base.GLCore;
function cubicvr_renderObject(obj_in,camera,o_matrix,lighting,skip_trans,skip_solid,force_wire){
var has_transparency=false;
skip_trans=skip_trans || false;
skip_solid=skip_solid || false;
if(obj_in.compiled === null){
return;
}
var ofs=0;
var gl=base.GLCore.gl;
var nLights,numLights=(lighting === undef)?0:lighting.length;
var mshader,last_ltype,l;
var lcount=0;
var j;
var mat=null;
var materials=obj_in.instanceMaterials || obj_in.materials;
var lines=(obj_in.wireframe || force_wire) && obj_in.compiled.line_elements_ref;
var elements_ref=lines?obj_in.compiled.line_elements_ref:obj_in.compiled.elements_ref;
var bound=false,subcount,blended,lt;
gl.depthFunc(gl.LEQUAL);
if(o_matrix === undef){ o_matrix=cubicvr_identity; }
for(var ic=0,icLen=elements_ref.length; ic<icLen; ic++){
if(lines && obj_in.wireframeMaterial){
mat=obj_in.wireframeMaterial;
}else{
mat=materials[ic];
}
var len=0;
var drawn=false;
if(mat.opacity<1.0 && skip_trans){
has_transparency=true;
continue;
}else if(skip_solid && mat.opacity>=1.0){
continue;
}
if(mat.opacity !== 1.0){
gl.enable(gl.BLEND);
gl.depthMask(0);
gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
}else{
gl.depthMask(1);
gl.disable(gl.BLEND);
gl.blendFunc(gl.ONE,gl.ONE);
}
for(var jc=0,jcLen=elements_ref[ic].length; jc<jcLen; jc++){
j=elements_ref[ic][jc][0];
drawn=false;
var this_len=elements_ref[ic][jc][1];
len+=this_len;
if(!mat.visible){
ofs+=this_len*2;
len-=this_len;
continue;
}
if(obj_in.segment_state[j]){
}else if(len>this_len){
ofs+=this_len*2;
len-=this_len;
if(!numLights){
mat.use(0,0);
gl.uniformMatrix4fv(mat.shader[0][0].matrixModelView,false,camera.mvMatrix);
gl.uniformMatrix4fv(mat.shader[0][0].matrixProjection,false,camera.pMatrix);
gl.uniformMatrix4fv(mat.shader[0][0].matrixObject,false,o_matrix);
gl.uniformMatrix3fv(mat.shader[0][0].matrixNormal,false,camera.nMatrix);
if(!bound){
mat.bindObject(obj_in,mat.shader[0][0]);
bound=(mat.shader[0][0].vertexTexCoord != -1);
if(lines){
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,obj_in.compiled.gl_line_elements);
}
}
if(lines){
gl.drawElements(gl.LINES,len,gl.UNSIGNED_SHORT,ofs);
}else{
gl.drawElements(gl.TRIANGLES,len,gl.UNSIGNED_SHORT,ofs);
}
}else{
subcount=0;
blended=false;
for(subcount=0; subcount<numLights;){
nLights=numLights-subcount;
if(nLights>base.MAX_LIGHTS){
nLights=base.MAX_LIGHTS;
}
if(subcount>0 && !blended){
gl.enable(gl.BLEND);
gl.blendFunc(gl.ONE,gl.ONE);
gl.depthFunc(gl.EQUAL);
blended=true;
}
mshader=undef;
l=lighting[subcount];
lt=l.light_type;
for(lcount=0; lcount<nLights; lcount++){
if(lighting[lcount+subcount].light_type != lt){
nLights=lcount;
break;
}
}
mat.use(l.light_type,nLights);
mshader=mat.shader[l.light_type][nLights];
gl.uniformMatrix4fv(mshader.matrixModelView,false,camera.mvMatrix);
gl.uniformMatrix4fv(mshader.matrixProjection,false,camera.pMatrix);
gl.uniformMatrix4fv(mshader.matrixObject,false,o_matrix);
gl.uniformMatrix3fv(mshader.matrixNormal,false,camera.nMatrix);
if(!bound){
mat.bindObject(obj_in,mshader);
bound=(mshader.vertexTexCoord != -1);
if(lines){
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,obj_in.compiled.gl_line_elements);
}
}
for(lcount=0; lcount<nLights; lcount++){
lighting[lcount+subcount].setupShader(mshader,lcount);
}
if(lines){
gl.drawElements(gl.LINES,len,gl.UNSIGNED_SHORT,ofs);
}else{
gl.drawElements(gl.TRIANGLES,len,gl.UNSIGNED_SHORT,ofs);
}
//   var un = mshader.uniforms["aNormal"];
// }
subcount+=nLights;
}
if(blended){
gl.disable(gl.BLEND);
gl.depthFunc(gl.LEQUAL);
}
}
ofs+=len*2;  // Note: unsigned short = 2 bytes
len=0;
drawn=true;
}else{
ofs+=len*2;
len=0;
}
}
if(!drawn && obj_in.segment_state[j] && mat.visible){
if(!numLights){
mat.use(0,0);
gl.uniformMatrix4fv(mat.shader[0][0].matrixModelView,false,camera.mvMatrix);
gl.uniformMatrix4fv(mat.shader[0][0].matrixProjection,false,camera.pMatrix);
gl.uniformMatrix4fv(mat.shader[0][0].matrixObject,false,o_matrix);
gl.uniformMatrix3fv(mat.shader[0][0].matrixNormal,false,camera.nMatrix);
if(!bound){
mat.bindObject(obj_in,mat.shader[0][0]);
bound=(mat.shader[0][0].vertexTexCoord != -1);
if(lines){
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,obj_in.compiled.gl_line_elements);
}
}
if(lines){
gl.drawElements(gl.LINES,len,gl.UNSIGNED_SHORT,ofs);
}else{
gl.drawElements(gl.TRIANGLES,len,gl.UNSIGNED_SHORT,ofs);
}
}else{
subcount=0;
blended=false;
for(subcount=0; subcount<numLights;){
nLights=numLights-subcount;
if(nLights>base.MAX_LIGHTS){
nLights=base.MAX_LIGHTS;
}
if(subcount>0 && !blended){
gl.enable(gl.BLEND);
gl.blendFunc(gl.ONE,gl.ONE);
gl.depthFunc(gl.EQUAL);
blended=true;
}
mshader=undef;
l=lighting[subcount];
lt=l.light_type;
for(lcount=0; lcount<nLights; lcount++){
if(lighting[lcount+subcount].light_type != lt){
nLights=lcount;
break;
}
}
mat.use(l.light_type,nLights);
mshader=mat.shader[l.light_type][nLights];
gl.uniformMatrix4fv(mshader.matrixModelView,false,camera.mvMatrix);
gl.uniformMatrix4fv(mshader.matrixProjection,false,camera.pMatrix);
gl.uniformMatrix4fv(mshader.matrixObject,false,o_matrix);
gl.uniformMatrix3fv(mshader.matrixNormal,false,camera.nMatrix);
if(!bound){
mat.bindObject(obj_in,mshader);
bound=(mshader.vertexTexCoord != -1);
if(lines){
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,obj_in.compiled.gl_line_elements);
}
}
for(lcount=0; lcount<nLights; lcount++){
lighting[lcount+subcount].setupShader(mshader,lcount);
}
if(lines){
gl.drawElements(gl.LINES,len,gl.UNSIGNED_SHORT,ofs);
}else{
gl.drawElements(gl.TRIANGLES,len,gl.UNSIGNED_SHORT,ofs);
}
//   var un = mshader.uniforms["aNormal"];
// }
subcount+=nLights;
}
if(blended){
gl.disable(gl.BLEND);
gl.depthFunc(gl.LEQUAL);
}
}
ofs+=len*2;
}
}
if(mat && mshader){
mat.clearObject(obj_in,mshader);
}else{
mat.clearObject(obj_in,null);
}
gl.depthMask(1);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,null);
return has_transparency;
}
var exports={
renderObject:cubicvr_renderObject
};
return exports;
});
CubicVR.RegisterModule("Light",function(base){
var GLCore=base.GLCore;
var enums=base.enums;
var undef=base.undef;
var util=base.util;
var cubicvr_identity=[1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0];
enums.light={
type:{
NULL:0,POINT:1,DIRECTIONAL:2,SPOT:3,AREA:4,DEPTH_PACK:5,SPOT_SHADOW:6,SPOT_SHADOW_PROJECTOR:7,MAX:8
},method:{
GLOBAL:0,STATIC:1,DYNAMIC:2
}
};
function Light(light_type,lighting_method){
var mat4=base.mat4;
var aabbMath=base.aabb;
light_type=base.get(light_type) || {};
if(light_type === undef){
light_type=enums.light.type.POINT;
}
if(lighting_method === undef){
lighting_method=enums.light.method.DYNAMIC;
}
if(typeof (light_type) == 'object'){
this.light_type=(light_type.type !== undef)?base.parseEnum(enums.light.type,light_type.type):enums.light.type.POINT;
this.diffuse=(light_type.diffuse !== undef)?light_type.diffuse:[1,1,1];
this.specular=(light_type.specular !== undef)?light_type.specular:[1.0,1.0,1.0];
this.intensity=(light_type.intensity !== undef)?light_type.intensity:1.0;
this.position=(light_type.position !== undef)?light_type.position:[0,0,0];
this.direction=(light_type.direction !== undef)?light_type.direction:[0,0,0];
this.distance=(light_type.distance !== undef)?light_type.distance:((this.light_type === enums.light.type.AREA)?30:10);
this.cutoff=(light_type.cutoff !== undef)?light_type.cutoff:60;
this.map_res=(light_type.map_res !== undef)?light_type.map_res:(this.light_type === enums.light.type.AREA)?2048:512;
this.map_res=(light_type.mapRes !== undef)?light_type.mapRes:this.map_res;
this.method=(light_type.method !== undef)?base.parseEnum(enums.light.method,light_type.method):lighting_method;
this.areaCam=(light_type.areaCam !== undef)?light_type.areaCam:null;
this.areaCeiling=(light_type.areaCeiling !== undef)?light_type.areaCeiling:40;
this.areaFloor=(light_type.areaFloor !== undef)?light_type.areaFloor:-40;
this.areaAxis=(light_type.areaAxis !== undef)?light_type.areaAxis:[1,1,0];
this.projectorTex=(light_type.projector !== undef)?light_type.projector:null;
}else{
this.light_type=base.parseEnum(enums.light.type,light_type);
this.diffuse=[1,1,1];
this.specular=[1.0,1.0,1.0];
this.intensity=1.0;
this.position=[0,0,0];
this.direction=[0,0,0];
this.distance=((this.light_type === enums.light.type.AREA)?30:10);
this.cutoff=60;
this.map_res=(this.light_type === enums.light.type.AREA)?2048:512;
this.method=base.parseEnum(enums.light.method,lighting_method);
this.areaCam=null;
this.areaCeiling=40;
this.areaFloor= -40;
this.areaAxis=[1,1,0];
this.projectorTex=null;
}
if(this.projectorTex && typeof (this.projectorTex) === "string"){
var tex=this.projectorTex;
this.projectorTex=(base.Textures_ref[tex] !== undef)?base.Textures_obj[base.Textures_ref[tex]]:(new base.Texture(tex));
}
this.setType(this.light_type);
this.lposition=[0,0,0];
this.dirty=true;
this.octree_leaves=[];
this.octree_common_root=null;
this.octree_aabb=[[0,0,0],[0,0,0]];
this.ignore_octree=false;
this.visible=true;
this.culled=true;
this.was_culled=true;
this.aabb=[[0,0,0],[0,0,0]];
aabbMath.reset(this.aabb,this.position);
this.adjust_octree=base.SceneObject.prototype.adjust_octree;
this.motion=null;
this.rotation=[0,0,0];
if((this.light_type === enums.light.type.SPOT_SHADOW || this.light_type === enums.light.type.SPOT_SHADOW_PROJECTOR) || this.light_type === enums.light.type.AREA && base.features.lightShadows){
this.setShadow(this.map_res);
}
this.lDir=[0,0,0];
this.lPos=[0,0,0];
this.parent=null;
}
Light.prototype={
setType:function(light_type){
if(light_type === enums.light.type.AREA && !base.features.lightShadows){
this.dummyCam=new base.Camera();
this.areaCam=new base.Camera();
this.updateAreaLight();
this.dummyCam=null;
this.areaCam=null;
light_type=enums.light.type.DIRECTIONAL;
}else if((light_type === enums.light.type.SPOT_SHADOW || light_type === enums.light.type.SPOT_SHADOW_PROJECTOR) && !base.features.lightShadows){
light_type=enums.light.type.SPOT;
}
this.light_type=light_type;
},setParent:function(lParent){
this.parent=lParent;
},setMethod:function(method){
this.method=method;
},setDiffuse:function(diffuse){
this.diffuse=diffuse;
},setSpecular:function(specular){
this.specular=specular;
},setIntensity:function(intensity){
this.intensity=intensity;
},setPosition:function(position){
this.position=position;
},setDistance:function(distance){
this.distance=distance;
},setCutoff:function(cutoff_angle){
this.cutoff=cutoff_angle;
},prepare:function(camera){
var mat4=base.mat4;
var mat3=base.mat3;
var ltype=this.light_type;
if(this.parent){
if(ltype === enums.light.type.SPOT || ltype === enums.light.type.SPOT_SHADOW || ltype === enums.light.type.SPOT_SHADOW_PROJECTOR){
var dMat=mat4.inverse_mat3(this.parent.tMatrix);
mat3.transpose_inline(dMat);
this.lDir=mat3.vec3_multiply(this.direction,dMat);
this.lDir=mat3.vec3_multiply(this.lDir,camera.nMatrix);
this.lPos=mat4.vec3_multiply(this.position,mat4.multiply(camera.mvMatrix,this.parent.tMatrix));
}else if(ltype === enums.light.type.POINT){
this.lPos=mat4.vec3_multiply(this.position,mat4.multiply(camera.mvMatrix,this.parent.tMatrix));
}
}else{
if(ltype === enums.light.type.DIRECTIONAL){
this.lDir=mat3.vec3_multiply(this.direction,camera.nMatrix);
}else if(ltype === enums.light.type.SPOT || ltype === enums.light.type.SPOT_SHADOW || ltype === enums.light.type.SPOT_SHADOW_PROJECTOR){
this.lDir=mat3.vec3_multiply(this.direction,camera.nMatrix);
this.lPos=mat4.vec3_multiply(this.position,camera.mvMatrix);
}else if(ltype === enums.light.type.POINT){
this.lPos=mat4.vec3_multiply(this.position,camera.mvMatrix);
}else if(ltype === enums.light.type.AREA){
this.lDir=mat3.vec3_multiply(this.direction,camera.nMatrix);
}
}
},control:function(controllerId,motionId,value){
if(controllerId === enums.motion.POS){
this.position[motionId]=value;
}else if(controllerId === enums.motion.INTENSITY){
this.intensity=value;
}
},getAABB:function(){
var vec3=base.vec3;
var aabbMath=base.aabb;
var aabb=[[0,0,0],[0,0,0]];
aabbMath.engulf(aabb,[this.distance,this.distance,this.distance]);
aabbMath.engulf(aabb,[-this.distance,-this.distance,-this.distance]);
aabb[0]=vec3.add(aabb[0],this.position);
aabb[1]=vec3.add(aabb[1],this.position);
this.aabb=aabb;
return this.aabb;
},setDirection:function(x,y,z){
var vec3=base.vec3;
if(typeof (x) === 'object'){
this.setDirection(x[0],x[1],x[2]);
return;
}
this.direction=vec3.normalize([x,y,z]);
return this;
},lookat:function(x,y,z){
var vec3=base.vec3;
if(typeof (x) === 'object'){
this.lookat(x[0],x[1],x[2]);
return;
}
this.direction=vec3.normalize(vec3.subtract([x,y,z],this.position));
return this;
},setRotation:function(x,y,z){
var mat4=base.mat4;
var vec3=base.vec3;
if(typeof (x) === 'object'){
this.setRotation(x[0],x[1],x[2]);
return;
}
var t=new base.Transform();
t.rotate([-x,-y,-z]);
t.pushMatrix();
this.direction=vec3.normalize(mat4.vec3_multiply([1,0,0],t.getResult()));
this.rotation=[x,y,z];
return this;
},setupShader:function(lShader,lNum){
var gl=GLCore.gl;
var lUniforms=lShader;
gl.uniform3fv(lUniforms.lightDiffuse[lNum],this.diffuse);
gl.uniform3fv(lUniforms.lightSpecular[lNum],this.specular);
if(this.lPos) gl.uniform3fv(lUniforms.lightPosition[lNum],this.lPos);
if(this.lDir) gl.uniform3fv(lUniforms.lightDirection[lNum],this.lDir);
gl.uniform1f(lUniforms.lightIntensity[lNum],this.intensity);
gl.uniform1f(lUniforms.lightDistance[lNum],this.distance);
if((this.light_type === enums.light.type.SPOT_SHADOW) || (this.light_type === enums.light.type.SPOT_SHADOW_PROJECTOR) || (this.light_type === enums.light.type.SPOT)){
gl.uniform1f(lUniforms.lightCutOffAngle[lNum],this.cutoff);
}
if((this.light_type === enums.light.type.SPOT_SHADOW) || (this.light_type === enums.light.type.SPOT_SHADOW_PROJECTOR) || (this.light_type === enums.light.type.AREA)){
if(this.light_type === enums.light.type.SPOT_SHADOW_PROJECTOR){
this.shadowMapTex.texture.use(GLCore.gl.TEXTURE0+lNum*2); // reserved in material for shadow map
gl.uniform1i(lShader.lightShadowMap[lNum],lNum*2);
this.projectorTex.use(GLCore.gl.TEXTURE0+lNum*2+1); // reserved in material for projector map
gl.uniform1i(lShader.lightProjectionMap[lNum],lNum*2+1);
}else{
this.shadowMapTex.texture.use(GLCore.gl.TEXTURE0+lNum); // reserved in material for shadow map
gl.uniform1i(lShader.lightShadowMap[lNum],lNum);
}
gl.uniform3fv(lShader.lightDepthClip[lNum],[this.dummyCam.nearclip,this.dummyCam.farclip,1.0/this.map_res]);
gl.uniformMatrix4fv(lShader.lightShadowMatrix[lNum],false,this.spMatrix);
}
},setShadow:function(map_res_in) // cone_tex
{
if(!base.features.lightShadows) return;
this.map_res=map_res_in;
this.shadowMapTex=new base.RenderBuffer(this.map_res,this.map_res,true);
this.shadowMapTex.texture.setFilter(enums.texture.filter.NEAREST);
this.dummyCam=new base.Camera(this.map_res,this.map_res,80,0.1,this.distance);
this.dummyCam.calc_nmatrix=false; // don't need a normal matrix, save some cycles and determinant issues
this.dummyCam.setTargeted(true);
//  has_projector = true;
this.has_shadow=true;
},hasShadow:function(){
return has_shadow;
},setProjector:function(projectorTex_in){
this.projectorTex=projectorTex_in;
},hasProjector:function(){
return ((this.projectorTex !== null)?true:false);
},shadowBegin:function(){
var gl=GLCore.gl;
var mat4=base.mat4;
var mat3=base.mat3;
this.shadowMapTex.use();
gl.viewport(0,0,this.map_res,this.map_res);
gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
if(this.light_type !== enums.light.type.AREA){
this.dummyCam.setClip(0.1,this.distance);
this.dummyCam.setFOV(this.cutoff);
}else{
this.dummyCam.calcProjection();
}
if(this.parent){
var dMat=mat4.inverse_mat3(this.parent.tMatrix);
mat3.transpose_inline(dMat);
var lDir=mat3.vec3_multiply(this.direction,dMat);
var lPos=mat4.vec3_multiply(this.position,this.parent.tMatrix);
this.dummyCam.lookat(this.position[0],this.position[1],this.position[2],this.position[0]+this.direction[0]*10.0,this.position[1]+this.direction[1]*10.0,this.position[2]+this.direction[2]*10.0,0,1,0);
mat4.multiply(this.dummyCam.mvMatrix.slice(0),mat4.inverse(this.parent.tMatrix),this.dummyCam.mvMatrix);
}else{
this.dummyCam.lookat(this.position[0],this.position[1],this.position[2],this.position[0]+this.direction[0]*10.0,this.position[1]+this.direction[1]*10.0,this.position[2]+this.direction[2]*10.0,0,1,0);
}
gl.cullFace(gl.FRONT);
},shadowEnd:function(){
var gl=GLCore.gl;
gl.bindFramebuffer(gl.FRAMEBUFFER,null);
gl.cullFace(gl.BACK);
this.setupTexGen();
},setupTexGen:function(){
var mat4=base.mat4;
var biasMatrix=[0.5,0.0,0.0,0.0,0.0,0.5,0.0,0.0,0.0,0.0,0.5,0.0,0.5,0.5,0.5,1.0];
this.spMatrix=mat4.multiply(cubicvr_identity,biasMatrix);
this.spMatrix=mat4.multiply(this.spMatrix,this.dummyCam.pMatrix);
this.spMatrix=mat4.multiply(this.spMatrix,this.dummyCam.mvMatrix);
},setAreaAxis:function(degs_in){
this.areaAxis=degs_in;
},updateAreaLight:function(){
var vec3=base.vec3;
var areaHeight=this.areaCeiling-this.areaFloor;
this.dummyCam.ortho=true;
this.dummyCam.setClip(0.01,1); // set defaults
var dist=0.0;
var sx=Math.tan((this.areaCam.fov/2.0)*(Math.PI/180.0));
var vview=vec3.subtract(this.areaCam.target,this.areaCam.position);
vview[1]=0;
vview=vec3.normalize(vview);
var vleft=vec3.normalize(vec3.cross(vview,[0,1,0]));
var fwd_ang=-Math.atan2(vview[2],vview[0]);
dist=((this.distance/2.0)*Math.abs(sx))-(this.distance/2.0);
if(dist<(this.distance/3.0)/2.0) dist=(this.distance/3.0)/2.0;
vview=vec3.multiply(vview,dist);
var zang=this.areaAxis[0]*(Math.PI/180);
var xang=this.areaAxis[1]*(Math.PI/180);
var tzang=Math.tan(zang);
var txang=Math.tan(xang);
var l_vec=[txang,0.0,tzang];
fwd_ang-=Math.atan2(l_vec[0],l_vec[2]);
this.position=vec3.add(vec3.add(this.areaCam.position,vview),vec3.multiply(l_vec,areaHeight));
this.position[1]=this.areaCeiling;
this.target=vec3.add(vec3.add(this.areaCam.position,vview),vec3.multiply(l_vec,-areaHeight));
this.target[1]=this.areaFloor;
this.direction=vec3.normalize(vec3.subtract(this.target,this.position));
this.dummyCam.rotation[2]=fwd_ang*(180.0/Math.PI);
var nearclip=this.dummyCam.nearclip;
var farclip=this.dummyCam.farclip*(Math.abs(this.direction[1])*areaHeight);
var aabb=this.orthoBounds(this.position,this.distance,this.distance,this.dummyCam.pMatrix,this.dummyCam.mvMatrix,this.dummyCam.nearclip);
var diff;
if(aabb[0][1]<this.areaCeiling){
diff=(this.areaCeiling-aabb[0][1]);
nearclip-=diff/Math.abs(this.direction[1]);
}
aabb=this.orthoBounds(this.position,this.distance,this.distance,this.dummyCam.pMatrix,this.dummyCam.mvMatrix,this.dummyCam.farclip);
if(aabb[1][1]>this.areaFloor){
diff=(aabb[1][1]-this.areaFloor);
farclip+=diff/Math.abs(this.direction[1]);
}
nearclip=0.01;
this.dummyCam.nearclip=nearclip;
this.dummyCam.farclip=farclip;
this.dummyCam.setOrtho(-this.distance/2.0,this.distance/2.0,-this.distance/2.0,this.distance/2.0);
},orthoBounds:function(position,ortho_width,ortho_height,projMatrix,modelMatrix,clipDist){
var vec3=base.vec3;
var right=vec3.normalize([modelMatrix[0],modelMatrix[4],modelMatrix[8]]);
var up=vec3.normalize([modelMatrix[1],modelMatrix[5],modelMatrix[9]]);
var forward=vec3.normalize(vec3.cross(up,right));
var hw,hh;
hw=ortho_width/2.0;
hh=ortho_height/2.0;
var f_bounds=[];
var rightHW=vec3.multiply(right,hw);
var upHH=vec3.multiply(up,hh);
var forwardClip=vec3.multiply(forward,clipDist);
f_bounds[0]=vec3.add(vec3.subtract(position,rightHW),vec3.add(upHH,forwardClip));
f_bounds[1]=vec3.add(vec3.add(position,rightHW),vec3.add(upHH,forwardClip));
f_bounds[2]=vec3.subtract(vec3.subtract(position,rightHW),vec3.add(upHH,forwardClip));
f_bounds[3]=vec3.subtract(vec3.add(position,rightHW),vec3.add(upHH,forwardClip));
aabb1=f_bounds[0];
aabb2=f_bounds[0];
for(var i=1; i<4; i++){
if(aabb1[0]>f_bounds[i][0]) aabb1[0]=f_bounds[i][0];
if(aabb1[1]>f_bounds[i][1]) aabb1[1]=f_bounds[i][1];
if(aabb1[2]>f_bounds[i][2]) aabb1[2]=f_bounds[i][2];
if(aabb2[0]<f_bounds[i][0]) aabb2[0]=f_bounds[i][0];
if(aabb2[1]<f_bounds[i][1]) aabb2[1]=f_bounds[i][1];
if(aabb2[2]<f_bounds[i][2]) aabb2[2]=f_bounds[i][2];
}
return [aabb1,aabb2];
}
};
var extend={
Light:Light
};
return extend;
});
CubicVR.RegisterModule("Camera",function(base){
var undef=base.undef;
var enums=base.enums;
var GLCore=base.GLCore;
var cubicvr_identity=[1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0];
var cameraUUID=0;
function Camera(width,height,fov,nearclip,farclip){
var mat4=base.mat4;
this.frustum=new base.Frustum();
if(typeof (width) == 'object'){
var obj_init=width;
this.position=obj_init.position || [0,0,-1];
this.rotation=obj_init.rotation || [0,0,0];
this.target=obj_init.target || [0,0,0];
this.fov=obj_init.fov || 60.0;
this.nearclip=(obj_init.nearclip || obj_init.nearClip || obj_init.near || 0.1);
this.farclip=(obj_init.farclip || obj_init.farClip || obj_init.far || 400.0);
this.targeted=(obj_init.targeted !== undef)?obj_init.targeted:true;
this.calc_nmatrix=(obj_init.calcNormalMatrix !== undef)?obj_init.calcNormalMatrix:true;
this.name=obj_init.name || ("camera"+cameraUUID);
height=obj_init.height?obj_init.height:undef;
width=obj_init.width?obj_init.width:undef;
}else{
this.position=[0,0,0];
this.rotation=[0,0,0];
this.target=[0,0,0];
this.fov=(fov !== undef)?fov:60.0;
this.nearclip=(nearclip !== undef)?nearclip:0.1;
this.farclip=(farclip !== undef)?farclip:400.0;
this.targeted=true;
this.calc_nmatrix=true;
this.name="camera"+cameraUUID;
}
this.targetSceneObject=null;
this.motion=null;
this.transform=new base.Transform();
this.manual=false;
this.setDimensions((width !== undef)?width:512,(height !== undef)?height:512);
this.mvMatrix=mat4.identity();
this.pMatrix=null;
this.calcProjection();
this.ortho=false;
this.ortho_view={
left:-1,right:1,bottom:-1,top:1
};
this.parent=null;
++cameraUUID;
}
Camera.prototype={
trackTarget:function(targetPos,speed,safeDist){
this.position=base.vec3.trackTarget(this.position,targetPos,speed,safeDist);
},setParent:function(camParent){
this.parent=camParent;
},hasParent:function(){
return !!this.parent;
},getParent:function(){
return this.parent;
},getParentedPosition:function(){
if(this.parent !== null && this.mvMatrix && this.parent.tMatrix){
return base.mat4.vec3_multiply(this.position,this.parent.tMatrix);
}else{
return this.position;
}
},setOrtho:function(left,right,bottom,top){
this.ortho=true;
this.ortho_view.left=left;
this.ortho_view.right=right;
this.ortho_view.bottom=bottom;
this.ortho_view.top=top;
},control:function(controllerId,motionId,value){
if(controllerId === enums.motion.ROT){
this.rotation[motionId]=value;
}else if(controllerId === enums.motion.POS){
this.position[motionId]=value;
}else if(controllerId === enums.motion.FOV){
this.setFOV(value);
}else if(controllerId === enums.motion.LENS){
this.setLENS(value);
}else if(controllerId === enums.motion.NEARCLIP){
this.setClip(value,this.farclip);
}else if(controllerId === enums.motion.FARCLIP){
this.setClip(this.nearclip,value);
}
},makeFrustum:function(left,right,bottom,top,zNear,zFar){
var A=(right+left)/(right-left);
var B=(top+bottom)/(top-bottom);
var C=-(zFar+zNear)/(zFar-zNear);
var D=-2.0*zFar*zNear/(zFar-zNear);
return [2.0*zNear/(right-left),0.0,0.0,0.0,0.0,2.0*zNear/(top-bottom),0.0,0.0,A,B,C,-1.0,0.0,0.0,D,0.0];
},setTargeted:function(targeted){
this.targeted=targeted;
},calcProjection:function(){
var mat4=base.mat4;
var mat3=base.mat3;
var vec3=base.vec3;
var gl=GLCore.gl;
if(this.ortho){
this.pMatrix=mat4.ortho(this.ortho_view.left,this.ortho_view.right,this.ortho_view.bottom,this.ortho_view.top,this.nearclip,this.farclip);
}else{
this.pMatrix=mat4.perspective(this.fov,this.aspect,this.nearclip,this.farclip);
}
if(!this.targeted && this.mvMatrix){
mat4.identity(this.mvMatrix);
mat4.rotate(-this.rotation[0],-this.rotation[1],-this.rotation[2],this.mvMatrix);
mat4.translate(-this.position[0],-this.position[1],-this.position[2],this.mvMatrix);
if(this.parent){
mat4.multiply(this.mvMatrix.slice(0),mat4.inverse(this.parent.tMatrix),this.mvMatrix);
}
if(this.calc_nmatrix){
this.nMatrix=mat4.inverse_mat3(this.mvMatrix);
mat3.transpose_inline(this.nMatrix);
}else{
mat4.identity(this.nMatrix);
}
}
this.frustum.extract(this,this.mvMatrix,this.pMatrix);
},setClip:function(nearclip,farclip){
this.nearclip=nearclip;
this.farclip=farclip;
this.calcProjection();
},setDimensions:function(width,height){
this.width=width;
this.height=height;
this.aspect=width/height;
this.calcProjection();
},resize:function(width,height){
this.setDimensions(width,height);
},setFOV:function(fov){
this.fov=fov;
this.ortho=false;
this.calcProjection();
},setLENS:function(lens){
this.setFOV(2.0*Math.atan(16.0/lens)*(180.0/Math.PI));
},lookat:function(eyeX,eyeY,eyeZ,lookAtX,lookAtY,lookAtZ,upX,upY,upZ){
var mat4=base.mat4;
var mat3=base.mat3;
if(typeof (eyeX) == 'object'){
this.lookat(this.position[0],this.position[1],this.position[2],eyeX[0],eyeX[1],eyeX[2],0,1,0);
return;
}
this.mvMatrix=mat4.lookat(eyeX,eyeY,eyeZ,lookAtX,lookAtY,lookAtZ,upX,upY,upZ);
if(this.rotation[2]){
this.transform.clearStack();
this.transform.rotate(-this.rotation[2],0,0,1);
this.transform.pushMatrix(this.mvMatrix);
this.mvMatrix=this.transform.getResult();
}
if(this.parent !== null){
mat4.multiply(this.mvMatrix.slice(0),mat4.inverse(this.parent.tMatrix),this.mvMatrix);
}
if(this.calc_nmatrix){
this.nMatrix=mat4.inverse_mat3(this.mvMatrix);
mat3.transpose_inline(this.nMatrix);
}else{
this.nMatrix=cubicvr_identity;
}
this.frustum.extract(this,this.mvMatrix,this.pMatrix);
},unProject:function(winx,winy,winz){
var mat4=base.mat4;
var vec3=base.vec3;
var viewport=[0,0,this.width,this.height];
var p=[(((winx-viewport[0])/(viewport[2]))*2)-1,-((((winy-viewport[1])/(viewport[3]))*2)-1),1,1.0];
var invp=mat4.vec4_multiply(mat4.vec4_multiply(p,mat4.inverse(this.pMatrix)),mat4.inverse(this.mvMatrix));
var result=[invp[0]/invp[3],invp[1]/invp[3],invp[2]/invp[3]];
if(winz !== undef){
var pos=this.getParentedPosition();
return vec3.add(pos,vec3.multiply(vec3.normalize(vec3.subtract(result,pos)),winz));
}
return result;
},project:function(objx,objy,objz){
var mat4=base.mat4;
var p=[objx,objy,objz,1.0];
var mp=mat4.vec4_multiply(mat4.vec4_multiply(p,this.mvMatrix),this.pMatrix);
mp[2]=base.vec3.length(base.vec3.subtract([objx,objy,objz],this.position));
return [((mp[0]/mp[3]+1.0)/2.0)*this.width,((-mp[1]/mp[3]+1.0)/2.0)*this.height,mp[2]];
}
};
function AutoCameraNode(pos){
this.position=(pos !== undef)?pos:[0,0,0];
}
AutoCameraNode.prototype={
control:function(controllerId,motionId,value){
if(controllerId === enums.motion.POS){
this.position[motionId]=value;
}
}
};
function AutoCamera(start_position,target,bounds){
this.camPath=new base.Motion();
this.targetPath=new base.Motion();
this.start_position=(start_position !== undef)?start_position:[8,8,8];
this.target=(target !== undef)?target:[0,0,0];
this.bounds=(bounds !== undef)?bounds:[[-15,3,-15],[15,20,15]];
this.safe_bb=[];
this.avoid_sphere=[];
this.segment_time=3.0;
this.buffer_time=20.0;
this.start_time=0.0;
this.current_time=0.0;
this.path_time=0.0;
this.path_length=0;
this.min_distance=2.0;
this.max_distance=40.0;
this.angle_min=40;
this.angle_max=180;
}
AutoCamera.prototype={
inBounds:function(pt){
var vec3=base.vec3;
if(!(pt[0]>this.bounds[0][0] && pt[1]>this.bounds[0][1] && pt[2]>this.bounds[0][2] && pt[0]<this.bounds[1][0] && pt[1]<this.bounds[1][1] && pt[2]<this.bounds[1][2])){
return false;
}
for(var i=0,iMax=this.avoid_sphere.length; i<iMax; i++){
var l=vec3.length(pt,this.avoid_sphere[i][0]);
if(l<this.avoid_sphere[i][1]){
return false;
}
}
return true;
},findNextNode:function(aNode,bNode){
var vec3=base.vec3;
var d=[this.bounds[1][0]-this.bounds[0][0],this.bounds[1][1]-this.bounds[0][1],this.bounds[1][2]-this.bounds[0][2]];
var nextNodePos=[0,0,0];
var randVector=[0,0,0];
var l=0.0;
var loopkill=0;
var valid=false;
do{
randVector[0]=Math.random()-0.5;
randVector[1]=Math.random()-0.5;
randVector[2]=Math.random()-0.5;
randVector=vec3.normalize(randVector);
var r=Math.random();
l=(r*(this.max_distance-this.min_distance))+this.min_distance;
nextNodePos=vec3.add(bNode.position,vec3.multiply(randVector,l));
valid=this.inBounds(nextNodePos);
loopkill++;
if(loopkill>30){
nextNodePos=bNode.position;
break;
}
}while(!valid);
return nextNodePos;
},run:function(timer){
this.current_time=timer;
if(this.path_time === 0.0){
this.path_time=this.current_time;
this.camPath.setKey(enums.motion.POS,enums.motion.X,this.path_time,this.start_position[0]);
this.camPath.setKey(enums.motion.POS,enums.motion.Y,this.path_time,this.start_position[1]);
this.camPath.setKey(enums.motion.POS,enums.motion.Z,this.path_time,this.start_position[2]);
}
while(this.path_time<this.current_time+this.buffer_time){
this.path_time+=this.segment_time;
var tmpNodeA=new AutoCameraNode();
var tmpNodeB=new AutoCameraNode();
if(this.path_length){
this.camPath.apply(this.path_time-(this.segment_time*2.0),tmpNodeA);
}
this.camPath.apply(this.path_time-this.segment_time,tmpNodeB);
var nextPos=this.findNextNode(tmpNodeA,tmpNodeB);
this.camPath.setKey(enums.motion.POS,enums.motion.X,this.path_time,nextPos[0]);
this.camPath.setKey(enums.motion.POS,enums.motion.Y,this.path_time,nextPos[1]);
this.camPath.setKey(enums.motion.POS,enums.motion.Z,this.path_time,nextPos[2]);
this.path_length++;
}
var tmpNodeC=new AutoCameraNode();
this.camPath.apply(timer,tmpNodeC);
return tmpNodeC.position;
},addSafeBound:function(min,max){
this.safe_bb.push([min,max]);
},addAvoidSphere:function(center,radius){
this.avoid_sphere.push([center,radius]);
}
};
var exports={
Camera:Camera,AutoCamera:AutoCamera
};
return exports;
});
CubicVR.RegisterModule("Motion",function(base){
var undef=base.undef;
var enums=CubicVR.enums;
enums.motion={
POS:0,ROT:1,SCL:2,POSITION:0,ROTATION:1,SCALE:2,FOV:3,LENS:4,NEARCLIP:5,FARCLIP:6,INTENSITY:7,X:0,Y:1,Z:2,V:3
};
enums.envelope={
shape:{
TCB:0,HERM:1,BEZI:2,LINE:3,STEP:4,BEZ2:5
},behavior:{
RESET:0,CONSTANT:1,REPEAT:2,OSCILLATE:3,OFFSET:4,LINEAR:5
}
};
var cubicvr_env_range=function(v,lo,hi){
var v2,i=0,r;
r=hi-lo;
if(r === 0.0){
return [lo,0];
}
v2=v-r*Math.floor((v-lo)/r);
i= -parseInt((v2-v)/r+(v2>v?0.5:-0.5),10);
return [v2,i];
};
var cubicvr_env_hermite=function(t){
var h1,h2,h3,h4;
var t2,t3;
t2=t*t;
t3=t*t2;
h2=3.0*t2-t3-t3;
h1=1.0-h2;
h4=t3-t2;
h3=h4-t2+t;
return [h1,h2,h3,h4];
};
var cubicvr_env_bezier=function(x0,x1,x2,x3,t){
var a,b,c,t2,t3;
t2=t*t;
t3=t2*t;
c=3.0*(x1-x0);
b=3.0*(x2-x1)-c;
a=x3-x0-c-b;
return a*t3+b*t2+c*t+x0;
};
var cubicvr_env_bez2_time=function(x0,x1,x2,x3,time,t0,t1){
var v,t;
t=t0+(t1-t0)*0.5;
v=cubicvr_env_bezier(x0,x1,x2,x3,t);
if(Math.abs(time-v)>0.0001){
if(v>time){
t1=t;
}else{
t0=t;
}
return cubicvr_env_bez2_time(x0,x1,x2,x3,time,t0,t1);
}else{
return t;
}
};
var cubicvr_env_bez2=function(key0,key1,time){
var x,y,t,t0=0.0,t1=1.0;
if(key0.shape === enums.envelope.shape.BEZ2){
x=key0.time+key0.param[2];
}else{
x=key0.time+(key1.time-key0.time)/3.0;
}
t=cubicvr_env_bez2_time(key0.time,x,key1.time+key1.param[0],key1.time,time,t0,t1);
if(key0.shape === enums.envelope.shape.BEZ2){
y=key0.value+key0.param[3];
}else{
y=key0.value+key0.param[1]/3.0;
}
return cubicvr_env_bezier(key0.value,y,key1.param[1]+key1.value,key1.value,t);
};
var cubicvr_env_outgoing=function(key0,key1){
var a,b,d,t,out;
if(key0.shape === enums.envelope.shape.TCB){
a=(1.0-key0.tension)*(1.0+key0.continuity)*(1.0+key0.bias);
b=(1.0-key0.tension)*(1.0-key0.continuity)*(1.0-key0.bias);
d=key1.value-key0.value;
if(key0.prev){
t=(key1.time-key0.time)/(key1.time-(key0.prev).time);
out=t*(a*(key0.value-(key0.prev).value)+b*d);
}else{
out=b*d;
}
}else if(key0.shape === enums.envelope.shape.LINE){
d=key1.value-key0.value;
if(key0.prev){
t=(key1.time-key0.time)/(key1.time-(key0.prev).time);
out=t*(key0.value-(key0.prev).value+d);
}else{
out=d;
}
}else if((key0.shape === enums.envelope.shape.BEZI) || (key0.shape === enums.envelope.shape.HERM)){
out=key0.param[1];
if(key0.prev){
out*=(key1.time-key0.time)/(key1.time-(key0.prev).time);
}
}else if(key0.shape === enums.envelope.shape.BEZ2){
out=key0.param[3]*(key1.time-key0.time);
if(Math.abs(key0.param[2])>1e-5){
out/=key0.param[2];
}else{
out*=1e5;
}
}else if(key0.shape === enums.envelope.shape.STEP){
out=0.0;
}else{
out=0.0;
}
return out;
};
var cubicvr_env_incoming=function(key0,key1){
var a,b,d,t,inval;
if(key1.shape === enums.envelope.shape.LINE){
d=key1.value-key0.value;
if(key1.next){
t=(key1.time-key0.time)/((key1.next).time-key0.time);
inval=t*((key1.next).value-key1.value+d);
}else{
inval=d;
}
}else if(key1.shape === enums.envelope.shape.TCB){
a=(1.0-key1.tension)*(1.0-key1.continuity)*(1.0+key1.bias);
b=(1.0-key1.tension)*(1.0+key1.continuity)*(1.0-key1.bias);
d=key1.value-key0.value;
if(key1.next){
t=(key1.time-key0.time)/((key1.next).time-key0.time);
inval=t*(b*((key1.next).value-key1.value)+a*d);
}else{
inval=a*d;
}
}else if((key1.shape === enums.envelope.shape.HERM) || (key1.shape === enums.envelope.shape.BEZI)){
inval=key1.param[0];
if(key1.next){
inval*=(key1.time-key0.time)/((key1.next).time-key0.time);
}
}else if(key1.shape === enums.envelope.shape.BEZ2){
inval=key1.param[1]*(key1.time-key0.time);
if(Math.abs(key1.param[0])>1e-5){
inval/=key1.param[0];
}else{
inval*=1e5;
}
}else if(key1.shape === enums.envelope.shape.STEP){
inval=0.0;
}else{
inval=0.0;
}
return inval;
};
function EnvelopeKey(){
this.value=0;
this.time=0;
this.shape=enums.envelope.shape.TCB;
this.tension=0;
this.continuity=0;
this.bias=0;
this.prev=null;
this.next=null;
this.param=[0,0,0,0];
}
function Envelope(obj_init){
this.nKeys=0;
this.keys=null;
this.firstKey=null;
this.lastKey=null;
if(obj_init){
this.in_behavior=CubicVR.parseEnum(enums.envelope.behavior,obj_init.in_behavior || obj_init.inBehavior || obj_init.behavior) || enums.envelope.behavior.CONSTANT;
this.out_behavior=CubicVR.parseEnum(enums.envelope.behavior,obj_init.out_behavior || obj_init.outBehavior || obj_init.behavior) || enums.envelope.behavior.CONSTANT;
}else{
this.in_behavior=enums.envelope.behavior.CONSTANT;
this.out_behavior=enums.envelope.behavior.CONSTANT;
}
}
Envelope.prototype={
setBehavior:function(in_b,out_b){
this.in_behavior=CubicVR.parseEnum(enums.envelope.behavior,in_b);
this.out_behavior=CubicVR.parseEnum(enums.envelope.behavior,out_b);
},empty:function(){
return (this.nKeys === 0);
},addKey:function(time,value,key_init){
var tempKey;
var obj=(typeof (time) == 'object')?time:key_init;
if(!value) value=0;
if(!time) time=0;
if(obj){
obj=time;
time=obj.time;
tempKey=this.insertKey(time);
tempKey.value=obj.value?obj.value:value;
tempKey.time=obj.time?obj.time:time;
tempKey.shape=CubicVR.parseEnum(enums.envelope.shape,obj.shape) || enums.envelope.shape.TCB;
tempKey.tension=obj.tension?obj.tension:0;
tempKey.continuity=obj.continuity?obj.continuity:0;
tempKey.bias=obj.bias?obj.bias:0;
tempKey.param=obj.param?obj.param:[0,0,0,0];
}else{
tempKey=this.insertKey(time);
tempKey.value=value;
}
return tempKey;
},insertKey:function(time){
var tempKey=new EnvelopeKey();
tempKey.time=time;
if(!this.nKeys){
this.keys=tempKey;
this.firstKey=tempKey;
this.lastKey=tempKey;
this.nKeys++;
return tempKey;
}
var k1=this.keys;
while(k1){
if(this.firstKey.time>time){
this.firstKey=tempKey;
}else if(this.lastKey.time<time){
this.lastKey=tempKey;
}
if(k1.time>tempKey.time){
tempKey.prev=k1.prev;
if(tempKey.prev){
tempKey.prev.next=tempKey;
}
tempKey.next=k1;
tempKey.next.prev=tempKey;
this.nKeys++;
return tempKey;
}else if(!k1.next){
tempKey.prev=k1;
k1.next=tempKey;
this.nKeys++;
return tempKey;
}
k1=k1.next;
}
return null; // you should not be here, time and space has imploded
},evaluate:function(time){
var key0,key1,skey,ekey;
var t,h1,h2,h3,h4,inval,out,offset=0.0;
var noff;
if(this.nKeys === 0){
return 0.0;
}
if(this.nKeys === 1){
return (this.keys).value;
}
skey=this.firstKey;
ekey=this.lastKey;
var tmp,behavior;
if(time<skey.time){
behavior=this.in_behavior;
if(behavior === enums.envelope.behavior.RESET){
return 0.0;
}else if(behavior === enums.envelope.behavior.CONSTANT){
return skey.value;
}else if(behavior === enums.envelope.behavior.REPEAT){
tmp=cubicvr_env_range(time,skey.time,ekey.time);
time=tmp[0];
}else if(behavior === enums.envelope.behavior.OCILLATE){
tmp=cubicvr_env_range(time,skey.time,ekey.time);
time=tmp[0];
noff=tmp[1];
if(noff%2){
time=ekey.time-skey.time-time;
}
}else if(behavior === enums.envelope.behavior.OFFSET){
tmp=cubicvr_env_range(time,skey.time,ekey.time);
time=tmp[0];
noff=tmp[1];
offset=noff*(ekey.value-skey.value);
}else if(behavior === enums.envelope.behavior.LINEAR){
out=cubicvr_env_outgoing(skey,skey.next)/(skey.next.time-skey.time);
return out*(time-skey.time)+skey.value;
}
}else if(time>ekey.time){
behavior=this.out_behavior;
if(behavior === enums.envelope.behavior.RESET){
return 0.0;
}else if(behavior === enums.envelope.behavior.CONSTANT){
return ekey.value;
}else if(behavior === enums.envelope.behavior.REPEAT){
tmp=cubicvr_env_range(time,skey.time,ekey.time);
time=tmp[0];
}else if(behavior === enums.envelope.behavior.OCILLATE){
tmp=cubicvr_env_range(time,skey.time,ekey.time);
time=tmp[0];
noff=tmp[1];
if(noff%2){
time=ekey.time-skey.time-time;
}
}else if(behavior === enums.envelope.behavior.OFFSET){
tmp=cubicvr_env_range(time,skey.time,ekey.time);
time=tmp[0];
noff=tmp[1];
offset=noff*(ekey.value-skey.value);
}else if(behavior === enums.envelope.behavior.LINEAR){
inval=cubicvr_env_incoming(ekey.prev,ekey)/(ekey.time-ekey.prev.time);
return inval*(time-ekey.time)+ekey.value;
}
}
if(this.lastKey0){
if(time>this.lastKey0.time){
key0=this.lastKey0;
}else if(time<this.lastKey0.time){
key0=this.lastKey;
while(time<key0.time && key0.prev){
key0=key0.prev;
}
}else{
key0=this.keys;
}
}else{
key0=this.keys;
}
while(time>key0.next.time){
key0=key0.next;
}
key1=key0.next;
this.lastKey0=key0;
if(time === key0.time){
return key0.value+offset;
}else if(time === key1.time){
return key1.value+offset;
}
t=(time-key0.time)/(key1.time-key0.time);
var keyShape=key1.shape;
if(keyShape === enums.envelope.shape.TCB || keyShape === enums.envelope.shape.BEZI || keyShape === enums.envelope.shape.HERM){
out=cubicvr_env_outgoing(key0,key1);
inval=cubicvr_env_incoming(key0,key1);
var h=cubicvr_env_hermite(t);
return h[0]*key0.value+h[1]*key1.value+h[2]*out+h[3]*inval+offset;
}else if(keyShape === enums.envelope.shape.BEZ2){
return cubicvr_env_bez2(key0,key1,time)+offset;
}else if(keyShape === enums.envelope.shape.LINE){
return key0.value+t*(key1.value-key0.value)+offset;
}else if(keyShape === enums.envelope.shape.STEP){
return key0.value+offset;
}else{
return offset;
}
}
};
function Motion(env_init,key_init){
this.controllers=[];
this.yzflip=false;
if(typeof (env_init) === 'object'){
var obj_init=CubicVR.get(env_init);
this.env_init=CubicVR.get(obj_init.envelope);
this.key_init=CubicVR.get(obj_init.key);
for(var i in obj_init){
if(!obj_init.hasOwnProperty(i)) continue;
if(i === 'envelope' || i === "key") continue;
var controller=obj_init[i];
var controllerEnv=CubicVR.get(controller.envelope);
for(var j in controller){
if(!controller.hasOwnProperty(j)) continue;
if(j === 'envelope' || j === "key") continue;
var motion=controller[j];
if(typeof (motion) === 'object') for(var k in motion){
this.setKey(i,k,j,motion[k]);
if(controllerEnv){
this.setBehavior(i,k,controllerEnv);
}
}
}
}
}else{
this.env_init=env_init;
this.key_init=key_init;
}
}
Motion.prototype={
clone:function(){
var dupe=new base.Motion(this.env_init,this.key_init);
for(var i in this.controllers){
if(this.controllers.hasOwnProperty(i)){
if(dupe.controllers[i] === undef){
dupe.controllers[i]=[];
}
for(var j in this.controllers[i]){
if(this.controllers[i].hasOwnProperty(j)){
var e=this.controllers[i][j];
var d=dupe.controllers[i][j]=new Envelope({
in_behavior:e.in_behavior,out_behavior:e.out_behavior
});
d.nKeys=e.nKeys;
d.keys=e.keys;
d.firstKey=e.firstKey;
d.lastKey=e.lastKey;
}
}
}
}
return dupe;
},envelope:function(controllerId,motionId){
motionId=CubicVR.parseEnum(enums.motion,motionId) || 0;
controllerId=CubicVR.parseEnum(enums.motion,controllerId) || 0;
if(this.controllers[controllerId] === undef){
this.controllers[controllerId]=[];
}
if(this.controllers[controllerId][motionId] === undef){
this.controllers[controllerId][motionId]=new Envelope(this.env_init);
}
return this.controllers[controllerId][motionId];
},evaluate:function(index){
var retArr=[];
for(var i in this.controllers){
if(this.controllers.hasOwnProperty(i)){
retArr[i]=[];
for(var j in this.controllers[i]){
if(this.controllers[i].hasOwnProperty(j)){
retArr[i][j]=this.controllers[i][j].evaluate(index);
}
}
}
}
return retArr;
},apply:function(index,target){
for(var i in this.controllers){
if(this.controllers.hasOwnProperty(i)){
var ic=parseInt(i,10);
if(this.yzflip && ic === enums.motion.ROT) // assume channel 0,1,2
{
if(!this.q){
this.q=new CubicVR.Quaternion();
}
var q=this.q;
var x=this.controllers[i][0].evaluate(index);
var y=this.controllers[i][1].evaluate(index);
var z=this.controllers[i][2].evaluate(index);
q.fromEuler(x,z,-y);
var qr=q.toEuler();
target.control(ic,0,qr[0]);
target.control(ic,1,qr[1]);
target.control(ic,2,qr[2]);
}else{
for(var j in this.controllers[i]){
if(this.controllers[i].hasOwnProperty(j)){
target.control(ic,parseInt(j,10),this.controllers[i][j].evaluate(index));
}
}
}
}
}
},setKey:function(controllerId,motionId,index,value,key_init){
motionId=CubicVR.parseEnum(enums.motion,motionId) || 0;
controllerId=CubicVR.parseEnum(enums.motion,controllerId) || 0;
var ev=this.envelope(controllerId,motionId);
return ev.addKey(index,value,key_init?key_init:this.key_init);
},setArray:function(controllerId,index,value,key_init){
var tmpKeys=[];
controllerId=CubicVR.parseEnum(enums.motion,controllerId) || 0;
for(var i in value){
if(value.hasOwnProperty(i)){
var ev=this.envelope(controllerId,CubicVR.parseEnum(enums.motion,i));
tmpKeys[i]=ev.addKey(index,value[i],key_init?key_init:this.key_init);
}
}
return tmpKeys;
},setBehavior:function(controllerId,motionId,behavior_in,behavior_out){
var ev=this.envelope(controllerId,motionId);
if(typeof (behavior_in) === 'object'){
var obj_init=behavior_in;
behavior_in=obj_init.in_behavior || obj_init.inBehavior || obj_init.behavior;
behavior_out=obj_init.out_behavior || obj_init.outBehavior || obj_init.behavior;
}
motionId=CubicVR.parseEnum(enums.motion,motionId) || 0;
controllerId=CubicVR.parseEnum(enums.motion,controllerId) || 0;
ev.setBehavior(behavior_in,behavior_out);
},setBehaviorArray:function(controllerId,behavior_in,behavior_out){
controllerId=CubicVR.parseEnum(enums.motion,controllerId) || 0;
var controller=this.controllers[controllerId];
for(var motionId in controller){
if(controller.hasOwnProperty(motionId)){
var ev=this.envelope(controllerId,CubicVR.parseEnum(enums.motion,motionId) || 0);
ev.setBehavior(behavior_in,behavior_out);
}
}
}
};
var extend={
Motion:Motion,Envelope:Envelope,EnvelopeKey:EnvelopeKey
};
return extend;
});
CubicVR.RegisterModule("EventHandler",function(base){
var undef=base.undef,enums=CubicVR.enums,GLCore=base.GLCore,aabbMath=CubicVR.aabb,primitives=CubicVR.primitives,mat4=CubicVR.mat4,log=base.log;
enums.event={
TICK:0,MOVE:1,MATRIX_UPDATE:2,  // for matrixLock'd movement event
OCTREE_ADJUST:3,  // maybe lighting can listen for updates?
COLLIDE:4, // for physics.. will probably move these bindings there
CONTACT:5,CONTACT_ADD:6,CONTACT_REMOVE:7,CONTACT_GHOST:8, // Summon evil spirits
RIGID_REST:9,RIGID_AWAKE:10,ENUM_MAX:11
};
function validateEvent(id){
id=CubicVR.parseEnum(enums.event,id);
if(id === undef){
log("For custom events use CubicVR.registerEvent('event_name'); and use the resulting CubicVR.enums.event.EVENT_NAME for type checks and 'event_name' for construction.");
return false;
}
if(!isNaN(parseInt(id,10)) && (id>=enums.event.EVENT_MAX || id<0)){
log("Unknown event ID passed: "+id);
return false;
}
return id;
}
function registerEvent(idName){
idName=idName.toUpperCase();
if(enums.event[idName] !== undef){
log("Error, event '"+idName+"' is already registered.");
return;
}
enums.event[idName]=enums.event.ENUM_MAX;
enums.event.ENUM_MAX++;
}
function Event(obj_init){
obj_init=obj_init || {};
this.name=obj_init.name;
obj_init.id=validateEvent(obj_init.id) || enums.event.TICK;
this.id=obj_init.id;
this.interval=obj_init.interval || 0;
this.enabled=obj_init.enabled || true;
this.action=obj_init.action || null;
this.properties=obj_init.properties || {};
this.event_properties=obj_init.event_properties || {};
this.buffered=obj_init.buffered || false;
this.weight=(obj_init.weight === undef)?-1:obj_init.weight;
this.subject=null;
this.t_sleep=0;
this.t_active=0;
this.t_updatecall=0;
this.t_update=0;
this.t_last=0;
this.t_rest=0;
this.t_resting=0;
this.n_updates=0;
this.break_chain=false;
}
Event.prototype={
getName:function(){
return this.name;
},setName:function(name_in){
this.name=name_in;
},getSubject:function(){
return this.subject;
},setSubject:function(subject){
this.subject=subject;
},getId:function(){
return this.id;
},setId:function(id_in){
this.id=id_in;
},isEnabled:function(){
return this.enabled;
},disable:function(){
this.setEnabled(false);
},enable:function(){
this.setEnabled(true);
},setEnabled:function(enabled){
if(enabled && !this.enabled){
this.t_sleep=0;
this.t_active=0;
this.t_updatecall=0;
this.t_update=0;
this.t_last=0;
this.t_rest=0;
this.t_resting=0;
this.n_updates=0;
this.break_chain=false;
}
this.enabled=enabled;
},isBuffered:function(){
return this.buffered;
},setBuffered:function(buffered){
this.buffered=buffered;
},setInterval:function(interval){
this.interval=interval;
},getInterval:function(){
return this.interval;
},setAction:function(action){
this.action=action;
},getAction:function(){
return this.action;
},getProperties:function(){
return this.properties;
},setProperties:function(properties){
this.properties=properties;
},getProperty:function(propertyName){
return this.properties[propertyName];
},setProperty:function(propertyName,propertyValue){
this.properties[propertyName]=propertyValue;
},setEventProperties:function(properties){
this.event_properties=properties;
},getEventProperties:function(){
return this.event_properties;
},getEventProperty:function(propertyName){
return this.event_properties[propertyName];
},setEventProperty:function(propertyName,propertyValue){
this.properties[propertyName]=propertyValue;
},getTimeSleeping:function(){
return this.t_sleep;
},getTimeActive:function(){
return this.t_active;
},getTimeUpdated:function(){
return this.t_update;
},getSeconds:function(){
return this.getTimeUpdated();
},getRestInterval:function(){
return this.t_rest;
},getLastUpdateSeconds:function(){
return this.t_last;
},setRestInterval:function(interval){
this.t_rest=interval;
},getUpdateCount:function(){
return this.n_updates;
},breakChain:function(bChain){
this.break_chain=true;
},isChainBroken:function(){
return this.break_chain;
},rest:function(interval){
this.setRestInterval(interval || 0);
},awake:function(){
this.t_rest=0;
},update:function(current_time,handler){
if(!this.enabled) return false;
var lastUpdate=0;
var timeChange=true;
if(this.n_updates === 0){
this.t_update=current_time;
this.t_updatecall=current_time;
lastUpdate=1.0/60.0; // default to 1/60 of a sec for first frame -- bad idea/good idea?
}else{
if(current_time !== this.t_update){
if(!this.t_rest){
this.t_last=current_time-this.t_update;
this.t_update=current_time;
}
lastUpdate=current_time-this.t_updatecall;
this.t_updatecall=current_time;
}else{
timeChange=false;
}
}
if(this.t_rest>0){
if(timeChange){
this.t_resting+=lastUpdate;
this.t_rest-=lastUpdate;
if(this.t_rest<0){
this.t_rest=0;
}
}
}else{
if(timeChange){
this.t_active+=this.t_last;
if(!this.t_rest && this.interval){
this.t_rest=this.interval;
}
this.n_updates++;
}
this.callEvent(handler);
return true;
}
if(timeChange){
this.n_updates++;
}
return false;
},callEvent:function(handler){
if(!this.action) return false;
return this.action(this,handler);
}
};
function EventHandler(){
this.events=[];
this.eventProperties=[];
this.eventPropertyCount=[];
this.eventHandled=[];
this.listeners=[];
this.listenerNames=[];
this.eventParameters=[];
}
EventHandler.prototype={
addEvent:function(event){
if(!event.callEvent){
event=new Event(event);
}
var eventId=event.getId();
if(!this.eventProperties[eventId]){
this.eventProperties[eventId]={};
}
this.listeners[eventId]=this.listeners[eventId] || 0;
this.listeners[eventId]++;
this.events.push(event);
if(this.listenerNames.indexOf(eventId) === -1){
this.listenerNames.push(eventId);
}
return event;
},removeEvent:function(event){
if(this.lockState){
if(!this.lockRemovals){
this.lockRemovals=[];
}
if(this.lockRemovals.indexOf(event) == -1){
this.lockRemovals.push(event);
}
return;
}
var idx=this.events.indexOf(event);
if(idx === -1) return;
var eventId=event.getId();
this.events.splice(idx,1);
this.listeners[eventId]--;
if(!this.listeners[eventId]){
this.eventHandled[eventId]=true;
this.eventParameters[eventId]={};
this.eventProperties[eventId]=[];
this.eventPropertyCount[eventId]=0;
var lidx=this.listenerNames.indexOf(eventId);
if(lidx>=0){
this.listenerNames.splice(lidx,1);
}
}
},getProperties:function(eventId){
this.eventParameters[eventId]=this.eventParameters[eventId] || {};
return this.eventParameters[eventId];
},setProperties:function(eventId,params){
this.eventParameters[eventId]=params;
},getProperty:function(eventId,propertyName){
return this.getProperties(eventId)[propertyName];
},setProperty:function(eventId,propertyName,propertyValue){
this.getProperties(eventId)[propertyName]=propertyValue;
},hasEvent:function(eventId){
return !!this.listeners[eventId];
},triggerEvent:function(eventId,properties){
if(!this.listeners[eventId]) return null;
if(this.eventProperties[eventId] == undef){
this.eventProperties[eventId]=[];
}
var ep=this.eventProperties[eventId];
if(this.eventPropertyCount[eventId] === undef){
this.eventPropertyCount[eventId]=0;
}
var ec=this.eventPropertyCount[eventId];
if(ec>20){
console.log("Warning, event "+eventId+" count > 20: "+ec);
}
if(properties && ep){
ep[ec]=properties;
this.eventPropertyCount[eventId]++;
}else{
ep[ec]=ep[ec] || {};
this.eventPropertyCount[eventId]++;
}
this.eventHandled[eventId]=false;
return ep[ec];
},update:function(currentTime){
var i,iMax,j,jMax,event,eventId,eh;
var tickEvent;
if(this.hasEvent(enums.event.TICK) && this.eventPropertyCount[enums.event.TICK] === 0 && !!(tickEvent=this.triggerEvent(enums.event.TICK))){
tickEvent.time=currentTime;
tickEvent.handler=this;  // global tick event belongs to handler
}
this.lockState=true;
for(i=0, iMax=this.events.length; i<iMax; i++){
event=this.events[i];
eventId=event.getId();
var epc=this.eventPropertyCount[eventId];
var handled=false;
var enabled=false;
if(epc){
var ep=this.eventProperties[eventId];
if(event.isEnabled()){
if(event.isBuffered()){ // send all the events as one property and call once
ep.length=epc;
event.setEventProperties(ep);
handled=handled || event.update(currentTime,this);
if(event.isChainBroken()){
event.breakChain(false);
break;
}
}else{  // call the event for each property
for(j=0, jMax=epc; j<jMax; j++){
event.setEventProperties(ep[i]);
handled=handled || event.update(currentTime,this);
if(event.isChainBroken()){
event.breakChain(false);
break;
}
}
}
enabled=true;
}
}
if(handled || !enabled) this.eventHandled[eventId]=true;
}
for(i=0, iMax=this.listenerNames.length; i<iMax; i++){
eventId=this.listenerNames[i];
if(this.eventHandled[eventId]){
this.eventPropertyCount[eventId]=0;
}
}
this.lockState=false;
if(this.lockRemovals && this.lockRemovals.length){
for(i=0, iMax=this.lockRemovals.length; i<iMax; i++){
this.removeEvent(this.lockRemovals[i]);
}
this.lockRemovals.length=0;
}
}
};
var extend={
Event:Event,EventHandler:EventHandler,registerEvent:registerEvent,validateEvent:validateEvent
};
return extend;
});
CubicVR.RegisterModule("Scene",function(base){
var undef=base.undef,enums=base.enums,GLCore=base.GLCore,aabbMath=base.aabb,primitives=base.primitives,mat4=base.mat4;
var scene_object_uuid=0;
function cubicvr_lightPackTypes(a,b){
return a.light_type-b.light_type;
}
function SceneObject(obj,name){
var obj_init=null;
var i,iMax;
if(obj !== undef && obj !== null){
if(obj.compile){
obj_init={};
}else{
obj_init=base.get(obj) || {};
obj=null;
}
}else{
obj_init={};
}
this.morphWeight=obj_init.morphWeight || 0.0;
this.morphSource=obj_init.morphSource || -1;
this.morphTarget=obj_init.morphTarget || -1;
this.position=(obj_init.position === undef)?[0,0,0]:obj_init.position;
this.rotation=(obj_init.rotation === undef)?[0,0,0]:obj_init.rotation;
this.scale=(obj_init.scale === undef)?[1,1,1]:obj_init.scale;
this.shadowCast=(obj_init.shadowCast === undef)?true:obj_init.shadowCast;
this.wireframe=obj_init.wireframe || false;
this.motion=(obj_init.motion === undef)?null:(base.get(obj_init.motion,base.Motion) || null);
this.obj=(!obj_init.mesh)?(obj?base.get(obj,base.Mesh):null):base.get(obj_init.mesh,base.Mesh);
this.name=(obj_init.name === undef)?((name !== undef)?name:null):obj_init.name;
this.properties=base.get(obj_init.properties) || {};
this.children=null;
this.parent=null;
var sceneObjChildren=obj_init.children || obj_init.child || obj_init.sceneObject || obj_init.sceneObjects;
if(sceneObjChildren){
if(sceneObjChildren && !sceneObjChildren.length || typeof (sceneObjChildren) === 'string'){
sceneObjChildren=[sceneObjChildren];
}
if(sceneObjChildren.length){
for(i=0, iMax=sceneObjChildren.length; i<iMax; i++){
this.bindChild(base.get(sceneObjChildren[i],base.SceneObject));
}
}
}
this.drawn_this_frame=false;
this.lposition=[0,0,0];
this.lrotation=[0,0,0];
this.lscale=[0,0,0];
this.lMatrix=mat4.identity();
this.tMatrix=mat4.identity();
this.dirty=true;
this.aabb=[];
this.id= -1;
this.octree_leaves=[];
this.octree_common_root=null;
this.octree_aabb=[[0,0,0],[0,0,0]];
aabbMath.reset(this.octree_aabb,[0,0,0]);
this.ignore_octree=false;
this.visible=true;
this.culled=true;
this.was_culled=true;
this.dynamic_lights=[];
this.static_lights=[];
this.matrixLock=false;
this.instanceMaterials=null;
this.eventHandler=null;
this.duplicateCount=0;
this.independentMotion=false;
}
SceneObject.prototype={
clone:function(){
var i,iMax;
var newName=this.name?(this.name+"_"+this.duplicateCount):null;
this.duplicateCount++;
var dupe=new base.SceneObject({
name:newName,mesh:this.obj,position:this.position.slice(0),rotation:this.rotation.slice(0),scale:this.scale.slice(0),morphWeight:this.morphWeight,morphSource:this.morphSource,morphTarget:this.morphTarget,shadowCast:this.shadowCast,wireframe:this.wireframe,motion:this.motion?this.motion.clone():null
});
if(this.instanceMaterials !== null){
dupe.instanceMaterials=[];
for(i=0, iMax=this.instanceMaterials.length; i<iMax; i++){
dupe.instanceMaterials[i]=this.instanceMaterials[i].clone();
}
}
if(this.children !== null){
for(i=0, iMax=this.children.length; i<iMax; i++){
dupe.bindChild(this.children[i].clone());
}
}
return dupe;
},evaluate:function(index){
var i,iMax;
this.independentMotion=true;
if(this.motion){
this.motion.apply(index,this);
}
if(this.children !== null){
for(i=0, iMax=this.children.length; i<iMax; i++){
this.children[i].evaluate(index);
}
}
},isWireframe:function(){
return this.wireframe;
},setWireframe:function(wireframe_in){
this.wireframe=wireframe_in;
},addEvent:function(event){
if(!this.eventHandler){
this.eventHandler=new base.EventHandler();
}
var newEvent=this.eventHandler.addEvent(event);
newEvent.setSubject(this);
return newEvent;
},removeEvent:function(event){
if(!this.eventHandler){
return;
}
this.eventHandler.removeEvent(event);
},hasEvents:function(){
return !!this.eventHandler;
},getEventHandler:function(){
return this.eventHandler;
},setMesh:function(mesh){
this.obj=mesh;
},getMesh:function(){
return this.obj;
},getProperties:function(){
return this.properties;
},setProperties:function(properties){
this.properties=properties;
},getProperty:function(propertyName){
return this.properties[propertyName];
},setProperty:function(propertyName,propertyValue){
this.properties[propertyName]=propertyValue;
},getInstanceMaterials:function(){
if(!this.obj){
return null;
}
if(this.instanceMaterials){
return this.instanceMaterials;
}
this.instanceMaterials=[];
for(var i=0,iMax=this.obj.materials.length; i<iMax; i++){
this.instanceMaterials[i]=this.obj.materials[i].clone();
}
return this.instanceMaterials;
},getInstanceMaterial:function(materialName){
var mInst=this.getInstanceMaterials();
for(var i=0,iMax=mInst.length; i<iMax; i++){
if(mInst[i].name == materialName){
return mInst[i];
}
}
return null;
},setMorphSource:function(idx){
this.morphSource=idx;
},setMorphTarget:function(idx){
this.morphTarget=idx;
},getMorphSource:function(){
return this.morphSource;
},getMorphTarget:function(){
return this.morphTarget;
},setMorphWeight:function(weight){
this.morphWeight=weight;
},morphTargetCount:function(){
return (this.obj.morphTargets !== null)?this.obj.morphTargets.length:0;
},setMatrixLock:function(mLock){
this.matrixLock=mLock;
},getMatrixLock:function(){
return this.matrixLock;
},setMatrix:function(mat){
if(mat){
this.tMatrix=mat.slice(0);
this.matrixLock=true;
if(this.hasEvents()){
var evh=this.getEventHandler();
if(evh.hasEvent(enums.event.MATRIX_UPDATE)){
var props=evh.triggerEvent(enums.event.MATRIX_UPDATE);
props.matrix=this.tMatrix;
}
}
}else{
this.matrixLock=false;
}
},doTransform:function(mat){
var vec3=base.vec3;
if(!this.matrixLock && (!vec3.equal(this.lposition,this.position) || !vec3.equal(this.lrotation,this.rotation) || !vec3.equal(this.lscale,this.scale) || (mat !== undef))){
if(mat !== undef){
this.tMatrix=mat.slice(0);
}else{
mat4.identity(this.tMatrix);
}
mat4.identity(this.lMatrix);
mat4.translate(this.position[0],this.position[1],this.position[2],this.lMatrix);
mat4.rotate(this.rotation[0],this.rotation[1],this.rotation[2],this.lMatrix);
if(!(this.scale[0] === 1 && this.scale[1] === 1 && this.scale[2] === 1)){
mat4.scale(this.scale[0],this.scale[1],this.scale[2],this.lMatrix);
}
mat4.multiply(this.tMatrix.slice(0),this.lMatrix,this.tMatrix);
this.lposition[0]=this.position[0];
this.lposition[1]=this.position[1];
this.lposition[2]=this.position[2];
this.lrotation[0]=this.rotation[0];
this.lrotation[1]=this.rotation[1];
this.lrotation[2]=this.rotation[2];
this.lscale[0]=this.scale[0];
this.lscale[1]=this.scale[1];
this.lscale[2]=this.scale[2];
this.dirty=true;
if(this.hasEvents()){
var evh=this.getEventHandler();
if(evh.hasEvent(enums.event.MOVE)){
var props=evh.triggerEvent(enums.event.MOVE);
props.oldPosition=this.lposition;
props.position=this.position;
props.oldRotation=this.lrotation;
props.rotation=this.rotation;
props.oldScale=this.lscale;
props.scale=this.scale;
}
}
}
},adjust_octree:function(){
var aabb=this.getAABB();
var taabb=this.octree_aabb;
var px0=aabb[0][0];
var py0=aabb[0][1];
var pz0=aabb[0][2];
var px1=aabb[1][0];
var py1=aabb[1][1];
var pz1=aabb[1][2];
var tx0=taabb[0][0];
var ty0=taabb[0][1];
var tz0=taabb[0][2];
var tx1=taabb[1][0];
var ty1=taabb[1][1];
var tz1=taabb[1][2];
if(this.octree_leaves.length>0 && (px0<tx0 || py0<ty0 || pz0<tz0 || px1>tx1 || py1>ty1 || pz1>tz1)){
for(var i=0; i<this.octree_leaves.length; ++i){
this.octree_leaves[i].remove(this);
} //for
this.octree_leaves=[];
this.static_lights=[];
var common_root=this.octree_common_root;
this.octree_common_root=null;
if(common_root !== null){
while(true){
if(!common_root.contains_point(aabb[0]) || !common_root.contains_point(aabb[1])){
if(common_root._root !== undef && common_root._root !== null){
common_root=common_root._root;
}else{
break;
} //if
}else{
break;
} //if
} //while
aabbMath.reset(this.octree_aabb,this.position);
common_root.insert(this);
} //if
} //if
},bindChild:function(childSceneObj){
if(this.children === null){
this.children=[];
}
childSceneObj.parent=this;
this.children.push(childSceneObj);
},control:function(controllerId,motionId,value){
if(controllerId === enums.motion.POS){
this.position[motionId]=value;
}else if(controllerId === enums.motion.SCL){
this.scale[motionId]=value;
}else if(controllerId === enums.motion.ROT){
this.rotation[motionId]=value;
}
},getAABB:function(){
var mat4=base.mat4;
var vec3=base.vec3;
if(this.dirty){
var p=new Array(8);
this.doTransform();
var aabbMin;
var aabbMax;
if(this.obj){
if(!this.obj.bb){
this.aabb=[vec3.add([-1,-1,-1],this.position),vec3.add([1,1,1],this.position)];
return this.aabb;
}
aabbMin=this.obj.bb[0];
aabbMax=this.obj.bb[1];
}
if(!this.obj || aabbMin === undef || aabbMax === undef){
// if (this.obj.bb.length===0)
this.aabb=[vec3.add([-1,-1,-1],this.position),vec3.add([1,1,1],this.position)];
return this.aabb;
}
var obj_aabb=aabbMin;
var obj_bounds=vec3.subtract(aabbMax,aabbMin);
p[0]=[obj_aabb[0],obj_aabb[1],obj_aabb[2]];
p[1]=[obj_aabb[0],obj_aabb[1],obj_aabb[2]+obj_bounds[2]];
p[2]=[obj_aabb[0]+obj_bounds[0],obj_aabb[1],obj_aabb[2]];
p[3]=[obj_aabb[0]+obj_bounds[0],obj_aabb[1],obj_aabb[2]+obj_bounds[2]];
p[4]=[obj_aabb[0],obj_aabb[1]+obj_bounds[1],obj_aabb[2]];
p[5]=[obj_aabb[0],obj_aabb[1]+obj_bounds[1],obj_aabb[2]+obj_bounds[2]];
p[6]=[obj_aabb[0]+obj_bounds[0],obj_aabb[1]+obj_bounds[1],obj_aabb[2]];
p[7]=[obj_aabb[0]+obj_bounds[0],obj_aabb[1]+obj_bounds[1],obj_aabb[2]+obj_bounds[2]];
var aabbTest;
aabbTest=mat4.vec3_multiply(p[0],this.tMatrix);
aabbMin=[aabbTest[0],aabbTest[1],aabbTest[2]];
aabbMax=[aabbTest[0],aabbTest[1],aabbTest[2]];
for(var i=1; i<8; ++i){
aabbTest=mat4.vec3_multiply(p[i],this.tMatrix);
if(aabbMin[0]>aabbTest[0]){
aabbMin[0]=aabbTest[0];
}
if(aabbMin[1]>aabbTest[1]){
aabbMin[1]=aabbTest[1];
}
if(aabbMin[2]>aabbTest[2]){
aabbMin[2]=aabbTest[2];
}
if(aabbMax[0]<aabbTest[0]){
aabbMax[0]=aabbTest[0];
}
if(aabbMax[1]<aabbTest[1]){
aabbMax[1]=aabbTest[1];
}
if(aabbMax[2]<aabbTest[2]){
aabbMax[2]=aabbTest[2];
}
}
this.aabb[0]=aabbMin;
this.aabb[1]=aabbMax;
this.dirty=false;
}
return this.aabb;
}
};
var sceneUUID=0;
function Scene(width,height,fov,nearclip,farclip,octree){
var i,iMax;
this.frames=0;
this.sceneObjects=[];
this.sceneObjectsByName=[];
this.sceneObjectsById=[];
this.lights=[];
this.global_lights=[];
this.dynamic_lights=[];
this.pickables=[];
this.stats=[];
this.cameras=[];
this.camerasByName=[];
this.collect_stats=false;
this.shadows_updated=false;
if(typeof (width) === "object" || typeof (width) === 'string'){
var options=base.get(width);
this.octree=options.octree;
this.skybox=options.skybox || null;
this.name=options.name || "scene"+sceneUUID;
this.wireframe=options.wireframe || false;
this.destroy=options.destroy || function(){};
this.update=options.update || function(){};
this.enable=options.enable || function(){};
this.disable=options.disable || function(){};
var returnOptions=options.setup && options.setup(this) || {};
this.update=returnOptions.update || this.update;
this.enable=returnOptions.enable || this.enable;
this.disable=returnOptions.disable || this.disable;
this.destroy=returnOptions.destroy || this.destroy;
var sceneObjs=options.sceneObjects || options.sceneObject || options.objects;
if(sceneObjs && !sceneObjs.length || typeof (sceneObjs) === 'string'){
sceneObjs=[sceneObjs];
}
if(sceneObjs && sceneObjs.length){
for(i=0, iMax=sceneObjs.length; i<iMax; i++){
this.bindSceneObject(base.get(sceneObjs[i],base.SceneObject));
}
}
var sceneLights=options.lights || options.light;
if(sceneLights && !sceneLights.length || typeof (sceneLights) === 'string'){
sceneLights=[sceneLights];
}
if(sceneLights && sceneLights.length){
for(i=0, iMax=sceneLights.length; i<iMax; i++){
this.bindLight(base.get(sceneLights[i],base.Light));
}
}
var sceneCameras=options.cameras || options.camera;
if(sceneCameras && !sceneCameras.length || typeof (sceneCameras) === 'string'){
sceneCameras=[sceneCameras];
}
if(sceneCameras && sceneCameras.length){
for(i=0, iMax=sceneCameras.length; i<iMax; i++){
this.bindCamera(base.get(sceneCameras[i],base.Camera));
}
this.camera=this.cameras[0];
}
if(!sceneCameras){
this.camera=new base.Camera(options.width,options.height,options.fov,options.nearclip,options.farclip);
}
}else{
this.skybox=null;
this.octree=octree;
this.name="scene"+sceneUUID;
this.camera=new base.Camera(width,height,fov,nearclip,farclip);
this.wireframe=false;
} //if
this.paused=false;
++sceneUUID;
} //Scene
Scene.prototype={
isWireframe:function(){
return this.wireframe;
},setWireframe:function(wireframe_in){
this.wireframe=wireframe_in;
},attachOctree:function(octree){
this.octree=octree;
if(octree.init){
octree.init(this);
} //if
var tmpLights=this.lights;
this.lights=[];
for(var l=0,lMax=tmpLights.length; l<lMax; l++){
this.bindLight(tmpLights[l]);
} //for
var objs=this.sceneObjects;
if(this.octree !== undef){
for(var i=0,oMax=objs.length; i<oMax; ++i){
var obj=objs[i];
if(obj.obj === null){
continue;
}
if(obj.id<0){
obj.id=scene_object_uuid;
++scene_object_uuid;
} //if
this.sceneObjectsById[obj.id]=obj;
aabbMath.reset(obj.octree_aabb,obj.position);
this.octree.insert(obj);
if(obj.octree_common_root === undefined || obj.octree_common_root === null){
log("!!",obj.name,"octree_common_root is null");
} //if
} //for
} //if
},setSkyBox:function(skybox){
this.skybox=skybox;
},getSceneObject:function(name){
return this.sceneObjectsByName[name];
},bindSceneObject:function(sceneObj,pickable,use_octree){
if(this.sceneObjects.indexOf(sceneObj) != -1){
return;
}
this.sceneObjects.push(sceneObj);
if(pickable !== undef){
if(pickable){
this.pickables.push(sceneObj);
}
}
if(sceneObj.name !== null){
this.sceneObjectsByName[sceneObj.name]=sceneObj;
}
if(this.octree !== undef && (use_octree === undef || use_octree === "true")){
if(sceneObj.id<0){
sceneObj.id=scene_object_uuid;
++scene_object_uuid;
} //if
this.sceneObjectsById[sceneObj.id]=sceneObj;
aabbMath.reset(sceneObj.octree_aabb,sceneObj.position);
this.octree.insert(sceneObj);
} //if
if(sceneObj.children){
for(var i=0,iMax=sceneObj.children.length; i<iMax; i++){
this.bindSceneObject(sceneObj.children[i],pickable,use_octree);
}
}
return sceneObj;
},removeLight:function(light){
var idx=this.lights.indexOf(light);
if(idx>=0){
this.lights.splice(idx,1);
}
},removeSceneObject:function(sceneObj){
var idx;
if(this.lockState){
if(!this.lockRemovals){
this.lockRemovals=[];
}
if(this.lockRemovals.indexOf(sceneObj) == -1){
this.lockRemovals.push(sceneObj);
}
return;
}
idx=this.sceneObjects.indexOf(sceneObj);
if(idx>=0){
this.sceneObjects.splice(idx,1);
}
idx=this.pickables.indexOf(sceneObj);
if(idx>=0){
this.pickables.splice(idx,1);
}
if(sceneObj.name !== null){
if(this.sceneObjectsByName[sceneObj.name] !== undef){
delete (this.sceneObjectsByName[sceneObj.name]);
}
}
if(sceneObj.children){
for(var i=0,iMax=sceneObj.children.length; i<iMax; i++){
this.removeSceneObject(sceneObj.children[i]);
}
}
},bindLight:function(lightObj,use_octree){
this.lights.push(lightObj);
if(this.octree !== undef && (use_octree === undef || use_octree === "true")){
if(lightObj.method === enums.light.method.GLOBAL){
this.global_lights.push(lightObj);
}else{
if(lightObj.method === enums.light.method.DYNAMIC){
this.dynamic_lights.push(lightObj);
} //if
this.octree.insert_light(lightObj);
} //if
} //if
this.lights=this.lights.sort(cubicvr_lightPackTypes);
},bindCamera:function(cameraObj){
if(this.cameras.indexOf(cameraObj) === -1){
this.cameras.push(cameraObj);
this.camerasByName[cameraObj.name]=cameraObj;
}
this.camera=cameraObj;
},removeCamera:function(cameraObj){  //todo: this
if(typeof (cameraObj) !== 'object'){
cameraObj=this.getCamera(camName);
}
if(this.cameras.indexOf(cameraObj) === -1){
this.cameras.push(cameraObj);
this.camerasByName[cameraObj.name]=cameraObj;
}
return cameraObj;
},bind:function(obj){
if(obj instanceof base.Light){
this.bindLight(obj);
}else if(obj instanceof base.SceneObject){
this.bindSceneObject(obj);
}else if(obj instanceof base.Camera){
this.bindCamera(obj);
}else if(obj instanceof base.Vehicle){
obj.bindToScene(this);
}else if(obj instanceof base.RigidBody){
this.bindSceneObject(obj.getSceneObject());
}
},remove:function(obj){
if(obj instanceof base.Light){
this.removeLight(obj);
}else if(obj instanceof base.SceneObject){
this.removeSceneObject(obj);
}else if(obj instanceof base.Camera){
this.removeCamera(obj);
}else if(obj instanceof bsae.RigidBody){
this.removeSceneObject(obj.getSceneObject());
}
},setCamera:function(cameraObj){
if(!cameraObj) return;
if(typeof (cameraObj) !== 'object'){
cameraObj=this.getCamera(cameraObj);
}
this.camera=cameraObj;
},getCamera:function(camName){
if(camName === undef){
return this.camera;
}
return this.camerasByName[camName];
},evaluate:function(index){
var i,iMax;
for(i=0, iMax=this.sceneObjects.length; i<iMax; i++){
if(!(this.sceneObjects[i].motion) || this.sceneObjects[i].independentMotion){
continue;
}
this.sceneObjects[i].motion.apply(index,this.sceneObjects[i]);
}
if(this.camera.motion !== null){
if(this.camera.targetSceneObject !== null){
this.camera.target=this.camera.targetSceneObject.position;
}
this.camera.motion.apply(index,this.camera);
}
for(i=0, iMax=this.lights.length; i<iMax; i++){
var l=this.lights[i];
if(l.motion !== null){
l.motion.apply(index,l);
}
}
},prepareTransforms:function(sceneObj){
var i,iMax;
if(!sceneObj){
if(this.sceneObjects.length === 0) return;
for(i=0, iMax=this.sceneObjects.length; i<iMax; ++i){
this.prepareTransforms(this.sceneObjects[i]);
}
}else{
sceneObj.doTransform();
if(sceneObj.children){
for(i=0, iMax=sceneObj.children.length; i<iMax; i++){
sceneObj.children[i].doTransform(sceneObj.tMatrix);
this.prepareTransforms(sceneObj.children[i]);
}
}
}
},updateShadows:function(skip_transform){
var gl=GLCore.gl;
var sflip=false;
skip_transform=skip_transform || false;
if(this.shadows_updated){
return false;
}else{
if(!skip_transform){
this.doTransform();
}
this.shadows_updated=true;
}
if(!base.features.lightShadows) return;
var currentBuffer=gl.getParameter(gl.FRAMEBUFFER_BINDING);
var has_shadow=false;
var dims=gl.getParameter(gl.VIEWPORT);
for(var l=0,lMax=this.lights.length; l<lMax; l++){
var light=this.lights[l];
if((light.light_type == enums.light.type.SPOT_SHADOW) || (light.light_type == enums.light.type.SPOT_SHADOW_PROJECTOR) || (light.light_type == enums.light.type.AREA)){
has_shadow=true;
var lDepthPack=[new base.Light(enums.light.type.DEPTH_PACK)];
if((light.light_type === enums.light.type.AREA)){
light.areaCam=this.camera;
light.updateAreaLight();
}
GLCore.shadow_near=light.dummyCam.nearclip;
GLCore.shadow_far=light.dummyCam.farclip;
light.shadowBegin();
for(var i=0,iMax=this.sceneObjects.length; i<iMax; i++){
var scene_object=this.sceneObjects[i];
if(scene_object.parent){
continue;
} //if
if(scene_object.visible === false || scene_object.shadowCast === false){
continue;
} //if
this.renderSceneObject(scene_object,light.dummyCam,lDepthPack,false,true);
} //for i
light.shadowEnd();
if(currentBuffer){
gl.bindFramebuffer(gl.FRAMEBUFFER,currentBuffer);
}
} //if shadowed
} // for l
if(has_shadow){
gl.viewport(dims[0],dims[1],dims[2],dims[3]);
}
},updateCamera:function(){
var gl=GLCore.gl;
if(this.camera.manual === false){
if(this.camera.targeted){
this.camera.lookat(this.camera.position[0],this.camera.position[1],this.camera.position[2],this.camera.target[0],this.camera.target[1],this.camera.target[2],0,1,0);
}else{
this.camera.calcProjection();
}
}
GLCore.depth_alpha_near=this.camera.nearclip;
GLCore.depth_alpha_far=this.camera.farclip;
},resize:function(w_in,h_in){
if(this.camera){
this.camera.setDimensions(w_in,h_in);
}
},doTransform:function(){
var use_octree=this.octree !== undef;
for(var i=0,iMax=this.sceneObjects.length; i<iMax; i++){
var scene_object=this.sceneObjects[i];
if(scene_object.parent !== null){
continue;
} //if
this.prepareTransforms(scene_object);
if(use_octree){
lights=[];
if(scene_object.dirty && scene_object.obj !== null){
scene_object.adjust_octree();
} //if
if(scene_object.visible === false || (use_octree && (scene_object.ignore_octree || scene_object.drawn_this_frame === true || scene_object.culled === true))){
continue;
} //if
lights=scene_object.dynamic_lights;
lights=lights.concat(scene_object.static_lights);
lights=lights.concat(this.global_lights);
if(this.collect_stats){
this.lights_rendered=Math.max(lights.length,this.lights_rendered);
if(this.lights_rendered === lights.length){
lights_list=lights;
} //if
++this.objects_rendered;
} //if
if(lights.length === 0){
lights=[GLCore.emptyLight];
}else{
lights=lights.sort(cubicvr_lightPackTypes);
} //if
scene_object.drawn_this_frame=true;
}else if(scene_object.visible === false){
continue;
} //if
}
},renderSceneObject:function(sceneObj,camera,lights,renderChildren,skip_trans,skip_solid,transparencies){
var sflip=false;
var gl=GLCore.gl;
renderChildren=(renderChildren !== undef) && renderChildren;
skip_trans=skip_trans || false;
skip_solid=skip_solid || false;
if(sceneObj.visible && sceneObj.obj){
if(sceneObj.scale[0]<0){
sflip= !sflip;
}
if(sceneObj.scale[1]<0){
sflip= !sflip;
}
if(sceneObj.scale[2]<0){
sflip= !sflip;
}
if(sflip){
gl.cullFace(gl.FRONT);
}
var mesh=sceneObj.obj;
if(mesh.morphTargets !== null){
if(sceneObj.morphSource !== -1) mesh.setMorphSource(sceneObj.morphSource);
if(sceneObj.morphTarget !== -1) mesh.setMorphTarget(sceneObj.morphTarget);
if(sceneObj.morphWeight !== null) mesh.morphWeight=sceneObj.morphWeight;
}
if(sceneObj.instanceMaterials){
mesh.bindInstanceMaterials(sceneObj.instanceMaterials);
}
if(base.renderObject(mesh,camera,sceneObj.tMatrix,lights,skip_trans,skip_solid,this.isWireframe() || sceneObj.isWireframe()) && transparencies){
transparencies.push(sceneObj);
}
if(sceneObj.instanceMaterials){
mesh.bindInstanceMaterials(null);
}
if(sflip){
gl.cullFace(gl.BACK);
}
sflip=false;
} //if
var children=sceneObj.children;
if(renderChildren && children){
for(var i=0,iMax=children.length; i<iMax; i++){
var childObj=children[i];
this.renderSceneObject(childObj,camera,lights,true,skip_trans,skip_solid,transparencies);
}
} //if
},runEvents:function(currentTime){
var i,iMax;
this.lockState=true;
if(!!currentTime.getSeconds){
currentTime=currentTime.getSeconds();
}
for(i=0, iMax=this.sceneObjects.length; i<iMax; i++){
var scene_object=this.sceneObjects[i];
if(scene_object.hasEvents()){
scene_object.getEventHandler().update(currentTime);
}
}
this.lockState=false;
if(this.lockRemovals){
for(i=0, iMax=this.lockRemovals.length; i<iMax; i++){
this.removeSceneObject(this.lockRemovals[i]);
}
}
this.lockRemovals=null;
},render:function(options){
++this.frames;
options=options || {};
if(options.postProcess){
options.postProcess.begin(!options.postBuffer);  // true to clear accumulation buffer
}
var gl=GLCore.gl;
var frustum_hits;
var use_octree=this.octree !== undef;
this.lights_rendered=0;
if(use_octree){
//                } //for
this.octree.reset_node_visibility();
this.octree.cleanup();
frustum_hits=this.octree.get_frustum_hits(this.camera);
this.lights_rendered=frustum_hits.lights.length;
} //if
this.doTransform();
this.updateCamera();
this.updateShadows(true);
this.shadows_updated=false;
var i,iMax;
for(i=0, iMax=this.lights.length; i<iMax; i++){
var light=this.lights[i];
light.prepare(this.camera);
}
this.objects_rendered=0;
var lights_list=[];
var transparencies=[];
var lights=this.lights;
for(i=0, iMax=this.sceneObjects.length; i<iMax; i++){
var scene_object=this.sceneObjects[i];
if(scene_object.visible === false || scene_object.parent !== null){
continue;
} //if
this.renderSceneObject(scene_object,this.camera,lights,true,true,false,transparencies);
} //for
for(i=0, iMax=transparencies.length; i<iMax; i++){
this.renderSceneObject(transparencies[i],this.camera,lights,false,false,true);
}
if(this.collect_stats){
this.stats['objects.num_rendered']=this.objects_rendered;
this.stats['lights.num_rendered']=this.lights_rendered;
this.stats['lights.rendered']=lights_list;
this.stats['lights.num_global']=this.global_lights.length;
this.stats['lights.num_dynamic']=this.dynamic_lights.length;
} //if
if(this.skybox !== null && this.skybox.ready === true){
gl.cullFace(gl.FRONT);
var size=(this.camera.farclip*2)/Math.sqrt(3.0);
if(this.camera.parent){
this.skybox.scene_object.position=mat4.vec3_multiply(this.camera.position,this.camera.parent.tMatrix);
}else{
this.skybox.scene_object.position=[this.camera.position[0],this.camera.position[1],this.camera.position[2]];
}
this.skybox.scene_object.scale=[size,size,size];
this.skybox.scene_object.doTransform();
base.renderObject(this.skybox.scene_object.obj,this.camera,this.skybox.scene_object.tMatrix,[]);
gl.cullFace(gl.BACK);
} //if
if(options.postProcess){
options.postProcess.end();
if(!options.postBuffer){
options.postProcess.render();
}
}
},bbRayTest:function(pos,ray,axisMatch){
var vec3=base.vec3;
var pt1,pt2;
var selList=[];
if(ray.length === 2){
ray=this.camera.unProject(ray[0],ray[1]);
}else{
ray=vec3.add(pos,ray);
}
pt1=pos;
pt2=ray;
for(var obj_i in this.pickables){
if(this.pickables.hasOwnProperty(obj_i)){
var obj=this.pickables[obj_i];
if(obj.visible !== true) continue;
var bb1,bb2;
var aabb=obj.getAABB();
bb1=aabb[0];
bb2=aabb[1];
var mindepth=0.2;
if(bb2[0]-bb1[0]<mindepth){
bb1[0]-=mindepth/2;
bb2[0]+=mindepth/2;
}
if(bb2[1]-bb1[1]<mindepth){
bb1[1]-=mindepth/2;
bb2[1]+=mindepth/2;
}
if(bb2[2]-bb1[2]<mindepth){
bb1[2]-=mindepth/2;
bb2[2]+=mindepth/2;
}
var center=vec3.multiply(vec3.add(bb1,bb2),0.5);
var testPt=vec3.getClosestTo(pt1,pt2,center);
var testDist=vec3.length(vec3.subtract(testPt,center));
var matches=((testPt[0]>=bb1[0] && testPt[0]<=bb2[0])?1:0)+((testPt[1]>=bb1[1] && testPt[1]<=bb2[1])?1:0)+((testPt[2]>=bb1[2] && testPt[2]<=bb2[2])?1:0);
if(matches>=axisMatch){
selList.push({
dist:testDist,obj:obj
});
}
}
}
if(selList.length){
selList.sort(function(a,b){
if(a.dist == b.dist) return 0;
return (a.dist<b.dist)?-1:1;
});
}
return selList;
}
};
function DeferredBin(){
this.meshBin={};
this.imageBin={};
this.meshMap={};
this.imageMap={};
this.imageBinPtr={};
this.meshBinPtr={};
}
DeferredBin.prototype={
addMesh:function(binId,meshId,meshObj){
if(this.meshBin[binId] === undef){
this.meshBin[binId]=[];
if(this.meshBinPtr[binId] === undef){
this.meshBinPtr[binId]=0;
}
}
if(this.meshMap[meshId] === undef){
this.meshMap[meshId]=meshObj;
this.meshBin[binId].push(meshObj);
}
},addImage:function(binId,imageId,imageObj){
if(this.imageBin[binId] === undef){
this.imageBin[binId]=[];
if(this.imageBinPtr[binId] === undef){
this.imageBinPtr[binId]=0;
}
}
if(this.imageMap[imageId] === undef){
this.imageMap[imageId]=imageObj;
this.imageBin[binId].push(imageObj);
}
},getMeshes:function(binId){
return this.meshBin[binId];
},getImages:function(binId){
return this.imageBin[binId];
},rewindMeshes:function(binId){
this.meshBinPtr[binId]=0;
},rewindImages:function(binId){
this.imageBinPtr[binId]=0;
},getNextMesh:function(binId){
var cBin=this.meshBinPtr[binId];
if(cBin<this.meshBin[binId].length){
this.meshBinPtr[binId]++;
return this.meshBin[binId][cBin];
}
return null;
},loadNextMesh:function(binId){
var mesh=this.getNextMesh(binId);
if(mesh !== null){
if(mesh.compiled === null){
mesh.triangulateQuads();
mesh.compile();
mesh.clean();
}
return true;
}
return false;
},isMeshBinEmpty:function(binId){
return this.meshBinPtr[binId] === this.meshBin[binId].length;
},loadNextImage:function(binId){
var img=this.getNextImage(binId);
if(img !== null){
img.src=img.deferredSrc;
}
},getNextImage:function(binId){
var cBin=this.imageBinPtr[binId];
if(cBin<this.imageBin[binId].length){
this.imageBinPtr[binId]++;
return this.imageBin[binId][cBin];
}
return null;
},isImageBinEmpty:function(binId){
return this.imageBinPtr[binId] === this.imageBin[binId].length;
}
};
function SkyBox(in_obj){
var texture=in_obj.texture;
var mapping=in_obj.mapping;
var that=this;
this.mapping=null;
this.ready=false;
this.texture=null;
this.onready=function(){
texture.onready=null;
var tw=1/base.Images[that.texture.tex_id].width;
var th=1/base.Images[that.texture.tex_id].height;
if(that.mapping === null){
that.mapping=[[1/3,0.5,2/3-tw,1], //top
[0,0.5,1/3,1], //bottom
[0,0,1/3-tw,0.5], //left
[2/3,0,1,0.5], //right
[2/3+tw,0.5,1,1], //front
[1/3,0,2/3,0.5]]; //back
} //if
var mat=new base.Material({
name:"skybox",textures:{
color:texture
},noFog:true
});
var obj=new base.Mesh();
obj.sky_mapping=that.mapping;
base.primitives.box({
mesh:obj,size:1.0,material:mat,uvmapper:{
projectionMode:base.enums.uv.projection.SKY,scale:[1,1,1]
}
});
obj.prepare();
that.scene_object=new base.SceneObject(obj);
that.ready=true;
}; //onready
if(texture){
if(typeof (texture) === "string"){
texture=new base.Texture(texture,null,null,null,this.onready);
}else if(!texture.loaded){
texture.onready=this.onready;
} //if
this.texture=texture;
if(mapping){
this.mapping=mapping;
this.onready();
} //if
} //if
} //cubicvr_SkyBox::Constructor
var extend={
Scene:Scene,SceneObject:SceneObject,SkyBox:SkyBox,DeferredBin:DeferredBin
};
return extend;
});
CubicVR.RegisterModule("PostProcess",function(base){
var undef=base.undef;
var GLCore=base.GLCore;
var enums=CubicVR.enums;
var makeFSQuad,destroyFSQuad,renderFSQuad;
enums.post={
output:{
REPLACE:0,BLEND:1,ADD:2,ALPHACUT:3
}
};
var postProcessDivisorBuffers=[];
var postProcessDivisorQuads=[];
function PostProcessShader(shaderInfo){
if(shaderInfo.shader_vertex === undef){
return null;
}
if(shaderInfo.shader_fragment === undef){
return null;
}
this.outputMode=(shaderInfo.outputMode === undef)?enums.post.output.REPLACE:CubicVR.parseEnum(CubicVR.enums.post.output,shaderInfo.outputMode);
this.onresize=(shaderInfo.onresize === undef)?null:shaderInfo.onresize;
this.onupdate=(shaderInfo.onupdate === undef)?null:shaderInfo.onupdate;
this.init=(shaderInfo.init === undef)?null:shaderInfo.init;
this.enabled=(shaderInfo.enabled === undef)?true:shaderInfo.enabled;
this.outputDivisor=(shaderInfo.outputDivisor === undef)?1:shaderInfo.outputDivisor;
this.shader=new CubicVR.Shader(shaderInfo.shader_vertex,shaderInfo.shader_fragment);
this.shader.use();
this.shader.addUVArray("aTex");
this.shader.addVertexArray("aVertex");
this.shader.addInt("srcTex",0);
this.shader.addInt("captureTex",1);
this.shader.addVector("texel");
if(this.init !== null){
this.init(this.shader);
}
}
function PostProcessChain(width,height,accum){
var gl=GLCore.gl;
this.width=width;
this.height=height;
this.accum=(accum === undef)?false:true;
this.vTexel=[1.0/this.width,1.0/this.height,0];
this.captureBuffer=new CubicVR.RenderBuffer(width,height,true);
this.bufferA=new CubicVR.RenderBuffer(width,height,false);
this.bufferB=new CubicVR.RenderBuffer(width,height,false);
this.bufferC=new CubicVR.RenderBuffer(width,height,false);
this.accumOpacity=1.0;
this.accumIntensity=0.3;
if(this.accum){
this.accumBuffer=new CubicVR.RenderBuffer(width,height,false);
this.accumBuffer.use();
gl.clearColor(0.0,0.0,0.0,1.0);
gl.clear(gl.COLOR_BUFFER_BIT);
this.blur_shader=new PostProcessShader({
shader_vertex:["attribute vec3 aVertex;","attribute vec2 aTex;","varying vec2 vTex;","void main(void)","{","vTex = aTex;","vec4 vPos = vec4(aVertex.xyz,1.0);","gl_Position = vPos;","}"].join("\n"),
shader_fragment:["#ifdef GL_ES","precision highp float;","#endif","uniform sampler2D srcTex;","varying vec2 vTex;","uniform float opacity;","void main(void)","{ gl_FragColor = vec4(texture2D(srcTex, vTex).rgb, opacity);","}"].join("\n"),
init:function(shader){
shader.addFloat("opacity");
shader.setFloat("opacity",1.0);
}
});
}
this.bufferA.use();
gl.clearColor(0.0,0.0,0.0,1.0);
gl.clear(gl.COLOR_BUFFER_BIT);
this.bufferB.use();
gl.clearColor(0.0,0.0,0.0,1.0);
gl.clear(gl.COLOR_BUFFER_BIT);
this.end();
this.fsQuad=this.makeFSQuad(this.width,this.height);
this.shaders=[];
this.copy_shader=new PostProcessShader({
shader_vertex:["attribute vec3 aVertex;","attribute vec2 aTex;","varying vec2 vTex;","void main(void) {","vTex = aTex;","vec4 vPos = vec4(aVertex.xyz,1.0);","gl_Position = vPos;","}"].join("\n"),shader_fragment:["#ifdef GL_ES","precision highp float;","#endif","uniform sampler2D srcTex;","varying vec2 vTex;","void main(void) {","gl_FragColor = texture2D(srcTex, vTex);","}"].join("\n")
});
this.resize(width,height);
}
PostProcessChain.prototype={
setBlurOpacity:function(opacity){
this.accumOpacity=opacity;
},setBlurIntensity:function(intensity){
this.accumIntensity=intensity;
},makeFSQuad:function(width,height){
var gl=GLCore.gl;
var fsQuad={}; // intentional empty object
var w=width;
var h=height;
var uscale=(width/w);
var vscale=(height/h);
fsQuad.vbo_points=new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,1,0,-1,-1,0,1,1,0]);
fsQuad.vbo_uvs=new Float32Array([0,0,uscale,0,uscale,vscale,0,vscale,0,0,uscale,vscale]);
fsQuad.gl_points=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,fsQuad.gl_points);
gl.bufferData(gl.ARRAY_BUFFER,fsQuad.vbo_points,gl.STATIC_DRAW);
fsQuad.gl_uvs=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,fsQuad.gl_uvs);
gl.bufferData(gl.ARRAY_BUFFER,fsQuad.vbo_uvs,gl.STATIC_DRAW);
return fsQuad;
},destroyFSQuad:function(fsQuad){
var gl=GLCore.gl;
gl.deleteBuffer(fsQuad.gl_points);
gl.deleteBuffer(fsQuad.gl_uvs);
},renderFSQuad:function(shader,fsq){
var gl=GLCore.gl;
shader.use();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,null);
gl.bindBuffer(gl.ARRAY_BUFFER,fsq.gl_points);
gl.vertexAttribPointer(shader.aVertex,3,gl.FLOAT,false,0,0);
gl.enableVertexAttribArray(shader.aVertex);
gl.bindBuffer(gl.ARRAY_BUFFER,fsq.gl_uvs);
gl.vertexAttribPointer(shader.aTex,2,gl.FLOAT,false,0,0);
gl.enableVertexAttribArray(shader.aTex);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,null);
gl.drawArrays(gl.TRIANGLES,0,6);
},addShader:function(shader){
this.shaders[this.shaders.length]=shader;
shader.shader.use();
shader.shader.setVector("texel",this.vTexel);
if(shader.outputDivisor && shader.outputDivisor != 1){
if(postProcessDivisorBuffers[shader.outputDivisor] === undef){
var divw=(this.width/shader.outputDivisor) | 0;
var divh=(this.height/shader.outputDivisor) | 0;
postProcessDivisorBuffers[shader.outputDivisor]=new CubicVR.RenderBuffer(divw,divh,false);
postProcessDivisorQuads[shader.outputDivisor]=this.makeFSQuad(divw,divh);
}
}
},resize:function(width,height){
var gl=GLCore.gl;
this.width=width;
this.height=height;
this.vTexel=[1.0/this.width,1.0/this.height,0];
this.captureBuffer.destroyBuffer();
this.captureBuffer.createBuffer(this.width,this.height,true);
this.bufferA.destroyBuffer();
this.bufferA.createBuffer(this.width,this.height,false);
this.bufferB.destroyBuffer();
this.bufferB.createBuffer(this.width,this.height,false);
this.bufferC.destroyBuffer();
this.bufferC.createBuffer(this.width,this.height,false);
if(this.accum){
this.accumBuffer.destroyBuffer();
this.accumBuffer.createBuffer(this.width,this.height,false);
this.accumBuffer.use();
gl.clearColor(0.0,0.0,0.0,1.0);
gl.clear(gl.COLOR_BUFFER_BIT);
}
for(var p in postProcessDivisorBuffers){
var divw=(this.width/p) | 0;
var divh=(this.height/p) | 0;
postProcessDivisorBuffers[p].destroyBuffer();
postProcessDivisorBuffers[p].createBuffer(divw,divh,false);
this.destroyFSQuad(postProcessDivisorQuads[p]);
postProcessDivisorQuads[p]=this.makeFSQuad(divw,divh);
}
this.inputBuffer=this.bufferA;
this.outputBuffer=this.bufferB;
for(var i=0,iMax=this.shaders.length; i<iMax; i++){
this.shaders[i].shader.use();
this.shaders[i].shader.setVector("texel",this.vTexel);
if(this.shaders[i].onresize !== null){
this.shaders[i].onresize(this.shaders[i].shader,this.width,this.height);
}
}
this.destroyFSQuad(this.fsQuad);
this.fsQuad=this.makeFSQuad(this.width,this.height);
},swap:function(){
var t=this.inputBuffer;
this.inputBuffer=this.outputBuffer;
this.outputBuffer=t;
},begin:function(doClear){
var gl=GLCore.gl;
this.captureBuffer.use();
if(doClear){
if(this.captureBuffer.depth){
gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
}else{
gl.clear(gl.COLOR_BUFFER_BIT);
}
}
},end:function(){
var gl=GLCore.gl;
gl.bindFramebuffer(gl.FRAMEBUFFER,null);
},render:function(){
var gl=GLCore.gl;
var initBuffer=null;
this.captureBuffer.texture.use(gl.TEXTURE1);
this.outputBuffer.use();
this.captureBuffer.texture.use(gl.TEXTURE0);
gl.clearColor(0.0,0.0,0.0,1.0);
gl.clear(gl.COLOR_BUFFER_BIT);
this.renderFSQuad(this.copy_shader.shader,this.fsQuad);
this.end();
var c=0;
for(var i=0,iMax=this.shaders.length; i<iMax; i++){
var s=this.shaders[i];
if(!s.enabled){
continue;
}
this.swap();
this.inputBuffer.texture.use(gl.TEXTURE0);
var o_mode=s.outputMode;
if(o_mode === enums.post.output.REPLACE){
if(s.outputDivisor !== 1){
postProcessDivisorBuffers[s.outputDivisor].use();
}else{
this.outputBuffer.use();
} //if
gl.clearColor(0.0,0.0,0.0,1.0);
gl.clear(gl.COLOR_BUFFER_BIT);
}else if(o_mode === enums.post.output.ADD || o_mode === enums.post.output.BLEND){
if(s.outputDivisor !== 1){
postProcessDivisorBuffers[s.outputDivisor].use();
}else{
this.bufferC.use();
} //if
gl.clearColor(0.0,0.0,0.0,1.0);
gl.clear(gl.COLOR_BUFFER_BIT);
} //if
if(s.onupdate !== null){
s.shader.use();
s.onupdate(s.shader);
} //if
if(s.outputDivisor !== 1){
gl.viewport(0,0,postProcessDivisorBuffers[s.outputDivisor].width,postProcessDivisorBuffers[s.outputDivisor].height);
this.renderFSQuad(s.shader,postProcessDivisorQuads[s.outputDivisor]);
if(s.outputMode === enums.post.output.REPLACE){
this.outputBuffer.use();
postProcessDivisorBuffers[s.outputDivisor].texture.use(gl.TEXTURE0);
gl.viewport(0,0,this.width,this.height);
this.renderFSQuad(this.copy_shader.shader,this.fsQuad);
}else{
gl.viewport(0,0,this.width,this.height);
} //if
}else{
this.renderFSQuad(s.shader,this.fsQuad);
} //if
if(o_mode === enums.post.output.BLEND){
this.swap();
this.outputBuffer.use();
gl.enable(gl.BLEND);
gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
this.inputBuffer.texture.use(gl.TEXTURE0);
if(s.outputDivisor !== 1){
postProcessDivisorBuffers[s.outputDivisor].texture.use(gl.TEXTURE0);
}else{
this.bufferC.texture.use(gl.TEXTURE0);
} //if
this.renderFSQuad(this.copy_shader.shader,this.fsQuad);
gl.disable(gl.BLEND);
}else if(o_mode === enums.post.output.ADD){
this.swap();
this.outputBuffer.use();
gl.enable(gl.BLEND);
gl.blendFunc(gl.ONE,gl.ONE);
if(s.outputDivisor !== 1){
postProcessDivisorBuffers[s.outputDivisor].texture.use(gl.TEXTURE0);
}else{
this.bufferC.texture.use(gl.TEXTURE0);
} //if
this.renderFSQuad(this.copy_shader.shader,this.fsQuad);
gl.disable(gl.BLEND);
} //if
this.end();
c++;
} //for
if(c === 0){
this.captureBuffer.texture.use(gl.TEXTURE0);
}else{
this.outputBuffer.texture.use(gl.TEXTURE0);
} //if
if(this.accum && this.accumOpacity !== 1.0){
this.blur_shader.shader.use();
this.blur_shader.shader.setFloat("opacity",this.accumOpacity);
this.accumBuffer.use();
gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
this.renderFSQuad(this.blur_shader.shader,this.fsQuad);
this.end();
gl.disable(gl.BLEND);
this.renderFSQuad(this.copy_shader.shader,this.fsQuad);
gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
this.blur_shader.shader.use();
this.blur_shader.shader.setFloat("opacity",this.accumIntensity);
this.accumBuffer.texture.use(gl.TEXTURE0);
this.renderFSQuad(this.blur_shader.shader,this.fsQuad);
gl.disable(gl.BLEND);
}else{
this.renderFSQuad(this.copy_shader.shader,this.fsQuad);
}
}
};
function RenderBuffer(width,height,depth_enabled){
this.createBuffer(width,height,depth_enabled);
}
RenderBuffer.prototype={
createBuffer:function(width,height,depth_enabled){
this.fbo=null;
this.depth=null;
this.texture=null;
this.width=parseInt(width,10);
this.height=parseInt(height,10);
var w=this.sizeParam(width);
var h=this.sizeParam(height);
var gl=GLCore.gl;
this.fbo=gl.createFramebuffer();
if(depth_enabled){
this.depth=gl.createRenderbuffer();
}
gl.bindFramebuffer(gl.FRAMEBUFFER,this.fbo);
if(depth_enabled){
gl.bindRenderbuffer(gl.RENDERBUFFER,this.depth);
if(navigator.appVersion.indexOf("Windows") !== -1){
gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h);
gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,this.depth);
}else{
gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_STENCIL,w,h);
gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.RENDERBUFFER,this.depth);
}
}
// }
//   gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
this.texture=new CubicVR.Texture();
gl.bindTexture(gl.TEXTURE_2D,base.Textures[this.texture.tex_id]);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,base.Textures[this.texture.tex_id],0);
gl.bindFramebuffer(gl.FRAMEBUFFER,null);
},destroyBuffer:function(){
var gl=GLCore.gl;
gl.bindFramebuffer(gl.FRAMEBUFFER,null);
gl.deleteRenderbuffer(this.depth);
gl.deleteFramebuffer(this.fbo);
gl.deleteTexture(base.Textures[this.texture.tex_id]);
base.Textures[this.texture.tex_id]=null;
},sizeParam:function(t){
return t;
//
},use:function(){
var gl=GLCore.gl;
gl.bindFramebuffer(gl.FRAMEBUFFER,this.fbo);
}
};
var fsQuad={
make:PostProcessChain.prototype.makeFSQuad,destroy:PostProcessChain.prototype.destroyFSQuad,render:PostProcessChain.prototype.renderFSQuad
};
var exports={
RenderBuffer:RenderBuffer,PostProcessShader:PostProcessShader,PostProcessChain:PostProcessChain,fsQuad:fsQuad
};
return exports;
});
CubicVR.RegisterModule("Layout",function(base){
var undef=base.undef;
var GLCore=base.GLCore;
function View(obj_init){
this.texture=obj_init.texture?obj_init.texture:null;
this.width=obj_init.width?obj_init.width:128;
this.height=obj_init.height?obj_init.height:128;
this.x=obj_init.x?obj_init.x:0;
this.y=obj_init.y?obj_init.y:0;
this.blend=obj_init.blend?obj_init.blend:false;
this.opacity=(typeof (obj_init.opacity) !== 'undefined')?obj_init.opacity:1.0;
this.tint=obj_init.tint?obj_init.tint:[1.0,1.0,1.0];
this.type='view';
this.superView=null;
this.childViews=[];
this.panel=null;
}
View.prototype={
addSubview:function(view){
this.childViews.push(view);
view.superView=this;
},makePanel:function(view){
return this.superView.makePanel(view);
}
};
function Layout(obj_init){
this.texture=obj_init.texture?obj_init.texture:null;
this.width=obj_init.width?obj_init.width:128;
this.height=obj_init.height?obj_init.height:128;
this.x=obj_init.x?obj_init.x:0;
this.y=obj_init.y?obj_init.y:0;
this.blend=obj_init.blend?obj_init.blend:false;
this.opacity=(typeof (obj_init.opacity) !== 'undefined')?obj_init.opacity:1.0;
this.tint=obj_init.tint?obj_init.tint:[1.0,1.0,1.0];
this.type='root';
this.superView=null;
this.childViews=[];
this.setupShader();
this.panel=null;
this.makePanel(this);
}
Layout.prototype={
resize:function(w,h){
this.width=w;
this.height=h;
},setupShader:function(){
this.shader=new CubicVR.PostProcessShader({
shader_vertex:["attribute vec3 aVertex;","attribute vec2 aTex;","varying vec2 vTex;","uniform vec3 screen;","uniform vec3 position;","uniform vec3 size;","void main(void) {","vTex = aTex;","vec4 vPos = vec4(aVertex.xyz,1.0);","vPos.x *= size.x/screen.x;","vPos.y *= size.y/screen.y;","vPos.x += (size.x/screen.x);","vPos.y -= (size.y/screen.y);","vPos.x += (position.x/screen.x)*2.0 - 1.0;","vPos.y -= (position.y/screen.y)*2.0 - 1.0;","gl_Position = vPos;","}"].join("\n"),
shader_fragment:["#ifdef GL_ES","precision highp float;","#endif","uniform sampler2D srcTex;","uniform vec3 tint;","varying vec2 vTex;","void main(void) {","vec4 color = texture2D(srcTex, vTex)*vec4(tint,1.0);","gl_FragColor = color;","}"].join("\n"),
init:function(shader){
shader.setInt("srcTex",0);
shader.addVector("screen");
shader.addVector("position");
shader.addVector("tint");
shader.addVector("size");
}
});
},addSubview:function(view){
this.childViews.push(view);
view.superView=this;
},removeSubview:function(view){
var idx=this.childViews.indexOf(view);
if(idx> -1){
this.childViews.splice(idx,1);
}
},makePanel:function(view){
var gl=CubicVR.GLCore.gl;
var pQuad={}; // intentional empty object
pQuad.vbo_points=new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,1,0,-1,-1,0,1,1,0]);
pQuad.vbo_uvs=new Float32Array([0,0,1,0,1,1,0,1,0,0,1,1]);
pQuad.gl_points=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,pQuad.gl_points);
gl.bufferData(gl.ARRAY_BUFFER,pQuad.vbo_points,gl.STATIC_DRAW);
pQuad.gl_uvs=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,pQuad.gl_uvs);
gl.bufferData(gl.ARRAY_BUFFER,pQuad.vbo_uvs,gl.STATIC_DRAW);
view.panel=pQuad;
},renderPanel:function(view,panel){
var gl=CubicVR.GLCore.gl;
if(!view.texture){
return false;
}
view.texture.use(gl.TEXTURE0);
},renderView:function(view){
if(!view.texture) return;
var gl=CubicVR.GLCore.gl;
var offsetLeft=view.offsetLeft;
var offsetTop=view.offsetTop;
if(!offsetLeft) offsetLeft=0;
if(!offsetTop) offsetTop=0;
var shader=this.shader.shader;
shader.use();
shader.setVector("screen",[this.width,this.height,0]);
shader.setVector("position",[view.x+offsetLeft,view.y+offsetTop,0]);
shader.setVector("size",[view.width,view.height,0]);
shader.setVector("tint",view.tint);
if(view.blend){
gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
}
view.texture.use(gl.TEXTURE0);
gl.drawArrays(gl.TRIANGLES,0,6);
if(view.blend){
gl.disable(gl.BLEND);
gl.blendFunc(gl.ONE,gl.ZERO);
}
},render:function(){
var gl=CubicVR.GLCore.gl;
gl.disable(gl.DEPTH_TEST);
if(this.texture) this.renderView(this);
var stack=[];
var framestack=[];
this.offsetLeft=0;
this.offsetTop=0;
stack.push(this);
var shader=this.shader.shader;
shader.use();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,null);
gl.bindBuffer(gl.ARRAY_BUFFER,this.panel.gl_points);
gl.vertexAttribPointer(shader.uniforms["aVertex"],3,gl.FLOAT,false,0,0);
gl.enableVertexAttribArray(shader.uniforms["aVertex"]);
gl.bindBuffer(gl.ARRAY_BUFFER,this.panel.gl_uvs);
gl.vertexAttribPointer(shader.uniforms["aTex"],2,gl.FLOAT,false,0,0);
gl.enableVertexAttribArray(shader.uniforms["aTex"]);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,null);
while(stack.length){
var view=stack.pop();
this.renderView(view);
if(view.childViews.length){
for(var i=view.childViews.length-1,iMin=0; i>=iMin; i--){
view.childViews[i].offsetLeft=view.x+view.offsetLeft;
view.childViews[i].offsetTop=view.y+view.offsetTop;
stack.push(view.childViews[i]);
}
}
}
gl.disableVertexAttribArray(shader.uniforms["aTex"]);
gl.enable(gl.DEPTH_TEST);
}
};
var extend={
Layout:Layout,View:View
};
return extend;
});
CubicVR.RegisterModule("Primitives",function(base){
var enums=base.enums;
var undef=base.undef;
var GLCore=base.GLCore;
var util=base.util;
var M_TWO_PI=2.0*Math.PI;
var M_HALF_PI=Math.PI/2.0;
function cubicvr_latheObject(obj_in,pointList,lathe_divisions,material,transform,uvmapper){
var mat4=base.mat4;
var vec3=base.vec3;
var slices=[];
var sliceNum;
var up=[0,1,0];
var right=[1,0,0];
var pos=[0,0,0];
var pofs=obj_in.points.length;
var i,j,jMax,k,kMax;
sliceNum=0;
for(i=0; i<M_TWO_PI; i+=(M_TWO_PI/lathe_divisions)){
if(sliceNum === lathe_divisions){
break;
}
right=[Math.cos(i),0,Math.sin(i)];
for(j=0, jMax=pointList.length; j<jMax; j++){
pos=vec3.add(vec3.multiply(right,pointList[j][0]),vec3.multiply(up,pointList[j][1]));
if(slices[sliceNum] === undef){
slices[sliceNum]=[];
}
slices[sliceNum].push(pos);
}
sliceNum++;
}
var m=null;
if(transform !== undef) m=(transform.getResult !== undef)?transform.getResult():transform;
for(j=0; j<lathe_divisions; j++){
for(k=0, kMax=pointList.length; k<kMax; k++){
if(m){
obj_in.addPoint(mat4.vec3_multiply(slices[j][k],m));
}else{
obj_in.addPoint(slices[j][k]);
}
}
}
if(typeof (material) === "string"){
material=new base.Material(material);
}
obj_in.setFaceMaterial(material);
for(k=0; k<lathe_divisions; k++){
for(j=0, jMax=pointList.length-1; j<jMax; j++){
var pt=j+(pointList.length*k);
var pt_r=j+(pointList.length*((k+1)%(lathe_divisions)));
if(vec3.equal(obj_in.points[pofs+pt],obj_in.points[pofs+pt_r])){
obj_in.addFace([pofs+pt+1,pofs+pt_r+1,pofs+pt_r]);
}else if(vec3.equal(obj_in.points[pofs+pt+1],obj_in.points[pofs+pt_r+1])){
obj_in.addFace([pofs+pt,pofs+pt+1,pofs+pt_r]);
}else{
obj_in.addFace([pofs+pt,pofs+pt+1,pofs+pt_r+1,pofs+pt_r]);
}
}
}
if(uvmapper !== undef){
var uvm=null;
if(uvmapper.apply !== undef){
uvm=uvmapper;
}else if(uvmapper){
uvm=new base.UVMapper(uvmapper);
}
if(uvm !== null){
obj_in.calcFaceNormals();
uvm.apply(obj_in,material);
}
}
}
function cubicvr_planeObject(mesh,size,mat,transform,uvmapper){
var mat4=base.mat4;
var half_size=size*0.5;
var pofs=mesh.points.length;
if(typeof (mat) === "string"){
mat=new base.Material(mat);
}
mesh.setFaceMaterial(mat);
if(transform !== undef){
var m=(transform.getResult !== undef)?transform.getResult():transform;
mesh.addPoint([mat4.vec3_multiply([half_size,-half_size,0],m),mat4.vec3_multiply([half_size,half_size,0],m),mat4.vec3_multiply([-half_size,half_size,0],m),mat4.vec3_multiply([-half_size,-half_size,0],m)]);
}else{
mesh.addPoint([[half_size,-half_size,0],[half_size,half_size,0],[-half_size,half_size,0],[-half_size,-half_size,0]]);
}
mesh.addFace([[pofs+0,pofs+1,pofs+2,pofs+3], //back
[pofs+3,pofs+2,pofs+1,pofs+0]  //front
]);
if(uvmapper !== undef){
var uvm=null;
if(uvmapper.apply !== undef){
uvm=uvmapper;
}else if(uvmapper){
uvm=new base.UVMapper(uvmapper);
}
if(uvm !== null){
mesh.calcFaceNormals();
uvm.apply(mesh,mat);
}
}
} //cubicvr_planeObject
function cubicvr_boxObject(boxObj,box_size,box_mat,transform,uvmapper){
var mat4=base.mat4;
var half_boxx,half_boxy,half_boxz;
if(typeof (box_size) === 'object'){
half_boxx=box_size[0]/2;
half_boxy=box_size[1]/2;
half_boxz=box_size[2]/2;
}else{
half_boxx=half_boxy=half_boxz=box_size/2.0;
}
var pofs=boxObj.points.length;
if(typeof (box_mat) === "string"){
box_mat=new base.Material(box_mat);
}
boxObj.setFaceMaterial(box_mat);
if(transform !== undef){
var m=(transform.getResult !== undef)?transform.getResult():transform;
boxObj.addPoint([mat4.vec3_multiply([half_boxx,-half_boxy,half_boxz],m),mat4.vec3_multiply([half_boxx,half_boxy,half_boxz],m),mat4.vec3_multiply([-half_boxx,half_boxy,half_boxz],m),mat4.vec3_multiply([-half_boxx,-half_boxy,half_boxz],m),mat4.vec3_multiply([half_boxx,-half_boxy,-half_boxz],m),mat4.vec3_multiply([half_boxx,half_boxy,-half_boxz],m),mat4.vec3_multiply([-half_boxx,half_boxy,-half_boxz],m),mat4.vec3_multiply([-half_boxx,-half_boxy,-half_boxz],m)]);
}else{
boxObj.addPoint([[half_boxx,-half_boxy,half_boxz],[half_boxx,half_boxy,half_boxz],[-half_boxx,half_boxy,half_boxz],[-half_boxx,-half_boxy,half_boxz],[half_boxx,-half_boxy,-half_boxz],[half_boxx,half_boxy,-half_boxz],[-half_boxx,half_boxy,-half_boxz],[-half_boxx,-half_boxy,-half_boxz]]);
}
boxObj.addFace([[pofs+0,pofs+1,pofs+2,pofs+3],[pofs+7,pofs+6,pofs+5,pofs+4],[pofs+4,pofs+5,pofs+1,pofs+0],[pofs+5,pofs+6,pofs+2,pofs+1],[pofs+6,pofs+7,pofs+3,pofs+2],[pofs+7,pofs+4,pofs+0,pofs+3]]);
if(uvmapper !== undef){
var uvm=null;
if(uvmapper.apply !== undef){
uvm=uvmapper;
}else if(uvmapper){
uvm=new base.UVMapper(uvmapper);
}
if(uvm !== null){
boxObj.calcFaceNormals();
uvm.apply(boxObj,box_mat);
}
}
}
function cubicvr_torusObject(mesh,inner_radius,outer_radius,lon,lat,material,transform,uvmapper){
var pointList=[],thick=outer_radius-inner_radius,radius=inner_radius+(thick)/2.0;
var step=(M_TWO_PI/lat),theta=0;
for(var i=0; i<=lat; i++){
pointList.push([radius+Math.cos(theta)*thick,Math.sin(theta)*thick,0]);
theta+=step;
}
base.genLatheObject(mesh,pointList,lon,material,transform,uvmapper);
}
function cubicvr_coneObject(mesh,baseSize,height,lon,material,transform,uvmapper){
base.genLatheObject(mesh,[[0,-height/2,0],[baseSize/2.0,-height/2,0],[0,height/2,0]],lon,material,transform,uvmapper);
}
function cubicvr_cylinderObject(mesh,radius,height,lon,material,transform,uvmapper){
base.genLatheObject(mesh,[[0,-height/2,0],[radius,-height/2,0],[radius,height/2,0],[0,height/2,0]],lon,material,transform,uvmapper);
}
function cubicvr_sphereObject(mesh,radius,lon,lat,material,transform,uvmapper){
var pointList=[];
lat=(lat/=2) | 0;
lon=lon | 0;
var step=(Math.PI/lat);
var theta=-M_HALF_PI;
for(var i=0; i<=lat; i++){
pointList.push([Math.cos(theta)*radius,Math.sin(theta)*radius,0]);
theta+=step;
}
base.genLatheObject(mesh,pointList,lon,material,transform,uvmapper);
}
function parseMaterial(mat){
if(typeof (mat) === 'string'){
mat=base.get(mat,base.Material);
}
if(mat === undef){
return new base.Material();
}
if(mat.use){
return mat;
}else if(typeof (mat) === 'object'){
return new base.Material(mat);
}else{    // TODO: support #reference syntax
return new base.Material();
}
}
function parseTransform(t){
if(t === undef) return undef;
if(typeof (t) === 'array'){
return t;
}
if(typeof (t) === 'object'){
if(!!t.getResult){
return t.getResult();
}else if(!!t.position || !!t.rotation || !!t.scale){
return base.mat4.transform(t.position,t.rotation,t.scale);
}else{
return undef;
}
}
}
function parseUV(uv){
if(typeof (uv) === 'string'){
uv=base.get(uv);
}
if(uv === undef){
return undef;
}
if(uv.apply){
return uv;
}else if(typeof (uv) === 'object'){
return new base.UVMapper(uv);
}else{    // TODO: support #reference syntax
return undef;
}
}
var primitives={
lathe:function(obj_init){
var obj_in,material,transform,uvmapper;
var pointList,lathe_divisions;
if(obj_init.points == undef) return null;
obj_in=(obj_init.mesh !== undef)?obj_init.mesh:(new base.Mesh((obj_init.name !== undef)?obj_init.name:undef));
material=parseMaterial(obj_init.material);
transform=parseTransform(obj_init.transform);
uvmapper=parseUV(obj_init.uvmapper || obj_init.uv);
lathe_divisions=(obj_init.divisions !== undef)?obj_init.divisions:24;
cubicvr_latheObject(obj_in,obj_init.points,lathe_divisions,material,transform,uvmapper);
return obj_in;
},box:function(obj_init){
var obj_in,material,transform,uvmapper;
var size;
obj_in=(obj_init.mesh !== undef)?obj_init.mesh:(new base.Mesh((obj_init.name !== undef)?obj_init.name:undef));
material=parseMaterial(obj_init.material);
transform=parseTransform(obj_init.transform);
uvmapper=parseUV(obj_init.uvmapper || obj_init.uv);
size=(obj_init.size !== undef)?obj_init.size:1.0;
cubicvr_boxObject(obj_in,size,material,transform,uvmapper);
return obj_in;
},plane:function(obj_init){
var obj_in,material,transform,uvmapper;
var size;
obj_in=(obj_init.mesh !== undef)?obj_init.mesh:(new base.Mesh((obj_init.name !== undef)?obj_init.name:undef));
material=parseMaterial(obj_init.material);
transform=parseTransform(obj_init.transform);
uvmapper=parseUV(obj_init.uvmapper || obj_init.uv);
size=(obj_init.size !== undef)?obj_init.size:1.0;
cubicvr_planeObject(obj_in,size,material,transform,uvmapper);
return obj_in;
},sphere:function(obj_init){
var obj_in,material,transform,uvmapper;
var radius,lon,lat;
obj_in=(obj_init.mesh !== undef)?obj_init.mesh:(new base.Mesh((obj_init.name !== undef)?obj_init.name:undef));
material=parseMaterial(obj_init.material);
transform=parseTransform(obj_init.transform);
uvmapper=parseUV(obj_init.uvmapper || obj_init.uv);
radius=(obj_init.radius !== undef)?obj_init.radius:1.0;
lon=(obj_init.lon !== undef)?obj_init.lon:24;
lat=(obj_init.lat !== undef)?obj_init.lat:24;
cubicvr_sphereObject(obj_in,radius,lon,lat,material,transform,uvmapper);
return obj_in;
},torus:function(obj_init){
var obj_in,material,transform,uvmapper;
var innerRadius,outerRadius,lon,lat;
obj_in=(obj_init.mesh !== undef)?obj_init.mesh:(new base.Mesh((obj_init.name !== undef)?obj_init.name:undef));
material=parseMaterial(obj_init.material);
transform=parseTransform(obj_init.transform);
uvmapper=parseUV(obj_init.uvmapper || obj_init.uv);
innerRadius=(obj_init.innerRadius !== undef)?obj_init.innerRadius:0.75;
outerRadius=(obj_init.outerRadius !== undef)?obj_init.outerRadius:1.0;
lon=(obj_init.lon !== undef)?obj_init.lon:24;
lat=(obj_init.lat !== undef)?obj_init.lat:24;
cubicvr_torusObject(obj_in,innerRadius,outerRadius,lon,lat,material,transform,uvmapper);
return obj_in;
},cone:function(obj_init){
var obj_in,material,transform,uvmapper;
var baseSize,height,lon;
obj_in=(obj_init.mesh !== undef)?obj_init.mesh:(new base.Mesh((obj_init.name !== undef)?obj_init.name:undef));
material=parseMaterial(obj_init.material);
transform=parseTransform(obj_init.transform);
uvmapper=parseUV(obj_init.uvmapper || obj_init.uv);
baseSize=(obj_init.base !== undef)?obj_init.base:1.0;
height=(obj_init.height !== undef)?obj_init.height:1.0;
lon=(obj_init.lon !== undef)?obj_init.lon:24;
cubicvr_coneObject(obj_in,baseSize,height,lon,material,transform,uvmapper);
return obj_in;
},cylinder:function(obj_init){
var obj_in,material,transform,uvmapper;
var radius,height,lon;
obj_in=(obj_init.mesh !== undef)?obj_init.mesh:(new base.Mesh((obj_init.name !== undef)?obj_init.name:undef));
material=parseMaterial(obj_init.material);
transform=parseTransform(obj_init.transform);
uvmapper=parseUV(obj_init.uvmapper || obj_init.uv);
radius=(obj_init.radius !== undef)?obj_init.radius:1.0;
height=(obj_init.height !== undef)?obj_init.height:1.0;
lon=(obj_init.lon !== undef)?obj_init.lon:24;
cubicvr_cylinderObject(obj_in,radius,height,lon,material,transform,uvmapper);
return obj_in;
}
};
var extend={
genPlaneObject:cubicvr_planeObject,genBoxObject:cubicvr_boxObject,genLatheObject:cubicvr_latheObject,genTorusObject:cubicvr_torusObject,genConeObject:cubicvr_coneObject,genCylinderObject:cubicvr_cylinderObject,genSphereObject:cubicvr_sphereObject,primitives:primitives
};
return extend;
});
CubicVR.RegisterModule("COLLADA",function(base){
var undef=base.undef;
var nop=function(){ };
var enums=base.enums;
var GLCore=base.GLCore;
var log=base.log;
var collada_tools={
fixuaxis:function(up_axis,v){
if(up_axis === 0){ // untested
return [v[1],v[0],v[2]];
}else if(up_axis === 1){
return v;
}else if(up_axis === 2){
return [v[0],v[2],-v[1]];
}
},fixscaleaxis:function(up_axis,v){
if(up_axis === 0){ // untested
return [v[1],v[0],v[2]];
}else if(up_axis === 1){
return v;
}else if(up_axis === 2){
return [v[0],v[2],v[1]];
}
},fixukaxis:function(up_axis,mot,chan,val){
if(mot === enums.motion.POS && chan === enums.motion.Z && up_axis === enums.motion.Z){
return -val;
}
return val;
},getAllOf:function(root_node,leaf_name){
var nStack=[root_node],results=[],n,i,p,pMax;
while(nStack.length){
n=nStack.pop();
for(i in n){
if(!n.hasOwnProperty(i)) continue;
if(i === leaf_name){
if(n[i].length){
for(p=0, pMax=n[i].length; p<pMax; p++){
results.push(n[i][p]);
}
}else{
results.push(n[i]);
}
}
if(typeof (n[i]) == 'object'){
if(n[i].length){
for(p=0, pMax=n[i].length; p<pMax; p++){
nStack.push(n[i][p]);
}
}else{
nStack.push(n[i]);
}
}
}
}
return results;
},quaternionFilterZYYZ:function(rot,ofs){
var vec3=base.vec3;
var r=rot;
var temp_q=new base.Quaternion();
if(ofs !== undef){
r=vec3.add(rot,ofs);
}
temp_q.fromEuler(r[0],r[2],-r[1]);
return temp_q.toEuler();
},cl_getInitalTransform:function(up_axis,scene_node){
var util=base.util;
var retObj={
position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]
};
var translate=scene_node.translate;
var rotate=scene_node.rotate;
var scale=scene_node.scale;
var matrix=scene_node.matrix;
if(matrix && !translate && !rotate && !scale){
return retObj;  // TODO: fix this up
}
if(translate && translate.$){
retObj.position=collada_tools.fixuaxis(up_axis,util.floatDelimArray(translate.$," "));
}
if(rotate){
for(var r=0,rMax=rotate.length; r<rMax; r++){
var cl_rot=rotate[r];
var rType=cl_rot["@sid"];
var rVal=util.floatDelimArray(cl_rot.$," ");
if(rType == "rotateX" || rType == "rotationX"){
retObj.rotation[0]=rVal[3];
}else if(rType == "rotateY" || rType == "rotationY"){
retObj.rotation[1]=rVal[3];
}else if(rType == "rotateZ" || rType == "rotationZ"){
retObj.rotation[2]=rVal[3];
} //if
} //for
} //if
if(scale){
retObj.scale=collada_tools.fixscaleaxis(up_axis,util.floatDelimArray(scale.$," "));
}
// {
return retObj;
}
};
function cubicvr_parseCollada(meshUrl,prefix,deferred_bin){
var util=base.util;
var tech;
var sourceId;
var materialRef,nameRef,nFace,meshName;
var cl;
var mesh=null;
if(typeof (meshUrl) == 'object'){
cl=meshUrl;
}else if(meshUrl.indexOf(".js") != -1){
cl=util.getJSON(meshUrl);
}else{
cl=base.util.xml2badgerfish(util.getXML(meshUrl));
}
var norm,vert,uv,mapLen,computedLen;
var i,iCount,iMax,iMod,mCount,mMax,k,kMax,cCount,cMax,sCount,sMax,pCount,pMax,j,jMax;
var cl_source=cl;
cl=null;
if(!cl_source.COLLADA){
throw new Error(meshUrl+" does not appear to be a valid COLLADA file.");
}
cl_source=cl_source.COLLADA;
var clib={
up_axis:1,images:[],effects:[],materials:[],meshes:[],scenes:[],lights:[],cameras:[],animations:[]
};
if(cl_source.asset){
var sAxis=cl_source.asset.up_axis.$;
if(sAxis === "X_UP"){
clib.up_axis=0;
}else if(sAxis === "Y_UP"){
clib.up_axis=1;
}else if(sAxis === "Z_UP"){
clib.up_axis=2;
}
}
var up_axis=clib.up_axis;
if(cl_source.library_images){
if(cl_source.library_images.image && !cl_source.library_images.image.length) cl_source.library_images.image=[cl_source.library_images.image];
if(cl_source.library_images.image.length){
var cl_images=cl_source.library_images.image;
for(var imgCount=0,imgCountMax=cl_images.length; imgCount<imgCountMax; imgCount++){
var cl_img=cl_images[imgCount];
var imageId=cl_img["@id"];
var imageName=cl_img["@name"];
var cl_imgsrc=cl_img.init_from;
if(cl_imgsrc.$){
var imageSource=cl_imgsrc.$;
if(prefix !== undef && (imageSource.lastIndexOf("/") !== -1)){
imageSource=imageSource.substr(imageSource.lastIndexOf("/")+1);
}
if(prefix !== undef && (imageSource.lastIndexOf("\\") !== -1)){
imageSource=imageSource.substr(imageSource.lastIndexOf("\\")+1);
}
clib.images[imageId]={
source:imageSource,id:imageId,name:imageName
};
}
}
}
}
var effectId;
var effectCount,effectMax;
var tCount,tMax,inpCount,inpMax;
var cl_params,cl_inputs,cl_input,cl_inputmap,cl_samplers,cl_camera,cl_cameras,cl_scene;
var ofs;
var meshPart;
function getColorNode(n){
var el=n.color;
if(!el){
return false;
}
var cn=n.color;
var ar=cn?util.floatDelimArray(cn.$.replace(/ {2}/g," ").replace(/^\s+|\s+$/,'')," "):false;
return ar;
}
function getFloatNode(n){
var el=n['float'];
if(!el){
return false;
}
var cn=n['float'];
cn=cn?parseFloat(cn.$.replace(/ {2}/g," ").replace(/^\s+|\s+$/,'')):0;
return cn;
}
function getTextureNode(n){
var el=n.texture;
if(!el){
return false;
}
var cn=n.texture["@texture"];
return cn;
}
if(cl_source.library_effects){
var cl_effects=cl_source.library_effects.effect;
if(cl_effects && !cl_effects.length) cl_effects=[cl_effects];
for(effectCount=0, effectMax=cl_effects.length; effectCount<effectMax; effectCount++){
var cl_effect=cl_effects[effectCount];
effectId=cl_effect["@id"];
var effect={};
effect.id=effectId;
effect.surfaces=[];
effect.samplers=[];
cl_params=cl_effect.profile_COMMON.newparam;
if(cl_params && !cl_params.length){
cl_params=[cl_params];
}
var params=[];
var cl_init;
if(cl_params){
for(pCount=0, pMax=cl_params.length; pCount<pMax; pCount++){
var cl_param=cl_params[pCount];
var paramId=cl_param["@sid"];
if(cl_param.surface){
effect.surfaces[paramId]={};
var initFrom=cl_param.surface.init_from.$;
if(typeof (clib.images[initFrom]) === 'object'){
var img_path=prefix+"/"+clib.images[initFrom].source;
effect.surfaces[paramId].source=img_path;
}
}else if(cl_param.sampler2D){
effect.samplers[paramId]={};
effect.samplers[paramId].source=cl_param.sampler2D.source.$;
if(cl_param.sampler2D.minfilter){
effect.samplers[paramId].minfilter=cl_param.sampler2D.minfilter.$;
}
if(cl_param.sampler2D.magfilter){
effect.samplers[paramId].magfiter=cl_param.sampler2D.magfilter.$;
}
}
}
}
var cl_technique=cl_effect.profile_COMMON.technique;
if(cl_technique && !cl_technique.length) cl_technique=[cl_technique];
effect.material={
textures_ref:[]
};
for(tCount=0, tMax=cl_technique.length; tCount<tMax; tCount++){
tech=cl_technique[tCount].blinn;
if(!tech){
tech=cl_technique[tCount].phong;
}
if(!tech){
tech=cl_technique[tCount].lambert;
}
if(tech){
for(var tagName in tech){
var node=tech[tagName];
var c=getColorNode(node);
var f=getFloatNode(node);
var t=getTextureNode(node);
if(c !== false){
if(c.length>3){
c.pop();
}
}
if(tagName == "emission"){
if(c !== false){
effect.material.ambient=c;
}
}else if(tagName == "ambient"){}else if(tagName == "diffuse"){
if(c !== false){
effect.material.color=c;
}
}else if(tagName == "specular"){
if(c !== false){
effect.material.specular=c;
}
}else if(tagName == "shininess"){
if(f !== false){
effect.material.shininess=f;
}
}else if(tagName == "reflective"){
nop();
}else if(tagName == "reflectivity"){
nop();
}else if(tagName == "transparent"){
nop();
}else if(tagName == "index_of_refraction"){
nop();
}
if(t !== false){
var srcTex=effect.surfaces[effect.samplers[t].source].source;
if(tagName == "emission"){
effect.material.textures_ref.push({
image:srcTex,type:enums.texture.map.AMBIENT
});
}else if(tagName == "ambient"){
effect.material.textures_ref.push({
image:srcTex,type:enums.texture.map.AMBIENT
});
}else if(tagName == "diffuse"){
effect.material.textures_ref.push({
image:srcTex,type:enums.texture.map.COLOR
});
}else if(tagName == "specular"){
effect.material.textures_ref.push({
image:srcTex,type:enums.texture.map.SPECULAR
});
}else if(tagName == "shininess"){}else if(tagName == "reflective"){
effect.material.textures_ref.push({
image:srcTex,type:enums.texture.map.REFLECT
});
}else if(tagName == "reflectivity"){}else if(tagName == "transparent"){
effect.material.textures_ref.push({
image:srcTex,type:enums.texture.map.ALPHA
});
}else if(tagName == "transparency"){
nop();
}else if(tagName == "index_of_refraction"){
nop();
}
}
}
}
clib.effects[effectId]=effect;
}
}
}
var cl_lib_mat_inst=collada_tools.getAllOf(cl_source,"instance_geometry");
var materialMap=[];
if(cl_lib_mat_inst.length){
for(i=0, iMax=cl_lib_mat_inst.length; i<iMax; i++){
var cl_mat_inst=cl_lib_mat_inst[i];
var mInst=collada_tools.getAllOf(cl_mat_inst,"instance_material");
if(mInst.length){
for(j=0, jMax=mInst.length; j<jMax; j++){
var inst=mInst[j];
var symbolId=inst["@symbol"];
var targetId=inst["@target"].substr(1);
materialMap[cl_mat_inst["@url"].substr(1)+":"+symbolId]=targetId;
}
}
}
}
var cl_lib_materials=cl_source.library_materials;
if(cl_lib_materials && cl_lib_materials.material){
var cl_materials=cl_lib_materials.material;
if(cl_materials && !cl_materials.length) cl_materials=[cl_materials];
for(mCount=0, mMax=cl_materials.length; mCount<mMax; mCount++){
var cl_material=cl_materials[mCount];
var materialId=cl_material["@id"];
var materialName=cl_material["@name"];
var cl_einst=cl_material.instance_effect;
if(cl_einst){
effectId=cl_einst["@url"].substr(1);
clib.materials.push({
id:materialId,name:materialName,mat:clib.effects[effectId].material
});
}
}
}
var cl_lib_geo=cl_source.library_geometries;
var meshId;
if(cl_lib_geo){
var cl_geo_node=cl_lib_geo.geometry;
if(cl_geo_node && !cl_geo_node.length) cl_geo_node=[cl_geo_node];
if(cl_geo_node.length){
for(var meshCount=0,meshMax=cl_geo_node.length; meshCount<meshMax; meshCount++){
var meshData={
id:undef,points:[],parts:[]
};
var currentMaterial;
var cl_geomesh=cl_geo_node[meshCount].mesh;
if(cl_geomesh){
meshId=cl_geo_node[meshCount]["@id"];
meshName=cl_geo_node[meshCount]["@name"];
var cl_geosources=cl_geomesh.source;
if(cl_geosources && !cl_geosources.length) cl_geosources=[cl_geosources];
var geoSources=[];
for(var sourceCount=0,sourceMax=cl_geosources.length; sourceCount<sourceMax; sourceCount++){
var cl_geosource=cl_geosources[sourceCount];
sourceId=cl_geosource["@id"];
var sourceName=cl_geosource["@name"];
var cl_floatarray=cl_geosource.float_array;
if(cl_floatarray){
geoSources[sourceId]={
id:sourceId,name:sourceName,data:util.floatDelimArray(cl_floatarray.$?cl_floatarray.$:""," ")
};
}
var cl_accessor=cl_geosource.technique_common.accessor;
if(cl_accessor){
geoSources[sourceId].count=cl_accessor["@count"] | 0;
geoSources[sourceId].stride=cl_accessor["@stride"] | 0;
if(geoSources[sourceId].count){
geoSources[sourceId].data=util.repackArray(geoSources[sourceId].data,geoSources[sourceId].stride,geoSources[sourceId].count);
}
}
}
var geoVerticies=[];
var cl_vertices=cl_geomesh.vertices;
var pointRef=null;
var pointRefId=null;
var triangleRef=null;
var normalRef=null;
var colorRef=null;
var uvRef=null;
if(cl_vertices){
pointRefId=cl_vertices["@id"];
cl_inputs=cl_vertices.input;
if(cl_inputs && !cl_inputs.length) cl_inputs=[cl_inputs];
if(cl_inputs){
for(inpCount=0, inpMax=cl_inputs.length; inpCount<inpMax; inpCount++){
cl_input=cl_inputs[inpCount];
if(cl_input["@semantic"] === "POSITION"){
pointRef=cl_input["@source"].substr(1);
}
}
}
}
var CL_VERTEX=0,CL_NORMAL=1,CL_TEXCOORD=2,CL_COLOR=3,CL_OTHER=4;
var cl_triangles=cl_geomesh.triangles;
if(cl_triangles && !cl_triangles.length) cl_triangles=[cl_triangles];
if(cl_triangles){
for(tCount=0, tMax=cl_triangles.length; tCount<tMax; tCount++){
meshPart={
material:0,faces:[],normals:[],texcoords:[],colors:[]
};
var cl_trianglesCount=parseInt(cl_triangles[tCount]["@count"],10);
cl_inputs=cl_triangles[tCount].input;
if(cl_inputs && !cl_inputs.length) cl_inputs=[cl_inputs];
cl_inputmap=[];
if(cl_inputs.length){
for(inpCount=0, inpMax=cl_inputs.length; inpCount<inpMax; inpCount++){
cl_input=cl_inputs[inpCount];
ofs=parseInt(cl_input["@offset"],10);
nameRef=cl_input["@source"].substr(1);
if(cl_input["@semantic"] === "VERTEX"){
if(nameRef === pointRefId){
nameRef=triangleRef=pointRef;
}else{
triangleRef=nameRef;
}
cl_inputmap[ofs]=CL_VERTEX;
}else if(cl_input["@semantic"] === "NORMAL"){
normalRef=nameRef;
if(geoSources[normalRef].count){
cl_inputmap[ofs]=CL_NORMAL;
}
}else if(cl_input["@semantic"] === "TEXCOORD"){
uvRef=nameRef;
if(geoSources[uvRef].count){
cl_inputmap[ofs]=CL_TEXCOORD;
}
}else if(cl_input["@semantic"] === "COLOR"){
colorRef=nameRef;
if(geoSources[colorRef].count){
cl_inputmap[ofs]=CL_COLOR;
}
}else{
cl_inputmap[ofs]=CL_OTHER;
}
}
}
mapLen=cl_inputmap.length;
materialRef=meshId+":"+cl_triangles[tCount]["@material"];
if(materialRef === null){
meshPart.material=0;
}else{
if(materialMap[materialRef] === undef){
log("missing material ["+materialRef+"]@"+meshId+"?");
meshPart.material=0;
}else{
meshPart.material=materialMap[materialRef];
}
}
var cl_triangle_source=cl_triangles[tCount].p;
var triangleData=[];
if(cl_triangle_source){
triangleData=util.intDelimArray(cl_triangle_source.$," ");
}
if(triangleData.length){
computedLen=((triangleData.length)/cl_inputmap.length)/3;
if(computedLen !== cl_trianglesCount){
}else{
if(meshData.points.length === 0){
meshData.points=geoSources[pointRef].data;
}
ofs=0;
for(i=0, iMax=triangleData.length, iMod=cl_inputmap.length; i<iMax; i+=iMod*3){
norm=[];
vert=[];
uv=[];
color=[];
for(j=0; j<iMod*3; j++){
var jMod=j%iMod;
if(cl_inputmap[jMod] === CL_VERTEX){
vert.push(triangleData[i+j]);
}else if(cl_inputmap[jMod] === CL_NORMAL){
norm.push(triangleData[i+j]);
}else if(cl_inputmap[jMod] === CL_TEXCOORD){
uv.push(triangleData[i+j]);
}else if(cl_inputmap[jMod] === CL_COLOR){
color.push(triangleData[i+j]);
}
}
if(vert.length){
meshPart.faces.push(vert);
if(norm.length === 3){
meshPart.normals.push([collada_tools.fixuaxis(clib.up_axis,geoSources[normalRef].data[norm[0]]),collada_tools.fixuaxis(clib.up_axis,geoSources[normalRef].data[norm[1]]),collada_tools.fixuaxis(clib.up_axis,geoSources[normalRef].data[norm[2]])]);
}
if(uv.length === 3){
meshPart.texcoords.push([geoSources[uvRef].data[uv[0]],geoSources[uvRef].data[uv[1]],geoSources[uvRef].data[uv[2]]]);
}
if(color.length === 3){
meshPart.colors.push([geoSources[colorRef].data[color[0]],geoSources[colorRef].data[color[1]],geoSources[colorRef].data[color[2]]]);
}
}
}
}
}
meshData.parts.push(meshPart);
}
}
var cl_polylist=cl_geomesh.polylist;
if(!cl_polylist){
cl_polylist=cl_geomesh.polygons; // try polygons
}
if(cl_polylist && !cl_polylist.length) cl_polylist=[cl_polylist];
if(cl_polylist){
for(tCount=0, tMax=cl_polylist.length; tCount<tMax; tCount++){
meshPart={
material:0,faces:[],normals:[],texcoords:[],colors:[]
};
var cl_polylistCount=parseInt(cl_polylist[tCount]["@count"],10);
cl_inputs=cl_polylist[tCount].input;
if(cl_inputs && !cl_inputs.length) cl_inputs=[cl_inputs];
cl_inputmap=[];
if(cl_inputs.length){
for(inpCount=0, inpMax=cl_inputs.length; inpCount<inpMax; inpCount++){
cl_input=cl_inputs[inpCount];
var cl_ofs=cl_input["@offset"];
if(cl_ofs === null){
cl_ofs=cl_input["@idx"];
}
ofs=parseInt(cl_ofs,10);
nameRef=cl_input["@source"].substr(1);
if(cl_input["@semantic"] === "VERTEX"){
if(nameRef === pointRefId){
nameRef=triangleRef=pointRef;
}else{
triangleRef=nameRef;
}
cl_inputmap[ofs]=CL_VERTEX;
}else if(cl_input["@semantic"] === "NORMAL"){
normalRef=nameRef;
cl_inputmap[ofs]=CL_NORMAL;
}else if(cl_input["@semantic"] === "TEXCOORD"){
uvRef=nameRef;
cl_inputmap[ofs]=CL_TEXCOORD;
}else if(cl_input["@semantic"] === "COLOR"){
colorRef=nameRef;
cl_inputmap[ofs]=CL_COLOR;
}else{
cl_inputmap[ofs]=CL_OTHER;
}
}
}
var cl_vcount=cl_polylist[tCount].vcount;
var vcount=[];
if(cl_vcount){
vcount=util.intDelimArray(cl_vcount.$," ");
}
materialRef=meshId+":"+cl_polylist[tCount]["@material"];
if(materialRef === undef){
meshPart.material=0;
}else{
meshPart.material=materialMap[materialRef];
}
var cl_poly_source=cl_polylist[tCount].p;
mapLen=cl_inputmap.length;
var polyData=[];
if((cl_poly_source.length>1) && !vcount.length) // blender 2.49 style
{
var pText="";
for(pCount=0, pMax=cl_poly_source.length; pCount<pMax; pCount++){
var tmp=util.intDelimArray(cl_poly_source[pCount].$," ");
vcount[pCount]=parseInt(tmp.length/mapLen,10);
polyData=polyData.concat(tmp);
}
}else{
if(cl_poly_source){
polyData=util.intDelimArray(cl_poly_source.$," ");
}
}
if(polyData.length){
computedLen=vcount.length;
if(computedLen !== cl_polylistCount){
log("poly vcount data doesn't add up, skipping object load: "+computedLen+" !== "+cl_polylistCount);
}else{
if(meshData.points.length === 0){
meshData.points=geoSources[pointRef].data;
}
ofs=0;
for(i=0, iMax=vcount.length; i<iMax; i++){
norm=[];
vert=[];
uv=[];
color=[];
for(j=0, jMax=vcount[i]*mapLen; j<jMax; j++){
if(cl_inputmap[j%mapLen] === CL_VERTEX){
vert.push(polyData[ofs]);
ofs++;
}else if(cl_inputmap[j%mapLen] === CL_NORMAL){
norm.push(polyData[ofs]);
ofs++;
}else if(cl_inputmap[j%mapLen] === CL_TEXCOORD){
uv.push(polyData[ofs]);
ofs++;
}else if(cl_inputmap[j%mapLen] === CL_COLOR){
color.push(polyData[ofs]);
ofs++;
}else{
ofs++;
}
}
var tlist;
if(vert.length){
// }
meshPart.faces.push(vert);
if(norm.length){
nlist=[];
for(k=0, kMax=norm.length; k<kMax; k++){
nlist.push(collada_tools.fixuaxis(clib.up_axis,geoSources[normalRef].data[norm[k]]));
}
meshPart.normals.push(nlist);
}
if(uv.length){
tlist=[];
for(k=0, kMax=uv.length; k<kMax; k++){
tlist.push(geoSources[uvRef].data[uv[k]]);
}
meshPart.texcoords.push(tlist);
}
if(color.length){
tlist=[];
for(k=0, kMax=color.length; k<kMax; k++){
tlist.push(geoSources[colorRef].data[color[k]]);
}
meshPart.colors.push(tlist);
}
}
}
}
}
meshData.parts.push(meshPart);
}
}
if(up_axis !== 1){
for(i=0, iMax=meshData.points.length; i<iMax; i++){
meshData.points[i]=collada_tools.fixuaxis(clib.up_axis,meshData.points[i]);
}
}
meshData.id=meshId;
clib.meshes.push(meshData);
}
}
}
}
var cl_lib_cameras=cl_source.library_cameras;
var camerasBoundRef=[];
if(cl_lib_cameras){
cl_cameras=cl_lib_cameras.camera;
if(cl_cameras && !cl_cameras.length) cl_cameras=[cl_cameras];
for(cCount=0, cMax=cl_cameras.length; cCount<cMax; cCount++){
cl_camera=cl_cameras[cCount];
var cameraId=cl_camera["@id"];
var cameraName=cl_camera["@name"];
var cl_yfov=0;
var cl_znear=0;
var cl_zfar=0;
if(cl_camera.optics) if(cl_camera.optics.technique_common) if(cl_camera.optics.technique_common.perspective){
cl_yfov=cl_camera.optics.technique_common.perspective.yfov;
cl_znear=cl_camera.optics.technique_common.perspective.znear;
cl_zfar=cl_camera.optics.technique_common.perspective.zfar;
}
var yfov;
var znear;
var zfar;
if(!cl_yfov && !cl_znear && !cl_zfar){
cl_params=cl_camera.param;
if(cl_params && !cl_params.length) cl_params=[cl_params];
for(i=0, iMax=cl_params.length; i<iMax; i++){
var txt=cl_params[i].$;
var pName=cl_params[i]["@name"];
if(pName == "YFOV"){
yfov=parseFloat(txt);
}else if(pName == "ZNEAR"){
znear=parseFloat(txt);
}else if(pName == "ZFAR"){
zfar=parseFloat(txt);
}
}
}else{
yfov=cl_yfov?parseFloat(cl_yfov.$):60;
znear=cl_znear?parseFloat(cl_znear.$):0.1;
zfar=cl_zfar?parseFloat(cl_zfar.$):1000.0;
}
clib.cameras.push({
id:cameraId,targeted:false,fov:parseFloat(yfov),nearclip:parseFloat(znear),farclip:parseFloat(zfar)
});
}
}
var cl_lib_lights=cl_source.library_lights;
var cl_light;
if(cl_lib_lights){
var cl_lights=cl_lib_lights.light;
if(cl_lights && !cl_lights.length) cl_lights=[cl_lights];
if(cl_lights) for(var lightCount=0,lightMax=cl_lights.length; lightCount<lightMax; lightCount++){
cl_light=cl_lights[lightCount];
var cl_point=cl_light.technique_common.point;
var cl_pointLight=cl_point?cl_point:null;
var lightId=cl_light["@id"];
var lightName=cl_light["@name"];
if(cl_pointLight !== null){
var cl_intensity=cl_pointLight.intensity;
var intensity=cl_intensity?parseFloat(cl_intensity.$):1.0;
var cl_distance=cl_pointLight.distance;
var distance=cl_distance?parseFloat(cl_distance.$):10.0;
var cl_color=cl_pointLight.color;
var color=[1,1,1];
if(cl_color){
color=util.floatDelimArray(cl_color.$," ");
}
clib.lights.push({
id:lightId,name:lightId,type:enums.light.type.POINT,method:enums.light.method.STATIC,diffuse:color,specular:[0,0,0],distance:distance,intensity:intensity
});
}
}
}
var cl_lib_scenes=cl_source.library_visual_scenes;
if(cl_lib_scenes){
var cl_scenes=null;
cl_scenes=cl_lib_scenes.visual_scene;
if(cl_scenes && !cl_scenes.length) cl_scenes=[cl_scenes];
for(var sceneCount=0,sceneMax=cl_scenes.length; sceneCount<sceneMax; sceneCount++){
cl_scene=cl_scenes[sceneCount];
var sceneId=cl_scene["@id"];
var sceneName=cl_scene["@name"];
var sceneData={
id:sceneId,sceneObjects:[],cameras:[],lights:[],parentMap:[]
};
var nodeMap=[];
var cl_nodes=[];
var cl_stack;
var mnode,nodeId,ntemp,nlist;
var parentNodeName,parentNode;
var cl_lib_scene_nodes=cl_source.library_nodes;
if(cl_lib_scene_nodes){
var nodes=cl_lib_scene_nodes.node;
if(nodes && !nodes.length){
nodes=[nodes];
}
nodeMap=[];
for(i=0, iMax=nodes.length; i<iMax; i++){
mnode=nodes[i];
mnodeId=mnode["@id"];
nodeMap[nodeId]=mnode;
}
cl_stack=[cl_scene];
while(cl_stack.length){
ntemp=cl_stack.pop();
if(ntemp.node){
nlist=ntemp.node;
if(nlist && !nlist.length) nlist=[nlist];
if(nlist){
for(i=0, iMax=nlist.length; i<iMax; i++){
cl_stack.push(nlist[i]);
}
}
}
if(ntemp.instance_node){
var iNodes=ntemp.instance_node;
if(iNodes && !iNodes.length){
iNodes=[iNodes];
}
for(i=0, iMax=iNodes.length; i<iMax; i++){
var iNode=iNodes[i];
var iNodeURL=iNode["@url"].substr(1);
if(nodeMap[iNodeURL]){
if(ntemp.node && ntemp.node.length){
ntemp.node=[ntemp.node];
}
if(!ntemp.node){
ntemp.node=[nodeMap[iNodeURL]];
}else{
ntemp.node.push(nodeMap[iNodeURL]);
}
}
}
}
}
}
cl_stack=[cl_scene];
while(cl_stack.length){
ntemp=cl_stack.pop();
if(ntemp.node){
nlist=ntemp.node;
if(nlist && !nlist.length) nlist=[nlist];
if(nlist){
for(i=0, iMax=nlist.length; i<iMax; i++){
nlist[i].parentNode=ntemp;
cl_nodes.push(nlist[i]);
cl_stack.push(nlist[i]);
}
}
}
}
if(cl_nodes.length){
for(var nodeCount=0,nodeMax=cl_nodes.length; nodeCount<nodeMax; nodeCount++){
var cl_node=cl_nodes[nodeCount];
var cl_geoms=cl_node.instance_geometry;
cl_light=cl_nodes[nodeCount].instance_light;
cl_camera=cl_nodes[nodeCount].instance_camera;
nodeId=cl_node["@id"];
var nodeName=cl_node["@name"];
var it=collada_tools.cl_getInitalTransform(clib.up_axis,cl_node);
if(up_axis === 2){
it.rotation=collada_tools.quaternionFilterZYYZ(it.rotation,(cl_camera)?[-90,0,0]:undef);
}
var parentGroup=null;
var sceneObject=null;
var parentNodeId;
if(cl_geoms){
if(cl_geoms && !cl_geoms.length){
cl_geoms=[cl_geoms];
}
for(i=0, iMax=cl_geoms.length; i<iMax; i++){
var cl_geom=cl_geoms[i];
meshName=cl_geom["@url"].substr(1);
sceneObject={};
sceneObject.name=((nodeName)?nodeName:nodeId)+(i?i:"");
sceneObject.id=((nodeId)?nodeId:nodeName)+(i?i:"");
sceneObject.meshId=meshId;
sceneObject.meshName=meshName;
if(!parentGroup){
sceneObject.position=it.position;
sceneObject.rotation=it.rotation;
sceneObject.scale=it.scale;
sceneObject.matrix=it.matrix;
}
sceneData.sceneObjects.push(sceneObject);
nodeMap[sceneObject.id]=true;
if(cl_node.parentNode){
parentNodeId=cl_node.parentNode["@id"];
parentNodeName=cl_node.parentNode["@name"];
if(parentNodeId && nodeMap[parentNodeId]){
sceneData.parentMap.push({
parent:parentNodeId,child:sceneObject.id
});
}else if(cl_geoms.length>1){
if(!parentGroup){
parentGroup=sceneObject;
sceneObject={};
}else{
if(nodeMap[parentGroup.id]){
sceneData.parentMap.push({
parent:parentGroup.id,child:sceneObject.id
});
}
}
}
}
}
}else if(cl_camera){
var cam_instance=cl_camera;
var camRefId=cam_instance["@url"].substr(1);
sceneData.cameras.push({
name:(nodeName)?nodeName:nodeId,id:(nodeName)?nodeName:nodeId,source:camRefId,position:it.position,rotation:it.rotation
});
}else if(cl_light){
var lightRefId=cl_light["@url"].substr(1);
sceneData.lights.push({
name:(nodeName)?nodeName:nodeId,id:(nodeName)?nodeName:nodeId,source:lightRefId,position:it.position
});
}else{
sceneObject={
position:it.position,rotation:it.rotation,scale:it.scale,matrix:it.matrix
};
sceneObject.name=((nodeName)?nodeName:nodeId);
sceneObject.id=((nodeId)?nodeId:nodeName);
sceneData.sceneObjects.push(sceneObject);
nodeMap[sceneObject.id]=true;
if(cl_node.parentNode){
parentNodeId=cl_node.parentNode["@id"];
parentNodeName=cl_node.parentNode["@name"];
if(parentNodeId && nodeMap[parentNodeId]){
sceneData.parentMap.push({
parent:parentNodeId,child:sceneObject.id
});
}
}
}
}
}
clib.scenes.push(sceneData);
}
}
var cl_lib_anim=cl_source.library_animations;
var animId;
if(cl_lib_anim){
var cl_anim_sources=cl_lib_anim.animation;
if(cl_anim_sources && !cl_anim_sources.length) cl_anim_sources=[cl_anim_sources];
if(cl_anim_sources){
for(var aCount=0,aMax=cl_anim_sources.length; aCount<aMax; aCount++){
var cl_anim=cl_anim_sources[aCount];
animId=cl_anim["@id"];
var animName=cl_anim["@name"];
clib.animations[animId]={};
clib.animations[animId].sources=[];
var cl_sources=cl_anim.source;
if(cl_sources && !cl_sources.length) cl_sources=[cl_sources];
if(cl_sources.length){
for(sCount=0, sMax=cl_sources.length; sCount<sMax; sCount++){
var cl_csource=cl_sources[sCount];
sourceId=cl_csource["@id"];
var tech_common=cl_csource.technique_common;
var name_array=null;
var float_array=null;
var data=null;
if(cl_csource.name_array){
name_array=util.textDelimArray(cl_csource.name_array.$," ");
}else if(cl_csource.Name_array){
name_array=util.textDelimArray(cl_csource.Name_array.$," ");
}else if(cl_csource.float_array){
float_array=util.floatDelimArray(cl_csource.float_array.$," ");
}
var acCount=0;
var acSource="";
var acStride=1;
if(tech_common){
tech=tech_common;
var acc=tech.accessor;
acCount=parseInt(acc["@count"],10);
acSource=acc["@source"].substr(1);
var aStride=acc["@stride"];
if(aStride){
acStride=parseInt(aStride,10);
}
}
clib.animations[animId].sources[sourceId]={
data:name_array?name_array:float_array,count:acCount,source:acSource,stride:acStride
};
if(acStride !== 1){
clib.animations[animId].sources[sourceId].data=util.repackArray(clib.animations[animId].sources[sourceId].data,acStride,acCount);
}
}
}
cl_samplers=cl_anim.sampler;
if(cl_samplers && !cl_samplers.length) cl_samplers=[cl_samplers];
if(cl_samplers){
clib.animations[animId].samplers=[];
for(sCount=0, sMax=cl_samplers.length; sCount<sMax; sCount++){
var cl_sampler=cl_samplers[sCount];
var samplerId=cl_sampler["@id"];
cl_inputs=cl_sampler.input;
if(cl_inputs && !cl_inputs.length) cl_inputs=[cl_inputs];
if(cl_inputs){
var inputs=[];
for(iCount=0, iMax=cl_inputs.length; iCount<iMax; iCount++){
cl_input=cl_inputs[iCount];
var semanticName=cl_input["@semantic"];
inputs[semanticName]=cl_input["@source"].substr(1);
}
clib.animations[animId].samplers[samplerId]=inputs;
}
}
}
var cl_channels=cl_anim.channel;
if(cl_channels && !cl_channels.length) cl_channels=[cl_channels];
if(cl_channels){
clib.animations[animId].channels=[];
for(cCount=0, cMax=cl_channels.length; cCount<cMax; cCount++){
var channel=cl_channels[cCount];
var channelSource=channel["@source"].substr(1);
var channelTarget=channel["@target"];
var channelSplitA=channelTarget.split("/");
var channelTargetName=channelSplitA[0];
var channelSplitB=channelSplitA[1].split(".");
var channelParam=channelSplitB[0];
var channelType=channelSplitB[1];
clib.animations[animId].channels.push({
source:channelSource,target:channelTarget,targetName:channelTargetName,paramName:channelParam,typeName:channelType
});
}
}
}
}
}
var cl_lib_scene=cl_source.scene;
if(cl_lib_scene){
cl_scene=cl_lib_scene.instance_visual_scene;
if(cl_scene){
var sceneUrl=cl_scene["@url"].substr(1);
clib.scene=sceneUrl;
}
}
return clib;
}
function cubicvr_loadCollada(meshUrl,prefix,deferred_bin){
var clib=cubicvr_parseCollada(meshUrl,prefix,deferred_bin);
var up_axis=clib.up_axis;
var materialRef=[];
var pInterp;
var m,mMax,c,cMax,l,lMax,t,tMax,mp,mpMax,p,pMax,s,sMax,so,soMax;
for(m=0, mMax=clib.materials.length; m<mMax; m++){
var material=clib.materials[m];
var newMaterial=new base.Material(material.mat);
newMaterial.name=material.name || null;
for(t=0, tMax=material.mat.textures_ref.length; t<tMax; t++){
var tex=material.mat.textures_ref[t];
var texObj=null;
if(base.Textures_ref[tex.image] === undefined){
texObj=new base.Texture(tex.image,GLCore.default_filter,deferred_bin,meshUrl);
}else{
texObj=base.Textures_obj[base.Textures_ref[tex.image]];
}
newMaterial.setTexture(texObj,tex.type);
}
materialRef[material.id]=newMaterial;
}
var meshRef=[];
for(m=0, mMax=clib.meshes.length; m<mMax; m++){
var meshData=clib.meshes[m];
var newObj=new base.Mesh({name:meshData.id});
newObj.points=meshData.points;
var hasNormals=false;
for(mp=0, mpMax=meshData.parts.length; mp<mpMax; mp++){
var part=meshData.parts[mp];
if(part.material !== 0){
var mpart=materialRef[part.material];
if(!mpart) mpart=new base.Material({name:part.material});
newObj.setFaceMaterial(mpart);
}
var bNorm=part.normals.length?true:false;
var bTex=part.texcoords.length?true:false;
var bColor=part.colors.length?true:false;
if(bColor) materialRef[part.material].color_map=true;
for(p=0, pMax=part.faces.length; p<pMax; p++){
var faceNum=newObj.addFace(part.faces[p]);
if(bNorm) newObj.faces[faceNum].point_normals=part.normals[p];
if(bTex) newObj.faces[faceNum].uvs=part.texcoords[p];
if(bColor) newObj.faces[faceNum].point_colors=part.colors[p];
}
hasNormals|=bNorm;
}
if(newObj.faces.length){
if(!deferred_bin){
if(!hasNormals) newObj.calcNormals();
newObj.triangulateQuads();
newObj.compile();
}else{
deferred_bin.addMesh(meshUrl,meshUrl+":"+meshId,newObj);
}
meshRef[meshData.id]=newObj;
}
}
var camerasRef=[];
for(c=0, cMax=clib.cameras.length; c<cMax; c++){
camerasRef[clib.cameras[c].id]=clib.cameras[c];
}
var lightsRef=[];
for(l=0, lMax=clib.lights.length; l<lMax; l++){
lightsRef[clib.lights[l].id]=clib.lights[l];
}
var sceneObjectMap={};
var sceneLightMap={};
var sceneCameraMap={};
var scenesRef={};
for(s=0, sMax=clib.scenes.length; s<sMax; s++){
var scn=clib.scenes[s];
var newScene=new base.Scene();
for(so=0, soMax=scn.sceneObjects.length; so<soMax; so++){
var sceneObj=scn.sceneObjects[so];
var newSceneObject=new base.SceneObject(sceneObj);
var srcMesh=(meshRef[sceneObj.meshName]?meshRef[sceneObj.meshName]:meshRef[sceneObj.meshId]) || null;
newSceneObject.obj=srcMesh;
if(sceneObj.matrix){
newSceneObject.setMatrix(sceneObj.matrix);
}
sceneObjectMap[sceneObj.id]=newSceneObject;
newScene.bindSceneObject(newSceneObject);
}
for(l=0, lMax=scn.lights.length; l<lMax; l++){
var lt=scn.lights[l];
var newLight=new base.Light(lightsRef[lt.source]);
newLight.position=lt.position;
sceneLightMap[lt.id]=newLight;
newScene.bindLight(newLight);
}
if(scn.cameras.length){ // single camera for the moment until we support it
var cam=scn.cameras[0];
var newCam=new base.Camera(camerasRef[cam.source]);
newCam.position=cam.position;
newCam.rotation=cam.rotation;
sceneCameraMap[cam.id]=newCam;
newScene.camera=newCam;
}
for(p=0, pMax=scn.parentMap.length; p<pMax; p++){
var pmap=scn.parentMap[p];
sceneObjectMap[pmap.parent].bindChild(sceneObjectMap[pmap.child]);
}
scenesRef[scn.id]=newScene;
}
for(var animId in clib.animations){
if(clib.animations.hasOwnProperty(animId)){
var anim=clib.animations[animId];
if(anim.channels.length){
for(cCount=0, cMax=anim.channels.length; cCount<cMax; cCount++){
var chan=anim.channels[cCount];
var sampler=anim.samplers[chan.source];
var samplerInput=anim.sources[sampler["INPUT"]];
var samplerOutput=anim.sources[sampler["OUTPUT"]];
var samplerInterp=anim.sources[sampler["INTERPOLATION"]];
var samplerInTangent=anim.sources[sampler["IN_TANGENT"]];
var samplerOutTangent=anim.sources[sampler["OUT_TANGENT"]];
var hasInTangent=(sampler["IN_TANGENT"] !== undef);
var hasOutTangent=(sampler["OUT_TANGENT"] !== undef);
var mtn=null;
var targetSceneObject=sceneObjectMap[chan.targetName];
var targetCamera=sceneCameraMap[chan.targetName];
var targetLight=sceneLightMap[chan.targetName];
if(targetSceneObject){
if(targetSceneObject.motion === null){
targetSceneObject.motion=new base.Motion();
}
mtn=targetSceneObject.motion;
}else if(targetCamera){
if(targetCamera.motion === null){
targetCamera.motion=new base.Motion();
}
mtn=targetCamera.motion;
}else if(targetLight){
if(targetLight.motion === null){
targetLight.motion=new base.Motion();
}
mtn=targetLight.motion;
}
//   console.log("missing",chan.paramName);
if(mtn === null){
continue;
}
var controlTarget=enums.motion.POS;
var motionTarget=enums.motion.X;
if(up_axis === 2){
mtn.yzflip=true;
}
var pName=chan.paramName;
if(pName === "rotateX" || pName === "rotationX"){
controlTarget=enums.motion.ROT;
motionTarget=enums.motion.X;
}else if(pName === "rotateY" || pName === "rotationY"){
controlTarget=enums.motion.ROT;
motionTarget=enums.motion.Y;
}else if(pName === "rotateZ" || pName === "rotationZ"){
controlTarget=enums.motion.ROT;
motionTarget=enums.motion.Z;
}else if(pName === "location"){
controlTarget=enums.motion.POS;
if(chan.typeName === "X"){
motionTarget=enums.motion.X;
}
if(chan.typeName === "Y"){
motionTarget=enums.motion.Y;
}
if(chan.typeName === "Z"){
motionTarget=enums.motion.Z;
}
}else if(pName === "translate"){
controlTarget=enums.motion.POS;
if(chan.typeName === "X"){
motionTarget=enums.motion.X;
}
if(chan.typeName === "Y"){
motionTarget=enums.motion.Y;
}
if(chan.typeName === "Z"){
motionTarget=enums.motion.Z;
}
}else if(pName === "LENS"){
controlTarget=10;
motionTarget=10;
continue; // disabled, only here for temporary collada files
}else if(pName === "FOV"){
controlTarget=enums.motion.FOV;
motionTarget=3; // ensure no axis fixes are applied
}else if(pName === "ZNEAR"){
controlTarget=enums.motion.NEARCLIP;
motionTarget=3; // ensure no axis fixes are applied
}else if(pName === "ZFAR"){
controlTarget=enums.motion.FARCLIP;
motionTarget=3; // ensure no axis fixes are applied
}else if(pName === "intensity"){
controlTarget=enums.motion.INTENSITY;
motionTarget=3; // ensure no axis fixes are applied
}
if(targetLight && controlTarget<3) targetLight.method=enums.light.method.DYNAMIC;
var ival;
for(mCount=0, mMax=samplerInput.data.length; mCount<mMax; mCount++){ // in the process of being deprecated
k=null;
if(typeof (samplerOutput.data[mCount]) === 'object'){
for(i=0, iMax=samplerOutput.data[mCount].length; i<iMax; i++){
ival=i;
if(up_axis === 2 && i === 2){
ival=1;
}else if(up_axis === 2 && i === 1){
ival=2;
}
k=mtn.setKey(controlTarget,ival,samplerInput.data[mCount],collada_tools.fixukaxis(clib.up_axis,controlTarget,ival,samplerOutput.data[mCount][i]));
if(samplerInterp){
pInterp=samplerInterp.data[mCount][i];
if(pInterp === "LINEAR"){
k.shape=enums.envelope.shape.LINE;
}else if(pInterp === "BEZIER"){
if(!(hasInTangent || hasOutTangent)){
k.shape=enums.envelope.shape.LINEAR;
}else{
k.shape=enums.envelope.shape.BEZI;
}
}
}
}
}else{
ival=motionTarget;
ofs=0;
if(targetCamera){
if(controlTarget === enums.motion.ROT){
if(up_axis === 2 && ival === 0){
ofs= -90;
}
}
}
if(controlTarget === enums.motion.ROT){
k=mtn.setKey(controlTarget,ival,samplerInput.data[mCount],samplerOutput.data[mCount]+ofs);
}else{
if(up_axis === 2 && motionTarget === 2){
ival=1;
}else if(up_axis === 2 && motionTarget === 1){
ival=2;
}
k=mtn.setKey(controlTarget,ival,samplerInput.data[mCount],collada_tools.fixukaxis(clib.up_axis,controlTarget,ival,samplerOutput.data[mCount]));
}
if(samplerInterp){
pInterp=samplerInterp.data[mCount];
if(pInterp === "LINEAR"){
k.shape=enums.envelope.shape.LINE;
}else if(pInterp === "BEZIER"){
if(!(hasInTangent || hasOutTangent)){
k.shape=enums.envelope.shape.LINEAR;
k.continutity=1.0;
}else{
k.shape=enums.envelope.shape.BEZ2;
var itx=samplerInTangent.data[mCount][0],ity;
var otx=samplerOutTangent.data[mCount][0],oty;
if(controlTarget === enums.motion.ROT){
ity=samplerInTangent.data[mCount][1];
oty=samplerOutTangent.data[mCount][1];
k.param[0]=itx-k.time;
k.param[1]=ity-k.value+ofs;
k.param[2]=otx-k.time;
k.param[3]=oty-k.value+ofs;
}else{
ity=collada_tools.fixukaxis(clib.up_axis,controlTarget,ival,samplerInTangent.data[mCount][1]);
oty=collada_tools.fixukaxis(clib.up_axis,controlTarget,ival,samplerOutTangent.data[mCount][1]);
k.param[0]=itx-k.time;
k.param[1]=ity-k.value;
k.param[2]=otx-k.time;
k.param[3]=oty-k.value;
}
}
}
}
}
}
}
}
}
}
var sceneRef=null;
if(clib.scene){
sceneRef=scenesRef[clib.scene];
}else{
sceneRef=scenesRef.pop();
}
return sceneRef;
}
var exports={
loadCollada:cubicvr_loadCollada,parseCollada:cubicvr_parseCollada
};
return exports;
});
CubicVR.RegisterModule("GML",function(base){
var undef=base.undef;
var GLCore=base.GLCore;
var enums=CubicVR.enums;
function GML(srcUrl){
var util=CubicVR.util;
this.strokes=[];
this.bounds=[1,1,1];
this.origin=[0,0,0];
this.upvector=[0,1,0];
this.viewvector=[0,0,1];
this.manual_pos=0;
if(srcUrl === undef){
return;
}
var gml=util.getXML(srcUrl);
var gml_header=gml.getElementsByTagName("header");
if(!gml_header.length){
return null;
}
var header=gml_header[0];
var gml_environment=gml.getElementsByTagName("environment");
if(!gml_environment.length){
return null;
}
this.name=null;
var gml_name=header.getElementsByTagName("name");
if(gml_name.length){
this.name=util.collectTextNode(gml_name[0]);
}
var gml_screenbounds=gml_environment[0].getElementsByTagName("screenBounds");
if(gml_screenbounds.length){
this.bounds=[parseFloat(util.collectTextNode(gml_screenbounds[0].getElementsByTagName("x")[0])),parseFloat(util.collectTextNode(gml_screenbounds[0].getElementsByTagName("y")[0])),parseFloat(util.collectTextNode(gml_screenbounds[0].getElementsByTagName("z")[0]))];
}
var gml_origin=gml_environment[0].getElementsByTagName("origin");
if(gml_origin.length){
this.origin=[parseFloat(util.collectTextNode(gml_origin[0].getElementsByTagName("x")[0])),parseFloat(util.collectTextNode(gml_origin[0].getElementsByTagName("y")[0])),parseFloat(util.collectTextNode(gml_origin[0].getElementsByTagName("z")[0]))];
}
var gml_upvector=gml_environment[0].getElementsByTagName("up");
if(gml_upvector.length){
this.upvector=[parseFloat(util.collectTextNode(gml_upvector[0].getElementsByTagName("x")[0])),parseFloat(util.collectTextNode(gml_upvector[0].getElementsByTagName("y")[0])),parseFloat(util.collectTextNode(gml_upvector[0].getElementsByTagName("z")[0]))];
}
var gml_drawings=gml.getElementsByTagName("drawing");
var drawings=[];
for(var dCount=0,dMax=gml_drawings.length; dCount<dMax; dCount++){
var drawing=gml_drawings[dCount];
var gml_strokes=drawing.getElementsByTagName("stroke");
var xm=0,ym=0,zm=0,tm=0;
for(var sCount=0,sMax=gml_strokes.length; sCount<sMax; sCount++){
var gml_stroke=gml_strokes[sCount];
var gml_points=gml_stroke.getElementsByTagName("pt");
var plen=gml_points.length;
var points=new Array(plen);
var px,py,pz,pt;
for(var pCount=0,pMax=plen; pCount<pMax; pCount++){
var gml_point=gml_points[pCount];
px=parseFloat(util.collectTextNode(gml_point.getElementsByTagName("x")[0]));
py=parseFloat(util.collectTextNode(gml_point.getElementsByTagName("y")[0]));
pz=parseFloat(util.collectTextNode(gml_point.getElementsByTagName("z")[0]));
pt=parseFloat(util.collectTextNode(gml_point.getElementsByTagName("time")[0]));
if(this.upvector[0] === 1){
points[pCount]=[(py !== py)?0:py,(px !== px)?0:-px,(pz !== pz)?0:pz,pt];
}else if(this.upvector[1] === 1){
points[pCount]=[(px !== px)?0:px,(py !== py)?0:py,(pz !== pz)?0:pz,pt];
}else if(this.upvector[2] === 1){
points[pCount]=[(px !== px)?0:px,(pz !== pz)?0:-pz,(py !== py)?0:py,pt];
}
if(xm<px){
xm=px;
}
if(ym<py){
ym=py;
}
if(zm<pz){
zm=pz;
}
if(tm<pt){
tm=pt;
}
}
if(zm>tm){ // fix swapped Z/Time
for(var i=0,iMax=points.length; i<iMax; i++){
var t=points[i][3];
points[i][3]=points[i][2];
points[i][2]=t/this.bounds[2];
}
}
this.strokes[sCount]=points;
}
}
}
GML.prototype={
addStroke:function(points,tstep){
var pts=[];
if(tstep === undef){
tstep=0.1;
}
for(var i=0,iMax=points.length; i<iMax; i++){
var ta=[points[i][0],points[i][1],points[i][2]];
this.manual_pos+=tstep;
ta.push(this.manual_pos);
pts.push(ta);
}
this.strokes.push(pts);
},recenter:function(){
var vec3=CubicVR.vec3;
var min=[0,0,0];
var max=[this.strokes[0][0][0],this.strokes[0][0][1],this.strokes[0][0][2]];
var i,iMax,s,sMax;
for(s=0, sMax=this.strokes.length; s<sMax; s++){
for(i=0, iMax=this.strokes[s].length; i<iMax; i++){
if(min[0]>this.strokes[s][i][0]){
min[0]=this.strokes[s][i][0];
}
if(min[1]>this.strokes[s][i][1]){
min[1]=this.strokes[s][i][1];
}
if(min[2]>this.strokes[s][i][2]){
min[2]=this.strokes[s][i][2];
}
if(max[0]<this.strokes[s][i][0]){
max[0]=this.strokes[s][i][0];
}
if(max[1]<this.strokes[s][i][1]){
max[1]=this.strokes[s][i][1];
}
if(max[2]<this.strokes[s][i][2]){
max[2]=this.strokes[s][i][2];
}
}
}
var center=vec3.multiply(vec3.subtract(max,min),0.5);
for(s=0, sMax=this.strokes.length; s<sMax; s++){
for(i=0, iMax=this.strokes[s].length; i<iMax; i++){
this.strokes[s][i][0]=this.strokes[s][i][0]-center[0];
this.strokes[s][i][1]=this.strokes[s][i][1]-(this.upvector[1]?center[1]:(-center[1]));
this.strokes[s][i][2]=this.strokes[s][i][2]-center[2];
}
}
},generateObject:function(seg_mod,extrude_depth,pwidth,divsper,do_zmove){
var vec3=CubicVR.vec3;
if(seg_mod === undef){
seg_mod=0;
}
if(extrude_depth === undef){
extrude_depth=0;
}
if(do_zmove === undef){
do_zmove=false;
}
var divs=3;
if(divsper === undef) divsper=0.02;
if(pwidth === undef) pwidth=0.015;
var extrude=extrude_depth !== 0;
var segCount=0;
var faceSegment=0;
var obj=new CubicVR.Mesh(this.name);
var lx,ly,lz,lt;
var i,iMax,pCount;
for(var sCount=0,sMax=this.strokes.length; sCount<sMax; sCount++){
var strokeEnvX=new CubicVR.Envelope();
var strokeEnvY=new CubicVR.Envelope();
var strokeEnvZ=new CubicVR.Envelope();
var pMax=this.strokes[sCount].length;
var d=0;
var len_set=[];
var time_set=[];
var start_time=0;
var strk=this.strokes[sCount];
for(pCount=0; pCount<pMax; pCount++){
var pt=strk[pCount];
var k1=strokeEnvX.addKey(pt[3],pt[0]);
var k2=strokeEnvY.addKey(pt[3],pt[1]);
var k3;
if(do_zmove){
k3=strokeEnvZ.addKey(pt[3],pt[2]);
}else{
k3=strokeEnvZ.addKey(pt[3],0);
}
k1.tension=0.5;
k2.tension=0.5;
k3.tension=0.5;
if(pCount !== 0){
var dx=pt[0]-lx;
var dy=pt[1]-ly;
var dz=pt[2]-lz;
var dt=pt[3]-lt;
var dlen=Math.sqrt(dx*dx+dy*dy+dz*dz);
d+=dlen;
len_set[pCount-1]=dlen;
time_set[pCount-1]=dt;
}else{
start_time=pt[3];
}
lx=pt[0];
ly=pt[1];
lz=pt[2];
lt=pt[3];
}
var dpos=start_time;
var ptofs=obj.points.length;
for(pCount=0; pCount<len_set.length; pCount++){
var segLen=len_set[pCount];
var segTime=time_set[pCount];
var segNum=Math.ceil((segLen/divsper)*divs);
for(var t=dpos,tMax=dpos+segTime,tInc=(segTime/segNum); t<(tMax-tInc); t+=tInc){
if(t === dpos){
lx=strokeEnvX.evaluate(t);
ly=strokeEnvY.evaluate(t);
lz=strokeEnvZ.evaluate(t);
}
var px,py,pz;
px=strokeEnvX.evaluate(t+tInc);
py=strokeEnvY.evaluate(t+tInc);
pz=strokeEnvZ.evaluate(t+tInc);
var pdx=(px-lx),pdy=py-ly,pdz=pz-lz;
var pd=Math.sqrt(pdx*pdx+pdy*pdy+pdz*pdz);
var a;
a=vec3.multiply(vec3.normalize(vec3.cross(this.viewvector,vec3.normalize([pdx,pdy,pdz]))),pwidth/2.0);
obj.addPoint([lx-a[0],-(ly-a[1]),(lz-a[2])+(extrude?(extrude_depth/2.0):0)]);
obj.addPoint([lx+a[0],-(ly+a[1]),(lz+a[2])+(extrude?(extrude_depth/2.0):0)]);
lx=px;
ly=py;
lz=pz;
}
dpos+=segTime;
}
var ptlen=obj.points.length;
if(extrude){
for(i=ptofs, iMax=ptlen; i<iMax; i++){
obj.addPoint([obj.points[i][0],obj.points[i][1],obj.points[i][2]-(extrude?(extrude_depth/2.0):0)]);
}
}
for(i=0, iMax=ptlen-ptofs; i<=iMax-4; i+=2){
if(segCount%seg_mod === 0){
faceSegment++;
}
obj.setSegment(faceSegment);
var arFace=[ptofs+i,ptofs+i+1,ptofs+i+3,ptofs+i+2];
var faceNum=obj.addFace(arFace);
if(extrude){
var arFace2=[arFace[3]+ptlen-ptofs,arFace[2]+ptlen-ptofs,arFace[1]+ptlen-ptofs,arFace[0]+ptlen-ptofs];
faceNum=obj.addFace(arFace2);
arFace2=[ptofs+i,ptofs+i+2,ptofs+i+2+ptlen-ptofs,ptofs+i+ptlen-ptofs];
faceNum=obj.addFace(arFace2);
arFace2=[ptofs+i+1+ptlen-ptofs,ptofs+i+3+ptlen-ptofs,ptofs+i+3,ptofs+i+1];
faceNum=obj.addFace(arFace2);
if(i === 0){
arFace2=[ptofs+i+ptlen-ptofs,ptofs+i+1+ptlen-ptofs,ptofs+i+1,ptofs+i];
faceNum=obj.addFace(arFace2);
}
if(i === iMax-4){
arFace2=[ptofs+i+2,ptofs+i+3,ptofs+i+3+ptlen-ptofs,ptofs+i+2+ptlen-ptofs];
faceNum=obj.addFace(arFace2);
}
}
segCount++;
}
}
obj.calcFaceNormals();
obj.triangulateQuads();
obj.calcNormals();
obj.compile();
return obj;
}
};
var extend={
GML:GML
};
return extend;
});
CubicVR.RegisterModule("PDF",function(base){
var undef=base.undef;
var GLCore=base.GLCore;
var enums=CubicVR.enums;
function PDF(options){
if(!options.src){
throw("PDF Error: you must specify a src url for a PDF.");
}
var src=options.src,width=options.width || null,height=options.height || null,callback=options.callback || function(){},pdf,pages=[],thumbnails=[];
this.__defineGetter__('pages',function(){
return pdf?pdf.numPages:0;
});
this.getPage=function(n){
//            return;
var pageCount=pdf.numPages;
n=n<1?1:n;
n=n>pageCount?pageCount:n;
n=n-1;
return pages[n];
};
this.getPageTexture=function(n,width,height){
var page=this.getPage(n);
width=width || page.width;
height=height || page.height;
return new CubicVR.PdfTexture(page,{width:width,height:height});
};
getPdf({
url:src,error:function(){
console.log('PDF Error: error loading pdf `'+src+'`');
}
},function(data){
pdf=new PDFDoc(data);
for(var i=1,pp=pdf.numPages; i<=pp; i++){
var page=pdf.getPage(i);
pages.push(page);
thumbnails.push(page);
}
callback();
});
}
var extend={
PDF:PDF
};
return extend;
});
CubicVR.RegisterModule("Particles",function(base){
var undef=base.undef;
var GLCore=base.GLCore;
var enums=CubicVR.enums;
function Particle(pos,start_time,life_time,velocity,accel){
this.startpos=new Float32Array(pos);
this.pos=new Float32Array(pos);
this.velocity=new Float32Array((velocity !== undef)?velocity:[0,0,0]);
this.accel=new Float32Array((accel !== undef)?accel:[0,0,0]);
this.start_time=(start_time !== undef)?start_time:0;
this.life_time=(life_time !== undef)?life_time:0;
this.color=null;
this.nextParticle=null;
}
function ParticleSystem(maxPts,hasColor,pTex,vWidth,vHeight,alpha,alphaCut){
var gl=GLCore.gl;
if(!maxPts){
return;
}
this.particles=null;
this.last_particle=null;
this.pTex=(pTex !== undef)?pTex:null;
this.vWidth=vWidth;
this.vHeight=vHeight;
this.alpha=(alpha !== undef)?alpha:false;
this.alphaCut=(alphaCut !== undef)?alphaCut:0;
this.pfunc=function(p,time){
var tdelta=time-p.start_time;
if(tdelta<0){
return 0;
}
if(tdelta>p.life_time && p.life_time){
return -1;
}
p.pos[0]=p.startpos[0]+(tdelta*p.velocity[0])+(tdelta*tdelta*p.accel[0]);
p.pos[1]=p.startpos[1]+(tdelta*p.velocity[1])+(tdelta*tdelta*p.accel[1]);
p.pos[2]=p.startpos[2]+(tdelta*p.velocity[2])+(tdelta*tdelta*p.accel[2]);
if(this.pgov !== null){
this.pgov(p,time);
}
return 1;
};
this.pgov=null;
if(hasColor === undef){
this.hasColor=false;
}else{
this.hasColor=hasColor;
}
var hasTex=(this.pTex !== null);
this.vs=["#ifdef GL_ES","precision highp float;","#endif","attribute vec3 aVertexPosition;",this.hasColor?"attribute vec3 aColor;":"","uniform mat4 uMVMatrix;","uniform mat4 uPMatrix;","varying vec4 color;","varying vec2 screenPos;",hasTex?"varying float pSize;":"","void main(void) {","vec4 position = uPMatrix * uMVMatrix * vec4(aVertexPosition,1.0);",hasTex?"screenPos=vec2(position.x/position.w,position.y/position.w);":"","gl_Position = position;",this.hasColor?"color = vec4(aColor.r,aColor.g,aColor.b,1.0);":"color = vec4(1.0,1.0,1.0,1.0);",hasTex?"pSize=200.0/position.z;":"float pSize=200.0/position.z;","gl_PointSize = pSize;","}"].join("\n");
this.fs=["#ifdef GL_ES","precision highp float;","#endif",hasTex?"uniform sampler2D pMap;":"","varying vec4 color;",hasTex?"varying vec2 screenPos;":"",hasTex?"uniform vec3 screenDim;":"",hasTex?"varying float pSize;":"","void main(void) {","vec4 c = color;",hasTex?"vec2 screen=vec2((gl_FragCoord.x/screenDim.x-0.5)*2.0,(gl_FragCoord.y/screenDim.y-0.5)*2.0);":"",hasTex?"vec2 pointCoord=vec2( ((screen.x-screenPos.x)/(pSize/screenDim.x))/2.0+0.5,((screen.y-screenPos.y)/(pSize/screenDim.y))/2.0+0.5);":"",hasTex?"vec4 tc = texture2D(pMap,pointCoord); gl_FragColor = vec4(c.rgb*tc.rgb,1.0);":"gl_FragColor = c;","}"].join("\n");
this.maxPoints=maxPts;
this.numParticles=0;
this.arPoints=new Float32Array(maxPts*3);
this.glPoints=null;
if(hasColor){
this.arColor=new Float32Array(maxPts*3);
this.glColor=null;
}
this.shader_particle=new CubicVR.Shader(this.vs,this.fs);
this.shader_particle.use();
this.shader_particle.addVertexArray("aVertexPosition");
if(this.hasColor){
this.shader_particle.addVertexArray("aColor");
}
this.shader_particle.addMatrix("uMVMatrix");
this.shader_particle.addMatrix("uPMatrix");
if(this.pTex !== null){
this.shader_particle.addInt("pMap",0);
this.shader_particle.addVector("screenDim");
this.shader_particle.setVector("screenDim",[vWidth,vHeight,0]);
}
this.genBuffer();
}
ParticleSystem.prototype={
resizeView:function(vWidth,vHeight){
this.vWidth=vWidth;
this.vHeight=vHeight;
if(this.pTex !== null){
this.shader_particle.addVector("screenDim");
this.shader_particle.setVector("screenDim",[vWidth,vHeight,0]);
}
},addParticle:function(p){
if(this.last_particle === null){
this.particles=p;
this.last_particle=p;
}else{
this.last_particle.nextParticle=p;
this.last_particle=p;
}
},genBuffer:function(){
var gl=GLCore.gl;
this.glPoints=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,this.glPoints);
gl.bufferData(gl.ARRAY_BUFFER,this.arPoints,gl.DYNAMIC_DRAW);
if(this.hasColor){
this.glColor=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,this.glColor);
gl.bufferData(gl.ARRAY_BUFFER,this.arColor,gl.DYNAMIC_DRAW);
}
},updatePoints:function(){
var gl=GLCore.gl;
gl.bindBuffer(gl.ARRAY_BUFFER,this.glPoints);
gl.bufferData(gl.ARRAY_BUFFER,this.arPoints,gl.DYNAMIC_DRAW);
},updateColors:function(){
var gl=GLCore.gl;
if(!this.hasColor){
return;
}
gl.bindBuffer(gl.ARRAY_BUFFER,this.glColor);
gl.bufferData(gl.ARRAY_BUFFER,this.arColor,gl.DYNAMIC_DRAW);
},draw:function(modelViewMat,projectionMat,time){
var gl=GLCore.gl;
this.shader_particle.use();
if(this.pTex !== null){
this.pTex.use(gl.TEXTURE0);
}
this.shader_particle.setMatrix("uMVMatrix",modelViewMat);
this.shader_particle.setMatrix("uPMatrix",projectionMat);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,null);
gl.bindBuffer(gl.ARRAY_BUFFER,this.glPoints);
gl.vertexAttribPointer(this.shader_particle.uniforms["aVertexPosition"],3,gl.FLOAT,false,0,0);
gl.enableVertexAttribArray(this.shader_particle.uniforms["aVertexPosition"]);
if(this.hasColor){
gl.bindBuffer(gl.ARRAY_BUFFER,this.glColor);
gl.vertexAttribPointer(this.shader_particle.uniforms["aColor"],3,gl.FLOAT,false,0,0);
gl.enableVertexAttribArray(this.shader_particle.uniforms["aColor"]);
}
if(time !== undef){
this.numParticles=0;
if(this.particles === null){
gl.disable(gl.BLEND);
return;
}
var p=this.particles;
var lp=null;
var c=0;
while(p !== null){
var ofs=this.numParticles*3;
var pf=this.pfunc(p,time);
if(pf === 1){
this.arPoints[ofs]=p.pos[0];
this.arPoints[ofs+1]=p.pos[1];
this.arPoints[ofs+2]=p.pos[2];
if(p.color !== null && this.arColor !== undef){
this.arColor[ofs]=p.color[0];
this.arColor[ofs+1]=p.color[1];
this.arColor[ofs+2]=p.color[2];
}
this.numParticles++;
c++;
if(this.numParticles === this.maxPoints){
break;
}
}else if(pf === -1) // particle death
{
if(lp !== null){
lp.nextParticle=p.nextParticle;
}
}else if(pf === 0){
c++;
}
lp=p;
p=p.nextParticle;
}
if(!c){
this.particles=null;
this.last_particle=null;
}
this.updatePoints();
if(this.hasColor){
this.updateColors();
}
}
if(this.alpha){
gl.enable(gl.BLEND);
gl.enable(gl.DEPTH_TEST);
gl.depthMask(0);
gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_COLOR);
}
gl.drawArrays(gl.POINTS,0,this.numParticles);
if(this.alpha){
gl.disable(gl.BLEND);
gl.depthMask(1);
gl.blendFunc(gl.ONE,gl.ONE);
}
if(this.hasColor){
gl.disableVertexAttribArray(this.shader_particle.uniforms["aColor"]);
}
}
};
var extend={
ParticleSystem:ParticleSystem,Particle:Particle
};
return extend;
});
CubicVR.RegisterModule("HeightField",function(base){
var undef=base.undef;
var enums=base.enums;
var GLCore=base.GLCore;
var cubicvr_identity=[1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0];
var M_TWO_PI=2.0*Math.PI;
var M_HALF_PI=Math.PI/2.0;
var heightfield_enums={};
enums.heightfield=heightfield_enums;
function HeightField(opt){
opt=opt || {};
opt=base.get(opt);
this.size=opt.size;
this.material=opt.material || (new base.Material());
this.divX=opt.divX | 0;
this.divZ=opt.divZ | 0;
this.obj=null;
if(this.divX>this.divZ){
this.sizeX=this.size;
this.sizeZ=(this.size/this.divX)*this.divZ;
}else if(this.divZ>this.divX){
this.sizeX=(this.size/this.divZ)*this.divX;
this.sizeZ=this.size;
}else{
this.sizeX=this.size;
this.sizeZ=this.size;
}
}
HeightField.prototype={
getMesh:function(){
if(this.obj === null){
this.obj=this.genMesh();
}
return this.obj;
},setIndexedHeight:function(ipos,jpos,val){
obj.points[(ipos)+(jpos*this.divX)][1]=val;
},genMesh:function(){
var obj=new base.Mesh({dynamic:true,buildWireframe:true});
var i,j;
for(j= -(this.sizeZ/2.0); j<(this.sizeZ/2.0); j+=(this.sizeZ/this.divZ)){
for(i= -(this.sizeX/2.0); i<(this.sizeX/2.0); i+=(this.sizeX/this.divX)){
obj.addPoint([i+((this.sizeX/(this.divX))/2.0),0,j+((this.sizeZ/(this.divZ))/2.0)]);
}
}
var k,l;
obj.setFaceMaterial(this.material);
for(l=0; l<this.divZ-1; l++){
for(k=0; k<this.divX-1; k++){
obj.addFace([(k)+((l+1)*this.divX),(k+1)+((l)*this.divX),(k)+((l)*this.divX)]);
obj.addFace([(k)+((l+1)*this.divX),(k+1)+((l+1)*this.divX),(k+1)+((l)*this.divX)]);
}
}
return obj;
},mapGen:function(opt){
var w_func=opt.src || function(){ return 0; };
var ipos=opt.startX || 0;
var jpos=opt.startZ || 0;
var ilen=opt.walkX;
var jlen=opt.walkZ;
var pt,i,imax;
if(ipos !== undef && jpos !== undef && ilen !== undef && jlen !== undef){
if(ipos>=this.divX) return;
if(jpos>=this.divZ) return;
if(ipos+ilen>=this.divX) ilen=this.divX-1-ipos;
if(jpos+jlen>=this.divZ) jlen=this.divZ-1-jpos;
if(ilen<=0 || jlen<=0) return;
for(i=ipos, imax=ipos+ilen; i<imax; i++){
for(var j=jpos,jmax=jpos+jlen; j<jmax; j++){
var t=(i)+(j*this.divX);
pt=this.obj.points[t];
pt[1]=w_func(pt[0],pt[2],t);
}
}
}else{
for(i=0, imax=this.obj.points.length; i<imax; i++){
pt=this.obj.points[i];
pt[1]=w_func(pt[0],pt[2],i);
}
}
},getFaceAt:function(x,z){
if(typeof (x) === 'object'){
return this.getFaceAt(x[0],x[2]);
}
var ofs_w=(this.sizeX/2.0)-((this.sizeX/(this.divX))/2.0);
var ofs_h=(this.sizeZ/2.0)-((this.sizeZ/(this.divZ))/2.0);
var i=parseInt(Math.floor(((x+ofs_w)/this.sizeX)*(this.divX)),10);
var j=parseInt(Math.floor(((z+ofs_h)/this.sizeZ)*(this.divZ)),10);
if(i<0){
return -1;
}
if(i>=this.divX-1){
return -1;
}
if(j<0){
return -1;
}
if(j>=this.divZ-1){
return -1;
}
var faceNum1=parseInt(i+(j*(this.divX-1)),10)*2;
var faceNum2=parseInt(faceNum1+1,10);
var testPt=this.obj.points[this.obj.faces[faceNum1].points[0]];
var slope=Math.abs(z-testPt[2])/Math.abs(x-testPt[0]);
if(slope>=1.0){
return (faceNum1);
}else{
return (faceNum2);
}
},getHeightValue:function(x,z){
var triangle=base.triangle;
if(typeof (x) === 'object'){
return this.getHeightValue(x[0],x[2]);
}
var tmpFace;
var tmpPoint;
var faceNum=this.getFaceAt(x,z);
if(faceNum === -1){
return 0;
}
tmpFace=this.obj.faces[faceNum];
tmpPoint=this.obj.points[this.obj.faces[faceNum].points[0]];
var tmpNorm=triangle.normal(this.obj.points[this.obj.faces[faceNum].points[0]],this.obj.points[this.obj.faces[faceNum].points[1]],this.obj.points[this.obj.faces[faceNum].points[2]]);
var na=tmpNorm[0];
var nb=tmpNorm[1];
var nc=tmpNorm[2];
var d=-(na*tmpPoint[0])-(nb*tmpPoint[1])-(nc*tmpPoint[2]);
return (((na*x)+(nc*z)+d)/(-nb)); // add height ofs here
}
};
var exports={
HeightField:HeightField
};
return exports;
});
CubicVR.RegisterModule("Landscape",function(base){
var undef=base.undef;
var enums=base.enums;
var GLCore=base.GLCore;
var cubicvr_identity=[1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0];
var M_TWO_PI=2.0*Math.PI;
var M_HALF_PI=Math.PI/2.0;
var Landscape=base.extendClassGeneral(base.SceneObject,function(){
this.heightfield=new base.HeightField({
size:arguments[0],divX:arguments[1],divZ:arguments[2],material:arguments[3]
});
base.SceneObject.apply(this,[{mesh:this.heightfield.getMesh()}]);
},{ // subclass functions
setIndexedHeight:function(ipos,jpos,val){
var obj=this.obj;
obj.points[(ipos)+(jpos*this.divisions_w)][1]=val;
},mapGen:function(w_func,ipos,jpos,ilen,jlen){
this.heightfield.mapGen({
src:w_func,startX:ipos,startZ:jpos,walkX:ilen,walkZ:jlen
});
},getFaceAt:function(x,z){
return this.heightfield.getFaceAt([x,0,z]);
},getHeightValue:function(x,z,transform){
if(transform !== undef){
}
return this.heightfield.getHeightValue([x,0,z]);
},orient:function(x,z,width,length,heading,center){
if(center === undef){
center=0;
}
var xpos,zpos;
var xrot,zrot;
var heightsample=[];
var xyzTmp;
var halfw=width/2.0;
var halfl=length/2.0;
var mag=Math.sqrt(halfl*halfl+halfw*halfw);
var ang=Math.atan2(halfl,halfw);
heading*=(Math.PI/180.0);
xpos=x+(Math.sin(heading)*center);
zpos=z+(Math.cos(heading)*center);
heightsample[0]=this.getHeightValue([xpos+mag*Math.cos(-ang-M_HALF_PI+heading),0,zpos+mag* -Math.sin(-ang-M_HALF_PI+heading)]);
heightsample[1]=this.getHeightValue([xpos+mag*Math.cos(ang-M_HALF_PI+heading),0,zpos+mag*(-Math.sin(ang-M_HALF_PI+heading))]);
heightsample[2]=this.getHeightValue([xpos+mag*Math.cos(-ang+M_HALF_PI+heading),0,zpos+mag*(-Math.sin(-ang+M_HALF_PI+heading))]);
heightsample[3]=this.getHeightValue([xpos+mag*Math.cos(ang+M_HALF_PI+heading),0,zpos+mag*(-Math.sin(ang+M_HALF_PI+heading))]);
xrot= -Math.atan2((heightsample[1]-heightsample[2]),width);
zrot= -Math.atan2((heightsample[0]-heightsample[1]),length);
xrot+= -Math.atan2((heightsample[0]-heightsample[3]),width);
zrot+= -Math.atan2((heightsample[3]-heightsample[2]),length);
xrot/=2.0; // average angles
zrot/=2.0;
return [[x,((heightsample[2]+heightsample[3]+heightsample[1]+heightsample[0]))/4.0,z], //
[xrot*(180.0/Math.PI),heading,zrot*(180.0/Math.PI)]];
}
});
var exports={
Landscape:Landscape
};
return exports;
});
CubicVR.RegisterModule("Octree",function(base){
var undef=base.undef;
var GLCore=base.GLCore;
var Plane=base.plane;
var Sphere=base.sphere;
var enums=base.enums;
enums.frustum={
plane:{
LEFT:0,RIGHT:1,TOP:2,BOTTOM:3,NEAR:4,FAR:5
}
};
enums.octree={
TOP_NW:0,TOP_NE:1,TOP_SE:2,TOP_SW:3,BOTTOM_NW:4,BOTTOM_NE:5,BOTTOM_SE:6,BOTTOM_SW:7
};
function OctreeWorkerProxy(size,depth){
var that=this;
this.size=size;
this.depth=depth;
this.worker=new base_Worker({
message:function(e){
console.log('Octree Worker Message:',e);
},error:function(e){
console.log('Octree Worker Error:',e);
},type:'octree'
});
this.worker.start();
this.init=function(scene){
that.scene=scene;
that.worker.init({
size:that.size,max_depth:that.depth,camera:scene.camera
});
}; //init
this.insert=function(node){
that.worker.send({message:'insert',node:node});
}; //insert
this.draw_on_map=function(){
return;
}; //draw_on_map
this.reset_node_visibility=function(){
return;
}; //reset_node_visibility
this.get_frustum_hits=function(){
}; //get_frustum_hits
} //OctreeWorkerProxy
function Octree(size,max_depth,root,position,child_index){
var children=this._children=[];
this._dirty=false;
children[0]=null;
children[1]=null;
children[2]=null;
children[3]=null;
children[4]=null;
children[5]=null;
children[6]=null;
children[7]=null;
child_index=this._child_index=child_index || -1;
root=this._root=root || null;
max_depth=this._max_depth=max_depth || 0;
size=this._size=size || 0;
position=this._position=position || [0,0,0];
this._nodes=[];
this._lights=[];
this._static_lights=[];
var sphere=this._sphere=[position[0],position[1],position[2],Math.sqrt(3*(this._size/2*this._size/2))];
var bbox=this._bbox=[[0,0,0],[0,0,0]];
var aabbMath=base.aabb;
aabbMath.reset(bbox,position);
var s=size/2;
aabbMath.engulf(bbox,[position[0]+s,position[1]+s,position[2]+s]);
aabbMath.engulf(bbox,[position[0]-s,position[1]-s,position[2]-s]);
this._debug_visible=false;
} //Octree::Constructor
var Array_remove=function(arr,from,to){
var rest=arr.slice((to || from)+1 || arr.length);
arr.length=from<0?arr.length+from:from;
return arr.push.apply(arr,rest);
};
Octree.prototype.destroy=function(){
var i,li,light;
for(i=0, li=this._static_lights.length; i<li; ++i){
light=this._static_lights[i];
light.octree_leaves=null;
light.octree_common_root=null;
light.octree_aabb=null;
} //for
for(i=0, li=this._lights.length; i<li; ++i){
light=this._lights[i];
light.octree_leaves=null;
light.octree_common_root=null;
light.octree_aabb=null;
} //for
this._static_lights=null;
this._lights=null;
for(i=0, li=this._children.length; i<li; ++i){
if(this._children[i] !== null){
this._children[i].destroy();
} //if
} //for
for(i=0, li=this._nodes.length; i<li; ++i){
var node=this._nodes[i];
node.octree_leaves=null;
node.octree_common_root=null;
node.octree_aabb=null;
node.dynamic_lights=[];
node.static_lights=[];
} //for
this._children[0]=null;
this._children[1]=null;
this._children[2]=null;
this._children[3]=null;
this._children[4]=null;
this._children[5]=null;
this._children[6]=null;
this._children[7]=null;
this._children=null;
this._root=null;
this._position=null;
this._nodes=null;
this._lights=null;
this._static_lights=null;
this._sphere=null;
this._bbox=null;
}; //Octree::destroy
Octree.prototype.toString=function(){
var real_size=[this._bbox[1][0]-this._bbox[0][0],this._bbox[1][2]-this._bbox[0][2]];
return "[Octree: @"+this._position+", depth: "+this._max_depth+", size: "+this._size+", nodes: "+this._nodes.length+", measured size:"+real_size+"]";
}; //Octree::toString
Octree.prototype.remove=function(node){
var dont_check_lights=false;
var len=this._nodes.length;
var i;
for(i=len-1, len=this._nodes.length; i>=0; --i){
if(node === this._nodes[i]){
Array_remove(this._nodes,i);
this.dirty_lineage();
dont_check_lights=true;
break;
} //if
} //for
if(!dont_check_lights){
for(i=len-1, len=this._lights.length; i>=0; --i){
if(node === this._lights[i]){
Array_remove(this._lights,i);
this.dirty_lineage();
break;
} //if
} //for
} //if
}; //Octree::remove
Octree.prototype.dirty_lineage=function(){
this._dirty=true;
if(this._root !== null){ this._root.dirty_lineage(); }
}; //Octree::dirty_lineage
Octree.prototype.cleanup=function(){
var num_children=this._children.length;
var num_keep_children=0;
for(var i=0; i<num_children; ++i){
var child=this._children[i];
if(child !== null){
var keep=true;
if(child._dirty === true){
keep=child.cleanup();
} //if
if(!keep){
this._children[i]=null;
}else{
++num_keep_children;
}
} //if
} //for
if((this._nodes.length === 0 && this._static_lights.length === 0 && this._lights.length === 0) && (num_keep_children === 0 || num_children === 0)){
return false;
}
return true;
}; //Octree::cleanup
Octree.prototype.insert_light=function(light){
this.insert(light,true);
}; //insert_light
Octree.prototype.propagate_static_light=function(light){
var i,l;
for(i=0, l=this._nodes.length; i<l; ++i){
if(this._nodes[i].static_lights.indexOf(light) === -1){
this._nodes[i].static_lights.push(light);
} //if
} //for
for(i=0; i<8; ++i){
if(this._children[i] !== null){
this._children[i].propagate_static_light(light);
} //if
} //for
}; //propagate_static_light
Octree.prototype.collect_static_lights=function(node){
var i,li;
for(i=0, li=this._static_lights.length; i<li; ++i){
if(node.static_lights.indexOf(this._static_lights[i]) === -1){
node.static_lights.push(this._static_lights[i]);
} //if
} //for
for(i=0; i<8; ++i){
if(this._children[i] !== null){
this._children[i].collect_static_lights(node);
} //if
} //for
}; //collect_static_lights
Octree.prototype.insert=function(node,is_light){
if(is_light === undef){ is_light=false; }
function $insert(octree,node,is_light,root){
var i,li,root_tree;
if(is_light){
if(node.method === enums.light.method.STATIC){
if(octree._static_lights.indexOf(node) === -1){
octree._static_lights.push(node);
} //if
for(i=0, li=octree._nodes.length; i<li; ++i){
if(octree._nodes[i].static_lights.indexOf(node) === -1){
octree._nodes[i].static_lights.push(node);
} //if
} //for
root_tree=octree._root;
while(root_tree !== null){
for(i=0, l=root_tree._nodes.length; i<l; ++i){
var n=root_tree._nodes[i];
if(n.static_lights.indexOf(node) === -1){
n.static_lights.push(node);
} //if
} //for
root_tree=root_tree._root;
} //while
}else{
if(octree._lights.indexOf(node) === -1){
octree._lights.push(node);
} //if
} //if
}else{
octree._nodes.push(node);
for(i=0, li=octree._static_lights.length; i<li; ++i){
if(node.static_lights.indexOf(octree._static_lights[i]) === -1){
node.static_lights.push(octree._static_lights[i]);
} //if
} //for
root_tree=octree._root;
while(root_tree !== null){
for(i=0, li=root_tree._static_lights.length; i<li; ++i){
var light=root_tree._static_lights[i];
if(node.static_lights.indexOf(light) === -1){
node.static_lights.push(light);
} //if
} //for
root_tree=root_tree._root;
} //while
} //if
node.octree_leaves.push(octree);
node.octree_common_root=root;
var aabbMath=base.aabb;
aabbMath.engulf(node.octree_aabb,octree._bbox[0]);
aabbMath.engulf(node.octree_aabb,octree._bbox[1]);
} //$insert
if(this._root === null){
node.octree_leaves=[];
node.octree_common_root=null;
} //if
if(this._max_depth === 0){
$insert(this,node,is_light,this._root);
return;
} //if
var p=this._position;
var t_nw,t_ne,t_sw,t_se,b_nw,b_ne,b_sw,b_se;
var aabb=node.getAABB();
var min=[aabb[0][0],aabb[0][1],aabb[0][2]];
var max=[aabb[1][0],aabb[1][1],aabb[1][2]];
t_nw=min[0]<p[0] && min[1]<p[1] && min[2]<p[2];
t_ne=max[0]>p[0] && min[1]<p[1] && min[2]<p[2];
b_nw=min[0]<p[0] && max[1]>p[1] && min[2]<p[2];
b_ne=max[0]>p[0] && max[1]>p[1] && min[2]<p[2];
t_sw=min[0]<p[0] && min[1]<p[1] && max[2]>p[2];
t_se=max[0]>p[0] && min[1]<p[1] && max[2]>p[2];
b_sw=min[0]<p[0] && max[1]>p[1] && max[2]>p[2];
b_se=max[0]>p[0] && max[1]>p[1] && max[2]>p[2];
if(t_nw && t_ne && b_nw && b_ne && t_sw && t_se && b_sw && b_se){
$insert(this,node,is_light,this);
if(is_light){
if(node.method == enums.light.method.STATIC){
this.propagate_static_light(node);
} //if
}else{
this.collect_static_lights(node);
} //if
}else{
for(var i=0,ii=this._static_lights.length; i<ii; ++i){
if(node.static_lights === undef) node.static_lights=[];
if(node.static_lights.indexOf(this._static_lights[i]) === -1){
node.static_lights.push(this._static_lights[i]);
} //if
} //for
var new_size=this._size/2;
var offset=this._size/4;
var new_position;
var num_inserted=0;
var x=this._position[0];
var y=this._position[1];
var z=this._position[2];
if(t_nw){
new_position=[x-offset,y-offset,z-offset];
if(this._children[enums.octree.TOP_NW] === null){
this._children[enums.octree.TOP_NW]=new Octree(new_size,this._max_depth-1,this,new_position,enums.octree.TOP_NW);
}
this._children[enums.octree.TOP_NW].insert(node,is_light);
++num_inserted;
} //if
if(t_ne){
new_position=[x+offset,y-offset,z-offset];
if(this._children[enums.octree.TOP_NE] === null){
this._children[enums.octree.TOP_NE]=new Octree(new_size,this._max_depth-1,this,new_position,enums.octree.TOP_NE);
}
this._children[enums.octree.TOP_NE].insert(node,is_light);
++num_inserted;
} //if
if(b_nw){
new_position=[x-offset,y+offset,z-offset];
if(this._children[enums.octree.BOTTOM_NW] === null){
this._children[enums.octree.BOTTOM_NW]=new Octree(new_size,this._max_depth-1,this,new_position,enums.octree.BOTTOM_NW);
}
this._children[enums.octree.BOTTOM_NW].insert(node,is_light);
++num_inserted;
} //if
if(b_ne){
new_position=[x+offset,y+offset,z-offset];
if(this._children[enums.octree.BOTTOM_NE] === null){
this._children[enums.octree.BOTTOM_NE]=new Octree(new_size,this._max_depth-1,this,new_position,enums.octree.BOTTOM_NE);
}
this._children[enums.octree.BOTTOM_NE].insert(node,is_light);
++num_inserted;
} //if
if(t_sw){
new_position=[x-offset,y-offset,z+offset];
if(this._children[enums.octree.TOP_SW] === null){
this._children[enums.octree.TOP_SW]=new Octree(new_size,this._max_depth-1,this,new_position,enums.octree.TOP_SW);
}
this._children[enums.octree.TOP_SW].insert(node,is_light);
++num_inserted;
} //if
if(t_se){
new_position=[x+offset,y-offset,z+offset];
if(this._children[enums.octree.TOP_SE] === null){
this._children[enums.octree.TOP_SE]=new Octree(new_size,this._max_depth-1,this,new_position,enums.octree.TOP_SE);
}
this._children[enums.octree.TOP_SE].insert(node,is_light);
++num_inserted;
} //if
if(b_sw){
new_position=[x-offset,y+offset,z+offset];
if(this._children[enums.octree.BOTTOM_SW] === null){
this._children[enums.octree.BOTTOM_SW]=new Octree(new_size,this._max_depth-1,this,new_position,enums.octree.BOTTOM_SW);
}
this._children[enums.octree.BOTTOM_SW].insert(node,is_light);
++num_inserted;
} //if
if(b_se){
new_position=[x+offset,y+offset,z+offset];
if(this._children[enums.octree.BOTTOM_SE] === null){
this._children[enums.octree.BOTTOM_SE]=new Octree(new_size,this._max_depth-1,this,new_position,enums.octree.BOTTOM_SE);
}
this._children[enums.octree.BOTTOM_SE].insert(node,is_light);
++num_inserted;
} //if
if(num_inserted>1 || node.octree_common_root === null){
node.octree_common_root=this;
} //if
} //if
}; //Octree::insert
Octree.prototype.draw_on_map=function(map_canvas,map_context,target){
var mhw=map_canvas.width/2;
var mhh=map_canvas.height/2;
var x,y,w,h;
var i,l,d,n,len;
if(target === undef || target === "map"){
map_context.save();
if(this._debug_visible !== false){
map_context.fillStyle="rgba(0,0,0,0)";
map_context.strokeStyle="#FF0000";
}else{
map_context.fillStyle="rgba(0,0,0,0)";
map_context.strokeStyle="rgba(0,0,0,0)";
} //if
map_context.beginPath();
var offset=this._size/2;
x=this._position[0];
y=this._position[2];
map_context.moveTo(mhw+x-offset,mhw+y-offset);
map_context.lineTo(mhw+x-offset,mhw+y+offset);
map_context.lineTo(mhw+x+offset,mhw+y+offset);
map_context.lineTo(mhw+x+offset,mhw+y-offset);
map_context.stroke();
map_context.fill();
map_context.restore();
}
if(target === undef || target === "objects"){
map_context.save();
for(i=0, len=this._nodes.length; i<len; ++i){
n=this._nodes[i];
map_context.fillStyle="#5500FF";
if(n.visible === true && n.culled === false){
map_context.strokeStyle="#FFFFFF";
}else{
map_context.strokeStyle="#000000";
} //if
map_context.beginPath();
x=n.aabb[0][0];
y=n.aabb[0][2];
w=n.aabb[1][0]-x;
h=n.aabb[1][2]-y;
map_context.rect(mhw+x,mhh+y,w,h);
map_context.stroke();
} //for
map_context.restore();
}
if(target === undef || target === "lights"){
for(i=0, len=this._lights.length; i<len; ++i){
l=this._lights[i];
if(l.culled === false && l.visible === true){
map_context.fillStyle="rgba(255, 255, 255, 0.1)";
}else{
map_context.fillStyle="rgba(255, 255, 255, 0.0)";
}
map_context.strokeStyle="#FFFF00";
map_context.beginPath();
d=l.distance;
x=l.position[0];
y=l.position[2];
map_context.arc(mhw+x,mhh+y,d,0,Math.PI*2,true);
map_context.closePath();
map_context.stroke();
map_context.fill();
map_context.beginPath();
x=l.aabb[0][0];
y=l.aabb[0][2];
w=l.aabb[1][0]-x;
h=l.aabb[1][2]-y;
map_context.rect(mhw+x,mhh+y,w,h);
map_context.closePath();
map_context.stroke();
} //for
for(i=0, len=this._static_lights.length; i<len; ++i){
l=this._static_lights[i];
if(l.culled === false && l.visible === true){
map_context.fillStyle="rgba(255, 255, 255, 0.01)";
}else{
map_context.fillStyle="rgba(255, 255, 255, 0.0)";
}
map_context.strokeStyle="#FF66BB";
map_context.beginPath();
d=l.distance;
x=l.position[0];
y=l.position[2];
map_context.arc(mhw+x,mhh+y,d,0,Math.PI*2,true);
map_context.closePath();
map_context.stroke();
map_context.fill();
map_context.beginPath();
x=l.aabb[0][0];
y=l.aabb[0][2];
w=l.aabb[1][0]-x;
h=l.aabb[1][2]-y;
map_context.rect(mhw+x,mhh+y,w,h);
map_context.closePath();
map_context.stroke();
} //for
} //if
function $draw_box(x1,y1,x2,y2,fill){
var x=x1<x2?x1:x2;
var y=y1<y2?y1:y2;
var w=x1<x2?x2-x1:x1-x2;
var h=y1<y2?y2-y1:y1-y2;
map_context.save();
if(fill !== undefined){
map_context.fillStyle=fill;
map_context.fillRect(mhw+x,mhh+y,w,h);
} //if
map_context.strokeRect(mhw+x,mhh+y,w,h);
map_context.restore();
} //$draw_box
function $draw_oct(oct,fill){
var x1=oct._bbox[0][0];
var y1=oct._bbox[0][2];
var x2=oct._bbox[1][0];
var y2=oct._bbox[1][2];
$draw_box(x1,y1,x2,y2,fill);
} //$draw_oct
if(target != "lights" && target != "objects" && target != "map"){
map_context.save();
var nodes=this._nodes;
for(i=0, l=nodes.length; i<l; ++i){
n=nodes[i];
if(n.name == target){
map_context.strokeStyle="#FFFF00";
map_context.lineWidth=3;
map_context.beginPath();
x=n.aabb[0][0];
y=n.aabb[0][2];
w=n.aabb[1][0]-x;
h=n.aabb[1][2]-y;
map_context.rect(mhw+x,mhh+y,w,h);
map_context.closePath();
map_context.stroke();
var oab=n.octree_aabb;
map_context.strokeStyle="#0000FF";
$draw_box(oab[0][0],oab[0][2],oab[1][0],oab[1][2]);
map_context.lineWidth=1;
if(n.common_root !== null){
map_context.strokeStyle="#00FF00";
} //if
break;
} //if
} //for
map_context.lineWidth=1;
map_context.strokeStyle="#FFFF00";
$draw_oct(this,"#444444");
map_context.fill();
map_context.restore();
} //if
for(i=0, len=this._children.length; i<len; ++i){
if(this._children[i] !== null){
this._children[i].draw_on_map(map_canvas,map_context,target);
}
} //for
}; //Octree::draw_on_map
Octree.prototype.contains_point=function(position){
return position[0]<=this._position[0]+this._size/2 && position[1]<=this._position[1]+this._size/2 && position[2]<=this._position[2]+this._size/2 && position[0]>=this._position[0]-this._size/2 && position[1]>=this._position[1]-this._size/2 && position[2]>=this._position[2]-this._size/2;
}; //Octree::contains_point
Octree.prototype.get_frustum_hits=function(camera,test_children){
var hits={
objects:[],lights:[]
};
if(test_children === undef || test_children === true){
if(!(this.contains_point(camera.position))){
if(Sphere.intersects(camera.frustum.sphere,this._sphere) === false){
return hits;
}
var contains_sphere=camera.frustum.contains_sphere(this._sphere);
if(contains_sphere === -1){
this._debug_visible=false;
return hits;
}else if(contains_sphere === 1){
this._debug_visible=2;
test_children=false;
}else if(contains_sphere === 0){
this._debug_visible=true;
var contains_box=camera.frustum.contains_box(this._bbox);
if(contains_box === -1){
this._debug_visible=false;
return hits;
}else if(contains_box === 1){
this._debug_visible=3;
test_children=false;
} //if
} //if
} //if
} //if
var i,max_i,l;
for(i=0, max_i=this._nodes.length; i<max_i; ++i){
var n=this._nodes[i];
hits.objects.push(n);
n.dynamic_lights=[].concat(this._lights);
n.was_culled=n.culled;
n.culled=false;
n.drawn_this_frame=false;
} //for objects
this._debug_visible=this._lights.length>0?4:this._debug_visible;
for(i=0, max_i=this._lights.length; i<max_i; ++i){
l=this._lights[i];
if(l.visible === true){
hits.lights.push(l);
l.was_culled=l.culled;
l.culled=false;
} //if
} //for dynamic lights
for(i=0, max_i=this._static_lights.length; i<max_i; ++i){
l=this._static_lights[i];
if(l.visible === true){
l.culled=false;
} //if
} //for static lights
for(i=0; i<8; ++i){
if(this._children[i] !== null){
var child_hits=this._children[i].get_frustum_hits(camera,test_children);
var o,max_o;
for(o=0, max_o=child_hits.objects.length; o<max_o; ++o){
hits.objects.push(child_hits.objects[o]);
var obj_lights=child_hits.objects[o].dynamic_lights;
for(var j=0,lj=this._lights.length; j<lj; ++j){
if(obj_lights.indexOf(this._lights[j])<0){
obj_lights.push(this._lights[j]);
} //if
} //for j
} //for o
for(o=0, max_o=child_hits.lights.length; o<max_o; ++o){
if(hits.lights.indexOf(child_hits.lights[o])<0){
hits.lights.push(child_hits.lights[o]);
} //if
} //for o
} //if
} //for
return hits;
}; //Octree::get_frustum_hits
Octree.prototype.reset_node_visibility=function(){
this._debug_visible=false;
var i,l;
for(i=0, l=this._nodes.length; i<l; ++i){
this._nodes[i].culled=true;
} //for
for(i=0, l=this._lights.length; i<l; ++i){
this._lights[i].culled=true;
} //for
for(i=0, l=this._static_lights.length; i<l; ++i){
this._static_lights[i].culled=true;
} //for
for(i=0, l=this._children.length; i<l; ++i){
if(this._children[i] !== null){
this._children[i].reset_node_visibility();
} //if
} //for
}; //Octree::reset_visibility
function OctreeNode(){
this.position=[0,0,0];
this.visible=false;
this._object=null;
} //OctreeNode::Constructor
OctreeNode.prototype.toString=function(){
return "[OctreeNode "+this.position+"]";
}; //OctreeNode::toString
OctreeNode.prototype.attach=function(obj){
this._object=obj;
}; //OctreeNode::attach
function base_OctreeWorker(){
this.octree=null;
this.nodes=[];
this.camera=null;
} //base_OctreeWorker::Constructor
base_OctreeWorker.prototype.onmessage=function(input){
var message=input.message;
if(message === "init"){
var params=input.data;
this.octree=new Octree(params.size,params.max_depth);
this.camera=new Camera();
}else if(type === "set_camera"){
var data=message.data;
this.camera.mvMatrix=data.mvMatrix;
this.camera.pMatrix=data.pMatrix;
this.camera.position=data.position;
this.camera.target=data.target;
this.camera.frustum.extract(this.camera,this.camera.mvMatrix,this.camera.pMatrix);
}else if(type === "insert"){
var json_node=JSON.parse(message.data);
var node=new base.SceneObject();
var trans=new base.Transform();
var i;
for(i in json_node){
if(json_node.hasOwnProperty(i)){
node[i]=json_node[i];
} //if
} //for
for(i in json_node.trans){
if(json_node.trans.hasOwnProperty(i)){
trans[i]=json_node.trans[i];
} //if
} //for
node.trans=trans;
node.id=json_node.id;
this.octree.insert(node);
this.nodes[node.id]=node;
}else if(type === "cleaup"){
this.octree.cleanup();
} //if
}; //onmessage
function FrustumWorkerProxy(worker,camera){
this.camera=camera;
this.worker=worker;
this.draw_on_map=function(map_context){
return;
};
} //FrustumWorkerProxy
FrustumWorkerProxy.prototype.extract=function(camera,mvMatrix,pMatrix){
this.worker.send({
type:"set_camera",data:{
mvMatrix:this.camera.mvMatrix,pMatrix:this.camera.pMatrix,position:this.camera.position,target:this.camera.target
}
});
}; //FrustumWorkerProxy::extract
function Frustum(){
this.last_in=[];
this._planes=[];
this.sphere=null;
for(var i=0; i<6; ++i){
this._planes[i]=[0,0,0,0];
} //for
} //Frustum::Constructor
Frustum.prototype.extract=function(camera,mvMatrix,pMatrix){
var mat4=base.mat4,vec3=base.vec3;
if(mvMatrix === undef || pMatrix === undef){
return;
}
var comboMatrix=mat4.multiply(pMatrix,mvMatrix);
var planes=this._planes;
planes[enums.frustum.plane.LEFT][0]=comboMatrix[3]+comboMatrix[0];
planes[enums.frustum.plane.LEFT][1]=comboMatrix[7]+comboMatrix[4];
planes[enums.frustum.plane.LEFT][2]=comboMatrix[11]+comboMatrix[8];
planes[enums.frustum.plane.LEFT][3]=comboMatrix[15]+comboMatrix[12];
planes[enums.frustum.plane.RIGHT][0]=comboMatrix[3]-comboMatrix[0];
planes[enums.frustum.plane.RIGHT][1]=comboMatrix[7]-comboMatrix[4];
planes[enums.frustum.plane.RIGHT][2]=comboMatrix[11]-comboMatrix[8];
planes[enums.frustum.plane.RIGHT][3]=comboMatrix[15]-comboMatrix[12];
planes[enums.frustum.plane.TOP][0]=comboMatrix[3]-comboMatrix[1];
planes[enums.frustum.plane.TOP][1]=comboMatrix[7]-comboMatrix[5];
planes[enums.frustum.plane.TOP][2]=comboMatrix[11]-comboMatrix[9];
planes[enums.frustum.plane.TOP][3]=comboMatrix[15]-comboMatrix[13];
planes[enums.frustum.plane.BOTTOM][0]=comboMatrix[3]+comboMatrix[1];
planes[enums.frustum.plane.BOTTOM][1]=comboMatrix[7]+comboMatrix[5];
planes[enums.frustum.plane.BOTTOM][2]=comboMatrix[11]+comboMatrix[9];
planes[enums.frustum.plane.BOTTOM][3]=comboMatrix[15]+comboMatrix[13];
planes[enums.frustum.plane.NEAR][0]=comboMatrix[3]+comboMatrix[2];
planes[enums.frustum.plane.NEAR][1]=comboMatrix[7]+comboMatrix[6];
planes[enums.frustum.plane.NEAR][2]=comboMatrix[11]+comboMatrix[10];
planes[enums.frustum.plane.NEAR][3]=comboMatrix[15]+comboMatrix[14];
planes[enums.frustum.plane.FAR][0]=comboMatrix[3]-comboMatrix[2];
planes[enums.frustum.plane.FAR][1]=comboMatrix[7]-comboMatrix[6];
planes[enums.frustum.plane.FAR][2]=comboMatrix[11]-comboMatrix[10];
planes[enums.frustum.plane.FAR][3]=comboMatrix[15]-comboMatrix[14];
for(var i=0; i<6; ++i){
Plane.normalize(planes[i]);
}
var fov=1/pMatrix[5];
var near=-planes[enums.frustum.plane.NEAR][3];
var far=planes[enums.frustum.plane.FAR][3];
var view_length=far-near;
var height=view_length*fov;
var width=height;
var P=[0,0,near+view_length*0.5];
var Q=[width,height,near+view_length];
var diff=vec3.subtract(P,Q);
var diff_mag=vec3.length(diff);
var look_v=[comboMatrix[3],comboMatrix[9],comboMatrix[10]];
var look_mag=vec3.length(look_v);
look_v=vec3.multiply(look_v,1/look_mag);
var pos=[camera.position[0],camera.position[1],camera.position[2]];
pos=vec3.add(pos,vec3.multiply(look_v,view_length*0.5));
pos=vec3.add(pos,vec3.multiply(look_v,1));
this.sphere=[pos[0],pos[1],pos[2],diff_mag];
}; //Frustum::extract
Frustum.prototype.contains_sphere=function(sphere){
var vec3=base.vec3,planes=this._planes;
for(var i=0; i<6; ++i){
var p=planes[i];
var normal=[p[0],p[1],p[2]];
var distance=vec3.dot(normal,[sphere[0],sphere[1],sphere[2]])+p.d;
this.last_in[i]=1;
if(distance< -sphere[3]){
return -1;
}
if(Math.abs(distance)<sphere[3]){
return 0;
}
} //for
return 1;
}; //Frustum::contains_sphere
Frustum.prototype.draw_on_map=function(map_canvas,map_context){
var mhw=map_canvas.width/2;
var mhh=map_canvas.height/2;
map_context.save();
var planes=this._planes;
var important=[0,1,4,5];
for(var pi=0,l=important.length; pi<l; ++pi){
var p=planes[important[pi]];
map_context.strokeStyle="#FF00FF";
if(pi<this.last_in.length){
if(this.last_in[pi]){
map_context.strokeStyle="#FFFF00";
}
} //if
var x1=-mhw;
var y1=(-p[3]-p[0]*x1)/p[2];
var x2=mhw;
var y2=(-p[3]-p[0]*x2)/p[2];
map_context.moveTo(mhw+x1,mhh+y1);
map_context.lineTo(mhw+x2,mhh+y2);
map_context.stroke();
} //for
map_context.strokeStyle="#0000FF";
map_context.beginPath();
map_context.arc(mhw+this.sphere[0],mhh+this.sphere[2],this.sphere[3],0,Math.PI*2,false);
map_context.closePath();
map_context.stroke();
map_context.restore();
}; //Frustum::draw_on_map
Frustum.prototype.contains_box=function(bbox){
var total_in=0;
var points=[];
points[0]=bbox[0];
points[1]=[bbox[0][0],bbox[0][1],bbox[1][2]];
points[2]=[bbox[0][0],bbox[1][1],bbox[0][2]];
points[3]=[bbox[0][0],bbox[1][1],bbox[1][2]];
points[4]=[bbox[1][0],bbox[0][1],bbox[0][2]];
points[5]=[bbox[1][0],bbox[0][1],bbox[1][2]];
points[6]=[bbox[1][0],bbox[1][1],bbox[0][2]];
points[7]=bbox[1];
var planes=this._planes;
for(var i=0; i<6; ++i){
var in_count=8;
var point_in=1;
for(var j=0; j<8; ++j){
if(Plane.classifyPoint(planes[i],points[j]) === -1){
point_in=0;
--in_count;
} //if
} //for j
this.last_in[i]=point_in;
if(in_count === 0){
return -1;
}
total_in+=point_in;
} //for i
if(total_in === 6){
return 1;
}
return 0;
}; //Frustum::contains_box
var exports={
Frustum:Frustum,Octree:Octree
};
return exports;
});
CubicVR.RegisterModule("CVRXML",function(base){
var undef=base.undef;
var nop=function(){ };
var enums=CubicVR.enums;
var GLCore=base.GLCore;
var MeshPool=[];
var meshKit={
getPoints:function(pts_elem,nodeName,force3d){
var util=CubicVR.util;
var str;
if(nodeName){
str=meshKit.getTextNode(pts_elem,nodeName);
}else{
str=pts_elem.$;
}
if(!str) return undef;
var pts=str.split(" ");
var texName,tex;
for(i=0, iMax=pts.length; i<iMax; i++){
pts[i]=pts[i].split(",");
for(j=0, jMax=pts[i].length; j<jMax; j++){
pts[i][j]=parseFloat(pts[i][j]);
}
if(force3d){  // force z to 0, or add z
pts[i][2]=0;
}
}
return pts;
},getTransform:function(telem){
var util=CubicVR.util;
if(!telem) return null;
var result={
position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]
};
var position,rotation,scale,tempNode;
postition=telem.position;
rotation=telem.rotation;
scale=telem.scale;
if(position) result.position=util.floatDelimArray(position.$);
if(rotation) result.rotation=util.floatDelimArray(rotation.$);
if(scale) result.scale=util.floatDelimArray(scale.$);
if(position || rotation || scale){
return result;
}
return null;
},getTextNode:function(pelem,nodeName,default_value){
var util=CubicVR.util;
var text=pelem[nodeName];
if(!text) return default_value;
if(text.length) text=text[0];
if(text.$){
return text.$;
}
return default_value;
},getFloatNode:function(pelem,nodeName,default_value){
var util=CubicVR.util;
var str=meshKit.getTextNode(pelem,nodeName);
if(str){
var val=parseFloat(str);
if(val != val) return default_value;
return val;
}
return default_value;
},getIntNode:function(pelem,nodeName,default_value){
var util=CubicVR.util;
var str=meshKit.getTextNode(pelem,nodeName);
if(str){
var val=parseInt(str,10);
if(val != val) return default_value;
return val;
}
return default_value;
},getFloatDelimNode:function(pelem,nodeName,default_value,delim){
var util=CubicVR.util;
var str=meshKit.getTextNode(pelem,nodeName);
if(str){
return util.floatDelimArray(str,delim);
}
return default_value;
},getIntDelimNode:function(pelem,nodeName,default_value,delim){
var util=CubicVR.util;
var str=meshKit.getTextNode(pelem,nodeName);
if(str){
return util.intDelimArray(str,delim);
}
return default_value;
}
};
function cubicvr_addTrianglePart(obj,mat,uvSet,melem){
var util=CubicVR.util;
var seglist=null;
var triangles=null;
if(melem.triangles){
triangles=util.intDelimArray(meshKit.getTextNode(melem,"triangles")," ");
}
if(!triangles) return;
if(melem.segments){
seglist=util.intDelimArray(meshKit.getTextNode(melem,"segments")," ");
}
if(seglist === null){
seglist=[0,parseInt((triangles.length)/3,10)];
}
var ofs=0;
obj.setFaceMaterial(mat);
if(triangles.length){
for(p=0, pMax=seglist.length; p<pMax; p+=2){
var currentSegment=seglist[p];
var totalPts=seglist[p+1]*3;
obj.setSegment(currentSegment);
for(j=ofs, jMax=ofs+totalPts; j<jMax; j+=3){
var newFace=obj.addFace([triangles[j],triangles[j+1],triangles[j+2]]);
if(uvSet){
obj.faces[newFace].setUV([uvSet[j],uvSet[j+1],uvSet[j+2]]);
}
}
ofs+=totalPts;
}
}
}
function cubicvr_getUVMapper(uvelem,mappers){
var util=CubicVR.util;
var uvm=new CubicVR.UVMapper();
var uvmType=null;
var uvSet=null;
if(uvelem.type){
uvmType=meshKit.getTextNode(uvelem,"type");
switch(uvmType){
case "uv":
break;
case "planar":
uvm.projection_mode=enums.uv.projection.PLANAR;
break;
case "cylindrical":
uvm.projection_mode=enums.uv.projection.CYLINDRICAL;
break;
case "spherical":
uvm.projection_mode=enums.uv.projection.SPHERICAL;
break;
case "cubic":
uvm.projection_mode=enums.uv.projection.CUBIC;
break;
}
}
if(!uvmType) return null;
if(uvmType === "uv"){
if(uvelem.uv){
uvSet=meshKit.getPoints(uvelem,"uv");
}
}
if(uvelem.axis){
var uvmAxis=meshKit.getTextNode(uvelem,"axis");
switch(uvmAxis){
case "x":
uvm.projection_axis=enums.uv.axis.X;
break;
case "y":
uvm.projection_axis=enums.uv.axis.Y;
break;
case "z":
uvm.projection_axis=enums.uv.axis.Z;
break;
}
}
if(uvelem.center){
uvm.center=util.floatDelimArray(meshKit.getTextNode(uvelem,"center"));
}
if(uvelem.rotation){
uvm.rotation=util.floatDelimArray(meshKit.getTextNode(uvelem,"rotation"));
}
if(uvelem.scale){
uvm.scale=util.floatDelimArray(meshKit.getTextNode(uvelem,"scale"));
}
if(uvelem.wrap_w){
uvm.wrap_w_count=parseFloat(meshKit.getTextNode(uvelem,"wrap_w"));
}
if(uvelem.wrap_h){
uvm.wrap_h_count=parseFloat(meshKit.getTextNode(uvelem,"wrap_h"));
}
if(uvmType !== "" && uvmType !== "uv"){
return uvm; // object
}else{
return uvSet; // array
}
}
function cubicvr_getMaterial(melem,prefix){
var util=CubicVR.util;
var matName=melem.name?melem.name.$:null;
var mat=new CubicVR.Material({name:matName});
if(melem.shininess){
mat.shininess=meshKit.getFloatNode(melem,"shininess",mat.shininess)/100.0;
}
mat.opacity=meshKit.getFloatNode(melem,"alpha",mat.opacity);
mat.max_smooth=meshKit.getFloatNode(melem,"max_smooth",mat.max_smooth);
mat.color=meshKit.getFloatDelimNode(melem,"color",mat.color);
mat.ambient=meshKit.getFloatDelimNode(melem,"ambient",mat.ambient);
mat.diffuse=meshKit.getFloatDelimNode(melem,"diffuse",mat.diffuse);
mat.specular=meshKit.getFloatDelimNode(melem,"specular",mat.specular);
var texName;
if(!!(texName=meshKit.getTextNode(melem,"texture"))){
texName=(prefix?prefix:"")+texName;
tex=(base.Textures_ref[texName] !== undef)?base.Textures_obj[base.Textures_ref[texName]]:(new CubicVR.Texture(texName));
mat.setTexture(tex,enums.texture.map.COLOR);
}
if(!!(texName=meshKit.getTextNode(melem,"texture_luminosity"))){
texName=(prefix?prefix:"")+texName;
tex=(base.Textures_ref[texName] !== undef)?base.Textures_obj[base.Textures_ref[texName]]:(new CubicVR.Texture(texName));
mat.setTexture(tex,enums.texture.map.AMBIENT);
}
if(!!(texName=meshKit.getTextNode(melem,"texture_normal"))){
texName=(prefix?prefix:"")+texName;
tex=(base.Textures_ref[texName] !== undef)?base.Textures_obj[base.Textures_ref[texName]]:(new CubicVR.Texture(texName));
mat.setTexture(tex,enums.texture.map.NORMAL);
}
if(!!(texName=meshKit.getTextNode(melem,"texture_specular"))){
texName=(prefix?prefix:"")+texName;
tex=(base.Textures_ref[texName] !== undef)?base.Textures_obj[base.Textures_ref[texName]]:(new CubicVR.Texture(texName));
mat.setTexture(tex,enums.texture.map.SPECULAR);
}
if(!!(texName=meshKit.getTextNode(melem,"texture_bump"))){
texName=(prefix?prefix:"")+texName;
tex=(base.Textures_ref[texName] !== undef)?base.Textures_obj[base.Textures_ref[texName]]:(new CubicVR.Texture(texName));
mat.setTexture(tex,enums.texture.map.BUMP);
}
if(!!(texName=meshKit.getTextNode(melem,"texture_envsphere"))){
texName=(prefix?prefix:"")+texName;
tex=(base.Textures_ref[texName] !== undef)?base.Textures_obj[base.Textures_ref[texName]]:(new CubicVR.Texture(texName));
mat.setTexture(tex,enums.texture.map.ENVSPHERE);
}
if(!!(texName=meshKit.getTextNode(melem,"texture_alpha"))){
texName=(prefix?prefix:"")+texName;
tex=(base.Textures_ref[texName] !== undef)?base.Textures_obj[base.Textures_ref[texName]]:(new CubicVR.Texture(texName));
mat.setTexture(tex,enums.texture.map.ALPHA);
}
return mat;
}
function cubicvr_loadMesh(meshUrl,prefix){
if(MeshPool[meshUrl] !== undef){
return MeshPool[meshUrl];
}
var util=CubicVR.util;
var i,j,p,iMax,jMax,pMax;
var mesh=null;
if(typeof (meshUrl) == 'object'){
mesh=meshUrl;
}else if(meshUrl.indexOf(".js") != -1){
mesh=util.getJSON(meshUrl);
}else{
mesh=CubicVR.util.xml2badgerfish(util.getXML(meshUrl));
}
if(mesh.root) mesh=mesh.root;
if(mesh.properties) mesh=mesh.properties;
var obj=new CubicVR.Mesh();
if(mesh.points){
var pts=meshKit.getPoints(mesh,"points");
if(pts){
obj.addPoint(pts);
}
}
var material_elem=mesh.material;
if(material_elem && !material_elem.length) material_elem=[material_elem];
var mappers=[];
if(material_elem) for(i=0, iMax=material_elem.length; i<iMax; i++){
var melem=material_elem[i];
var mat=cubicvr_getMaterial(melem,prefix);
var uvelem=null,uvm=null,uvSet=null;
if(melem.uvmapper){
uvm=cubicvr_getUVMapper(melem.uvmapper);
if(uvm && !uvm.length){
mappers.push([uvm,mat]);
}else{
uvSet=uvm;
}
}
var mpart=melem.part;
if(mpart && !mpart.length) mpart=[mpart];
if(mpart && mpart.length){
var local_uvm=null;
var ltrans=null;
for(j=0, jMax=mpart.length; j<jMax; j++){
var part=mpart[j];
local_uvm=null;
uvSet=null;
uvelem=part.uvmapper;
if(uvelem){
local_uvm=cubicvr_getUVMapper(uvelem);
if(melem.triangles){
var face_start=obj.faces.length,face_end=face_start;
if(local_uvm && !local_uvm.length){
cubicvr_addTrianglePart(obj,mat,null,part);
face_end=obj.faces.length-1;
obj.calcFaceNormals(face_start,face_end);
local_uvm.apply(obj,mat,undef,face_start,face_end);
}else if(local_uvm && local_uvm.length){
cubicvr_addTrianglePart(obj,mat,local_uvm,part);
}else if(uvm && !uvm.length){
cubicvr_addTrianglePart(obj,mat,null,part);
face_end=obj.faces.length-1;
obj.calcFaceNormals(face_start,face_end);
uvm.apply(obj,mat,undef,face_start,face_end);
}
}
}
if(part.procedural){
uvelem=part.uvmapper;
if(uvelem){
local_uvm=cubicvr_getUVMapper(uvelem);
}
if(part.transform){
ltrans=meshKit.getTransform(part.transform);
}else{
ltrans=undef;
}
var trans=undef;
var proc=part.procedural;
var ptype=meshKit.getTextNode(proc,"type");
if(ltrans){
trans=new CubicVR.Transform();
trans.translate(ltrans.position);
trans.pushMatrix();
trans.rotate(ltrans.rotation);
trans.pushMatrix();
trans.scale(ltrans.scale);
}
if(!uvm) uvm=undef;
var prim={
material:mat,uvmapper:uvm || local_uvm
};
if(ptype === "box" || ptype === "cube"){
prim.size=meshKit.getFloatNode(proc,"size");
obj.booleanAdd(CubicVR.primitives.box(prim),trans);
}else if(ptype === "sphere"){
prim.radius=meshKit.getFloatNode(proc,"radius");
prim.lat=meshKit.getIntNode(proc,"lat");
prim.lon=meshKit.getIntNode(proc,"lon");
obj.booleanAdd(CubicVR.primitives.sphere(prim),trans);
}else if(ptype === "cone"){
prim.base=meshKit.getFloatNode(proc,"base");
prim.height=meshKit.getFloatNode(proc,"height");
prim.lon=meshKit.getIntNode(proc,"lon");
obj.booleanAdd(CubicVR.primitives.cone(prim),trans);
}else if(ptype === "plane"){
prim.size=meshKit.getFloatNode(proc,"size");
obj.booleanAdd(CubicVR.primitives.plane(prim),trans);
}else if(ptype === "cylinder"){
prim.radius=meshKit.getFloatNode(proc,"radius");
prim.height=meshKit.getFloatNode(proc,"height");
prim.lon=meshKit.getIntNode(proc,"lon");
obj.booleanAdd(CubicVR.primitives.cylinder(prim),trans);
}else if(ptype === "torus"){
prim.innerRadius=meshKit.getFloatNode(proc,"innerRadius");
prim.outerRadius=meshKit.getFloatNode(proc,"outerRadius");
prim.lat=meshKit.getIntNode(proc,"lat");
prim.lon=meshKit.getIntNode(proc,"lon");
obj.booleanAdd(CubicVR.primitives.torus(prim),trans);
}else if(ptype === "lathe"){
prim.points=meshKit.getPoints(proc,"p");
prim.lon=meshKit.getIntNode(proc,"lon");
obj.booleanAdd(CubicVR.primitives.lathe(prim),trans);
}else if(ptype === "polygon"){
var poly_pts=meshKit.getPoints(proc,"p");
var poly=new CubicVR.Polygon(poly_pts);
var cuts=proc.cut;
if(cuts && !cuts.length) cuts=[cuts];
if(cuts.length){
for(j=0, iMax=cuts.length; j<jMax; j++){
poly.cut(new CubicVR.Polygon(meshKit.getPoints(cuts[j])));
}
}
prim.front=0;
prim.back=0;
prim.frontShift=0;
prim.backShift=0;
prim.frontDepth=0;
prim.backDepth=0;
if(proc.extrude){
var ext=proc.extrude;
prim.front=meshKit.getFloatNode(ext,"front",0);
prim.back=meshKit.getFloatNode(ext,"back",0);
prim.frontShift=meshKit.getFloatNode(ext,"frontBevelShift",0);
prim.backShift=meshKit.getFloatNode(ext,"backBevelShift",0);
prim.frontDepth=meshKit.getFloatNode(ext,"frontBevelDepth",0);
prim.backDepth=meshKit.getFloatNode(ext,"backBevelDepth",0);
prim.depth=meshKit.getFloatNode(ext,"depth",0);
prim.shift=meshKit.getFloatNode(ext,"shift",0);
prim.bevel=meshKit.getFloatNode(ext,"bevel",0);
if(prim.depth && !prim.backDepth && !prim.frontDepth){
prim.front=-prim.depth/2;
prim.back=prim.depth/2;
}
if(prim.shift && !prim.backShift && !prim.frontShift){
prim.frontShift=prim.shift;
prim.backShift=prim.shift;
}
if(prim.bevel && !prim.backDepth && !prim.frontDepth){
prim.frontDepth=prim.bevel;
prim.backDepth=prim.bevel;
}
}
var pMesh=poly.toExtrudedBeveledMesh(new CubicVR.Mesh(),prim);
pMesh.setFaceMaterial(prim.material);
obj.booleanAdd(pMesh,trans);
}
}
}
}else{
cubicvr_addTrianglePart(obj,mat,uvSet,melem);
}
}
obj.triangulateQuads();
obj.calcNormals();
for(i=0, iMax=mappers.length; i<iMax; i++){
mappers[i][0].apply(obj,mappers[i][1]);
}
obj.compile();
MeshPool[meshUrl]=obj;
return obj;
}
function cubicvr_isMotion(node){
if(node === null){
return false;
}
return (node.getElementsByTagName("x").length || node.getElementsByTagName("y").length || node.getElementsByTagName("z").length || node.getElementsByTagName("fov").length);
}
function cubicvr_nodeToMotion(node,controllerId,motion){
var util=CubicVR.util;
var c=[];
c[0]=node.getElementsByTagName("x");
c[1]=node.getElementsByTagName("y");
c[2]=node.getElementsByTagName("z");
c[3]=node.getElementsByTagName("fov");
var etime,evalue,ein,eout,etcb;
for(var k in c){
if(c.hasOwnProperty(k)){
if(c[k] !== undef){
if(c[k].length){
etime=c[k][0].getElementsByTagName("time");
evalue=c[k][0].getElementsByTagName("value");
ein=c[k][0].getElementsByTagName("in");
eout=c[k][0].getElementsByTagName("out");
etcb=c[k][0].getElementsByTagName("tcb");
var time=null,value=null,tcb=null;
var intype=null,outtype=null;
if(ein.length){
intype=util.collectTextNode(ein[0]);
}
if(eout.length){
outtype=util.collectTextNode(eout[0]);
}
if(etime.length){
time=util.floatDelimArray(util.collectTextNode(etime[0])," ");
}
if(evalue.length){
value=util.floatDelimArray(util.collectTextNode(evalue[0])," ");
}
if(etcb.length){
tcb=util.floatDelimArray(util.collectTextNode(etcb[0])," ");
}
if(time !== null && value !== null){
for(var i=0,iMax=time.length; i<iMax; i++){
var mkey=motion.setKey(controllerId,k,time[i],value[i]);
if(tcb){
mkey.tension=tcb[i*3];
mkey.continuity=tcb[i*3+1];
mkey.bias=tcb[i*3+2];
}
}
}
var in_beh=enums.envelope.behavior.CONSTANT;
var out_beh=enums.envelope.behavior.CONSTANT;
if(intype){
switch(intype){
case "reset":
in_beh=enums.envelope.behavior.RESET;
break;
case "constant":
in_beh=enums.envelope.behavior.CONSTANT;
break;
case "repeat":
in_beh=enums.envelope.behavior.REPEAT;
break;
case "oscillate":
in_beh=enums.envelope.behavior.OSCILLATE;
break;
case "offset":
in_beh=enums.envelope.behavior.OFFSET;
break;
case "linear":
in_beh=enums.envelope.behavior.LINEAR;
break;
}
}
if(outtype){
switch(outtype){
case "reset":
out_beh=enums.envelope.behavior.RESET;
break;
case "constant":
out_beh=enums.envelope.behavior.CONSTANT;
break;
case "repeat":
out_beh=enums.envelope.behavior.REPEAT;
break;
case "oscillate":
out_beh=enums.envelope.behavior.OSCILLATE;
break;
case "offset":
out_beh=enums.envelope.behavior.OFFSET;
break;
case "linear":
out_beh=enums.envelope.behavior.LINEAR;
break;
}
}
motion.setBehavior(controllerId,k,in_beh,out_beh);
}
}
}
}
}
function cubicvr_loadScene(sceneUrl,model_prefix,image_prefix){
var util=CubicVR.util;
if(model_prefix === undef){
model_prefix="";
}
if(image_prefix === undef){
image_prefix="";
}
var obj=new CubicVR.Mesh();
var scene=util.getXML(sceneUrl);
var sceneOut=new CubicVR.Scene();
var parentingSet=[];
var sceneobjs=scene.getElementsByTagName("sceneobjects");
var tempNode;
var position,rotation,scale;
for(var i=0,iMax=sceneobjs[0].childNodes.length; i<iMax; i++){
var sobj=sceneobjs[0].childNodes[i];
if(sobj.tagName === "sceneobject"){
var name="unnamed";
var parent="";
var model="";
tempNode=sobj.getElementsByTagName("name");
if(tempNode.length){
name=util.collectTextNode(tempNode[0]);
}
tempNode=sobj.getElementsByTagName("parent");
if(tempNode.length){
parent=util.collectTextNode(tempNode[0]);
}
tempNode=sobj.getElementsByTagName("model");
if(tempNode.length){
model=util.collectTextNode(tempNode[0]);
}
position=null;
rotation=null;
scale=null;
tempNode=sobj.getElementsByTagName("position");
if(tempNode.length){
position=tempNode[0];
}
tempNode=sobj.getElementsByTagName("rotation");
if(tempNode.length){
rotation=tempNode[0];
}
tempNode=sobj.getElementsByTagName("scale");
if(tempNode.length){
scale=tempNode[0];
}
obj=null;
if(model !== ""){
obj=cubicvr_loadMesh(model_prefix+model,image_prefix);
}
var sceneObject=new CubicVR.SceneObject(obj,name);
if(cubicvr_isMotion(position)){
if(!sceneObject.motion){
sceneObject.motion=new CubicVR.Motion();
}
cubicvr_nodeToMotion(position,enums.motion.POS,sceneObject.motion);
}else if(position){
sceneObject.position=util.floatDelimArray(util.collectTextNode(position));
}
if(cubicvr_isMotion(rotation)){
if(!sceneObject.motion){
sceneObject.motion=new CubicVR.Motion();
}
cubicvr_nodeToMotion(rotation,enums.motion.ROT,sceneObject.motion);
}else{
sceneObject.rotation=util.floatDelimArray(util.collectTextNode(rotation));
}
if(cubicvr_isMotion(scale)){
if(!sceneObject.motion){
sceneObject.motion=new CubicVR.Motion();
}
cubicvr_nodeToMotion(scale,enums.motion.SCL,sceneObject.motion);
}else{
sceneObject.scale=util.floatDelimArray(util.collectTextNode(scale));
}
sceneOut.bindSceneObject(sceneObject);
if(parent !== ""){
parentingSet.push([sceneObject,parent]);
}
}
}
for(var j in parentingSet){
if(parentingSet.hasOwnProperty(j)){
sceneOut.getSceneObject(parentingSet[j][1]).bindChild(parentingSet[j][0]);
}
}
var camera=scene.getElementsByTagName("camera");
if(camera.length){
position=null;
rotation=null;
var target="";
tempNode=camera[0].getElementsByTagName("name");
var cam=sceneOut.camera;
var fov=null;
if(tempNode.length){
target=tempNode[0].firstChild.nodeValue;
}
tempNode=camera[0].getElementsByTagName("target");
if(tempNode.length){
target=tempNode[0].firstChild.nodeValue;
}
if(target !== ""){
cam.targetSceneObject=sceneOut.getSceneObject(target);
}
tempNode=camera[0].getElementsByTagName("position");
if(tempNode.length){
position=tempNode[0];
}
tempNode=camera[0].getElementsByTagName("rotation");
if(tempNode.length){
rotation=tempNode[0];
}
tempNode=camera[0].getElementsByTagName("fov");
if(tempNode.length){
fov=tempNode[0];
}
if(cubicvr_isMotion(position)){
if(!cam.motion){
cam.motion=new CubicVR.Motion();
}
cubicvr_nodeToMotion(position,enums.motion.POS,cam.motion);
}else if(position){
cam.position=util.floatDelimArray(position.firstChild.nodeValue);
}
if(cubicvr_isMotion(rotation)){
if(!cam.motion){
cam.motion=new CubicVR.Motion();
}
cubicvr_nodeToMotion(rotation,enums.motion.ROT,cam.motion);
}else if(rotation){
cam.rotation=util.floatDelimArray(rotation.firstChild.nodeValue);
}
if(cubicvr_isMotion(fov)){
if(!cam.motion){
cam.motion=new CubicVR.Motion();
}
cubicvr_nodeToMotion(fov,enums.motion.FOV,cam.motion);
}else if(fov){
cam.fov=parseFloat(fov.firstChild.nodeValue);
}
}
return sceneOut;
}
var exports={
loadMesh:cubicvr_loadMesh,loadScene:cubicvr_loadScene
};
return exports;
});
CubicVR.RegisterModule("Worker",function(base){
try{
if(!window){
self.window=self;
self.document={};
self.fakeWindow=true;
self.console={
log:function(){}
};
}
}catch(e){
self.window=self;
self.document={};
self.fakeWindow=true;
self.console={
log:function(){}
};
}
var GLCore=base.GLCore,enums=CubicVR.enums,undef=base.undef,Mesh=CubicVR.Mesh,Texture=CubicVR.Texture,Material=CubicVR.Material,SceneObject=CubicVR.SceneObject,Motion=CubicVR.Motion,Envelope=CubicVR.Envelope,DeferredBin=CubicVR.DeferredBin,util=CubicVR.util;
function ResourcePool(poolSettings){
var that=this,files={},managers={};
function SceneFileManager(settings){
var parsedFunc=settings.parsed || function(){};
var readyFuncs={};
var fileWorker;
if(settings.url.match(/\.dae/)){
fileWorker=new CubicVR.Worker({
type:"sceneFile",data:settings.url,message:function(message){
if(message.message === "loaded"){
var domParser=new DOMParser(),xml=domParser.parseFromString(message.data,"text/xml"),clSource=util.xml2badgerfish(xml);
console.log(xml);
fileWorker.send("parse",clSource);
}else if(message.message === "getMesh"){
var mesh=new Mesh();
for(var prop in message.data.mesh){
if(message.data.mesh.hasOwnProperty(prop)){
mesh[prop]=message.data.mesh[prop];
} //if
} //for
mesh.bindBuffer(mesh.bufferVBO(message.data.vbo));
if(readyFuncs["getMesh"]){
readyFuncs["getMesh"](mesh);
} //if
}else if(message.message === "parsed"){
parsedFunc();
} //if
}
});
} //if
this.getSceneObject=function(name,readyFunc){
fileWorker.send("getMesh",name);
readyFuncs["getMesh"]=readyFunc;
};
}
this.createSceneFileManager=function(settings){
var manager=new SceneFileManager({
url:settings.url,parsed:settings.parsed
});
managers[settings.url]=manager;
return manager;
};
this.removeSceneFileManager=function(manager){
if(typeof (settings) === "string"){
delete managers[settings];
}else{
for(var name in managers){
if(managers[name] === manager){
delete managers[name];
} //if
} //for
} //if
};
function prepareObject(object,templateObject){
for(var prop in object){
if(object.hasOwnProperty(prop)){
templateObject[prop]=object[prop];
} //if
} //for
return templateObject;
} //prepareMesh
this.createSceneObjectFromMesh=function(settings){
var scene=settings.scene,mesh=settings.mesh,meshObject=settings.object,assetBase=settings.assetBase || "",options=settings.options;
var manager=that.createSceneFileManager({
url:mesh,parsed:function(){
if(meshObject){
manager.getSceneObject(meshObject,function(mesh){
var newMesh=prepareObject(mesh,new Mesh());
for(var i=0,li=newMesh.materials.length; i<li; ++i){
var mat=prepareObject(newMesh.materials[i],new Material());
for(var j=0,lj=mat.textures.length; j<lj; ++j){
var tex=mat.textures[i];
mat.textures[i]=new Texture(assetBase+tex.img_path,tex.filter_type);
} //for
newMesh.materials[i]=mat;
} //for
var sceneObject=new SceneObject(newMesh);
scene.bindSceneObject(sceneObject);
});
} //if
}
});
};
this.loadFile=function(filename,callback){
callback=callback || function(data){ files[filename]=data; };
var fileWorker=new CubicVR.Worker({
type:"file",data:mesh,message:function(message){
callback(message.data);
}
});
};
}
function CubicVR_Worker(settings){
this.worker=new Worker(CubicVR.getScriptLocation()+"CubicVR.js");
this.message=settings.message || function(){};
this.error=settings.error || function(e){ console.log("Error: "+e.message+": "+e.lineno); };
this.type=settings.type;
var that=this;
this.worker.onmessage=function(e){
that.message(e.data);
};
this.worker.onerror=function(e){
that.error(e);
}; //onerror
this.init=function(data){
that.send('init',{type:that.type,data:data});
};
this.send=function(message,data){
that.worker.postMessage({
message:message,data:data
});
};
this.send('CubicVR_InitWorker',CubicVR.getScriptLocation());
if(settings.data || settings.autoStart){
that.init(settings.data);
} //if
} //CubicVR_Worker
function WorkerConnection(options){
var that=this;
this.message=options.message || function(){};
this.send=function(message,data){
postMessage({message:message,data:data});
};
self.addEventListener('message',function(e){
if(e.data.message !== 'init'){
that.message(e.data);
} //if
},false);
} //WorkerConnection
function TestWorker(data){
var that=this;
function message(data){
setTimeout(function(){
connection.send("test",data);
},1000);
}
if(data){
message(data);
} //if
var connection=new WorkerConnection({
message:message
});
} //TestWorker
function FileDataWorker(data){
var that=this,connection;
function load(filename){
var file=util.getURL(filename);
connection.send("done",file.length);
}
connection=new WorkerConnection({
message:function(data){
load(data);
}
});
if(data){
load(data);
} //if
} //FileDataWorker
function SceneFileWorker(data){
var that=this,connection,deferred,filename,scene;
function load(file){
filename=file;
var fileData=util.getURL(file);
connection.send("loaded",fileData);
}
connection=new WorkerConnection({
message:function(message){
if(message.message === "parse"){
deferred=new DeferredBin();
scene=CubicVR.loadCollada("","",deferred,message.data);
connection.send("parsed");
}else if(message.message === "getMesh"){
var mesh=deferred.meshMap[":"+message.data];
if(mesh){
var compiled=mesh.triangulateQuads().compileVBO(mesh.compileMap());
connection.send("getMesh",{mesh:mesh,vbo:compiled});
} //if
}else{
throw new Error("Not a SceneFileWorker command: "+message.message);
} //if
}
});
if(data){
load(data);
} //if
} //SceneFileWorker
function PrepareMeshWorker(data){
var that=this,connection;
function compile(meshData){
var mesh=new Mesh();
for(var prop in meshData){
if(meshData.hasOwnProperty(prop)){
mesh[prop]=meshData[prop];
} //if
} //for
var compiled=mesh.triangulateQuads().compileVBO(mesh.compileMap());
connection.send("done",compiled);
} //compile
connection=new WorkerConnection({
message:function(data){
compile(data);
}
});
if(data){
compile(data);
} //if
} //CompileWorker
function OctreeWorkerProxy(size,depth){
var that=this;
this.size=size;
this.depth=depth;
this.worker=new CubicVR_Worker({
message:function(e){
console.log('Octree Worker Message:',e);
},error:function(e){
console.log('Octree Worker Error:',e);
},type:'octree'
});
this.worker.start();
this.init=function(scene){
that.scene=scene;
that.worker.init({
size:that.size,max_depth:that.depth,camera:scene.camera
});
}; //init
this.insert=function(node){
that.worker.send({message:'insert',node:node});
}; //insert
this.draw_on_map=function(){
return;
}; //draw_on_map
this.reset_node_visibility=function(){
return;
}; //reset_node_visibility
this.get_frustum_hits=function(){
}; //get_frustum_hits
} //OctreeWorkerProxy
function CubicVR_OctreeWorker(){
this.octree=null;
this.nodes=[];
this.camera=null;
} //CubicVR_OctreeWorker::Constructor
CubicVR_OctreeWorker.prototype.onmessage=function(input){
var message=input.message;
if(message === "init"){
var params=input.data;
this.octree=new Octree(params.size,params.max_depth);
this.camera=new Camera();
}else if(type === "set_camera"){
var data=message.data;
this.camera.mvMatrix=data.mvMatrix;
this.camera.pMatrix=data.pMatrix;
this.camera.position=data.position;
this.camera.target=data.target;
this.camera.frustum.extract(this.camera,this.camera.mvMatrix,this.camera.pMatrix);
}else if(type === "insert"){
var json_node=JSON.parse(message.data);
var node=new SceneObject();
var trans=new Transform();
var i;
for(i in json_node){
if(json_node.hasOwnProperty(i)){
node[i]=json_node[i];
} //if
} //for
for(i in json_node.trans){
if(json_node.trans.hasOwnProperty(i)){
trans[i]=json_node.trans[i];
} //if
} //for
node.trans=trans;
node.id=json_node.id;
this.octree.insert(node);
this.nodes[node.id]=node;
}else if(type === "cleaup"){
this.octree.cleanup();
} //if
}; //onmessage
function FrustumWorkerProxy(worker,camera){
this.camera=camera;
this.worker=worker;
this.draw_on_map=function(map_context){
return;
};
} //FrustumWorkerProxy
FrustumWorkerProxy.prototype.extract=function(camera,mvMatrix,pMatrix){
this.worker.send({
type:"set_camera",data:{
mvMatrix:this.camera.mvMatrix,pMatrix:this.camera.pMatrix,position:this.camera.position,target:this.camera.target
}
});
}; //FrustumWorkerProxy::extract
function cubicvr_loadColladaWorker(meshUrl,prefix,callback,deferred_bin){
var worker;
try{
worker=new Worker(CubicVR.getScriptLocation()+'collada.js');
}catch(e){
throw new Error("Can't find collada.js");
} //try
var materials_map=[];
var meshes_map=[];
worker.onmessage=function(e){
var i,maxI;
function copyObjectFromJSON(json,obj){
for(var i in json){
obj[i]=json[i];
} //for
} //new_obj
function reassembleMotion(obj){
if(obj.motion){
var co=obj.motion.controllers;
var new_controllers=[];
for(var j=0,maxJ=co.length; j<maxJ; ++j){
var con=co[j];
if(!con){
co[j]=null; // XXXhumph was undefined;
continue;
}
var new_con=[];
for(var k=0,maxK=con.length; k<maxK; ++k){
var env=con[k];
if(!env){
con[k]=null; // XXXhumph was undefined;
continue;
}
var keys=env.keys[0];
if(env.keys.length>1){
keys.prev=null;
keys.next=env.keys[1];
keys=env.keys[1];
} //if
for(var keyI=1,maxKeyI=env.keys.length-1; keyI<maxKeyI; ++keyI){
keys.prev=env.keys[keyI-1];
keys.next=env.keys[keyI+1];
keys=env.keys[keyI+1];
} //for keyI
if(env.keys.length>1){
keys=env.keys[env.keys.length-1];
keys.prev=env.keys[env.keys.length-2];
keys.next=null;
} //if
env.firstKey=env.keys[0];
env.lastKey=env.keys[env.keys.length-1];
env.keys=env.firstKey;
var envelope=new Envelope();
copyObjectFromJSON(env,envelope);
new_con[k]=envelope;
} //for k
new_controllers[j]=new_con;
} //for j
obj.motion.controllers=new_controllers;
var motion=new Motion();
copyObjectFromJSON(obj.motion,motion);
obj.motion=motion;
} //if
} //reassembleMotion
function createSceneObject(scene_obj){
var sceneObject=new SceneObject();
copyObjectFromJSON(scene_obj,sceneObject);
if(scene_obj.obj !== null){
var stored_mesh=meshes_map[scene_obj.obj.id];
if(stored_mesh === undef){
var mesh=new Mesh();
copyObjectFromJSON(scene_obj.obj,mesh);
sceneObject.obj=mesh;
meshes_map[scene_obj.obj.id]=mesh;
if(deferred_bin){
if(mesh.points.length>0){
deferred_bin.addMesh(meshUrl,meshUrl+":"+mesh.id,mesh);
for(var f=0,maxF=mesh.faces.length; f<maxF; ++f){
var face=mesh.faces[f];
var m_index=face.material;
var mapped=materials_map[m_index];
if(mapped !== undef){
face.material=materials_map[m_index];
}else{
face.material=0;
} //if
} //for
} //if
}else{
sceneObject.obj.triangulateQuads();
sceneObject.obj.calcNormals();
sceneObject.obj.compile();
sceneObject.obj.clean();
} //if
}else{
sceneObject.obj=stored_mesh;
} //if
} //if
sceneObject.trans=new Transform();
if(scene_obj.children && scene_obj.children.length>0){
sceneObject.children=[];
createChildren(scene_obj,sceneObject);
} //if
return sceneObject;
} //createSceneObject
function createChildren(scene_obj,sceneObject){
if(scene_obj.children){
for(var j=0,maxJ=scene_obj.children.length; j<maxJ; ++j){
var child=createSceneObject(scene_obj.children[j]);
sceneObject.bindChild(child);
} //for
} //if
} //createChildren
var message=e.data.message;
if(message == 'materials'){
var mats=JSON.parse(e.data.data);
for(i=0, maxI=mats.length; i<maxI; ++i){
var new_mat=new Material(mats[i].name);
var mat_id=new_mat.material_id;
copyObjectFromJSON(mats[i],new_mat);
new_mat.material_id=mat_id;
materials_map[mats[i].material_id]=mat_id;
for(var j=0,maxJ=mats[i].textures.length; j<maxJ; ++j){
var dt=mats[i].textures[j];
if(dt){
var stored_tex=Texture_ref[dt.img_path];
if(stored_tex === undef){
var t=new Texture(dt.img_path,dt.filter_type,deferred_bin,meshUrl);
new_mat.textures[j]=t;
}else{
new_mat.textures[j]=Textures_obj[stored_tex];
} //if
}else{
new_mat.textures[j]=0;
} //if
} //for
} //for
}else if(message == 'scene'){
var scene=JSON.parse(e.data.data);
for(i=0, maxI=scene.sceneObjects.length; i<maxI; ++i){
var so=scene.sceneObjects[i];
if(so.obj !== null){
nop();
} //if
if(so.reassembled === undef){
reassembleMotion(so);
so.reassembled=true;
} //if
scene.sceneObjects[i]=createSceneObject(so);
} //for i
var new_scene=new Scene();
var camera=new_scene.camera;
var camera_transform=camera.transform;
copyObjectFromJSON(scene.camera,camera);
copyObjectFromJSON(scene.camera.transform,camera_transform);
reassembleMotion(camera);
new_scene.camera=camera;
new_scene.camera.transform=camera_transform;
new_scene.camera.frustum=new Frustum();
for(i=0, maxI=scene.sceneObjects.length; i<maxI; ++i){
var o=scene.sceneObjects[i];
new_scene.bindSceneObject(o);
try{
o.getAABB();
}catch(ex){
} //try
} //for
for(i=0, maxI=scene.lights.length; i<maxI; ++i){
var l=new Light();
copyObjectFromJSON(scene.lights[i],l);
l.trans=new Transform();
reassembleMotion(l);
new_scene.bindLight(l);
} //for
callback(new_scene);
}else{
console.log("message from collada worker:",e.data.message);
} //if
}; //onmessage
worker.onerror=function(e){
console.log("error from collada worker:",e.message);
}; //onerror
worker.postMessage({message:'start',params:{meshUrl:meshUrl,prefix:prefix,rootDir:CubicVR.getScriptLocation()}});
} //cubicvr_loadColladaWorker
function InitWorker(){
var workerMap={
test:TestWorker,prepareMesh:PrepareMeshWorker,file:FileDataWorker,sceneFile:SceneFileWorker
};
self.addEventListener('message',function(e){
var message=e.data.message;
if(message === "init"){
var type=e.data.data.type;
if(type in workerMap){
new workerMap[type](e.data.data.data);
}else{
throw new Error("Invalid worker type.");
} //if
} //if
},false);
} //InitWorker
return {
Worker:CubicVR_Worker,ResourcePool:ResourcePool,loadColladaWorker:cubicvr_loadColladaWorker,InitWorker:InitWorker
};
});
CubicVR.RegisterModule("Polygon",function(base){
var undef=base.undef;
var EPSILON=0.0000000001;
function area(contour){
var n=contour.length;
var a=0.0;
for(var p=n-1,q=0; q<n; p=q++){
a+=contour[p][0]*contour[q][1]-contour[q][0]*contour[p][1];
}
return a*0.5;
}
function insideTriangle(ax,ay,bx,by,cx,cy,px,py){
var aX,aY,bX,bY,cX,cY,apx,apy,bpx,bpy,cpx,cpy,cCROSSap,bCROSScp,aCROSSbp;
aX=cx-bx;
aY=cy-by;
bX=ax-cx;
bY=ay-cy;
cX=bx-ax;
cY=by-ay;
apx=px-ax;
apy=py-ay;
bpx=px-bx;
bpy=py-by;
cpx=px-cx;
cpy=py-cy;
aCROSSbp=aX*bpy-aY*bpx;
cCROSSap=cX*apy-cY*apx;
bCROSScp=bX*cpy-bY*cpx;
return ((aCROSSbp>=0.0) && (bCROSScp>=0.0) && (cCROSSap>=0.0));
}
function snip(contour,u,v,w,n,verts){
var p;
var ax,ay,bx,by;
var cx,cy,px,py;
ax=contour[verts[u]][0];
ay=contour[verts[u]][1];
bx=contour[verts[v]][0];
by=contour[verts[v]][1];
cx=contour[verts[w]][0];
cy=contour[verts[w]][1];
if(EPSILON>(((bx-ax)*(cy-ay))-((by-ay)*(cx-ax)))) return false;
for(p=0; p<n; p++){
if((p == u) || (p == v) || (p == w)) continue;
px=contour[verts[p]][0];
py=contour[verts[p]][1];
if(insideTriangle(ax,ay,bx,by,cx,cy,px,py)) return false;
}
return true;
}
function triangulate2D(contour){
var result=[];
var n=contour.length;
if(n<3) return null;
var verts=[];
var v;
if(0.0<area(contour)){
for(v=0; v<n; v++) verts[v]=v;
}else{
for(v=0; v<n; v++) verts[v]=(n-1)-v;
}
var nv=n;
var count=2*nv; /* error detection */
var m;
for(m=0, v=nv-1; nv>2;){ /* if we loop, it is probably a non-simple polygon */
if(0>=(count--)){
return null;
}
var u=v;
if(nv<=u) u=0; /* previous */
v=u+1;
if(nv<=v) v=0; /* new v    */
var w=v+1;
if(nv<=w) w=0; /* next     */
if(snip(contour,u,v,w,nv,verts)){
var a,b,c,s,t;
a=verts[u];
b=verts[v];
c=verts[w];
result.push(a);
result.push(b);
result.push(c);
m++;
for(s=v, t=v+1; t<nv; s++, t++) verts[s]=verts[t];
nv--;
count=2*nv;
}
}
return result;
}
function polygonToMesh(mesh,contour,zdepth){
if(zdepth === undef){
zdepth=0;
}
var i;
var triangulated=triangulate2D(contour);
var triangles=CubicVR.util.repackArray(triangulated,3,triangulated.length/3);
var points=[];
var point_ofs=mesh.points.length;
for(i=0, iMax=contour.length; i<iMax; i++){
points.push([contour[i][0],contour[i][1],zdepth]);
}
mesh.addPoint(points);
for(i=0, iMax=triangles.length; i<iMax; i++){
mesh.addFace([triangles[i][0]+point_ofs,triangles[i][1]+point_ofs,triangles[i][2]+point_ofs]);
}
}
function pairDist(c1,c2){
var dx=c2[0]-c1[0],dy=c2[1]-c1[1];
return Math.sqrt(dx*dx+dy*dy);
}
function findNearPair(c1,c2){
var minPair=[0,0];
var minDist=pairDist(c1[0],c2[0]);
var iMax=c1.length,jMax=c2.length;
for(var i=0; i<iMax; i++){
for(var j=0; j<jMax; j++){
var d=pairDist(c1[i],c2[j]);
if(d<minDist){
minPair[0]=i;
minPair[1]=j;
minDist=d;
}
}
}
return minPair;
}
function minPairShift(c1,c2){
var minPair=findNearPair(c1,c2);
var a=c1.slice(minPair[0]);
if(minPair[0]>0) a=a.concat(c1.slice(0,minPair[0]));
var b=c2.slice(minPair[1]);
if(minPair[1]>0) b=b.concat(c2.slice(0,minPair[1]));
c1.length=0;
c2.length=0;
var i,iMax;
for(i=0, iMax=a.length; i<iMax; i++){
c1.push(a[i]);
}
for(i=0, iMax=b.length; i<iMax; i++){
c2.push(b[i]);
}
}
function findEdgePairs(c1,c2){
var i,j,result=[],iMax=c1.length,jMax=c2.length;
var pairs=[];
for(i=0; i<iMax; i++){
for(j=0; j<jMax; j++){
var d=pairDist(c1[i],c2[j]);
result.push([d,i,j]);
}
}
result.sort(function(a,b){ return a[0]>b[0]; });
var edgeLimit=4;  // this controls the max edge run length allowed
for(i=0; i<5; i++){ // sample the first few near matches instead of the full exponential meal deal
for(j=0; j<result.length; j++){
if(i == j) continue;
if(result[i][1] != result[j][1] && result[i][2] != result[j][2] && result[i][1]<result[j][1] && result[i][2]<result[j][2]){
if(Math.abs(result[i][1]-result[j][1])<edgeLimit && Math.abs(result[i][2]-result[j][2])<edgeLimit){
pairs.push([i,j]);
}
}
}
}
pairs.sort(function(a,b){ return result[a[0]][0]+result[a[1]][0]>result[b[0]][0]+result[b[1]][0]; });
if(pairs.length>10){
pairs.length=10;
}
var result_pairs=[];
for(i=0; i<pairs.length; i++){
result_pairs.push([result[pairs[i][0]],result[pairs[i][1]]]);
}
return result_pairs;
}
function subtract(c1,c2){ // attempt to break out an ideal segment of the polygon
var pairs=findEdgePairs(c1,c2); // get top 10 runs of edge pairs
var result=[];
var i;
if(!pairs.length){
return null;  // no suitable pairs
}
var aPair=pairs[0][0];  // pick the top entry for now..
var bPair=pairs[0][1];
var aLen=bPair[1]-aPair[1];
var bLen=bPair[2]-aPair[2];
var a=c1.slice(aPair[1]);
a=a.concat(c1.slice(0,aPair[1]));
var b=c2.slice(aPair[2]);
b=b.concat(c2.slice(0,aPair[2]));
var polygonA=[];
function wrap(a,max){
if(a<0) a+=max;
if(a>max) a-=max;
return a;
}
for(i=aLen; i<a.length; i++) polygonA.push(a[i]);
polygonA.push(a[0]);
for(i=bLen; i<b.length; i++) polygonA.push(b[i]);
polygonA.push(b[0]);
var polygonB=[];
for(i=0; i<=aLen; i++) polygonB.push(a[i]);
for(i=0; i<=bLen; i++) polygonB.push(b[i]);
return [polygonA,polygonB];
}
function getCenterPoint(c1){
var ctr=[0,0];
for(var i=0; i<c1.length; i++){
ctr[0]+=c1[i][0];
ctr[1]+=c1[i][1];
}
ctr[0]/=c1.length;
ctr[1]/=c1.length;
return ctr;
}
function polarShiftPoints(c1,center,shift_val){
var result=[];
for(var i=0; i<c1.length; i++){
var pt=[c1[i][0]-center[0],c1[i][1]-center[1]];
var d=Math.sqrt(pt[0]*pt[0]+pt[1]*pt[1])+shift_val;
var a=Math.atan2(pt[1],pt[0]);
result[i]=[center[0]+Math.cos(a)*d,center[1]+Math.sin(a)*d];
}
return result;
}
function extrudePolygonToMesh(mesh,cnear,cfar,znear,zfar){
var i,ptOfs=mesh.points.length;
if(cnear.length != cfar.length){
return null;
}
var len=cnear.length;
for(i=0; i<len; i++){
mesh.addPoint([cnear[i][0],cnear[i][1],znear]);
}
for(i=0; i<len; i++){
mesh.addPoint([cfar[i][0],cfar[i][1],zfar]);
}
for(i=0; i<len-1; i++){
mesh.addFace([ptOfs+i,ptOfs+i+1,ptOfs+(i+len+1),ptOfs+(i+len)]);
}
i=len-1;
mesh.addFace([ptOfs+i,ptOfs,ptOfs+len,ptOfs+(i+len)]);
}
function addOffset(c1,pt_ofs){
var cout=[];
for(var i=0,iMax=c1.length; i<iMax; i++){
var p=c1[i];
cout.push([p[0]+pt_ofs[0],p[1]+pt_ofs[1]]);
}
return cout;
}
function Polygon(point_list){
this.points=point_list;
this.cuts=[];
this.result=[];
}
Polygon.prototype={
cut:function(pSubtract){
this.cuts.push(pSubtract);
},toMesh:function(mesh){
if(this.points.length === 0){
return;
}
var i;
if(!mesh) mesh=new CubicVR.Mesh();
this.result=[this.points];
for(i=0; i<this.cuts.length; i++){
var pCut=this.cuts[i].points.slice(0);
pCut=pCut.reverse();
var sub=subtract(this.result[0],pCut);
this.result[0]=sub[0];
this.result.push(sub[1]);
}
for(i=0; i<this.result.length; i++){
polygonToMesh(mesh,this.result[i]);
}
mesh.removeDoubles();
return mesh;
},toExtrudedMesh:function(mesh,zfront,zback){
if(this.points.length === 0){
return;
}
var pCut,i;
if(zfront === undef) zfront=0;
if(zback === undef) zback=0;
var hasDepth=(zfront != zback);
if(!mesh) mesh=new CubicVR.Mesh();
this.result=[this.points];
for(i=0; i<this.cuts.length; i++){
pCut=this.cuts[i].points.slice(0);
pCut=pCut.reverse();
var sub=subtract(this.result[0],pCut);
this.result[0]=sub[0];
this.result.push(sub[1]);
}
var faceMesh=new CubicVR.Mesh();
for(i=0; i<this.result.length; i++){
polygonToMesh(faceMesh,this.result[i],zback);
}
mesh.booleanAdd(faceMesh);
faceMesh.flipFaces();
if(hasDepth){
for(i=0; i<faceMesh.points.length; i++){
faceMesh.points[i][2]=zfront;
}
}
mesh.booleanAdd(faceMesh);
if(hasDepth){
extrudePolygonToMesh(mesh,this.points,this.points,zfront,zback);
for(i=0; i<this.cuts.length; i++){
pCut=this.cuts[i].points.slice(0);
pCut=pCut.reverse();
extrudePolygonToMesh(mesh,pCut,pCut,zfront,zback);
}
}
mesh.removeDoubles();
return mesh;
},toExtrudedBeveledMesh:function(mesh,zfront,zback,zfront_depth,zfront_shift,zback_depth,zback_shift){
var front_cuts=[],back_cuts=[],back_bevel_points,front_bevel_points,pCut,i,sub,cut_center;
if(this.points.length === 0){
return;
}
if(typeof (zfront) === 'object'){
var opt=zfront;
zfront=opt.front || 0;
zback=opt.back || 0;
zfront_depth=opt.frontDepth || 0;
zfront_shift=opt.frontShift || 0;
zback_depth=opt.backDepth || 0;
zback_shift=opt.backShift || 0;
}
var hasDepth=(zfront !== zback);
var hasBackDepth=(zback_depth !== 0);
var hasFrontDepth=(zfront_depth !== 0);
if(!mesh) mesh=new CubicVR.Mesh();
if(hasFrontDepth){
var front_center=getCenterPoint(this.points);
front_bevel_points=polarShiftPoints(this.points,front_center,-zfront_shift);
this.result=[front_bevel_points.slice(0)];
}else{
this.result=[this.points.slice(0)];
}
for(i=0; i<this.cuts.length; i++){
cut_center=getCenterPoint(this.cuts[i].points);
pCut=polarShiftPoints(this.cuts[i].points,cut_center,zfront_shift);
pCut=pCut.reverse();
front_cuts.push(pCut);
sub=subtract(this.result[0],pCut);
this.result[0]=sub[0];
this.result.push(sub[1]);
}
var faceMesh=new CubicVR.Mesh();
for(i=0; i<this.result.length; i++){
polygonToMesh(faceMesh,this.result[i],zfront-zfront_depth);
}
faceMesh.flipFaces();
mesh.booleanAdd(faceMesh);
if(hasBackDepth || hasFrontDepth){
var back_center=getCenterPoint(this.points);
back_bevel_points=polarShiftPoints(this.points,back_center,-zback_shift);
this.result=[back_bevel_points.slice(0)];
for(i=0; i<this.cuts.length; i++){
cut_center=getCenterPoint(this.cuts[i].points);
pCut=polarShiftPoints(this.cuts[i].points,cut_center,zback_shift);
pCut=pCut.reverse();
back_cuts.push(pCut);
sub=subtract(this.result[0],pCut);
this.result[0]=sub[0];
this.result.push(sub[1]);
}
faceMesh=new CubicVR.Mesh();
for(i=0; i<this.result.length; i++){
polygonToMesh(faceMesh,this.result[i],zback+zback_depth);
}
}else{
for(i=0; i<faceMesh.points.length; i++){
faceMesh.points[i][2]=zback;
}
faceMesh.flipFaces();
}
mesh.booleanAdd(faceMesh);
if(hasFrontDepth) extrudePolygonToMesh(mesh,front_bevel_points,this.points,zfront-zfront_depth,zfront);
if(hasDepth) extrudePolygonToMesh(mesh,this.points,this.points,zfront,zback);
if(hasBackDepth) extrudePolygonToMesh(mesh,this.points,back_bevel_points,zback,zback+zback_depth);
for(i=0; i<front_cuts.length; i++){
pCut=this.cuts[i].points.slice(0).reverse();
if(hasFrontDepth){
extrudePolygonToMesh(mesh,front_cuts[i],pCut,zfront-zfront_depth,zfront);
}
if(hasDepth){
extrudePolygonToMesh(mesh,pCut,pCut,zfront,zback);
}
if(hasBackDepth){
extrudePolygonToMesh(mesh,pCut,back_cuts[i],zback,zback+zback_depth);
}
}
mesh.removeDoubles();
return mesh;
}
};
var polygon={
triangulate2D:triangulate2D,toMesh:polygonToMesh,findNearPair:findNearPair,subtract:subtract,addOffset:addOffset
};
var extend={
polygon:polygon,Polygon:Polygon
};
return extend;
});
CubicVR.RegisterModule("ScenePhysics",function(base){
var undef=base.undef;
var util=base.util;
var vec3=base.vec3;
var enums=base.enums;
var nop=base.nop;
enums.physics={
body:{
STATIC:0,DYNAMIC:1,GHOST:2,SOFT:3 // TODO: SoftBody implementation
},constraint:{
P2P:0
},collision_flags:{
STATIC_OBJECT:1,KINEMATIC_OBJECT:2,NO_CONTACT_RESPONSE:4,       //object->hasContactResponse()
CUSTOM_MATERIAL_CALLBACK:8,  //this allows per-triangle material (friction/restitution)
CHARACTER_OBJECT:16,DISABLE_VISUALIZE_OBJECT:32  //disable debug drawing
},rigid_flags:{
DISABLE_WORLD_GRAVITY:1
},collision_types:{
COLLISION_OBJECT:1,RIGID_BODY:2,GHOST_OBJECT:3,SOFT_BODY:4,HF_FLUID:5
},collision_states:{
ACTIVE_TAG:1,ISLAND_SLEEPING:2,WANTS_DEACTIVATION:3,DISABLE_DEACTIVATION:4,DISABLE_SIMULATION:5
}
};
var utrans;
var uquat,ubtquat;
var uvec,uvec2;
function vec3bt_copy(a,b){
b.setX(a[0]);
b.setY(a[1]);
b.setZ(a[2]);
}
function btvec3_copy(a,b){
b[0]=a.x();
b[1]=a.y();
b[2]=a.z();
}
function quatbt_copy(a,b){
b.setX(a.x);
b.setY(a.y);
b.setZ(a.z);
b.setW(a.w);
}
function btquat_copy(a,b){
b.x=a.x();
b.y=a.y();
b.z=a.z();
b.w=a.w();
}
function vec3bt(a){
return new Ammo.btVector3(a[0],a[1],a[2]);
}
function vec3btquat(a){
var q=new Ammo.btQuaternion();
q.setEulerZYX(a[2]*(Math.PI/180.0),a[1]*(Math.PI/180.0),a[0]*(Math.PI/180.0));
return q;
}
function vec3quat(a){
uquat.fromEuler(a[0],a[1],a[2]);
return [uquat.x,uquat.y,uquat.z,uquat.w];
}
function btvec3(a){
return [a.x(),a.y(),a.z()];
}
var shapeBin=[];
function generateCollisionShape(rigidBody){
var cmap=rigidBody.getCollisionMap();
if(cmap.getResult()) return cmap.getResult();
var shapes=cmap.getShapes();
var shape,i,iMax,f,fMax,scale,mesh,btShapes=[];
var btShape=null;
for(i=0, iMax=shapes.length; i<iMax; i++){
shape=shapes[i];
btShape=null;
if(shape.type === enums.collision.shape.BOX){
btShape=new Ammo.btBoxShape(new Ammo.btVector3(shape.size[0]/2,shape.size[1]/2,shape.size[2]/2));
}else if(shape.type === enums.collision.shape.SPHERE){
btShape=new Ammo.btSphereShape(shape.radius);
}else if(shape.type === enums.collision.shape.CAPSULE){
btShape=new Ammo.btCapsuleShape(shape.radius,shape.height);
}else if(shape.type === enums.collision.shape.CYLINDER){
btShape=new Ammo.btCylinderShape(new Ammo.btVector3(shape.size[0]/2,shape.size[1]/2,shape.size[2]/2));
}else if(shape.type === enums.collision.shape.CONE){
btShape=new Ammo.btConeShape(shape.radius,shape.height);
}else if(shape.type === enums.collision.shape.MESH){
mesh=shape.mesh;
var mTriMesh=new Ammo.btTriangleMesh();
scale=shape.size;
var v0=new Ammo.btVector3(0,0,0);
var v1=new Ammo.btVector3(0,0,0);
var v2=new Ammo.btVector3(0,0,0);
var mats=mesh.getMaterials();
for(f=0, fMax=mesh.faces.length; f<fMax; f++){
var face=mesh.faces[f];
var mat=mats[face.material];
if(!mat.collision) continue;
if(face.points.length !== 3) continue;
v0.setValue(mesh.points[face.points[0]][0]*scale[0],mesh.points[face.points[0]][1]*scale[1],mesh.points[face.points[0]][2]*scale[2]);
v1.setValue(mesh.points[face.points[1]][0]*scale[0],mesh.points[face.points[1]][1]*scale[1],mesh.points[face.points[1]][2]*scale[2]);
v2.setValue(mesh.points[face.points[2]][0]*scale[0],mesh.points[face.points[2]][1]*scale[1],mesh.points[face.points[2]][2]*scale[2]);
mTriMesh.addTriangle(v0,v1,v2);
}
if(rigidBody.getMass() === 0.0 || rigidBody.getType() == enums.physics.body.STATIC || rigidBody.getType() == enums.physics.body.GHOST)  // static
{
rigidBody.setMass(0);
btShape=new Ammo.btBvhTriangleMeshShape(mTriMesh,true);
}else{
btShape=new Ammo.btConvexTriangleMeshShape(mTriMesh,true);
}
}else if(shape.type === enums.collision.shape.CONVEX_HULL){
mesh=shape.mesh;
scale=shape.size;
var v=new Ammo.btVector3(0,0,0);
btShape=new Ammo.btConvexHullShape();
for(f=0, fMax=mesh.points.length; f<fMax; f++){
vec3bt_copy([mesh.points[f][0]*scale[0],mesh.points[f][1]*scale[1],mesh.points[f][2]*scale[2]],v);
btShape.addPoint(v);
}
}else if(shape.type === enums.collision.shape.HEIGHTFIELD){
mesh=shape.mesh;
var xdiv=0,xsize=0;
var zdiv=0,zsize=0;
var points;
if(shape.landscape && !shape.heightfield && shape.landscape instanceof base.HeightField){
shape.heightfield=shape.landscape;    // patch
}else if(shape.landscape && shape.landscape instanceof base.Landscape){
xdiv=shape.landscape.heightfield.divX;
zdiv=shape.landscape.heightfield.divZ;
xsize=shape.landscape.heightfield.sizeX;
zsize=shape.landscape.heightfield.sizeZ;
points=shape.landscape.heightfield.getMesh().points;
}
if(shape.heightfield && shape.heightfield instanceof base.HeightField){
xdiv=shape.heightfield.divX;
zdiv=shape.heightfield.divZ;
xsize=shape.heightfield.sizeX;
zsize=shape.heightfield.sizeZ;
points=shape.heightfield.getMesh().points;
}
var upIndex=1;
var maxHeight=100;
var flipQuadEdges=false;
var ptr=Ammo.allocate(points.length*4,"float",Ammo.ALLOC_NORMAL);
for(f=0, fMax=xdiv*zdiv; f<fMax; f++){
Ammo.setValue(ptr+(f << 2),points[f][1],'float');
}
var scalarType={
FLOAT:0,DOUBLE:1,INTEGER:2,SHORT:3,FIXEDPOINT88:4,UCHAR:5
};
btShape=new Ammo.btHeightfieldTerrainShape(xdiv,zdiv,ptr,1,-maxHeight,maxHeight,upIndex,scalarType.FLOAT,flipQuadEdges);
btShape.setUseDiamondSubdivision(true);
var localScaling=new Ammo.btVector3(xsize/(xdiv),1,zsize/(zdiv));
btShape.setLocalScaling(localScaling);
}
if(btShape){
if(shape.margin !== 0.0){
btShape.setMargin(shape.margin);
}
btShapes.push({cShape:shape,btShape:btShape});
}
}
var btResultShape=null;
if(btShapes.length === 1){  // single shape, just return it
btResultShape=btShapes[0].btShape;
}else if(btShapes.length>1){ // compound multi-shape
utrans=new Ammo.btTransform();
btResultShape=new Ammo.btCompoundShape(false); // not animating internal shape yet, set to false for now
for(i=0, iMax=btShapes.length; i<iMax; i++){
utrans.setIdentity();
utrans.setOrigin(vec3bt(btShapes[i].cShape.position));
utrans.setRotation(vec3btquat(btShapes[i].cShape.rotation));
btResultShape.addChildShape(utrans,btShapes[i].btShape);
}
} // TODO: btMultiSphereShape optimized for sphere clusters
cmap.setResult(btResultShape);
return btResultShape;
}
var RigidProperties=function(obj_init){
this.type=base.parseEnum(enums.physics.body,obj_init.type);
this.mass=(obj_init.mass !== undef)?obj_init.mass:(this.type?1.0:0.0);
this.size=obj_init.size || [1,1,1];
this.restitution=obj_init.restitution || (this.type?0.0:1.0);
this.friction=obj_init.friction || 1.0;
this.collision=obj_init.collision;
if(this.collision && !this.collision.getShapes){
this.collision=new base.CollisionMap(this.collision);
}
this.blocker=obj_init.blocker || false;
};
var RigidBody=function(sceneObj_in,properties_in,cmap_in){
var obj_init;
if(!sceneObj_in.position && sceneObj_in.sceneObject){
obj_init=sceneObj_in;
sceneObj_in=sceneObj_in.sceneObject;
properties_in=obj_init.properties;
cmap_in=obj_init.collision;
}
obj_init=base.get(obj_init) || {};
this.properties=new base.RigidProperties(properties_in?base.get(properties_in):{collision:cmap_in});
this.collisionEvents=[];  // TODO: registration for collision event callbacks during updateSceneObject()
this.parent=null; // TODO: rigid body parenting with default 6DOF constraint
this.init_position=sceneObj_in.position.slice(0);
this.init_rotation=sceneObj_in.rotation.slice(0);
this.init_linearVelocity=this.linearVelocity=obj_init.linearVelocity || [0,0,0];
this.init_angularVelocity=this.angularVelocity=obj_init.angularVelocity || [0,0,0];
this.init_impulse=this.impulse=obj_init.impulse || [0,0,0];
this.init_impulsePosition=this.impulsePosition=obj_init.impulsePosition || [0,0,0];
this.rigid_flags=null;
this.collision_flags=null;
this.sceneObject=sceneObj_in;
this.transform=new Ammo.btTransform();
this.transform.setIdentity();
this.transform.setOrigin(vec3bt(this.init_position));
this.transform.setRotation(vec3btquat(this.init_rotation));
this.shape=null;
this.motionState=new Ammo.btDefaultMotionState(this.transform);
this.localInertia=new Ammo.btVector3(0,0,0);
this.bodyInit=null;
this.body=null;
this.ghost=null;
this.noDeactivate=false;
};
RigidBody.prototype={
getProperties:function(){
return this.properties;
},getSceneObject:function(){
return this.sceneObject;
},getInitialPosition:function(){
return this.init_position;
},getInitialRotation:function(){
return this.init_rotation;
},setInitialPosition:function(){
this.init_position=init_position_in;
},setInitialRotation:function(){
this.init_rotation=init_rotation_in;
},getType:function(){
return this.properties.type;
},getMass:function(){
return this.properties.mass;
},getRestitution:function(){
return this.properties.restitution;
},getCollisionMap:function(){
return this.properties.collision;
},setMass:function(mass_in){
this.properties.mass=mass_in;
if(this.body){
this.body.setMassProps(mass_in,this.localInertia);
}
},setRestitution:function(restitution_in){
this.restitution=restitution_in;
},getBody:function(){
if(!this.body && !this.ghost){
var shape=this.getCollisionShape();
if(this.getType() === enums.physics.body.GHOST){
this.body=null;
this.ghost=new Ammo.btGhostObject();
this.ghost.setCollisionShape(shape);
this.ghost.setWorldTransform(this.transform);
this.ghost._cvr_rigidbody=this;
}else{
if(this.getMass()){
shape.calculateLocalInertia(this.getMass(),this.localInertia);
}
this.bodyInit=new Ammo.btRigidBodyConstructionInfo(this.getMass(),this.motionState,shape,this.localInertia);
if(this.friction){
this.bodyInit.set_m_friction(this.friction);
}
this.body=new Ammo.btRigidBody(this.bodyInit);
if(this.getRestitution()){
this.body.setRestitution(this.getRestitution());
}
vec3bt_copy(this.linearVelocity,uvec);
this.body.setLinearVelocity(uvec);
vec3bt_copy(this.angularVelocity,uvec);
this.body.setAngularVelocity(uvec);
if(!base.vec3.equal([0,0,0],this.impulse)){
vec3bt_copy(this.impulse,uvec);
vec3bt_copy(this.impulsePosition,uvec2);
this.body.applyImpulse(uvec,uvec2);
}
if(this.rigid_flags){
this.body.setFlags(this.rigid_flags);
}
if(this.collision_flags){
this.body.setFlags(this.collision_flags);
}
this.body._cvr_rigidbody=this;
}
}
return this.body || this.ghost;
},updateSceneObject:function(force_update){
if(!this.body) return;
if(this.body.isActive() || force_update){
this.body.getMotionState().getWorldTransform(utrans);
var origin=utrans.getOrigin();
if(origin.x != origin.x){
console.log("origin is NaN");
}else{
this.sceneObject.position[0]=origin.x();
this.sceneObject.position[1]=origin.y();
this.sceneObject.position[2]=origin.z();
}
var quat_rotation=utrans.getRotation();
uquat.x=quat_rotation.x();
uquat.y=quat_rotation.y();
uquat.z=quat_rotation.z();
uquat.w=quat_rotation.w();
if(uquat.x != uquat.x){
console.log("rotation is NaN");
}else{
var rotation=uquat.toEuler();
this.sceneObject.rotation[0]=rotation[0];
this.sceneObject.rotation[1]=rotation[1];
this.sceneObject.rotation[2]=rotation[2];
}
return true;
}else{
}
},reset:function(pos,quat){
if(!this.body) return;
var origin=this.body.getWorldTransform().getOrigin();
vec3bt_copy(this.init_position,origin);
var rotation=this.body.getWorldTransform().getRotation();
this.resetMotion();
var rotq=vec3quat(this.init_rotation);
ubtquat.setX(rotq[0]);
ubtquat.setY(rotq[1]);
ubtquat.setZ(rotq[2]);
ubtquat.setW(rotq[3]);
this.body.getWorldTransform().setRotation(ubtquat);
this.activate();
},resetMotion:function(){
vec3bt_copy(this.init_linearVelocity,uvec);
this.body.setLinearVelocity(uvec);
vec3bt_copy(this.init_angularVelocity,uvec);
this.body.setAngularVelocity(uvec);
if(!base.vec3.equal([0,0,0],this.init_impulse)){
vec3bt_copy(this.init_impulse,uvec);
vec3bt_copy(this.init_impulsePosition,uvec2);
this.body.applyImpulse(uvec,uvec2);
}
},getCollisionShape:function(){
if(!this.shape){
this.shape=generateCollisionShape(this);
}
return this.shape;
},setAngularVelocity:function(vel){
this.angularVelocity=vel;
if(!this.body) return;
vec3bt_copy(vel,uvec);
this.body.setAngularVelocity(uvec);
},setGravity:function(acc){
this.gravity=acc;
if(!this.body) return;
vec3bt_copy(acc,uvec);
this.body.setGravity(uvec);
},getGravity:function(){
if(this.gravity && !this.body) return this.gravity;
return btvec3(this.body.getGravity());
},setLinearVelocity:function(vel){
this.linearVelocity=vel;
if(!this.body) return;
vec3bt_copy(vel,uvec);
this.body.setLinearVelocity(uvec);
},applyImpulse:function(impulse,impulsePosition){
this.impulse=impulse || [0,0,0];
this.impulsePosition=impulsePosition || [0,0,0];
if(!this.body) return;
if(!base.vec3.equal([0,0,0],impulse)){
vec3bt_copy(this.impulse,uvec);
vec3bt_copy(this.impulsePosition,uvec2);
this.body.applyImpulse(uvec,uvec2);
}
},applyForce:function(force,forcePosition){
if(!this.body) return;
if(!base.vec3.equal([0,0,0],force)){
vec3bt_copy(force,uvec);
vec3bt_copy(forcePosition,uvec2);
this.body.applyImpulse(uvec,uvec2);
}
},getAngularVelocity:function(){
return btvec3(this.body.getAngularVelocity());
},getLinearVelocity:function(){
return btvec3(this.body.getLinearVelocity());
},activate:function(noDeactivate){
this.noDeactivate=noDeactivate || false;
if(this.body){
if(this.noDeactivate){
this.body.setActivationState(enums.physics.collision_states.DISABLE_DEACTIVATION);
}
this.body.activate();
}
},setAngularFactor:function(angFactor){
if(this.body && (angFactor !== undef)){
if(!angFactor.length){
angFactor=[angFactor,angFactor,angFactor];
}
vec3bt_copy(angFactor,uvec);
this.body.setAngularFactor(uvec);
}
},isActive:function(){
if(this.body){
return this.body.isActive();
}else{
return false;
}
},isStatic:function(){
return (this.properties.type == enums.physics.body.STATIC);
},setRigidFlags:function(flags){
this.rigid_flags=flags;
if(this.body){
this.body.setFlags(flags);
}
},setCollisionFlags:function(flags){
flags=base.parseEnum(enums.physics.collision_flags,flags);
this.collision_flags=flags;
if(this.body){
this.body.setCollisionFlags(flags);
}
},setPosition:function(in_pos){
this.position=in_pos;
if(!this.body && !this.ghost) return;
vec3bt_copy(in_pos,uvec);
if(this.body){
this.body.getCenterOfMassTransform().setOrigin(uvec);
}
if(this.ghost){
this.ghost.getWorldTransform().setOrigin(uvec);
}
},getRotation:function(){
if(!this.body && !this.ghost) return this.init_rotation;
if(this.body){
this.body.getCenterOfMassTransform().getRotation(ubtquat);
}
if(this.ghost){
this.ghost.getWorldTransform().getRotation(ubtquat);
}
var q=new base.Quaternion();
btquat_copy(ubtquat,q);
return q;
},setRotation:function(in_quat){
this.rotation=in_quat.toEuler();
if(!this.body && !this.ghost) return;
quatbt_copy(in_quat,ubtquat);
if(this.body){
this.body.getCenterOfMassTransform().setRotation(ubtquat);
}
if(this.ghost){
this.ghost.getWorldTransform().setRotation(ubtquat);
}
},getRotationEuler:function(){
if(!this.body && !this.ghost) return this.init_rotation;
var q=new base.Quaternion();
if(this.body){
this.body.getCenterOfMassTransform().getRotation(ubtquat);
}
if(this.ghost){
this.ghost.getWorldTransform().getRotation(ubtquat);
}
btquat_copy(ubtquat,q);
return q.toEuler();
},setRotationEuler:function(in_rot){
this.rotation=in_rot;
ubtquat.setEuler(this.rotation[2]*(Math.PI/180.0),this.rotation[1]*(Math.PI/180.0),this.rotation[0]*(Math.PI/180.0));
if(this.body){
this.body.getCenterOfMassTransform().setRotation(ubtquat);
}
if(this.ghost){
this.body.getWorldTransform().setRotation(ubtquat);
}
}
};
var Constraint=function(obj_init){
obj_init=obj_init || {};
this.ctype=base.parseEnum(enums.physics.constraint,obj_init.ctype) || enums.physics.constraint.P2P;
this.strength=obj_init.strength || 0.1;
this.maxImpulse=obj_init.maxImpulse || 0;
this.rigidBodyA=(obj_init.rigidBodyA || obj_init.rigidBody) || null;
this.rigidBodyB=obj_init.rigidBodyB || null;
this.positionA=obj_init.positionA || [0,0,0];
this.positionB=obj_init.positionB || obj_init.position || [0,0,0];
this.damping=(obj_init.damping != undef)?obj_init.damping:1;
this.btConstraint=null;
this.localPivotA=vec3bt(this.positionA);
this.localPivotB=vec3bt(this.positionB);
};
Constraint.prototype={
getConstraint:function(){
if(!this.btConstraint){
if(!this.rigidBodyA){
return false;
}
if(this.ctype === enums.physics.constraint.P2P){
if(this.rigidBodyA && this.rigidBodyB){ // connect two rigid bodies via p2p if provided
this.btConstraint=new Ammo.btPoint2PointConstraint(this.rigidBodyA.getBody(),this.rigidBodyB.getBody(),this.localPivotA,this.localPivotB);
}else{  // otherwise assume we're just constraining with pivot B
this.btConstraint=new Ammo.btPoint2PointConstraint(this.rigidBodyA.getBody(),this.localPivotA);
}
this.btConstraint.get_m_setting().set_m_tau(this.strength);
this.btConstraint.get_m_setting().set_m_damping(this.damping);
if(this.maxImpulse){
this.btConstraint.get_m_setting().set_m_impulseClamp(this.maxImpulse);
}
if(this.btConstraint === Ammo.NULL){
this.btConstraint=null;
}
}
}
return this.btConstraint;
},setStrength:function(strength){
this.strength=strength;
if(this.btConstraint){
this.btConstraint.get_m_setting().set_m_tau(this.strength);
}
},setDamping:function(damping){
this.damping=damping;
if(this.btConstraint){
this.btConstraint.get_m_setting().set_damping(this.damping);
}
},setMaxImpulse:function(maxImpulse){
this.maxImpulse=maxImpulse;
if(this.btConstraint){
this.btConstraint.get_m_setting().set_impulseClamp(this.maxImpulse);
}
},getStrength:function(){
return this.strength;
},setPosition:function(p){
this.positionB=p;
if(this.btConstraint){
vec3bt_copy(this.positionB,this.localPivotB);
this.btConstraint.setPivotB(this.localPivotB);
}
},getPosition:function(){
return this.positionB;
}
};
function ContactManifold(contactManifold){
this.setManifold(contactManifold);
}
ContactManifold.prototype={
getContact:function(contactNum){
var pt=this.manifold.getContactPoint(j); // btManifoldPoint
if(pt === Ammo.NULL) return null;
var contact={
impulse:pt.getAppliedImpulse(),lifetime:pt.getLifeTime(),friction:pt.get_m_combinedFriction(),positionA:btvec3(pt.getPositionWorldOnA()),positionB:btvec3(pt.getPositionWorldOnB())
};
return contact;
},setManifold:function(contactManifold){
this.numContacts=contactManifold.getNumContacts();
this.manifold=contactManifold;
}
};
var ScenePhysics=function(world_aabb_min,world_aabb_max){
this.rigidObjects=[];
this.ghostObjects=[];
this.contactObjects=[];
this.collisionObjects=[];
this.active_count=0;
this.collisionConfiguration=new Ammo.btDefaultCollisionConfiguration();
this.dispatcher=new Ammo.btCollisionDispatcher(this.collisionConfiguration);
this.overlappingPairCache=new Ammo.btDbvtBroadphase();
this.solver=new Ammo.btSequentialImpulseConstraintSolver();
this.dynamicsWorld=new Ammo.btDiscreteDynamicsWorld(this.dispatcher,this.overlappingPairCache,this.solver,this.collisionConfiguration);
this.dynamicsWorld.setGravity(new Ammo.btVector3(0,-10,0));
this.overlappingPairCache.getOverlappingPairCache().setInternalGhostPairCallback(new Ammo.btGhostPairCallback());
if(!utrans || !uquat){
uvec=new Ammo.btVector3();
uvec2=new Ammo.btVector3();
utrans=new Ammo.btTransform();
uquat=new base.Quaternion();
ubtquat=new Ammo.btQuaternion();
}
};
ScenePhysics.prototype={
addConstraint:function(constraint){
var btConstraint=constraint.getConstraint();
if(btConstraint){
this.dynamicsWorld.addConstraint(btConstraint);
constraint.rigidBodyA.activate(true);
return true;
}
return false;
},removeConstraint:function(constraint){
var btConstraint=constraint.getConstraint();
if(btConstraint){
this.dynamicsWorld.removeConstraint(btConstraint);
return true;
}
return false;
},setGravity:function(grav){
vec3bt_copy(grav,uvec);
this.dynamicsWorld.setGravity(uvec);
},bindSceneObject:function(sceneObject_in,physProperties_in){
var rigidBody=new base.RigidBody(sceneObject_in,physProperties_in);
this.rigidObjects.push(rigidBody);
var body=rigidBody.getBody();
rigidBody.activate();
this.dynamicsWorld.addRigidBody(rigidBody.getBody());
rigidBody.updateSceneObject(true);
return rigidBody;
},bind:function(obj){
if(obj instanceof base.Vehicle){
obj.initBody(this);
}else if(obj instanceof base.RigidBody){
this.bindRigidBody(obj);
}
},remove:function(obj){
if(obj instanceof base.RigidBody){
this.removeRigidBody(obj);
}
},bindRigidBody:function(rigidBody_in){
if(rigidBody_in.getType() === enums.physics.body.GHOST){
if(this.ghostObjects.indexOf(rigidBody_in) !== -1) return;
this.ghostObjects.push(rigidBody_in);
var ghost=rigidBody_in.getBody();
if(!rigidBody_in.properties.blocker){
ghost.setCollisionFlags(ghost.getCollisionFlags()+enums.physics.collision_flags.NO_CONTACT_RESPONSE);
}
this.dynamicsWorld.addCollisionObject(ghost);
}else{
if(this.rigidObjects.indexOf(rigidBody_in) !== -1) return;
this.rigidObjects.push(rigidBody_in);
var body=rigidBody_in.getBody();
rigidBody_in.activate();
this.dynamicsWorld.addRigidBody(body);
rigidBody_in.updateSceneObject(true);
}
var sceneObj,evh;
if(!!(sceneObj=rigidBody_in.getSceneObject()) && !!(evh=sceneObj.getEventHandler())){
if(evh.hasEvent(enums.event.CONTACT)){
this.contactObjects.push(rigidBody_in);
}
if(evh.hasEvent(enums.event.COLLIDE)){
this.collisionObjects.push(rigidBody_in);
}
}
},removeRigidBody:function(rigidBody_in){
if(rigidBody_in.getType() === enums.physics.body.GHOST){
if(this.ghostObjects.indexOf(rigidBody_in) === -1) return;
this.ghostObjects.splice(this.ghostObjects.indexOf(rigidBody_in),1);
var ghost=rigidBody_in.getBody();
this.dynamicsWorld.removeCollisionObject(ghost);
}else{
if(this.rigidObjects.indexOf(rigidBody_in) === -1) return;
this.rigidObjects.splice(this.rigidObjects.indexOf(rigidBody_in),1);
var body=rigidBody_in.getBody();
this.dynamicsWorld.removeRigidBody(body);
}
var sceneObj,evh;
if(!!(sceneObj=rigidBody_in.getSceneObject()) && !!(evh=sceneObj.getEventHandler())){
if(evh.hasEvent(enums.event.CONTACT)){
if(this.contactObjects.indexOf(rigidBody_in) !== -1){
this.contactObjects.splice(this.contactObjects.indexOf(rigidBody_in),1);
}
}
if(evh.hasEvent(enums.event.COLLIDE)){
if(this.collisionObjects.indexOf(rigidBody_in) !== -1){
this.collisionObjects.splice(this.collisionObjects.indexOf(rigidBody_in),1);
}
}
}
},getActiveCount:function(){
return this.active_count;
},stepSimulation:function(lus,substep){
this.dynamicsWorld.stepSimulation(lus,substep || 2);
var active_count=0;
for(var i=0,iMax=this.rigidObjects.length; i<iMax; i++){
var rb=this.rigidObjects[i];
if(rb.updateSceneObject()){
active_count++;
}
}
this.active_count=active_count;
},triggerEvents:function(){
var i,j,evh,prop,sceneObj;
var world=this.dynamicsWorld;
if(this.contactObjects.length){
var numManifolds=world.getDispatcher().getNumManifolds();
for(i=0; i<numManifolds; i++){
var contactManifold=world.getDispatcher().getManifoldByIndexInternal(i);  //btPersistentManifold
var obj0=Ammo.wrapPointer(contactManifold.getBody0(),Ammo.btRigidBody); //btRigidBody
var rb0=obj0._cvr_rigidbody || null;
var obj1=Ammo.wrapPointer(contactManifold.getBody1(),Ammo.btRigidBody); //btRigidBody
var rb1=obj1._cvr_rigidbody || null;
if(!!rb0 && !!(sceneObj=rb0.getSceneObject()) && !!(evh=sceneObj.getEventHandler()) && evh.hasEvent(enums.event.CONTACT)){
prop=evh.triggerEvent(enums.event.CONTACT);
prop.self=rb0;
prop.other=rb1;
if(prop.contacts) prop.contacts.setManifold(contactManifold); else prop.contacts=new ContactManifold(contactManifold);
}else if(!!rb1 && rb1.isStatic() && !!(sceneObj=rb1.getSceneObject()) && !!(evh=sceneObj.getEventHandler()) && evh.hasEvent(enums.event.CONTACT)){
prop=evh.triggerEvent(enums.event.CONTACT);
prop.other=rb0;
prop.self=rb1;
if(prop.contacts) prop.contacts.setManifold(contactManifold); else prop.contacts=new ContactManifold(contactManifold);
}
}
}
var numCollision=this.collisionObjects.length;
for(i=0; i<numCollision; i++){
var cobj=this.collisionObjects[i];
if(!!(sceneObj=cobj.getSceneObject()) && !!(evh=sceneObj.getEventHandler()) && evh.hasEvent(enums.event.COLLIDE)){
var evp=evh.getProperties(enums.event.COLLIDE);
var collidesWith=evp.collidesWith;
evp.mf=evp.mf || [];
evp.alg=evp.alg || [];
if(collidesWith && collidesWith.length){
var collisions=[];
var body0=cobj.getBody();
for(i=0, iMax=collidesWith.length; i<iMax; i++){
var cw=collidesWith[i];
var body1=cw.getBody();
if(!evp.mf[i]) evp.mf[i]=new Ammo.btManifoldResult(body0,body1);
if(!evp.alg[i]) evp.alg[i]=this.dynamicsWorld.getDispatcher().findAlgorithm(body0,body1);
evp.alg[i].processCollision(body0,body1,this.dynamicsWorld.getDispatchInfo(),evp.mf[i]);
if(evp.mf[i].getPersistentManifold().getNumContacts()>0){
collisions.push(cw);
this.dynamicsWorld.getDispatcher().clearManifold(evp.mf[i].getPersistentManifold()); // drop the manifold or we get a feedback collision response..
}
}
if(collisions.length){
prop=evh.triggerEvent(enums.event.COLLIDE);
if(prop){
prop.collisions=collisions;
}
}
}
}
}
var numGhosts=this.ghostObjects.length;
for(i=0; i<numGhosts; i++){
var ghost=this.ghostObjects[i];
sceneObj=ghost.getSceneObject();
if(sceneObj){
evh=sceneObj.getEventHandler();
if(evh && evh.hasEvent(enums.event.CONTACT_GHOST)){
var ghostBody=ghost.getBody();
var numOverlaps=ghostBody.getNumOverlappingObjects();
if(numOverlaps){
prop=evh.triggerEvent(enums.event.CONTACT_GHOST);
prop.contacts=prop.contacts || [];
if(prop.contacts.length>numOverlaps){
prop.contacts.length=numOverlaps;
}
for(j=0; j<numOverlaps; j++){
var contactBody=Ammo.btRigidBody.prototype.upcast(ghostBody.getOverlappingObject(j));
prop.contacts[j]=contactBody._cvr_rigidbody || null;
}
}
}
}
}
},reset:function(){
for(var i=0,iMax=this.rigidObjects.length; i<iMax; i++){
this.rigidObjects[i].reset();
}
},getRayHit:function(rayFrom,rayTo,pickStatic,pickKinematic){
var btRayFrom,btRayTo;
btRayFrom=vec3bt(rayFrom);
btRayTo=vec3bt(rayTo);
pickStatic=pickStatic || false;
pickKinematic=pickKinematic || false;
var rayCallback=new Ammo.ClosestRayResultCallback(btRayFrom,btRayTo);
this.dynamicsWorld.rayTest(btRayFrom,btRayTo,rayCallback);
if(rayCallback.hasHit()){
body=Ammo.btRigidBody.prototype.upcast(rayCallback.get_m_collisionObject());
if(body !== Ammo.NULL){
if(!((body.isStaticObject() && !pickStatic) || (body.isKinematicObject() && !pickKinematic))){
var pickedBody=body;
var pickPos=rayCallback.get_m_hitPointWorld();  // btVector3
var localPos=pickedBody.getCenterOfMassTransform().inverse().op_mul(pickPos);
var rb=pickedBody._cvr_rigidbody;
if(rb){
Ammo.destroy(rayCallback);
return {position:btvec3(pickPos),localPosition:btvec3(localPos),rigidBody:rb,ammoBody:pickedBody};
}else{
Ammo.destroy(rayCallback);
return {position:btvec3(pickPos),localPosition:btvec3(localPos),rigidBody:null,ammoBody:pickedBody};
}
}
}
}
Ammo.destroy(rayCallback);
}
};
var extend={
ScenePhysics:ScenePhysics,Constraint:Constraint,RigidProperties:RigidProperties,RigidBody:RigidBody,vec3bt_copy:vec3bt_copy,btvec3_copy:btvec3_copy,quatbt_copy:quatbt_copy,btquat_copy:btquat_copy
};
return extend;
});
CubicVR.RegisterModule("CollisionMap",function(base){
var undef=base.undef;
var util=base.util;
var vec3=base.vec3;
var enums=base.enums;
enums.collision={
shape:{
BOX:0,SPHERE:1,CYLINDER:2,CONE:3,CAPSULE:4,MESH:5,HEIGHTFIELD:6,CONVEX_HULL:7
}
};
var CollisionMap=function(cmap_objs){
this.shapes=[];
this.result=null;
if(cmap_objs){
if(cmap_objs && !cmap_objs.length){
cmap_objs=[cmap_objs];
}
for(var i=0,iMax=cmap_objs.length; i<iMax; i++){
this.addShape(cmap_objs[i]);
}
}
};
CollisionMap.prototype={
addShape:function(shape_in){
shape_in.type=base.parseEnum(enums.collision.shape,shape_in.type);
shape_in.position=shape_in.position || [0,0,0];
shape_in.rotation=shape_in.rotation || [0,0,0];
shape_in.size=shape_in.size || [1,1,1];
shape_in.radius=shape_in.radius || 1;
shape_in.height=shape_in.height || 1;
shape_in.margin=shape_in.margin || 0.0;
shape_in.mesh=shape_in.mesh || null;
this.shapes.push(shape_in);
},getShapes:function(){
return this.shapes;
},setResult:function(shape){
this.result=shape;
},getResult:function(){
return this.result;
}
};
var extend={
CollisionMap:CollisionMap
};
return extend;
});
CubicVR.RegisterModule("RigidVehicle",function(base){
var undef=base.undef;
var util=base.util;
var vec3=base.vec3;
var enums=base.enums;
var utrans;
var uquat,ubtquat;
var uvec,uvec2;
var Vehicle=function(obj_init){
obj_init=base.get(obj_init) || {};
var bodyMesh=obj_init.mesh;
var bodyCollision=obj_init.collision;
this.maxEngineForce=obj_init.maxEngineForce || 2000.0;
this.maxBreakingForce=obj_init.maxBreakingForce || 125.0;
this.steeringClamp=obj_init.steeringClamp || 0.51;
this.mass=obj_init.mass || 400;
this.gEngineForce=0.0;
this.gBreakingForce=0.0;
this.gVehicleSteering=0.0;
this.rightIndex=0;
this.upIndex=1;
this.forwardIndex=2;
this.m_vehicleRayCaster=null;
this.m_vehicle=null;
this.m_tuning=null;
this.wheelDirectionCS0=new Ammo.btVector3();
this.wheelAxleCS=new Ammo.btVector3();
this.wheels=[];
this.bodyMesh=bodyMesh;
this.bodyCollision=new base.CollisionMap(bodyCollision);
this.sceneObject=new base.SceneObject(this.bodyMesh);
if(!utrans || !uquat){
uvec=new Ammo.btVector3();
uvec2=new Ammo.btVector3();
utrans=new Ammo.btTransform();
uquat=new base.Quaternion();
ubtquat=new Ammo.btQuaternion();
}
if(obj_init.wheels != undef){
for(var i=0,iMax=obj_init.wheels.length; i<iMax; i++){
var wheel=obj_init.wheels[i];
if(wheel instanceof base.VehicleWheel){
this.addWheel(wheel);
}else{
this.addWheel(new base.VehicleWheel(wheel));
}
}
}
};
Vehicle.prototype={
getSceneObject:function(){
return this.sceneObject;
},initBody:function(scenePhysics){
this.body=new base.RigidBody(this.sceneObject,{
collision:this.bodyCollision,mass:this.mass,restitution:0.1
});
base.vec3bt_copy([0,-1,0],this.wheelDirectionCS0);
base.vec3bt_copy([-1,0,0],this.wheelAxleCS);
this.gVehicleSteering=0;
this.body.setLinearVelocity([0,0,0]);
this.body.setAngularVelocity([0,0,0]);
this.m_vehicleRayCaster=new Ammo.btDefaultVehicleRaycaster(scenePhysics.dynamicsWorld);
this.m_tuning=new Ammo.btVehicleTuning();
this.m_vehicle=new Ammo.btRaycastVehicle(this.m_tuning,this.body.getBody(),this.m_vehicleRayCaster);
this.body.getBody().setActivationState(enums.physics.collision_states.DISABLE_DEACTIVATION);
this.m_vehicle.setCoordinateSystem(this.rightIndex,this.upIndex,this.forwardIndex);
var wpos=new Ammo.btVector3();
for(var i=0; i<this.wheels.length; i++){
base.vec3bt_copy(this.wheels[i].getWheelPosition(),wpos);
this.m_vehicle.addWheel(wpos,this.wheelDirectionCS0,this.wheelAxleCS,this.wheels[i].getSuspensionRest(),this.wheels[i].getWheelRadius(),this.m_tuning,this.wheels[i].getSteering());
}
scenePhysics.dynamicsWorld.addVehicle(this.m_vehicle);
scenePhysics.bind(this.body);
this.updateSuspension();
},evaluate:function(){
var m=[];
var numWheels=this.m_vehicle.getNumWheels();
for(var i=0; i<numWheels; i++){
if(this.wheels[i].isSteering()){
this.m_vehicle.setSteeringValue(this.gVehicleSteering,i);
}
if(this.wheels[i].isBraking()){
this.m_vehicle.setBrake(this.gBrakingForce,i);
}
if(this.wheels[i].isDriving()){
this.m_vehicle.applyEngineForce(this.gEngineForce,i);
}
this.m_vehicle.updateWheelTransform(i,true);
var wtrans=this.m_vehicle.getWheelTransformWS(i);  //.getOpenGLMatrix(this.wheels[i].wheelObj.tMatrix);
var origin=wtrans.getOrigin();
this.wheels[i].wheelObj.position[0]=origin.x();
this.wheels[i].wheelObj.position[1]=origin.y();
this.wheels[i].wheelObj.position[2]=origin.z();
var quat_rotation=wtrans.getRotation();
uquat.x=quat_rotation.x();
uquat.y=quat_rotation.y();
uquat.z=quat_rotation.z();
uquat.w=quat_rotation.w();
var rotation=uquat.toEuler();
this.wheels[i].wheelObj.rotation[0]=rotation[0];
this.wheels[i].wheelObj.rotation[1]=rotation[1];
this.wheels[i].wheelObj.rotation[2]=rotation[2];
}
if(!this.body.isActive()){
this.body.activate();
}
this.updateSceneObject(true);
},getRigidBody:function(){
return this.body;
},updateSceneObject:function(force_update){
if(!this.body) return;
if(this.body.isActive() || force_update){
this.body.getBody().getMotionState().getWorldTransform(utrans);
var origin=utrans.getOrigin();
if(origin.x != origin.x){
console.log("origin is NaN");
}else{
this.sceneObject.position[0]=origin.x();
this.sceneObject.position[1]=origin.y();
this.sceneObject.position[2]=origin.z();
}
var quat_rotation=utrans.getRotation();
uquat.x=quat_rotation.x();
uquat.y=quat_rotation.y();
uquat.z=quat_rotation.z();
uquat.w=quat_rotation.w();
if(uquat.x != uquat.x){
console.log("rotation is NaN");
}else{
var rotation=uquat.toEuler();
this.sceneObject.rotation[0]=rotation[0];
this.sceneObject.rotation[1]=rotation[1];
this.sceneObject.rotation[2]=rotation[2];
}
return true;
}else{
}
},setEngineForce:function(engineForce){
this.gEngineForce=engineForce;
if(this.gEngineForce>this.maxEngineForce){
this.gEngineForce=this.maxEngineForce;
}
if(this.gEngineForce< -this.maxEngineForce){
this.gEngineForce= -this.maxEngineForce;
}
},getEngineForce:function(engineForce){
return this.gEngineForce;
},incEngine:function(engineForce_inc){
this.setEngineForce(this.getEngineForce()+engineForce_inc);
},decEngine:function(engineForce_dec){
this.setEngineForce(this.getEngineForce()-engineForce_dec);
},setSteering:function(steering){
this.gVehicleSteering=steering;
},getSteering:function(steering){
return this.gVehicleSteering;
},incSteering:function(steeringVal){
this.gVehicleSteering+=steeringVal;
if(this.gVehicleSteering>this.steeringClamp) this.gVehicleSteering=this.steeringClamp;
if(this.gVehicleSteering< -this.steeringClamp) this.gVehicleSteering= -this.steeringClamp;
},setBrake:function(brake_val){
this.gBreakingForce=brake_val;
},getWheelGroundPosition:function(wheelNum){
return this.wheels[wheelNum].wheelObj.getWorldPosition()-[0,wheels[wheelNum].getWheelRadius(),0];
},getWheelSkid:function(wheelNum){
var wheelInfo=this.m_vehicle.getWheelInfo(wheelNum);
return wheelInfo.get_m_skidInfo();
},getRigidGround:function(wheelNum){
var wheelInfo=this.m_vehicle.getWheelInfo(wheelNum);
//console.log(wheelInfo.get_m_wheelDirectionCS());
//console.log(wheelInfo.get_m_wheelsRadius());
//console.log(wheelInfo.get_m_frictionSlip());
//console.log(wheelInfo.get_m_rollInfluence());
//console.log(wheelInfo.get_m_clippedInvContactDotSuspension());
//console.log(wheelInfo.getSuspensionRestLength());
},addWheel:function(wheel_in,wheelNum){
if(wheelNum === undef){
wheelNum=this.wheels.length;
}
this.wheels[wheelNum]=wheel_in;
},getWheel:function(wheelNum){
return this.wheels[wheelNum];
},bindToScene:function(scene){
var numWheels=this.wheels.length;
for(var i=0; i<numWheels; i++){
scene.bind(this.getWheelObj(i));
}
scene.bind(this.getSceneObject());
},getWheelObj:function(i){
var wheel=this.getWheel(i);
return wheel.wheelObj;
},updateSuspension:function(){
var i;
var numWheels=this.m_vehicle.getNumWheels();
for(i=0; i<numWheels; i++){
var wheel=this.m_vehicle.getWheelInfo(i);
wheel.set_m_suspensionStiffness(this.wheels[i].getSuspensionStiffness());
wheel.set_m_suspensionRestLength1(this.wheels[i].getSuspensionRest());
wheel.set_m_wheelsDampingRelaxation(this.wheels[i].getDampingRelaxation());
wheel.set_m_wheelsDampingCompression(this.wheels[i].getDampingCompression());
wheel.set_m_frictionSlip(this.wheels[i].getFrictionSlip());
wheel.set_m_rollInfluence(this.wheels[i].getRollInfluence());
}
if(this.m_vehicle){
this.m_vehicle.resetSuspension();
for(i=0; i<numWheels; i++){
this.m_vehicle.updateWheelTransform(i,true);
}
}
},getMass:function(){
return this.mass;
},setMass:function(mass){
this.mass=mass;
if(this.body){
this.body.setMass(this.mass);
}
}
};
var VehicleWheel=function(obj_init){
obj_init=base.get(obj_init) || {};
this.wheelRef=new base.SceneObject();
this.wheelObj=new base.SceneObject();
this.wheelRef.scale=obj_init.scale || [1,1,1];
this.wheelRadius=obj_init.radius || 0.0;
this.wheelWidth=obj_init.width || 0.0;
if(obj_init.mesh != undef){
this.setModel(obj_init.mesh);
}
this.suspensionStiffness=obj_init.suspensionStiffness || 40.0;
this.suspensionRest=obj_init.suspensionRest || 0.05;
this.dampingRelaxation=obj_init.dampingRelaxation || 2.3;
this.dampingCompression=obj_init.dampingCompression || 2.4;
this.frictionSlip=obj_init.frictionSlip || 0.94;
this.rollInfluence=obj_init.rollInfluence || 0.5;
this.wheelPosition=obj_init.position || [0,0,0];
this.wheelRotation=[0,0,0];
this.steering=obj_init.steering || false;
this.braking=obj_init.braking || false;
this.driving=obj_init.driving || false;
};
VehicleWheel.prototype={
setModel:function(wheelModel_in,wheelRadius_in,wheelWidth_in){
this.wheelModel=wheelModel_in;
this.wheelRadius=wheelRadius_in || 0.0;
this.wheelWidth=wheelWidth_in || 0.0;
if(this.wheelRadius === 0.0){
this.wheelRadius=(this.wheelModel.bb[1][1]-this.wheelModel.bb[0][1])/2.0;
this.wheelRadius+=(this.wheelModel.bb[1][2]-this.wheelModel.bb[0][2])/2.0;
this.wheelRadius/=2.0;
}
if(this.wheelWidth === 0.0){
this.wheelWidth=this.wheelModel.bb[1][0]-this.wheelModel.bb[0][0];
}
this.wheelRef.obj=this.wheelModel;
this.wheelObj.bindChild(this.wheelRef);
},setSuspensionStiffness:function(suspensionStiffness_in){
this.suspensionStiffness=suspensionStiffness_in;
},getSuspensionStiffness:function(){
return this.suspensionStiffness;
},setSuspensionRest:function(suspensionRest_in){
this.suspensionRest=suspensionRest_in;
},getSuspensionRest:function(){
return this.suspensionRest;
},setDampingRelaxation:function(dampingRelaxation_in){
this.dampingRelaxation=dampingRelaxation_in;
},getDampingRelaxation:function(){
return this.dampingRelaxation;
},setDampingCompression:function(dampingCompression_in){
this.dampingCompression=dampingCompression_in;
},getDampingCompression:function(){
return this.dampingCompression;
},setFrictionSlip:function(frictionSlip_in){
this.frictionSlip=frictionSlip_in;
},getFrictionSlip:function(){
return this.frictionSlip;
},setRollInfluence:function(rollInfluence_in){
this.rollInfluence=rollInfluence_in;
},getRollInfluence:function(){
return this.rollInfluence;
},setWheelRadius:function(wheelRadius_in){
this.wheelRadius=wheelRadius_in;
},getWheelRadius:function(){
return this.wheelRadius;
},setWheelWidth:function(wheelWidth_in){
this.wheelWidth=wheelWidth_in;
},getWheelWidth:function(){
return this.wheelWidth;
},setWheelRotation:function(wheelRotation_in){
this.wheelRotation=wheelRotation_in;
this.wheelRef.setRotation(wheelRotation);
},getWheelRotation:function(){
return this.wheelRotation;
},setWheelPosition:function(wheelPosition_in){
this.wheelPosition=wheelPosition_in;
this.wheelObj.position=wheelPosition;
},getWheelPosition:function(){
return this.wheelPosition;
},setSteering:function(steering_in){
this.steering=steering_in;
},getSteering:function(){
return this.steering;
},isSteering:function(){
return this.steering;
},setBraking:function(braking_in){
this.braking=this.braking_in;
},isBraking:function(){
return this.braking;
},setDriving:function(driving_in){
this.driving=driving_in;
},isDriving:function(){
return this.driving;
}
};
var extend={
Vehicle:Vehicle,VehicleWheel:VehicleWheel
};
return extend;
});
window.CubicVRShader.CubicVRCoreVS="attribute vec3 vertexPosition;\nattribute vec3 vertexNormal;\nattribute vec2 vertexTexCoord;\n#if VERTEX_COLOR\nattribute vec3 vertexColor;\nvarying vec3 vertexColorOut;\n#endif\n#if VERTEX_MORPH\nattribute vec3 vertexMorphPosition;\nattribute vec3 vertexMorphNormal;\nuniform float materialMorphWeight;\n#endif\nvarying vec2 vertexTexCoordOut;\nuniform vec2 materialTexOffset;\n#if !LIGHT_PERPIXEL\n#if LIGHT_IS_POINT||LIGHT_IS_DIRECTIONAL||LIGHT_IS_SPOT||LIGHT_IS_AREA\nuniform vec3 lightDirection[LIGHT_COUNT];\nuniform vec3 lightPosition[LIGHT_COUNT];\nuniform vec3 lightSpecular[LIGHT_COUNT];\nuniform vec3 lightDiffuse[LIGHT_COUNT];\nuniform float lightIntensity[LIGHT_COUNT];\nuniform float lightDistance[LIGHT_COUNT];\n#if LIGHT_IS_SPOT\nuniform float lightCutOffAngle[LIGHT_COUNT];\n#endif\nvarying vec3 lightColorOut;\nvarying vec3 lightSpecularOut;\n#endif\nuniform vec3 materialDiffuse;\nuniform vec3 materialSpecular;\nuniform float materialShininess;\n#endif\nuniform mat4 matrixModelView;\nuniform mat4 matrixProjection;\nuniform mat4 matrixObject;\nuniform mat3 matrixNormal;\nvarying vec3 vertexNormalOut;\nvarying vec4 vertexPositionOut;\n#if !LIGHT_DEPTH_PASS\n#if LIGHT_SHADOWED\nvarying vec4 lightProjectionOut[LIGHT_COUNT];\nuniform mat4 lightShadowMatrix[LIGHT_COUNT];\n#endif\n#if TEXTURE_ENVSPHERE\n#if TEXTURE_NORMAL\nvarying vec3 envTexCoordOut;\n#else\nvarying vec2 envTexCoordOut;\n#endif\n#endif\n#if TEXTURE_BUMP||TEXTURE_NORMAL\nvarying vec3 envEyeVectorOut;\n#endif\n#endif \nvoid cubicvr_normalMap() {\n#if !LIGHT_DEPTH_PASS\n#if TEXTURE_BUMP||TEXTURE_NORMAL\nvec3 tangent;\nvec3 binormal;\nvec3 c1 = cross( vertexNormal, vec3(0.0, 0.0, 1.0) );\nvec3 c2 = cross( vertexNormal, vec3(0.0, 1.0, 0.0) );\nif ( length(c1) > length(c2) )  {\ntangent = c1;\n}  else {\ntangent = c2;\n}\ntangent = normalize(tangent);\nbinormal = cross(vertexNormal, tangent);\nbinormal = normalize(binormal);\nmat4 uMVOMatrix = matrixModelView * matrixObject;\nmat3 TBNMatrix = mat3( (vec3 (uMVOMatrix * vec4 (tangent, 0.0))),\n(vec3 (uMVOMatrix * vec4 (binormal, 0.0))),\n(vec3 (uMVOMatrix * vec4 (vertexNormal, 0.0)))\n);\nenvEyeVectorOut = vec3(uMVOMatrix * vec4(vertexPosition,1.0)) * TBNMatrix;\n#endif\n#endif\n}\nvoid cubicvr_environmentMap() {\n#if !LIGHT_DEPTH_PASS\n#if TEXTURE_ENVSPHERE\n#if TEXTURE_NORMAL\nenvTexCoordOut = normalize( vertexPositionOut.xyz );\n#else\nvec3 ws = (matrixModelView * vec4(vertexPosition,1.0)).xyz;\nvec3 r = reflect(ws, vertexNormalOut );\nfloat m = 2.0 * sqrt( r.x*r.x + r.y*r.y + (r.z+1.0)*(r.z+1.0) );\nenvTexCoordOut.s = r.x/m + 0.5;\nenvTexCoordOut.t = r.y/m + 0.5;\n#endif\n#endif\n#if VERTEX_COLOR\nvertexColorOut = vertexColor;\n#endif\n#endif\n}\nvoid cubicvr_shadowMap() {\n#if (LIGHT_IS_SPOT||LIGHT_IS_AREA) && LIGHT_SHADOWED\nfor (int i = 0; i < LIGHT_COUNT; i++)\n{\n#if LIGHT_SHADOWED\n#if VERTEX_MORPH\nlightProjectionOut[i] = lightShadowMatrix[i] * (matrixObject * vec4(vertexPosition+(vertexMorphPosition-vertexPosition)*materialMorphWeight, 1.0));\n#else\nlightProjectionOut[i] = lightShadowMatrix[i] * (matrixObject * vec4(vertexPosition, 1.0));\n#endif\n#endif\n}\n#endif\n}\nvoid cubicvr_lighting() {\n#if !LIGHT_PERPIXEL\n#if LIGHT_IS_POINT\nvec3 specTotal = vec3(0.0,0.0,0.0);\nvec3 accum = vec3(0.0,0.0,0.0);\nfor (int i = 0; i < LIGHT_COUNT; i++) {\nvec3 lightDirection = lightPosition[i]-vertexPositionOut.xyz;\nfloat dist = length(lightDirection);\nvec3 halfVector = normalize(vec3(0.0,0.0,1.0)+lightDirection);\nfloat NdotL = max(dot(normalize(lightDirection),vertexNormalOut),0.0);\nif (NdotL > 0.0) {\nfloat att = clamp(((lightDistance[i]-dist)/lightDistance[i]), 0.0, 1.0)*lightIntensity[i];\naccum += att * NdotL * lightDiffuse[i] * materialDiffuse;\nfloat NdotHV = max(dot(vertexNormalOut, halfVector),0.0);\nvec3 spec2 = lightSpecular[i] * materialSpecular * pow(NdotHV,materialShininess);\nspecTotal += spec2;\n}\n}\nlightColorOut = accum;\nlightSpecularOut = specTotal;\n#endif\n#if LIGHT_IS_DIRECTIONAL\nfloat NdotL;\nfloat NdotHV = 0.0;\nvec3 specTotal = vec3(0.0,0.0,0.0);\nvec3 spec2 = vec3(0.0,0.0,0.0);\nvec3 accum = vec3(0.0,0.0,0.0);\nvec3 halfVector;\nfor (int i = 0; i < LIGHT_COUNT; i++) {\nhalfVector = normalize(vec3(0.0,0.0,1.0)-lightDirection[i]);\nNdotL = max(dot(normalize(-lightDirection[i]),vertexNormalOut),0.0);\nif (NdotL > 0.0)   {\naccum += lightIntensity[i] * materialDiffuse * lightDiffuse[i] * NdotL;\nNdotHV = max(dot(vertexNormalOut, halfVector),0.0);\nspec2 = lightSpecular[i] * materialSpecular * pow(NdotHV,materialShininess);\nspecTotal += spec2;\n}\n}\nlightColorOut = accum;\nlightSpecularOut = specTotal;\n#endif\n#if LIGHT_IS_SPOT\nvec3 specTotal = vec3(0.0,0.0,0.0);\nvec3 spec2 = vec3(0.0,0.0,0.0);\nvec3 accum = vec3(0.0,0.0,0.0);\nvec3 halfVector;\nfloat spotEffect;\nfloat spotDot;\nfloat power;\nfor (int i = 0; i < LIGHT_COUNT; i++) {\nvec3 l = lightPosition[i]-vertexPositionOut.xyz;\nfloat dist = length(l);\nfloat att = clamp(((lightDistance[i]-dist)/lightDistance[i]), 0.0, 1.0)*lightIntensity[i];\natt = clamp(att,0.0,1.0);\nspotDot = dot(normalize(-l), normalize(lightDirection[i]));\nif ( spotDot < cos((lightCutOffAngle[i]/2.0)*(3.14159/180.0)) ) {\nspotEffect = 0.0;\n}\nelse {\nspotEffect = pow(spotDot, 1.0);\n}\natt *= spotEffect;\nvec3 v = normalize(-vertexPositionOut.xyz);\nvec3 h = normalize(l + v);\nfloat NdotL = max(0.0, dot(vertexNormalOut, normalize(l)));\nfloat NdotH = max(0.0, dot(vertexNormalOut, h));\nif (NdotL > 0.0) {\npower = pow(NdotH, materialShininess);\n}\nelse {\npower = 0.0;\n}\naccum += att * lightDiffuse[i] * materialDiffuse * NdotL;\nspec2 = lightSpecular[i] * materialSpecular * power;\nspecTotal += spec2*spotEffect;\n}\nlightColorOut = accum;\nlightSpecularOut = specTotal;\n#endif\n#endif \ncubicvr_normalMap();\ncubicvr_shadowMap();\ncubicvr_environmentMap();\n}\nvec2 cubicvr_texCoord() {\nreturn vertexTexCoord + materialTexOffset;\n}\nvec4 cubicvr_transform() {\n#if LIGHT_DEPTH_PASS\nvertexNormalOut = vec3(0.0,0.0,0.0);\n#endif\n#if VERTEX_MORPH\nvec4 vPos = matrixObject * vec4(vertexPosition+(vertexMorphPosition-vertexPosition)*materialMorphWeight, 1.0);\n#else\nvec4 vPos = matrixObject * vec4(vertexPosition, 1.0);\n#endif\nvertexPositionOut = matrixModelView * vPos;\nreturn vPos;\n}\nvec3 cubicvr_normal() {\n#if VERTEX_MORPH\nreturn normalize(matrixObject*vec4(vertexNormal+(vertexMorphNormal-vertexNormal)*materialMorphWeight,0.0)).xyz;\n#else\nreturn normalize(matrixObject*vec4(vertexNormal,0.0)).xyz;\n#endif\n}\n#define customShader_splice 1\nvoid main(void)\n{\nvertexTexCoordOut = cubicvr_texCoord();\ngl_Position =  matrixProjection * matrixModelView * cubicvr_transform();\n#if !LIGHT_DEPTH_PASS  \nvertexNormalOut = matrixNormal * cubicvr_normal();\ncubicvr_lighting();\n#endif \n}\n";
window.CubicVRShader.CubicVRCoreFS="#ifdef GL_ES\n#if LIGHT_PERPIXEL\nprecision highp float;\n#else\nprecision lowp float;\n#endif\n#endif\n#if FOG_ENABLED\nuniform vec3 fogColor;\nuniform float fogDensity;\nuniform float fogNear;\nuniform float fogFar;\n#endif\nuniform vec3 materialAmbient;\nuniform vec3 lightAmbient;\nuniform vec3 materialColor;\n#if LIGHT_PERPIXEL\nuniform vec3 materialDiffuse;\nuniform vec3 materialSpecular;\nuniform float materialShininess;\n#if LIGHT_IS_POINT||LIGHT_IS_DIRECTIONAL||LIGHT_IS_SPOT||LIGHT_IS_AREA\nuniform vec3 lightDirection[LIGHT_COUNT];\nuniform vec3 lightPosition[LIGHT_COUNT];\nuniform vec3 lightSpecular[LIGHT_COUNT];\nuniform vec3 lightDiffuse[LIGHT_COUNT];\nuniform float lightIntensity[LIGHT_COUNT];\nuniform float lightDistance[LIGHT_COUNT];\n#if LIGHT_IS_SPOT\nuniform float lightCutOffAngle[LIGHT_COUNT];\n#endif\n#endif\n#if LIGHT_IS_PROJECTOR\nuniform sampler2D lightProjectionMap[LIGHT_COUNT];\n#endif\n#if LIGHT_SHADOWED\nvarying vec4 lightProjectionOut[LIGHT_COUNT];\nuniform sampler2D lightShadowMap[LIGHT_COUNT];\nuniform vec3 lightDepthClip[LIGHT_COUNT];\n#endif\n#else \nvarying vec3 lightColorOut;\nvarying vec3 lightSpecularOut;\n#endif  \nvarying vec3 vertexNormalOut;\nvarying vec2 vertexTexCoordOut;\n#if VERTEX_COLOR\nvarying vec3 vertexColorOut;\n#endif\n#if FX_DEPTH_ALPHA||LIGHT_DEPTH_PASS||LIGHT_SHADOWED\nuniform vec3 postDepthInfo;\nfloat ConvertDepth3(float d) { return (postDepthInfo.x*postDepthInfo.y)/(postDepthInfo.y-d*(postDepthInfo.y-postDepthInfo.x));  }\nfloat DepthRange( float d ) { return ( d - postDepthInfo.x ) / ( postDepthInfo.y - postDepthInfo.x ); }\nfloat ConvertDepth3A(float d, float near, float far) { return (near*far)/(far-d*(far-near));  }\nfloat DepthRangeA( float d, float near, float far ) { return ( d - near ) / ( far - near ); }\n#endif\n#if LIGHT_DEPTH_PASS\nvec4 packFloatToVec4i(const float value)\n{\nconst vec4 bitSh = vec4(256.0*256.0*256.0, 256.0*256.0, 256.0, 1.0);\nconst vec4 bitMsk = vec4(0.0, 1.0/256.0, 1.0/256.0, 1.0/256.0);\nvec4 res = fract(value * bitSh);\nres -= res.xxyz * bitMsk;\nreturn res;\n}\n#endif\n#if LIGHT_SHADOWED\nfloat unpackFloatFromVec4i(const vec4 value)\n{\nconst vec4 bitSh = vec4(1.0/(256.0*256.0*256.0), 1.0/(256.0*256.0), 1.0/256.0, 1.0);\nreturn(dot(value, bitSh));\n}\n#if LIGHT_SHADOWED_SOFT\nfloat getShadowVal(sampler2D shadowTex,vec4 shadowCoord, float proj, float texel_size) {\nvec2 filterTaps[6];\nfilterTaps[0] = vec2(-0.326212,-0.40581);\nfilterTaps[1] = vec2(-0.840144,-0.07358);\nfilterTaps[2] = vec2(-0.695914,0.457137);\nfilterTaps[3] = vec2(-0.203345,0.620716);\nfilterTaps[4] = vec2(0.96234,-0.194983);\nfilterTaps[5] = vec2(0.473434,-0.480026);\n/*  filterTaps[6] = vec2(0.519456,0.767022);\nfilterTaps[7] = vec2(0.185461,-0.893124);\nfilterTaps[8] = vec2(0.507431,0.064425);\nfilterTaps[9] = vec2(0.89642,0.412458) ;\nfilterTaps[10] =vec2(-0.32194,-0.932615);\nfilterTaps[11] =vec2(-0.791559,-0.59771); */\nfloat shadow = 0.0;\nvec4  shadowSample;\nfloat distanceFromLight;\nfor (int i = 0; i < 6; i++) {\nshadowSample = texture2D(shadowTex,shadowCoord.st+filterTaps[i]*(2.0*texel_size));\ndistanceFromLight = unpackFloatFromVec4i(shadowSample);\nshadow += distanceFromLight <= shadowCoord.z ? 0.0 : 1.0 ;\n}\nshadow /= 6.0;\nreturn shadow;\n}\n#else\nfloat getShadowVal(sampler2D shadowTex,vec4 shadowCoord, float proj, float texel_size) {\nvec4 shadowSample = texture2D(shadowTex,shadowCoord.st);\nfloat distanceFromLight = unpackFloatFromVec4i(shadowSample);\nfloat shadow = 1.0;\nshadow = distanceFromLight <= (shadowCoord.z) ? 0.0 : 1.0 ;\nreturn shadow;\n}\n#endif\n#endif\n#if !LIGHT_DEPTH_PASS\n#if TEXTURE_COLOR\nuniform sampler2D textureColor;\n#endif\n#if TEXTURE_BUMP||TEXTURE_NORMAL\nvarying vec3 envEyeVectorOut;\n#endif\n#if TEXTURE_BUMP\nuniform sampler2D textureBump;\n#endif\n#if TEXTURE_ENVSPHERE\nuniform sampler2D textureEnvSphere;\nuniform float materialEnvironment;\n#if TEXTURE_NORMAL\nvarying vec3 envTexCoordOut;\n#else\nvarying vec2 envTexCoordOut;\n#endif\n#endif\n#if TEXTURE_REFLECT\nuniform sampler2D textureReflect;\n#endif\n#if TEXTURE_NORMAL\nuniform sampler2D textureNormal;\n#endif\nuniform float materialAlpha;\n#if TEXTURE_AMBIENT\nuniform sampler2D textureAmbient;\n#endif\n#if TEXTURE_SPECULAR\nuniform sampler2D textureSpecular;\n#endif\n#endif \n#if TEXTURE_ALPHA\nuniform sampler2D textureAlpha;\n#endif\nvarying vec4 vertexPositionOut;\nvec2 cubicvr_texCoord() {\n#if LIGHT_DEPTH_PASS\nreturn vertexTexCoordOut;\n#else\n#if TEXTURE_BUMP\nfloat height = texture2D(textureBump, vertexTexCoordOut.xy).r;\nfloat v = (height) * 0.05 - 0.04; \nvec3 eye = normalize(envEyeVectorOut);\nreturn vertexTexCoordOut.xy + (eye.xy * v);\n#else\nreturn vertexTexCoordOut;\n#endif\n#endif\n}\nvec3 cubicvr_normal(vec2 texCoord) {\n#if TEXTURE_NORMAL && !LIGHT_DEPTH_PASS\nvec3 bumpNorm = vec3(texture2D(textureNormal, texCoord));\nvec3 n = (vec4(normalize(vertexNormalOut),1.0)).xyz;\nbumpNorm = (bumpNorm-0.5)*2.0;\nbumpNorm.y = -bumpNorm.y;\nreturn normalize((n+bumpNorm)/2.0);\n#else\nreturn normalize(vertexNormalOut);\n#endif\n}\n#if FOG_ENABLED\nvec4 apply_fog(vec4 color) {\nvec4 outColor = color;\nfloat depth = gl_FragCoord.z / gl_FragCoord.w;\n#if USE_FOG_EXP\nconst float LOG2 = 1.442695;\nfloat fogFactor = exp2( - fogDensity * fogDensity * depth * depth * LOG2 );\nfogFactor = 1.0 - clamp( fogFactor, 0.0, 1.0 );\noutColor = mix( color, vec4( fogColor, color.w ), fogFactor );\n#endif\n#if USE_FOG_LINEAR\nfloat fogFactor = smoothstep( fogNear, fogFar, depth );\noutColor = mix( color, vec4( fogColor, color.w ), fogFactor );\n#endif\nreturn outColor;\n}\n#endif\nvec4 cubicvr_color(vec2 texCoord) {\nvec4 color = vec4(0.0,0.0,0.0,0.0);\n#if !LIGHT_DEPTH_PASS\n#if TEXTURE_COLOR\n#if !(LIGHT_IS_POINT||LIGHT_IS_DIRECTIONAL||LIGHT_IS_SPOT||LIGHT_IS_AREA)\ncolor = texture2D(textureColor, texCoord).rgba;\ncolor.rgb *= materialColor;\n#else\ncolor = texture2D(textureColor, texCoord).rgba;\n#if !TEXTURE_ALPHA\nif (color.a<=0.9) {\ndiscard;\n}\n#endif\ncolor.rgb *= materialColor;\n#endif\n#if VERTEX_COLOR\ncolor *= vec4(vertexColorOut,1.0);\n#endif\n#else\n#if VERTEX_COLOR\ncolor = vec4(vertexColorOut,1.0);\n#else\ncolor = vec4(materialColor,1.0);\n#endif\n#endif\n#if TEXTURE_ALPHA\ncolor.a = texture2D(textureAlpha, texCoord).r;\n#if FX_DEPTH_ALPHA\nif (color.a < 0.9) discard;\n#else\n#if MATERIAL_ALPHA\nif (color.a == 0.0) discard;\n#else\nif (color.a < 0.9) discard;\n#endif\n#endif\n#else\n#if MATERIAL_ALPHA\ncolor.a = materialAlpha;\n#endif\n#endif\n#endif\nreturn color;\n}\nvec4 cubicvr_lighting(vec4 color_in, vec3 n, vec2 texCoord) {\nvec4 color = color_in;\n#if !LIGHT_DEPTH_PASS\nvec3 accum = lightAmbient;\n#if LIGHT_PERPIXEL\n#if LIGHT_IS_POINT\nvec3 specTotal = vec3(0.0,0.0,0.0);\nfor (int i = 0; i < LIGHT_COUNT; i++) {\nvec3 lightDirection = lightPosition[i]-vertexPositionOut.xyz;\nfloat dist = length(lightDirection);\nvec3 halfVector = normalize(vec3(0.0,0.0,1.0)+lightDirection);\nfloat NdotL = max(dot(normalize(lightDirection),n),0.0);\nif (NdotL > 0.0) {\nfloat att = clamp(((lightDistance[i]-dist)/lightDistance[i]), 0.0, 1.0)*lightIntensity[i];\naccum += att * NdotL * lightDiffuse[i] * materialDiffuse;\nfloat NdotHV = max(dot(n, halfVector),0.0);\n#if TEXTURE_SPECULAR\nvec3 spec2 = lightSpecular[i] * texture2D(textureSpecular, vec2(texCoord.s, texCoord.t)).rgb * pow(NdotHV,materialShininess);\n#else\nvec3 spec2 = lightSpecular[i] * materialSpecular * pow(NdotHV,materialShininess);\n#endif\nspecTotal += spec2;\n}\n}\ncolor.rgb *= accum;\ncolor.rgb += specTotal;\n#endif\n#if LIGHT_IS_DIRECTIONAL\nfloat NdotL;\nfloat NdotHV = 0.0;\nvec3 specTotal = vec3(0.0,0.0,0.0);\nvec3 spec2 = vec3(0.0,0.0,0.0);\nvec3 halfVector;\nfor (int i = 0; i < LIGHT_COUNT; i++) {\nhalfVector = normalize(vec3(0.0,0.0,1.0)-lightDirection[i]);\nNdotL = max(dot(normalize(-lightDirection[i]),n),0.0);\nif (NdotL > 0.0)   {\naccum += lightIntensity[i] * materialDiffuse * lightDiffuse[i] * NdotL;\nNdotHV = max(dot(n, halfVector),0.0);\n#if TEXTURE_SPECULAR\nspec2 = lightSpecular[i] * texture2D(textureSpecular, vec2(texCoord.s, texCoord.t)).rgb * pow(NdotHV,materialShininess);\n#else\nspec2 = lightSpecular[i] * materialSpecular * pow(NdotHV,materialShininess);\n#endif\nspecTotal += spec2;\n}\n}\ncolor.rgb *= accum;\ncolor.rgb += specTotal;\n#endif\n#if LIGHT_IS_AREA\nvec3 specTotal = vec3(0.0,0.0,0.0);\nvec3 spec2 = vec3(0.0,0.0,0.0);\nfloat NdotL;\nfloat NdotHV = 0.0;\nvec3 halfVector;\nfor (int i = 0; i < LIGHT_COUNT; i++) {\nhalfVector = normalize(vec3(0.0,0.0,1.0)-lightDirection[i]);\nNdotL = max(dot(normalize(-lightDirection[i]),n),0.0);\nif (NdotL > 0.0)   {\nNdotHV = max(dot(n, halfVector),0.0);\n#if LIGHT_SHADOWED\nvec4 shadowCoord = lightProjectionOut[i] / lightProjectionOut[i].w;\nshadowCoord.z = DepthRangeA(ConvertDepth3A(shadowCoord.z,lightDepthClip[i].x,lightDepthClip[i].y),lightDepthClip[i].x,lightDepthClip[i].y);\nvec4 shadowSample;\nfloat shadow = 1.0;\nif (shadowCoord.s > 0.000&&shadowCoord.s < 1.000 && shadowCoord.t > 0.000 && shadowCoord.t < 1.000) if (i == 0) { shadow = getShadowVal(lightShadowMap[0],shadowCoord,lightProjectionOut[i].w,lightDepthClip[i].z);}\n#if LIGHT_COUNT>1\nelse if (i == 1) { shadow = getShadowVal(lightShadowMap[1],shadowCoord,lightProjectionOut[i].w,lightDepthClip[i].z); }\n#endif\n#if LIGHT_COUNT>2\nelse if (i == 2) { shadow = getShadowVal(lightShadowMap[2],shadowCoord,lightProjectionOut[i].w,lightDepthClip[i].z); }\n#endif\n#if LIGHT_COUNT>3\nelse if (i == 3) { shadow = getShadowVal(lightShadowMap[3],shadowCoord,lightProjectionOut[i].w,lightDepthClip[i].z);  }\n#endif\n#if LIGHT_COUNT>4\nelse if (i == 4) { shadow = getShadowVal(lightShadowMap[4],shadowCoord,lightProjectionOut[i].w,lightDepthClip[i].z);  }\n#endif\n#if LIGHT_COUNT>5\nelse if (i == 5) { shadow = getShadowVal(lightShadowMap[5],shadowCoord,lightProjectionOut[i].w,lightDepthClip[i].z);  }\n#endif\n#if LIGHT_COUNT>6\nelse if (i == 6) { shadow = getShadowVal(lightShadowMap[6],shadowCoord,lightProjectionOut[i].w,lightDepthClip[i].z);  }\n#endif\n#if LIGHT_COUNT>7\nelse if (i == 7) { shadow = getShadowVal(lightShadowMap[7],shadowCoord,lightProjectionOut[i].w,lightDepthClip[i].z); }\n#endif\naccum += shadow * lightIntensity[i] * materialDiffuse * lightDiffuse[i] * NdotL;\n#else\naccum += lightIntensity[i] * materialDiffuse * lightDiffuse[i] * NdotL;\n#endif\n#if TEXTURE_SPECULAR\nspec2 = lightSpecular[i] * texture2D(textureSpecular, vec2(texCoord.s, texCoord.t)).rgb * pow(NdotHV,materialShininess);\n#else\nspec2 = lightSpecular[i] * materialSpecular * pow(NdotHV,materialShininess);\n#endif\n#if LIGHT_SHADOWED\nspec2 *= shadow;\n#endif\nspecTotal += spec2;\n#if LIGHT_SHADOWED\n#endif\n}\n}\ncolor.rgb *= accum;\ncolor.rgb += specTotal;\n#endif\n#if LIGHT_IS_SPOT\nvec3 specTotal = vec3(0.0,0.0,0.0);\nvec3 spec2 = vec3(0.0,0.0,0.0);\nvec3 halfVector;\nfloat spotEffect;\nfloat spotDot;\nfloat power;\nfor (int i = 0; i < LIGHT_COUNT; i++) {\nvec3 l = lightPosition[i]-vertexPositionOut.xyz;\nfloat dist = length(l);\nfloat att = clamp(((lightDistance[i]-dist)/lightDistance[i]), 0.0, 1.0)*lightIntensity[i];\natt = clamp(att,0.0,1.0);\nspotDot = dot(normalize(-l), normalize(lightDirection[i]));\nif ( spotDot < cos((lightCutOffAngle[i]/2.0)*(3.14159/180.0)) ) {\nspotEffect = 0.0;\n}\nelse {\nspotEffect = pow(spotDot, 1.0);\n}\n#if !LIGHT_IS_PROJECTOR\natt *= spotEffect;\n#endif\nvec3 v = normalize(-vertexPositionOut.xyz);\nvec3 h = normalize(l + v);\nfloat NdotL = max(0.0, dot(n, normalize(l)));\nfloat NdotH = max(0.0, dot(n, h));\nif (NdotL > 0.0) {\npower = pow(NdotH, materialShininess);\n}\nelse {\npower = 0.0;\n}\n#if LIGHT_SHADOWED\nvec4 shadowCoord = lightProjectionOut[i] / lightProjectionOut[i].w;\nshadowCoord.z = DepthRangeA(ConvertDepth3A(shadowCoord.z,lightDepthClip[i].x,lightDepthClip[i].y),lightDepthClip[i].x,lightDepthClip[i].y);\nvec4 shadowSample;\nfloat shadow = 1.0;\nif (shadowCoord.s >= 0.000&&shadowCoord.s <= 1.000 && shadowCoord.t >= 0.000 && shadowCoord.t <= 1.000) if (i == 0) { shadow = getShadowVal(lightShadowMap[0],shadowCoord,lightProjectionOut[i].w,lightDepthClip[i].z);}\n#if LIGHT_COUNT>1\nelse if (i == 1) { shadow = getShadowVal(lightShadowMap[1],shadowCoord,lightProjectionOut[i].w,lightDepthClip[i].z); }\n#endif\n#if LIGHT_COUNT>2\nelse if (i == 2) { shadow = getShadowVal(lightShadowMap[2],shadowCoord,lightProjectionOut[i].w,lightDepthClip[i].z); }\n#endif\n#if LIGHT_COUNT>3\nelse if (i == 3) { shadow = getShadowVal(lightShadowMap[3],shadowCoord,lightProjectionOut[i].w,lightDepthClip[i].z);  }\n#endif\n#if LIGHT_COUNT>4\nelse if (i == 4) { shadow = getShadowVal(lightShadowMap[4],shadowCoord,lightProjectionOut[i].w,lightDepthClip[i].z);  }\n#endif\n#if LIGHT_COUNT>5\nelse if (i == 5) { shadow = getShadowVal(lightShadowMap[5],shadowCoord,lightProjectionOut[i].w,lightDepthClip[i].z);  }\n#endif\n#if LIGHT_COUNT>6\nelse if (i == 6) { shadow = getShadowVal(lightShadowMap[6],shadowCoord,lightProjectionOut[i].w,lightDepthClip[i].z);  }\n#endif\n#if LIGHT_COUNT>7\nelse if (i == 7) { shadow = getShadowVal(lightShadowMap[7],shadowCoord,lightProjectionOut[i].w,lightDepthClip[i].z); }\n#endif\natt = att * shadow;\n#endif\n#if LIGHT_IS_PROJECTOR && LIGHT_SHADOWED\nif (shadowCoord.s >= 0.0&&shadowCoord.s <= 1.0 && shadowCoord.t >= 0.0 && shadowCoord.t <= 1.0 && spotDot > cos((90.0)*(3.14159/180.0))) {\nvec3 projTex = texture2D(lightProjectionMap[i],shadowCoord.st).rgb;\naccum += att * projTex * lightIntensity[i] * materialDiffuse * lightDiffuse[i] * NdotL;\n}\n#else\naccum += att * lightDiffuse[i] * materialDiffuse * NdotL;\n#endif\n#if TEXTURE_SPECULAR\nspec2 = lightSpecular[i] * texture2D(textureSpecular, vec2(texCoord.s, texCoord.t)).rgb * power;\n#else\nspec2 = lightSpecular[i] * materialSpecular * power;\n#endif\n#if LIGHT_SHADOWED\nspec2 *= shadow;\n#endif\nspecTotal += spec2*spotEffect;\n}\ncolor.rgb *= accum;\ncolor.rgb += specTotal;\n#if LIGHT_SHADOWED\n#endif\n#endif\n#else\n#if LIGHT_IS_POINT||LIGHT_IS_DIRECTIONAL||LIGHT_IS_SPOT||LIGHT_IS_AREA\ncolor.rgb *= lightColorOut;\ncolor.rgb += lightSpecularOut;\n#endif\n#endif \n#if TEXTURE_AMBIENT\n#if LIGHT_IS_POINT||LIGHT_IS_DIRECTIONAL||LIGHT_IS_SPOT||LIGHT_IS_AREA\ncolor.rgb += texture2D(textureAmbient, texCoord).rgb*(vec3(1.0,1.0,1.0)+materialColor*materialAmbient);\n#else\ncolor.rgb = color.rgb*texture2D(textureAmbient, texCoord).rgb;\n#endif\n#else\n#if TEXTURE_COLOR\ncolor.rgb += materialAmbient*texture2D(textureColor, texCoord).rgb;\n#else\ncolor.rgb += materialColor*materialAmbient;\n#endif\n#endif\n#endif\n#if FOG_ENABLED\nreturn apply_fog(color);\n#else\nreturn color;\n#endif\n}\nvec4 cubicvr_environment(vec4 color_in, vec3 n, vec2 texCoord) {\nvec4 color = color_in;\n#if !LIGHT_DEPTH_PASS\n#if TEXTURE_REFLECT\nfloat environmentAmount = texture2D( textureReflect, texCoord).r;\n#endif\n#if TEXTURE_ENVSPHERE\n#if TEXTURE_NORMAL\nvec3 r = reflect( envTexCoordOut, n );\nfloat m = 2.0 * sqrt( r.x*r.x + r.y*r.y + (r.z+1.0)*(r.z+1.0) );\nvec3 coord;\ncoord.s = r.x/m + 0.5;\ncoord.t = r.y/m + 0.5;\n#if TEXTURE_REFLECT\ncolor.rgb += materialColor*texture2D( textureEnvSphere, coord.st).rgb * environmentAmount;\n#else\ncolor.rgb += materialColor*texture2D( textureEnvSphere, coord.st).rgb * materialEnvironment;\n#endif\n#else\n#if TEXTURE_REFLECT\ncolor.rgb += materialColor*texture2D( textureEnvSphere, envTexCoordOut).rgb * environmentAmount;\n#else\ncolor.rgb += materialColor*texture2D( textureEnvSphere, envTexCoordOut).rgb * materialEnvironment;\n#endif\n#endif\n#endif \n#endif \n#if FX_DEPTH_ALPHA\n#if !MATERIAL_ALPHA\nfloat linear_depth = DepthRange( ConvertDepth3(gl_FragCoord.z) );\ncolor.a = linear_depth;\n#endif\n#endif\nreturn color;\n}\n#if LIGHT_DEPTH_PASS\nvec4 cubicvr_depthPack(vec2 texCoord) {\n#if TEXTURE_ALPHA\nfloat alphaVal = texture2D(textureAlpha, texCoord).r;\nif (alphaVal < 0.9) discard;\n#endif\nreturn packFloatToVec4i(DepthRange( ConvertDepth3(gl_FragCoord.z)));\n}\n#endif\n#define customShader_splice 1\nvoid main(void)\n{\nvec2 texCoord = cubicvr_texCoord();\n#if !LIGHT_DEPTH_PASS\nvec4 color = cubicvr_color(texCoord);\nvec3 normal = cubicvr_normal(texCoord);\ncolor = cubicvr_environment(color,normal,texCoord);\ncolor = cubicvr_lighting(color,normal,texCoord);\ngl_FragColor = clamp(color,0.0,1.0);\n#else \ngl_FragColor = cubicvr_depthPack(texCoord);\n#endif\n}\n";
