/** A provenance marker does not imply that an option contains visible geometry. */
export function hasPartGeometry(option){
 return !!(option?.forgeBionic||option?.meshes?.length||option?.resolvedObjectIds?.length||option?.components?.some(component=>hasPartGeometry(component)));
}
