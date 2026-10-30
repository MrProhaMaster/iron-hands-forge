/** Shared locomotion preview binding; source animation files stay unchanged. */
export function resolveMotionBinding(config,classId,gait,stance){
 if(config?.schema!=='iron-hands-forge-motion-bindings-v1'||config.version!==1)throw Error('Unsupported motion binding configuration');
 if(!['walk','run'].includes(gait)||!['unarmed','armed'].includes(stance))throw Error('Unknown motion');
 if(['__proto__','prototype','constructor'].includes(classId))throw Error('Movement is not verified for this class');
 const native=Object.hasOwn(config.classes||{},classId),alias=!native&&Object.hasOwn(config.aliases||{},classId)?config.aliases[classId]:null;
 const sourceId=alias?.baseClassId||classId,group=Object.hasOwn(config.classes||{},sourceId)?config.classes[sourceId]:null;
 if(!group||group.status!=='validated'||alias&&(alias.status!=='source-backed-profile'||alias.asset!==group.asset||!alias.profileId||alias.profileId!==classId))throw Error('Movement is not verified for this class');
 const id=group.clipIds?.[gait]?.[stance],clip=config.clips?.[id];
 if(!clip||clip.gait!==gait||clip.stance!==stance)throw Error('Motion binding does not match request');
 if(typeof clip.output!=='string'||!clip.output||clip.output.includes('\0')||clip.output.startsWith('/')||clip.output.includes('..')||clip.output.includes('\\')||clip.output.includes(':'))throw Error('Unsafe motion path');
 return{classId,asset:group.asset,clipId:id,...clip,bindingPolicy:alias?'source-backed-astartes-profile-preview':group.bindingPolicy||config.bindingPolicy,...(alias?{bodyFrameAlias:{profileId:alias.profileId,baseClassId:sourceId,sourceModel:alias.sourceModel,preserveSourceTiming:true}}:{}),inheritedOnlyChannels:[...(config.inheritedOnlyChannels||[])],canonicalGameFacialController:false};
}
export function motionPreviewChannels(data,binding){
 if(!Array.isArray(data?.channels))throw Error('Invalid motion channels');
 const inherited=new Set(binding?.inheritedOnlyChannels||[]);
 return data.channels.filter(c=>!(inherited.has(c.name)&&c.positionMode==='fixed'&&c.rotationMode==='fixed'));
}
export function classHasPreviewMotion(config,classId){
 try{for(const gait of ['walk','run'])for(const stance of ['unarmed','armed'])resolveMotionBinding(config,classId,gait,stance);return true}catch{return false}
}
