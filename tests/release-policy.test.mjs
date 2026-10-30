import test from 'node:test';
import assert from 'node:assert/strict';
import release from '../shared/release-policy.cjs';
test('the user-approved0.5 series can be built locally',()=>{
 for(const v of ['0.5.0','0.5.1','0.5.99'])assert.equal(release.assertIterationVersion(v),v);
 for(const v of ['0.4.6','0.6.0','1.0.0','0.5','0.5.0-beta',null])assert.throws(()=>release.assertIterationVersion(v),/user-approved version policy/);
});
test('only the explicitly approved stable version can be published',()=>{
 assert.equal(release.assertApprovedPublicationVersion('0.5.0'),'0.5.0');
 for(const v of ['0.5.1','0.5.2'])assert.throws(()=>release.assertApprovedPublicationVersion(v),/explicit user release command/);
});
