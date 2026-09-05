/**
 * Built-in polyfills for older iPhones, injected as a blocking inline <script>
 * in <head> (see layout.tsx) so it runs before any app chunk.
 *
 * WHY THIS EXISTS
 * The `browserslist` in package.json makes the compiler downlevel modern SYNTAX
 * (`?.`, `??`) so the bundle can be parsed at all on iOS 12/13 — before that, a
 * single unparseable chunk meant zero JavaScript ran, which showed up on a real
 * phone as a stuck splash, a countdown frozen on its placeholder dots, an empty
 * דבוקה list and a dead submit button, all at once.
 *
 * But browserslist only rewrites syntax. A METHOD that doesn't exist on an old
 * engine still throws at runtime, and Next/Turbopack emits no polyfill bundle to
 * cover it. These are the ones our own bundle actually calls (verified by
 * grepping the built chunks), with the iOS version each one landed in:
 *
 *   Array/String.prototype.at   iOS 15.4
 *   Object.hasOwn               iOS 15.4
 *   String.prototype.replaceAll iOS 13.4
 *   Object.fromEntries          iOS 12.2
 *   Array.prototype.flatMap     iOS 12.0  (present on 12, kept for 11 headroom)
 *   globalThis                  iOS 12.2
 *
 * DELIBERATELY NOT POLYFILLED:
 * - `structuredClone` (iOS 15.4). The honest shim is a real deep clone with
 *   cycle handling and typed-array/Map/Set support; a JSON round-trip looks like
 *   one and silently corrupts Dates, Maps and undefined. A missing function
 *   throwing where it is used beats every caller getting mangled data.
 * - `String.prototype.matchAll` (iOS 13). A correct shim has to reimplement
 *   lastIndex/sticky-flag semantics, and both call sites are in dependencies,
 *   not our code. If an iOS 12 device ever turns up in real use, revisit.
 *
 * Written as ES5 on purpose — it has to parse on the engine it is fixing, so no
 * arrow functions, no `let`/`const`, no template literals in here.
 */
export const LEGACY_POLYFILLS = `(function(){
try{
if(typeof globalThis!=='object'){Object.defineProperty(Object.prototype,'__mc_global',{get:function(){return this},configurable:true});__mc_global.globalThis=__mc_global;delete Object.prototype.__mc_global}
function at(n){var l=this.length;n=Math.trunc(n)||0;if(n<0)n+=l;if(n<0||n>=l)return undefined;return this[n]}
if(!Array.prototype.at){Object.defineProperty(Array.prototype,'at',{value:at,writable:true,configurable:true})}
if(!String.prototype.at){Object.defineProperty(String.prototype,'at',{value:at,writable:true,configurable:true})}
if(!Object.hasOwn){Object.defineProperty(Object,'hasOwn',{value:function(o,k){return Object.prototype.hasOwnProperty.call(o,k)},writable:true,configurable:true})}
if(!Object.fromEntries){Object.defineProperty(Object,'fromEntries',{value:function(it){var o={};Array.prototype.forEach.call(Array.from?Array.from(it):it,function(p){o[p[0]]=p[1]});return o},writable:true,configurable:true})}
if(!Array.prototype.flatMap){Object.defineProperty(Array.prototype,'flatMap',{value:function(f,t){var out=[];this.forEach(function(v,i,a){var r=f.call(t,v,i,a);if(Array.isArray(r)){out.push.apply(out,r)}else{out.push(r)}});return out},writable:true,configurable:true})}
if(!String.prototype.replaceAll){Object.defineProperty(String.prototype,'replaceAll',{value:function(s,r){
  if(s instanceof RegExp){if(s.flags.indexOf('g')<0){throw new TypeError('replaceAll must be called with a global RegExp')}return this.replace(s,r)}
  var str=String(this),pat=String(s),fn=typeof r==='function';
  /* One index loop covers every case the spec distinguishes:
     - a function replacer, which split().join() would stringify;
     - a string replacer containing '$' ($& etc.), which split().join() would
       take literally where real replaceAll expands it;
     - the empty pattern, which the spec inserts between every character.
     Everything else takes the fast split/join path. */
  if(!fn&&pat!==''&&String(r).indexOf('$')<0){return str.split(pat).join(String(r))}
  var rep=function(idx){return fn?String(r(pat,idx,str)):pat.replace(pat,String(r))};
  if(pat===''){var acc=rep(0),k;for(k=0;k<str.length;k++){acc+=str.charAt(k)+rep(k+1)}return acc}
  var out='',i=0,j;
  while((j=str.indexOf(pat,i))>=0){out+=str.slice(i,j)+rep(j);i=j+pat.length}
  return out+str.slice(i)},writable:true,configurable:true})}
}catch(e){}
})();`;
