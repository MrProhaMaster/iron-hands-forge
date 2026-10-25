// Dependency-free test bridge; stdin/out JSON only.
import {normalizeRecipe, encodeRecipe, decodeRecipe} from '../shared/recipe-codec.mjs';
let input='';for await(const chunk of process.stdin)input+=chunk;
try {
  const {op,value}=JSON.parse(input);
  const result=op==='encode'?await encodeRecipe(value):op==='decode'?await decodeRecipe(value):op==='normalize'?normalizeRecipe(value):(()=>{throw new Error('Unknown operation');})();
  process.stdout.write(JSON.stringify({ok:true,result}));
}catch(error){process.stdout.write(JSON.stringify({ok:false,code:error.code||'ERROR',error:error.message}));}
