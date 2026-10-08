const fs=require('fs'),path=require('path');
const 根=process.argv[2];
let 文件=[];
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(/^(\.godot|_backup)$/.test(e.name))continue;const f=path.join(d,e.name);if(e.isDirectory())walk(f);else if(/\.gd$/.test(e.name))文件.push(f);}})(根);
let 坏=0;
for(const f of 文件){
  const L=fs.readFileSync(f,'utf8').split('\n');
  for(let i=0;i<L.length;i++){
    if(!/^\s*while true:/.test(L[i]))continue;
    const 缩进=L[i].match(/^\s*/)[0].length;
    let 体=[],j=i+1;
    while(j<L.length){const t=L[j];if(t.trim()===''){体.push(t);j++;continue;}const c=(t.match(/^\s*/)||[''])[0].length;if(c<=缩进)break;体.push(t);j++;}
    const 有=体.some(x=>/await /.test(x));
    if(!有)坏++;
    console.log((有?'[OK ]':'[!! ]')+' '+f.replace(根+path.sep,'')+':'+(i+1)+'  体'+体.length+'行  await='+(有?'有':'无'));
    if(!有)体.slice(0,10).forEach(x=>console.log('        '+x));
  }
}
console.log('没有让出点的 while true: '+坏+' 个');