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

export function planMove(rows: Row[], source: string, target: string, below: boolean, direction: Direction): Change[] {
  if (source === target) return [];
  if (new Set(rows.map(r=>r.path)).size !== rows.length) throw new Error('Duplicate notes cannot be reordered.');
  const moving = rows.find(row=>row.path===source);
  if (!moving || !rows.some(row=>row.path===target)) throw new Error('The rows changed. Please try again.');
  const next = rows.filter(row=>row.path!==source);
  next.splice(next.findIndex(row=>row.path===target)+(below ? 1 : 0),0,moving);
  if (next.every((row,i)=>row.path===rows[i].path)) return [];
  return next.flatMap((row,i)=> {
    const rank = direction==='asc' ? i+1 : next.length-i;
    return row.rank===rank ? [] : [{path:row.path,before:row.rank,after:rank}];
  });
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
