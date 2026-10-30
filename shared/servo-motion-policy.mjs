/** Shared native-helper exclusion for the already applied startup servo pose.
 * Body gait time, contacts and channels are preserved. Generic servo/tube
 * channels must not overwrite variant-specific target helper bind lengths.
 */
export function filterServoMotionChannels(channels,servoPoseApplied=false){
 if(!Array.isArray(channels))throw new TypeError('Motion channels must be an array');
 return servoPoseApplied?channels.filter(channel=>!/^(?:hand_|gun_|tube_|techtube_)/i.test(channel.name||'')):channels;
}
