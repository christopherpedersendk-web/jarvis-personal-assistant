// Discord does not render Markdown tables. Keep values and links as labelled
// list entries; leave code fences, malformed tables and ordinary prose alone.
export function formatDiscordTables(value){
 const lines=String(value||'').split('\n'),out=[];let fence=null;
 const cells=line=>{
  const trimmed=line.trim();if(!trimmed.includes('|'))return null;
  const parts=trimmed.split(/(?<!\\)\|/u);
  if(trimmed.startsWith('|'))parts.shift();
  if(trimmed.endsWith('|')&&!trimmed.endsWith('\\|'))parts.pop();
  return parts.map(x=>x.trim());
 };
 for(let i=0;i<lines.length;i++){
  const marker=/^\s*(\x60{3,}|~{3,})/u.exec(lines[i]);
  if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;out.push(lines[i]);continue;}
  const head=!fence?cells(lines[i]):null,rule=head?cells(lines[i+1]||''):null;
  if(!head||head.length<2||head.length>12||head.some(x=>!x||x.length>100)||!rule||rule.length!==head.length||!rule.every(x=>/^:?-{3,}:?$/u.test(x))){out.push(lines[i]);continue;}
  const rows=[];let end=i+2;
  for(;end<lines.length;end++){const row=cells(lines[end]);if(!row||row.length!==head.length)break;rows.push(row);}
  if(!rows.length){out.push(lines[i]);continue;}
  for(const row of rows){out.push('- '+head[0]+': '+row[0]);for(let c=1;c<head.length;c++)out.push('  '+head[c]+': '+row[c]);out.push('');}
  i=end-1;
 }
 return out.join('\n');
}
