import * as T from 'three';
const gradient=()=>({addColorStop(){}});
const context={createLinearGradient:gradient,createRadialGradient:gradient,fillRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){},fillText(){},save(){},restore(){},translate(){},rotate(){},scale(){}};
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>context})};
const { RiderRig, GRAB_TARGETS } = await import('../lib/rider-rig.ts');
const { BOARDS } = await import('../lib/sim/boards.ts');
const { GRABS } = await import('../lib/sim/freestyle.ts');
const root = new T.Group(); const rig = new RiderRig(root, new T.MeshStandardMaterial(), new T.MeshStandardMaterial());
const spec = BOARDS['all-mountain']; rig.setBoard(spec);
rig.pose({ dt: 1, time: 0, turn: 0, speed: 0, air: false, grab: false, landing: 0, menu: true }); root.updateMatrixWorld(true);
const box = new T.Box3().setFromObject(root), bb = new T.Box3().setFromObject(rig.board.children[0]);
console.log('rider top (m)', box.max.y.toFixed(3), 'board L', (bb.max.x - bb.min.x).toFixed(3), 'board W', (bb.max.z - bb.min.z).toFixed(3));
const ws = rig.boots.map(b => b.getWorldPosition(new T.Vector3()).x.toFixed(3)); console.log('boots x (m)', ws.join(' '));
function gripTip(hand) { return new T.Vector3(0, -.117, 0).applyQuaternion(hand.quaternion).add(hand.position); }
for (const lead of [1, -1]) for (let k = 0; k < GRAB_TARGETS.length; k++) {
  for (let i = 0; i < 120; i++) rig.pose({ dt: 1/120, time: i/120, turn: 0, speed: 20, air: false, grab: false, landing: 0, menu: false, spin: lead > 0 ? 0 : Math.PI });
  for (let i = 0; i < 240; i++) rig.pose({ dt: 1/120, time: i/120, turn: 0, speed: 20, air: true, grab: true, landing: 0, menu: false, grabKind: k, spin: lead > 0 ? 0 : Math.PI, extension: 0, pop: 0 });
  root.updateMatrixWorld(true);
  const hw = rig.grabHands(k, lead); const errs = [];
  for (const h of [0, 1]) if (hw[h]) { const c = rig.grabContact(k, lead, h).clone(); const tip = gripTip(rig.hands[h]); errs.push((tip.distanceTo(c) * .9).toFixed(3)); }
  console.log(`lead ${lead} ${GRABS[k].name.padEnd(14)} hand ${hw.join('')} miss ${errs.join(',')} m`);
}
