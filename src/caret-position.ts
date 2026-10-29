/** Use the standard caret API; retain a feature-detected fallback for older Electron. */
export function caretRangeAtPoint(doc:Document,x:number,y:number):Range|null {
  const position=doc.caretPositionFromPoint?.(x,y);
  if(position){const range=doc.createRange();range.setStart(position.offsetNode,position.offset);range.collapse(true);return range;}
  const legacy=(doc as {caretRangeFromPoint?:(x:number,y:number)=>Range|null})['caretRangeFromPoint'];
  return legacy?.call(doc,x,y)??null;
}
