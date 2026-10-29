export const GROUP_COLORS_KEY='manualGroupColors';
export function readGroupColors(raw:unknown):Record<string,string> {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
  return Object.fromEntries(Object.entries(raw).flatMap(([key,value])=>{
    if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))return [];
    return [[key,value.toLowerCase()]];
  }));
}
export function applyGroupColors(root:HTMLElement,colors:Record<string,string>) {
  for(const section of root.querySelectorAll<HTMLElement>('[data-group-color-key]')) {
    const color=colors[section.dataset.groupColorKey!];section.classList.toggle('is-colored-group',!!color);
    if(color) {
      const rgb=[1,3,5].map(index=>parseInt(color.slice(index,index+2),16)).join(',');
      section.style.setProperty('--manual-order-group-color',color);
      section.style.setProperty('--manual-order-group-tint',`rgba(${rgb},0.10)`);
      section.style.setProperty('--manual-order-group-header-tint',`rgba(${rgb},0.20)`);
      section.style.setProperty('--manual-order-group-selection',`rgba(${rgb},0.36)`);
    } else for(const name of ['color','tint','header-tint','selection'])section.style.removeProperty(`--manual-order-group-${name}`);
  }
}
