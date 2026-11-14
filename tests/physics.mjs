import assert from 'node:assert/strict';
import {MeshStandardMaterial, Raycaster, Vector3} from 'three';
import {makeBoardGeometry} from '../lib/rider-rig.ts';
import {kickerAt} from '../lib/park-jumps.ts';
import {makeParkRails, railRideHeight, railTop} from '../lib/park-rails.ts';
import {SnowGame,COURSES,center,height,landingScore,pathSlope,snowDepth} from '../lib/snow-game.ts';
function makeGame(course,mode){const g=Object.create(SnowGame.prototype);Object.assign(g,{course,mode,state:'ride',x:center(0,course),d:0,y:height(center(0,course),0,course),vy:0,speed:12,heading:0,spin:0,flip:0,airTime:0,grabTime:0,ground:true,settings:{assist:true},spinInput:0,spinOrigin:0,flipOrigin:0,spinVelocity:0,flipVelocity:0,load:0,pop:0,extension:0,landingImpact:0,grabContactTime:0,grabKind:0,grabLocked:-1,lastGrabKind:0,jumpPending:false,jumpReleased:false,time:0,bailTimer:0,flowTimer:0,toastTimer:0,score:0,tricks:0,bails:0,combo:1,keys:new Set(),touch:new Set(),repeats:new Map(),rails:[],railDone:new Set(),railActive:-1,railTime:0,obstacles:[],gateCount:0,gateIndex:0,features:Array.from({length:Math.floor(course.length/180)-1},()=>({})),recordTimer:0,frames:[],hudTimer:0,onHUD:()=>{},onEnd:r=>{g.result=r;},sound:()=>{}});return g;}
// The legacy procedural courses (real-terrain Verbier runs are covered by tests/verbier.mjs).
for(const course of COURSES.filter(c=>!c.dem)){
 const g=makeGame(course,'slopestyle');let count=0;
 while(g.state==='ride'&&count++<30000){const offset=center(g.d+20,course)-g.x;g.keys.clear();if(offset>1)g.keys.add('KeyD');if(offset< -1)g.keys.add('KeyA');if(!g.ground){g.keys.add('ShiftLeft');}g.update(1/120);assert(Number.isFinite(g.x)&&Number.isFinite(g.y)&&Number.isFinite(g.speed));}
 assert.equal(g.state,'result');assert(g.result.distance>=course.length-10);assert(g.result.score>0);assert(g.result.tricks>0);assert(g.frames.length>500);assert(g.frames.length<14410);assert(g.result.gates<=g.result.totalGates);console.log(course.name,JSON.stringify({score:g.score,tricks:g.tricks,time:g.time.toFixed(1),frames:g.frames.length}));
}
const base=landingScore(Math.PI*4,Math.PI*2,1,2,0);assert.equal(base.name,'BACKFLIP 720° INDY');assert(base.score>landingScore(Math.PI*4,Math.PI*2,1,2,4).score);
const bad=makeGame(COURSES[0],'slopestyle');bad.settings.assist=false;bad.ground=false;bad.airTime=1;bad.spin=Math.PI/2;bad.land();assert.equal(bad.bails,1);assert.equal(bad.score,0);
const assisted=makeGame(COURSES[0],'training');assisted.settings.assist=false;assisted.ground=false;assisted.airTime=1;assisted.spin=Math.PI/2;assisted.land();assert.equal(assisted.bails,1);assert.equal(assisted.score,0);
const replay=makeGame(COURSES[0],'freeride');replay.run={time:2,frames:[{t:0,x:0,d:0,y:180,heading:0,spin:0,flip:0},{t:2,x:2,d:40,y:170,heading:0,spin:0,flip:0}]};replay.replayTime=1;replay.replayPlaying=false;replay.updateReplay(0);assert.equal(replay.x,1);assert.equal(replay.d,20);replay.setReplayTime(99);assert.equal(replay.replayTime,2);
const bankReplay = makeGame(COURSES[0], 'freeride');
bankReplay.course = { ...bankReplay.course, packedSnow: true };
const bankX = 68, oldBankHeight = 180 + Math.sin(bankX * .15) * .25 + (bankX - 23) ** 2 * .024;
bankReplay.run = { time: 0, frames: [{ ...bankReplay.snapshot(), x: bankX, y: oldBankHeight + 2 }] };
bankReplay.replayTime = 0;
bankReplay.updateReplay(0);
assert(Math.abs(bankReplay.y - height(bankX, 0, bankReplay.course) - 2) < 1e-8);
console.log('Scoring variety, strict landing, bounded training assist, run completion and replay interpolation passed.');

const deck = makeBoardGeometry();
deck.computeBoundingBox();
assert(Math.abs(deck.boundingBox.max.x - deck.boundingBox.min.x - 1.90) < .01);
assert(Math.abs(deck.boundingBox.min.y) < .005, 'Running surface should rest at snow height');
assert(deck.attributes.normal.getY(0) > .9);
const position = deck.attributes.position;
const vertices = Array.from({length: position.count}, (_, i) => i);
const centerDeck = vertices.find(i => Math.abs(position.getX(i)) < 1e-6 && Math.abs(position.getZ(i)) < 1e-6);
assert(centerDeck !== undefined);
const waist = vertices.filter(i => Math.abs(position.getX(i)) < 1e-6).map(i => position.getZ(i));
assert(Math.abs(Math.max(...waist) - Math.min(...waist) - .34) < .005);
for (const side of [-1, 1]) {
 assert(vertices.some(i => side * position.getX(i) > .90 && position.getY(i) > position.getY(centerDeck) + .04));
}
assert(position.array.every(Number.isFinite));
assert.deepEqual(deck.groups.map(group => group.materialIndex), [0, 1, 2, 3]);
deck.dispose();
console.log('Board dimensions, snow contact, steel edge, upward deck normals and raised tips passed.');

// Charge/release is shared by keyboard, touch and gamepad action handlers.
const charged=makeGame(COURSES[0],'training');charged.prepareJump();
for(let i=0;i<42;i++)charged.update(1/120);
assert(charged.ground);assert(charged.load>.85);
charged.jumpReleased=true;charged.update(1/120);assert(!charged.ground);assert(charged.vy-charged.speed*pathSlope(charged.x,charged.d,charged.heading,charged.course)>3,"Pop is relative to the sloping surface");
const tapped=makeGame(COURSES[0],'training');tapped.prepareJump();tapped.jumpReleased=true;
for(let i=0;i<15;i++)tapped.update(1/120);assert(!tapped.ground,'Quick tap still produces a preloaded pop');
// Switch stance must survive touchdown, and the next trick counts only new rotation.
const switchRun=makeGame(COURSES[0],'slopestyle');switchRun.ground=false;switchRun.airTime=1;switchRun.spin=Math.PI;switchRun.land();
assert.equal(switchRun.spin,Math.PI);assert.equal(switchRun.bails,0);assert.equal(switchRun.trick,'180°');
switchRun.jump();assert.equal(switchRun.spinOrigin,Math.PI);switchRun.airTime=1;switchRun.land();assert.equal(switchRun.trick,'STRAIGHT AIR');
assert(!landingScore(Math.PI*1.5,0,0,1,0).name.includes('360'));
assert(!landingScore(0,Math.PI,0,1,0).name.includes('FLIP'));
const inverted=makeGame(COURSES[0],'training');inverted.ground=false;inverted.airTime=1;inverted.flip=Math.PI;inverted.land();assert.equal(inverted.score,0);assert.equal(inverted.bails,1);
const modern=makeGame(COURSES[0],'freeride');modern.run={time:1,frames:[{...modern.snapshot(),t:0,spin:Math.PI*2-.1,ground:false,pop:1,speed:20},{...modern.snapshot(),t:1,spin:Math.PI*2+.1,ground:false,pop:0,speed:30,grab:true,grabKind:2}]};modern.replayTime=.5;modern.replayPlaying=false;modern.updateReplay(0);assert(Math.abs(modern.spin-Math.PI*2)<1e-10);assert.equal(modern.speed,25);assert.equal(modern.pop,.5);assert.equal(modern.ground,false);assert.equal(modern.grabKind,2);
console.log('Loaded/tapped jumps, persistent switch stance, no incomplete rotation credit, inverted bail, continuous replay angles and pose drivers passed.');
// Fly complete tricks through gravity/contact, rather than only testing score helpers.
for(const [axis,control,target,label] of [['spin','KeyE',Math.PI,'180°'],['flip','KeyX',Math.PI*2,'BACKFLIP']]){
 const g=makeGame(COURSES[0],'slopestyle');g.jump(8.2);if(axis==='flip')g.flipVelocity=4.8;let steps=0;
 while(!g.ground&&steps++<600){const velocity=axis==='spin'?g.spinVelocity:g.flipVelocity;if(g[axis]+velocity/4.8<target)g.keys.add(control);else g.keys.delete(control);g.update(1/120);}
 assert(g.ground);assert.equal(g.bails,0);assert(g.trick.includes(label),`${axis} should finish and score after physical contact`);assert(g.score>0);
}
console.log('Physical 180 and full backflip flights, angular braking and scored ground contact passed.');

const rail = makeGame(COURSES[1], 'training');
const testRailMaterial = new MeshStandardMaterial();
rail.rails = makeParkRails(rail.course, d => center(d, rail.course), (x, d) => height(x, d, rail.course), testRailMaterial);
assert.equal(new Set(rail.rails.map(item => item.name)).size, 4);
assert.equal(new Set(rail.rails.map(item => item.end - item.d)).size, 4);
for (const profile of rail.rails) {
    const middle = (profile.d + profile.end) / 2;
    profile.mesh.updateMatrixWorld();
    const ray = new Raycaster(new Vector3(profile.x, railTop(profile, middle) + 2, -middle), new Vector3(0, -1, 0));
    const [hit] = ray.intersectObject(profile.mesh.children[0]);
    assert(hit && Math.abs(hit.point.y - railTop(profile, middle)) < 1e-5, 'Rail collider matches its visible deck');
}
const profile = rail.rails[0];
rail.d = profile.d + 1;
rail.x = profile.x;
rail.ground = false;
rail.y = railRideHeight(profile, rail.d) + .01;
rail.vy = rail.speed * profile.slope - 2.5;
rail.update(1 / 120);
assert.equal(rail.railActive, 0);
assert(Math.abs(rail.y - railRideHeight(profile, rail.d)) < 1e-8);
rail.d = profile.end - .01;
rail.y = railRideHeight(profile, rail.d);
const railY = rail.y;
rail.update(1 / 120);
assert(!rail.ground);
assert(Math.abs(rail.y - railY) < .1, 'Rail exit should fall ballistically instead of dropping instantly');
const slide = makeGame(COURSES[1], 'training');
slide.rails = [profile];
slide.x = profile.x;
slide.d = profile.d + 1;
slide.y = railRideHeight(profile, slide.d) + .01;
slide.ground = false;
slide.vy = slide.speed * profile.slope - 2.5;
slide.spin = Math.PI / 2;
slide.update(1 / 120);
assert.equal(slide.railActive, 0);
assert.equal(slide.feedback, 'BOARDSLIDE · WIDE BOX');
for (let i = 0; i < 100 && (slide.railActive >= 0 || !slide.ground); i++) slide.update(1 / 120);
assert.equal(slide.bails, 0);
assert.equal(slide.trick, 'BOARDSLIDE');
assert(slide.ground);
assert(Math.abs(Math.sin(slide.spin)) < .15, 'Boardslide exit aligns the board before snow contact');
for (const feature of rail.rails.slice(0, 4)) {
    let caught = false;
    for (let approach = 2; approach <= 16 && !caught; approach++) {
        const run = makeGame(COURSES[1], 'training');
        run.rails = [feature];
        run.d = feature.d - approach;
        run.x = feature.x;
        run.y = height(run.x, run.d, run.course);
        run.prepareJump();
        for (let i = 0; i < 48; i++) run.update(1 / 120);
        run.jumpReleased = true;
        for (let i = 0; i < 96 && !caught; i++) {
            run.update(1 / 120);
            caught = run.railActive >= 0;
        }
    }
    assert(caught, `${feature.name} is reachable with a normal charged pop`);
}
console.log('Four rail profiles, exact deck support, swept catches, boardslides and ballistic dismounts passed.');

// Regression checks for the physically motivated movement model.
const airborne=makeGame(COURSES[0],'freeride');airborne.y+=20;airborne.jump(0);
const y0=airborne.y,v0=airborne.vy,h0=airborne.heading,s0=airborne.speed;
airborne.keys.add('KeyD');airborne.keys.add('KeyW');airborne.keys.add('KeyS');
for(let i=0;i<60;i++)airborne.update(1/120);
assert(Math.abs(airborne.y-(y0+v0*.5-.5*9.81*.25))<1e-8);
assert.equal(airborne.heading,h0,'Airborne steering cannot redirect trajectory');
assert.equal(airborne.speed,s0,'Tuck and brake cannot add horizontal thrust in flight');
const impact=makeGame(COURSES[0],'freeride');impact.y+=.01;impact.ground=false;impact.vy=-20;impact.update(1/120);assert.equal(impact.bails,1);assert.equal(impact.trick,'HARD LANDING');
const stopped=makeGame(COURSES[0],'freeride');stopped.keys.add('KeyS');for(let i=0;i<600;i++)stopped.update(1/120);assert.equal(stopped.speed,0,'Braking can stop the board');
console.log('Earth gravity, conserved airborne heading/speed, hard-impact bail and full stop passed.');

const looseSnow = makeGame(COURSES[2], 'freeride');
looseSnow.x = 36;
looseSnow.y = height(looseSnow.x, looseSnow.d, looseSnow.course);
looseSnow.update(1 / 120);
assert(looseSnow.ground && snowDepth(looseSnow.x, looseSnow.d, looseSnow.course) > .24);
assert(snowDepth(center(looseSnow.d, looseSnow.course), looseSnow.d, looseSnow.course) < .04);
assert(height(looseSnow.x, looseSnow.d, looseSnow.course) - looseSnow.y > .05, 'The board rides below the surface in deep powder');

for (const course of COURSES.filter(c => !c.dem)) {
 for (let feature = 0; feature < 3; feature++) {
  const {base, profile} = kickerAt(100 + feature * course.spacing, course);
  for (const [speed, offset, heading] of [[12, 0, 0], [17, -3, -.15], [19, 3, .1], [20, 0, 0]]) {
   const g = makeGame(course, 'slopestyle');
   g.settings = {autoLand: true, assist: false};
   g.d = base + profile.lip - .04;
   g.x = center(base + profile.lip, course) + offset;
   g.y = height(g.x, g.d, course);
   g.speed = speed;
   g.heading = heading;
   g.keys.add('KeyX');
   g.keys.add('KeyE');
   g.update(1 / 120);
   assert(g.parkFlight && !g.ground, `${course.name}, feature ${feature}, speed ${speed} has a reachable landing`);
   const lip = base + profile.lip;
   const naturalVy = g.speed * pathSlope(g.parkFlight.originX, lip - .16, g.heading, course);
   assert(Math.abs(g.vy + 9.81 * g.airTime - naturalVy) <= 3.2 + 1e-8, 'Assist stays close to the lip tangent');
   for (let step = 0; !g.ground && step < 500; step++) g.update(1 / 120);
   assert(g.ground && g.bails === 0, `${course.name}, feature ${feature}, speed ${speed}`);
   assert(g.d >= base + profile.knuckle && g.d < base + profile.runout);
   const sink = height(g.x, g.d, course) - g.y;
   assert(sink >= -1e-8 && sink <= Math.max(0, snowDepth(g.x, g.d, course) - .045) * .44 + 1e-8);
   assert(Math.abs(g.flip % (2 * Math.PI)) < 1e-8 && Math.abs(g.spin % Math.PI) < 1e-8);
  }
 }
}
const overspeed = makeGame(COURSES[1], 'slopestyle');
overspeed.settings = {autoLand: true, assist: false};
const overspeedLip = 100 + kickerAt(100, overspeed.course).profile.lip;
overspeed.d = overspeedLip - .04;
overspeed.x = center(overspeedLip, overspeed.course);
overspeed.y = height(overspeed.x, overspeed.d, overspeed.course);
overspeed.speed = 29;
overspeed.update(1 / 120);
assert(!overspeed.ground && !overspeed.parkFlight && overspeed.vy > 0, 'Overspeed launch follows the lip instead of being pushed down');
for (let step = 0; !overspeed.ground && step < 620; step++) overspeed.update(1 / 120);
assert.equal(overspeed.trick, 'HARD LANDING', 'A high impact still bails with automatic park landings enabled');
console.log('Reachable automatic landings, bounded launch correction, and overspeed impact passed.');
