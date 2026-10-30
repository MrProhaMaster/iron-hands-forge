/** Apply the source actor scale once, above both the rig and all visual nodes. */
export function applyBodyFrameScale(doc,frame){
 const scale=frame?.sourceActorScale??1;
 if(typeof scale!=='number'||!Number.isFinite(scale)||scale<=0||scale>10)throw Error('Invalid source body frame scale');
 if(scale===1)return;
 if(doc.nodes.some(n=>n.extras?.forgeBodyFrameScale))throw Error('Body frame scale was already applied');
 for(const scene of doc.scenes){
  const root=doc.nodes.length;
  doc.nodes.push({name:'Forge body frame / '+frame.profileId,scale:[scale,scale,scale],children:[...scene.nodes],extras:{forgeBodyFrameScale:true,sourceActorScale:scale,profileId:frame.profileId}});
  scene.nodes=[root];
 }
}
