'use strict';
const policy=Object.freeze(require('./release-policy.json'));
function assertIterationVersion(version){
 if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version)||version.split('.').slice(0,2).join('.')!==policy.iterationSeries)
  throw Error('Forge builds must remain in '+policy.iterationSeries+'.x under the current user-approved version policy.');
 return version;
}
function assertApprovedPublicationVersion(version){
 assertIterationVersion(version);
 if(version!==policy.approvedStableVersion)throw Error('Publishing '+version+' requires an explicit user release command.');
 return version;
}
module.exports={assertIterationVersion,assertApprovedPublicationVersion,policy};
