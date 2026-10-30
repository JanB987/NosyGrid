export type Direction = 'asc' | 'desc';
export type Rank = number | undefined;
export interface Row { path: string; rank: Rank }
export interface Change { path: string; before: Rank; after: Rank }

export function propertyName(value: unknown): string {
  const name = String(value ?? 'priority').trim().replace(/^note\./, '');
  if (!name || /^(file|formula)\./.test(name) || ['__proto__','constructor','prototype'].includes(name)) {
    throw new Error('Choose a writable note property, such as priority.');
  }
  return name;
}

export function numericRank(value: unknown): Rank {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('The ordering property must contain numbers or be empty.');
  }
  return value;
}

export function sortRows<T extends Row>(rows: T[], direction: Direction): T[] {
  return [...rows].sort((a,b) => {
    if (a.rank === undefined) return b.rank === undefined ? a.path.localeCompare(b.path) : 1;
    if (b.rank === undefined) return -1;
    return (direction === 'asc' ? a.rank-b.rank : b.rank-a.rank) || a.path.localeCompare(b.path);
  });
}

export function rankPrecision(value:unknown):number {
  const parsed=typeof value==='string'&&value.trim()?Number(value):value;
  return typeof parsed==='number'&&Number.isInteger(parsed)&&parsed>=0&&parsed<=6?parsed:2;
}

// Convert decimal numbers to exact scaled bounds, including exponent notation.
// Existing anchors may have more decimals than the view currently permits.
function scaledBounds(value:number,precision:number):{floor:bigint;ceil:bigint} {
  const [mantissa,exponent='0']=Math.abs(value).toString().split('e');
  const [whole,fraction='']=mantissa.split('.');
  const power=precision+Number(exponent)-fraction.length;
  const digits=BigInt(whole+fraction)*(value<0?-1n:1n);
  if(power>=0){const units=digits*10n**BigInt(power);return {floor:units,ceil:units};}
  const divisor=10n**BigInt(-power),quotient=digits/divisor,remainder=digits%divisor;
  return {floor:quotient+(remainder<0?-1n:0n),ceil:quotient+(remainder>0?1n:0n)};
}
function unitRank(units:bigint,precision:number):number|undefined {
  const negative=units<0n,absolute=(negative?-units:units).toString().padStart(precision+1,'0');
  const value=Number(`${negative?'-':''}${precision?absolute.slice(0,-precision)+'.'+absolute.slice(-precision):absolute}`);
  if(!Number.isFinite(value))return undefined;
  const exact=scaledBounds(value,precision);
  return exact.floor===units&&exact.ceil===units?value:undefined;
}

// The moved rows form one block. Keep its neighbours as anchors; enlarge only
// the smallest surrounding range when the selected decimal grid has no room.
export function planOrder(next:Row[],moved:string[],direction:Direction,decimals=2):Change[] {
  if(new Set(next.map(row=>row.path)).size!==next.length)throw new Error('Duplicate notes cannot be reordered.');
  const moving=new Set(moved),indices=next.flatMap((row,i)=>moving.has(row.path)?[i]:[]);
  if(indices.length!==moving.size)throw new Error('The rows changed. Please try again.');
  if(!indices.length)return [];
  const first=indices[0],last=indices[indices.length-1];
  if(last-first+1!==indices.length)throw new Error('Moved rows must form a contiguous block.');
  const precision=rankPrecision(decimals),scale=10n**BigInt(precision),sign=direction==='asc'?1:-1;
  for(let size=indices.length;size<=next.length;size++) {
    let best:Change[]|undefined;
    for(let start=Math.max(0,last-size+1);start<=Math.min(first,next.length-size);start++) {
      const end=start+size,left=start?next[start-1].rank:undefined,right=end<next.length?next[end].rank:undefined;
      // Empty ranks always sort last, so a finite rank cannot follow one.
      if(start&&left===undefined)continue;
      const low=left===undefined?undefined:scaledBounds(sign*left,precision).floor;
      const high=right===undefined?undefined:scaledBounds(sign*right,precision).ceil;
      const count=BigInt(size);
      if(low!==undefined&&high!==undefined&&high-low-1n<count)continue;
      const changes:Change[]=[];let previous=left===undefined?undefined:sign*left,valid=true;
      for(let offset=0;offset<size;offset++) {
        const i=BigInt(offset+1);
        const units=low!==undefined&&high!==undefined?low+(high-low)*i/(count+1n)
          :low!==undefined?low+scale*i:high!==undefined?high-scale*(count-i+1n):scale*i;
        const normalized=unitRank(units,precision);
        if(normalized===undefined||(previous!==undefined&&normalized<=previous)||(right!==undefined&&normalized>=sign*right)){valid=false;break;}
        previous=normalized;const row=next[start+offset],rank=sign*normalized;
        if(row.rank!==rank)changes.push({path:row.path,before:row.rank,after:rank});
      }
      if(valid&&(!best||changes.length<best.length))best=changes;
    }
    if(best)return best;
  }
  throw new Error('Ranks exceed the safe numeric range at this precision. Reduce decimal places or use smaller ordering values.');
}

export function planMove(rows: Row[], source: string, target: string, below: boolean, direction: Direction,decimals=2): Change[] {
  if (source === target) return [];
  if (new Set(rows.map(r=>r.path)).size !== rows.length) throw new Error('Duplicate notes cannot be reordered.');
  const moving = rows.find(row=>row.path===source);
  if (!moving || !rows.some(row=>row.path===target)) throw new Error('The rows changed. Please try again.');
  const next = rows.filter(row=>row.path!==source);
  next.splice(next.findIndex(row=>row.path===target)+(below ? 1 : 0),0,moving);
  if (next.every((row,i)=>row.path===rows[i].path)) return [];
  return planOrder(next,[source],direction,decimals);
}

// Validate only changed rows and the anchors around their old and new positions.
export function rankGuards(rows:Row[],changes:Change[],direction:Direction):Row[] {
  const changed=new Map(changes.map(change=>[change.path,change])),paths=new Set(changed.keys());
  const after=sortRows(rows.map(row=>({...row,rank:changed.has(row.path)?changed.get(row.path)!.after:row.rank})),direction);
  for(const order of [rows,after])for(let i=0;i<order.length;i++)if(changed.has(order[i].path)) {
    if(i)paths.add(order[i-1].path);if(i+1<order.length)paths.add(order[i+1].path);
  }
  return rows.filter(row=>paths.has(row.path));
}

// The adapter checks and edits frontmatter inside Obsidian's processFrontMatter callback.
export type WriteRank = (change: Change) => Promise<void>;
export async function applyChanges(changes: Change[], write: WriteRank): Promise<void> {
  const done: Change[] = [];
  try {
    for (const change of changes) { await write(change); done.push(change); }
  } catch (error) {
    const failures: string[] = [];
    for (const change of done.reverse()) {
      try { await write({path:change.path,before:change.after,after:change.before}); }
      catch { failures.push(change.path); }
    }
    if (failures.length) throw new Error(`Reorder failed; rollback could not restore: ${failures.join(', ')}. Check these notes. Original error: ${String(error)}`);
    throw error;
  }
}
