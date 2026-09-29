
/* 修復重複合併造成的損傷：
   ① const ROLE_OUTFIT_HINTS 被插入兩次（同一 scope 重複 const → SyntaxError）
   ② PLACE_TEX_BY_NAME 的鍵是 RegExp，去重失效 → 條目重複
   修法：保留第一個宣告、其餘刪掉；陣列依 String(regex) 去重。 */
const fs=require('fs'), vm=require('vm');
const CORE='/home/arthur/.hermes/cache/scratch/novel-import-core.js';
let src=fs.readFileSync(CORE,'utf8');
const TAG=Object.prototype.toString;
const log=[];

function bounds(name, kind){
  const needle = kind==='obj' ? 'const '+name+' = {' : 'const '+name+' = [';
  const s=src.indexOf(needle); if(s<0) return null;
  if(kind==='obj'){ let d=0,i=s+needle.length-1; for(;i<src.length;i++){ if(src[i]==='{')d++; else if(src[i]==='}'){d--; if(!d)break;} } return [s, src[i+1]===';'?i+2:i+1]; }
  const e=src.indexOf('];', s); return e<0?null:[s,e+2];
}
function js(v){
  if(TAG.call(v)==='[object RegExp]') return v.toString();
  if(typeof v==='string') return "'"+v.replace(/\\/g,'\\\\').replace(/'/g,"\\'")+"'";
  if(typeof v==='number'||typeof v==='boolean') return String(v);
  if(Array.isArray(v)) return '['+v.map(js).join(', ')+']';
  if(TAG.call(v)==='[object Set]') return 'new Set(['+Array.from(v).map(js).join(', ')+'])';
  if(v&&typeof v==='object') return '{\n'+Object.keys(v).map(function(k){return '  '+js(k)+': '+js(v[k]);}).join(',\n')+'\n}';
  return 'null';
}

/* ① ROLE_OUTFIT_HINTS 去重複宣告 */
for(;;){
  const first=src.indexOf('const ROLE_OUTFIT_HINTS = [');
  const second=src.indexOf('const ROLE_OUTFIT_HINTS = [', first+10);
  if(second<0) break;
  const e=src.indexOf('];', second); if(e<0) break;
  src=src.slice(0,second)+src.slice(e+3);
  log.push('  刪除一組重複的 ROLE_OUTFIT_HINTS 宣告');
}

/* ② PLACE_TEX_BY_NAME 依 regex 來源去重 */
const r=bounds('PLACE_TEX_BY_NAME','arr');
if(r){
  const old=vm.runInNewContext('('+src.slice(r[0],r[1]).replace(/^const \w+ = /,'').replace(/;$/,'')+')');
  const seen=new Set(), out=[];
  old.forEach(function(x){ const k=String(x[0]); if(!seen.has(k)){ seen.add(k); out.push(x); } });
  src=src.slice(0,r[0])+'const PLACE_TEX_BY_NAME = [\n'+out.map(function(x){return '  '+js(x);}).join(',\n')+'\n];'+src.slice(r[1]);
  log.push('  PLACE_TEX_BY_NAME '+old.length+' → '+out.length+' 條（去重）');
}
fs.writeFileSync(CORE, src);
console.log(log.join('\n') || '  沒有需要修復的地方');
console.log('核心大小 '+src.length+' 字元');
