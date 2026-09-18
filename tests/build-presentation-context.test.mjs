import assert from 'node:assert/strict'; import test from 'node:test';
import { buildPresentationContext, normalizeOffense, normalizeWeapon } from '../js/build-presentation-context.js';
test('offense exact values and shared families are preserved',()=>{
 for(const [raw,family] of Object.entries({Poison:'chaos',Freeze:'cold',Shock:'lightning',Electrocute:'lightning',Companions:'minions',Totems:'minions','Physical Damage':'physical',Ignite:'fire'})) assert.deepEqual(normalizeOffense(raw),{raw,family});
});
test('weapon normalization is stable and unknown concepts fail safely',()=>{
 assert.deepEqual(normalizeWeapon(' Two-handed Mace '),{raw:'Two-handed Mace',key:'Mace'});
 assert.deepEqual(normalizeOffense('Arcane'),{raw:'Arcane',family:''});
 assert.deepEqual(buildPresentationContext(),{className:'',ascendancy:'',weapon:{raw:'',key:''},offense:{raw:'',family:''}});
});
