import test from 'node:test';
import assert from 'node:assert/strict';
import {heraldryOptions,applyHeraldryChoice,IRON_HANDS_CHAPTERS,IRON_HANDS_COMPANIES} from '../shared/heraldry-options.mjs';
const decals=[...IRON_HANDS_CHAPTERS.map(d=>({...d,section:'LEFT_PAULDRON',material:'native_'+d.id,colorsNumber:3})),...IRON_HANDS_COMPANIES.map(d=>({...d,section:'RIGHT_PAULDRON',material:'native_'+d.id,colorsNumber:3})),{id:'Right_Pau_Decal_Iron_Hands',section:'RIGHT_PAULDRON',material:'native_chapter',colorsNumber:3},{id:'Right_Pau_Blank',section:'RIGHT_PAULDRON',material:'default',colorsNumber:0}];
test('heraldry exposes exactly ten actual Iron Hands clans on the right shoulder and five chapters on the left',()=>{
 const before=structuredClone(decals),groups=heraldryOptions(decals);
 assert.equal(groups.company.slot,'RIGHT_PAULDRON');assert.equal(groups.company.options.length,10);assert.equal(groups.company.complete,true);
 assert.equal(groups.chapter.slot,'LEFT_PAULDRON');assert.equal(groups.chapter.options.length,5);assert.equal(groups.chapter.complete,true);
 assert(!groups.company.options.some(d=>d.id==='Right_Pau_Decal_Iron_Hands'));assert.deepEqual(decals,before);
 assert.equal(groups.company.options[0].label,'Clan Avernii');assert.equal(groups.company.options[9].label,'Clan Dorrvok');
});
test('an incomplete or wrong-side source never invents a selectable company',()=>{
 const wrong=decals.filter(d=>d.id!==IRON_HANDS_COMPANIES[0].id).map(d=>d.id===IRON_HANDS_COMPANIES[1].id?{...d,section:'LEFT_PAULDRON'}:d),group=heraldryOptions(wrong).company;
 assert.equal(group.complete,false);assert.equal(group.options.length,8);assert.deepEqual(group.missingIds,[IRON_HANDS_COMPANIES[0].id,IRON_HANDS_COMPANIES[1].id]);
 assert.equal(heraldryOptions().company.options.length,0);assert.throws(()=>heraldryOptions([...decals,decals[0]]),/Duplicate/);
});
test('changing Chapter and Company preserves imported selections, local paint and greave emblems',()=>{
 const appearance={colors:{trim:'#102030'},parts:{CHEST:{armor:'#203040'}},decals:{LEFT_GREAVE:{id:'legacy_greave',color:'#123456'},LEFT_PAULDRON:{id:'Left_Pau_Decal_Iron_Hands',color:'#AABBCC'},RIGHT_PAULDRON:{id:'Right_Pau_Decal_Iron_Hands',color:'#445566'}}},before=structuredClone(appearance);
 const company=applyHeraldryChoice(appearance,'company',IRON_HANDS_COMPANIES[3].id,{color:'#FFFFFF'},decals);
 assert.deepEqual(appearance,before);assert.deepEqual(company.decals.LEFT_PAULDRON,before.decals.LEFT_PAULDRON);assert.deepEqual(company.decals.LEFT_GREAVE,before.decals.LEFT_GREAVE);assert.deepEqual(company.parts,before.parts);assert.equal(company.decals.RIGHT_PAULDRON.id,IRON_HANDS_COMPANIES[3].id);
 const chapter=applyHeraldryChoice(company,'chapter',IRON_HANDS_CHAPTERS[2].id,{color:'#FFFFFF',secondaryColor:'#000000'},decals);
 assert.equal(chapter.decals.LEFT_PAULDRON.id,IRON_HANDS_CHAPTERS[2].id);assert.deepEqual(chapter.decals.RIGHT_PAULDRON,company.decals.RIGHT_PAULDRON);
 const cleared=applyHeraldryChoice(chapter,'company','',{},decals);assert.equal(cleared.decals.RIGHT_PAULDRON,undefined);assert.deepEqual(cleared.decals.LEFT_PAULDRON,chapter.decals.LEFT_PAULDRON);
});
test('cross-group selections and malformed paint cannot move a chapter to the right or a company to the left',()=>{
 assert.throws(()=>applyHeraldryChoice({},'chapter',IRON_HANDS_COMPANIES[0].id,{},decals),/not available/);
 assert.throws(()=>applyHeraldryChoice({},'company',IRON_HANDS_CHAPTERS[0].id,{},decals),/not available/);
 assert.throws(()=>applyHeraldryChoice({},'company',IRON_HANDS_COMPANIES[0].id,{color:'invalid'},decals),/Invalid/);
});
