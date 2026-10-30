/** Explicit Body Frame selection loads a fresh outfit; recipe restoration does not call this. */
export function bodyFrameTemplate(frame,previous){
 const selection=structuredClone(frame.initialSelection||{});
 for(const slot of frame.slots||[]){
  const option=slot.options.find(o=>o.id===selection[slot.id]);
  if(!option||option.forgeUnavailable)throw Error('The starting outfit is unavailable for '+frame.id+' / '+slot.id);
 }
 if(frame.forgeBodyFrame)return{selection,paint:{...previous.paint,...frame.initialPaint},appearance:structuredClone(frame.initialAppearance||{})};
 return{selection,paint:{...previous.paint},appearance:{...structuredClone(previous.appearance||{}),parts:{},decals:{}}};
}
