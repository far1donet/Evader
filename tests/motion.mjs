import assert from 'node:assert/strict';
import * as T from 'three';
import {rotationStep,landingWindow,completedRotation,landingTime,airPhase,TAU} from '../lib/trick-motion.ts';
import {RiderRig} from '../lib/rider-rig.ts';
import {boardEdgeAt} from '../lib/snowboard-gear.ts';
import {PowderSpray} from '../lib/powder-spray.ts';
import {springStep,solveTwoBone,ClothedLimb} from '../lib/motion.ts';
function springAt(fps){const s={value:0,velocity:0};for(let i=0;i<fps;i++)springStep(s,1,2,1/fps);return s;}
const reference=springAt(60);for(const fps of [30,144,240]){const r=springAt(fps);assert(Math.abs(r.value-reference.value)<1e-10);assert(Math.abs(r.velocity-reference.velocity)<1e-10);}
const reversal={value:0,velocity:0};for(let i=0;i<60;i++){springStep(reversal,1,3,1/120);assert(reversal.value>=0&&reversal.value<=1);}for(let i=0;i<120;i++)springStep(reversal,-1,3,1/120);assert(Math.abs(reversal.value+1)<.000001);
const start=new T.Vector3(.2,1.4,0);for(const target of [new T.Vector3(.45,.95,-.1),new T.Vector3(.1,.3,-.2),new T.Vector3(.2,1.4,0)]){const solution=solveTwoBone(start,target,new T.Vector3(.7,1,-.4),.31,.29);assert(Math.abs(solution.joint.distanceTo(start)-.31)<1e-10);assert(Math.abs(solution.end.distanceTo(solution.joint)-.29)<1e-10);}
const limb=new ClothedLimb(.31,.29,.083,new T.MeshStandardMaterial(),'arm');const solution=limb.pose(start,new T.Vector3(.3,.9,-.14),new T.Vector3(.6,1,-.4));limb.mesh.updateMatrixWorld(true);limb.skeleton.update();assert(limb.tip.getWorldPosition(new T.Vector3()).distanceTo(solution.end)<1e-7);const weights=limb.mesh.geometry.attributes.skinWeight;for(let i=0;i<weights.count;i++)assert(Math.abs(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)-1)<1e-6);assert(limb.mesh.geometry.attributes.normal.getX(0)>.8);limb.mesh.geometry.dispose();limb.mesh.material.dispose();limb.dispose();
console.log('Frame-rate-independent springs, smooth reversal, fixed-length IK, skin weights and outward cloth normals passed.');

// CPU pose validation: canvas drawing is stubbed; geometry/IK are real Three.js objects.
const gradient=()=>({addColorStop(){}});
const context={createLinearGradient:gradient,createRadialGradient:gradient,fillRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){},fillText(){},save(){},restore(){},translate(){},rotate(){},scale(){}};
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>context})};
function disposeMesh(object) {
 if (!object.isMesh) return;
 object.geometry.dispose();
 const materials = Array.isArray(object.material) ? object.material : [object.material];
 materials.forEach(material => material.dispose());
}
const root=new T.Group(),jacket=new T.MeshStandardMaterial(),deck=new T.MeshStandardMaterial(),rig=new RiderRig(root,jacket,deck);
const snowboard=rig.board.children.find(part=>Array.isArray(part.material));
const sharedBase=snowboard.material[1], evaderBase=sharedBase.map;
rig.setKit('alpine');
assert.equal(snowboard.material[1],sharedBase,'Garage preview shares the board base material');
assert.notEqual(sharedBase.map,evaderBase,'Alpine kit should expose the reference base graphic');
rig.setKit('ochre');
assert.equal(sharedBase.map,evaderBase,'Switching kits should restore the original base texture');
function gripTip(hand) {
 return new T.Vector3(0,-.117,0).applyQuaternion(hand.quaternion).add(hand.position);
}
for(let i=0;i<120;i++)rig.pose({dt:1/60,time:i/60,turn:.2,speed:20,air:true,grab:true,landing:0,menu:false});
assert(gripTip(rig.hands[1]).distanceTo(boardEdgeAt(.31,-1))<.025,'Indy grab should reach the board without stretching the arm');
for(let i=0;i<120;i++)rig.pose({dt:1/60,time:2+i/60,turn:-.6,speed:25,air:false,grab:false,landing:0,menu:false});
root.updateMatrixWorld(true);root.traverse(o=>{for(const value of [...o.position.toArray(),...o.quaternion.toArray()])assert(Number.isFinite(value));});rig.dispose();root.traverse(disposeMesh);
console.log('Board-contact grab and post-landing rider transforms passed.');

function rotateAt(fps){let velocity=0,angle=0;for(let i=0;i<fps;i++){const r=rotationStep(velocity,1,1/fps);velocity=r.velocity;angle+=r.angle;}return{velocity,angle};}
const spinRef=rotateAt(60);for(const fps of [30,120,144,240]){const r=rotateAt(fps);assert(Math.abs(r.velocity-spinRef.velocity)<1e-10);assert(Math.abs(r.angle-spinRef.angle)<1e-10);}
const release=rotationStep(4,0,1/120);assert(release.velocity>0&&release.velocity<4);assert(release.angle>0);
assert(!landingWindow(Math.PI*.5,0,true).valid);assert(!landingWindow(0,Math.PI,true).valid);
assert(landingWindow(Math.PI*2-.2,0,false).valid);assert(landingWindow(Math.PI*2-.5,0,true).valid);assert(!landingWindow(Math.PI*2-.6,0,true).valid);
assert.equal(completedRotation(Math.PI*1.5,Math.PI),1);assert.equal(completedRotation(Math.PI,TAU),0);
assert(landingTime(2,-2)>0);assert.equal(airPhase(.3,0).extension,1);
// Each grab stays within anatomical reach, both soles remain attached, and
// changes in trick phase move individual joints without one-frame jumps.
const detailRoot=new T.Group(),detail=new RiderRig(detailRoot,new T.MeshStandardMaterial(),new T.MeshStandardMaterial());
for(const [kind,hand,target] of [[0,1,boardEdgeAt(.31,-1)],[1,0,boardEdgeAt(-.18,-1)],[2,0,boardEdgeAt(-.31,1)]]){
 for(let i=0;i<180;i++)detail.pose({dt:1/120,time:i/120,turn:.2,speed:22,air:true,grab:true,landing:0,menu:false,grabKind:kind,spinVelocity:3,flipVelocity:0,extension:0,pop:0});
 assert(gripTip(detail.hands[hand]).distanceTo(target)<.025,`grab ${kind} must reach board`);
 for(let i=0;i<2;i++){const ankle=new T.Vector3((i?1:-1)*.39,.305,0);detail.legs[i].mesh.updateMatrixWorld(true);assert(detail.legs[i].tip.getWorldPosition(new T.Vector3()).distanceTo(ankle)<1e-5);}
}
let maxHandStep=0,previousHand=detail.hands[0].position.clone();
for(let i=0;i<180;i++){
 const extension=Math.min(1,i/90);detail.pose({dt:1/120,time:3+i/120,turn:-.3,speed:22,air:i<90,grab:false,landing:i>=90?Math.max(0,1-(i-90)/70):0,menu:false,extension,spinVelocity:3*(1-extension),flipVelocity:0,spin:Math.PI,rail:false});
 maxHandStep=Math.max(maxHandStep,previousHand.distanceTo(detail.hands[0].position));previousHand.copy(detail.hands[0].position);
 for(const limb of [...detail.legs,...detail.arms]){limb.mesh.updateMatrixWorld(true);const a=limb.upper.getWorldPosition(new T.Vector3()),j=limb.lower.getWorldPosition(new T.Vector3()),e=limb.tip.getWorldPosition(new T.Vector3());assert(Math.abs(a.distanceTo(j)-limb.upperLength)<1e-6);assert(Math.abs(j.distanceTo(e)-limb.lowerLength)<1e-6);}
}
assert(maxHandStep<.085,`hand movement should remain continuous, max ${maxHandStep}`);

// A 180 changes the leading foot and mirrors body mechanics without moving the bindings.
const cruise = { dt: 1 / 120, time: 6, turn: .22, edge: .64, speed: 22, air: false, grab: false, landing: 0, menu: false };
function holdPose(pose) {
 for (let i = 0; i < 90; i++) detail.pose({ ...cruise, ...pose, time: 6 + i / 120 });
 detailRoot.updateMatrixWorld(true);
}
holdPose({ spin: 0 });
assert(detail.leadSpring.value > .99 && detail.lean > .2);
assert(detail.head.getWorldDirection(new T.Vector3()).x < -.65);
assert(detail.hands[1].position.y > detail.hands[0].position.y);
holdPose({ spin: 2.2, air: true, extension: .05, landingSpin: Math.PI });
assert(detail.leadSpring.value > .98, 'Hold the takeoff stance through the compact rotation');
for (let i = 0; i <= 30; i++) {
 const progress = i / 30;
 detail.pose({ ...cruise, time: 7 + i / 120, spin: 2.2 + (Math.PI - 2.2) * progress,
  air: true, extension: .15 + .85 * progress, landingSpin: Math.PI });
}
assert(detail.leadSpring.value < -.72, 'Open into switch before the 180 touches down');
holdPose({ spin: Math.PI });
assert(detail.leadSpring.value < -.99 && detail.lean < -.2);
assert(detail.head.getWorldDirection(new T.Vector3()).x > .65);
assert(detail.hands[0].position.y > detail.hands[1].position.y);
for (let i = 0; i < 2; i++)
 assert(detail.legs[i].tip.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3((i ? 1 : -1) * .39, .305, 0)) < 1e-5);
holdPose({ spin: Math.PI / 2, rail: true });
assert(detail.leadSpring.value < -.99, 'A sideways slide keeps its entry stance');
holdPose({ spin: Math.PI * 2 });
assert(detail.leadSpring.value > .99, 'A second 180 returns to regular');
detail.dispose();detailRoot.traverse(disposeMesh);
console.log('Angular momentum frame-rate parity, bounded correction, all three grab contacts, fixed boot contact and landing motion continuity passed.');

const contact = {x:0,y:0,z:0,heading:0,speed:18,edge:0,skid:0,depth:.018,landing:0,slopeX:0,slopeZ:0,grounded:true};
const packedSpray = new PowderSpray('extreme'), deepSpray = new PowderSpray('extreme');
const count = spray => spray.points.geometry.drawRange.count;
for (let step = 0; step < 36; step++) {
 const frame = {...contact,z:-step*.15};
 packedSpray.update(1/120,frame,1440);
 deepSpray.update(1/120,{...frame,depth:.46,skid:.62},1440);
}
assert(count(deepSpray) > count(packedSpray) * 4, 'Powder and skidding should throw a denser plume');
deepSpray.update(1/120,{...contact,z:-40,y:3,grounded:false},1440);
assert(count(deepSpray) > 0, 'Snow already thrown should persist after takeoff');
const positions = deepSpray.points.geometry.attributes.position;
for (let i = 0; i < count(deepSpray); i++)
 assert(positions.getZ(i) > -20, 'Airborne motion must not drag the plume with the board');
// Snow dust hangs up to ~2.5 s (powder plumes); after 3.3 s in the air nothing new may have been emitted.
for (let step = 0; step < 400; step++)
 deepSpray.update(1/120,{...contact,z:-40-step*.15,y:3,grounded:false},1440);
assert.equal(count(deepSpray),0,'Airborne rider should stop emitting new snow');
deepSpray.update(1/120,{...contact,z:-70,speed:0,landing:1},1440);
assert(count(deepSpray) > 8,'Landing should throw a distinct puff');
deepSpray.clear();
assert.equal(count(deepSpray),0);
packedSpray.dispose();
deepSpray.dispose();
console.log('Snow spray intensity, airborne persistence, fade and landing burst passed.');
