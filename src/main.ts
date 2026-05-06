import './style.css';
import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';

type Side = 'hero' | 'npc';
type TurnState = 'ready' | 'charging' | 'swinging' | 'resolved';
type SwipeDirection = 'up' | 'down' | 'left' | 'right' | 'none';
type HeroPose = 'idle' | 'prepare' | 'attack' | 'recover' | 'dodge' | 'victory';
type NpcPose = 'idle' | 'prepare' | 'charge' | 'attack' | 'hit' | 'miss' | 'dodge' | 'hurt' | 'defeat';

type Pose = HeroPose | NpcPose;

interface FighterVisual<TPose extends string> {
  side: Side;
  container: Container;
  sprites: Record<TPose, Sprite>;
  currentPose: TPose;
  baseX: number;
  baseY: number;
  baseScale: number;
  shakeUntil: number;
}

interface CombatState {
  round: number;
  heroHp: number;
  npcHp: number;
  attacker: Side;
  turnState: TurnState;
  turnDeadlineMs: number;
  turnTimeLeftMs: number;
  chargeEndsAt: number;
  swingEndsAt: number;
  counterWindowFor: Side | null;
  counterWindowEndsAt: number;
  counterFromAttacker: Side | null;
  isCounterAttack: boolean;
  dodgeCooldownUntil: Record<Side, number>;
  dodgeSuccessBuff: Record<Side, number>;
  dodgeSuccessThisAttack: Record<Side, boolean>;
  winner: Side | null;
}

const CONFIG = {
  width: 1080,
  height: 1920,
  maxHp: 200,
  baseDamage: 32,
  chargeWindowMs: 220,
  swingWindowMs: 230,
  counterWindowMs: 850,
  counterDamageMultiplier: 1.45,
  dodgeCooldownMs: 1000,
  turnLimitMs: 5000,
  aiPrepareMinMs: 380,
  aiPrepareMaxMs: 1700,
  aiFakeChance: 0.55,
  aiReactionMinMs: 75,
  aiReactionMaxMs: 200,
  attackerHoldScale: 1,
  defenderDodgeShift: 72,
  minSwipeDistance: 42,
  fighterAlphaBoxHeight: 1512,
  fighterTargetScreenHeightRatio: 0.9,
  fighterBaseYRatio: 0.87,
  heroXRatio: 0.83,
  npcXRatio: 0.285,
  heroScaleMultiplier: 1.24,
  npcScaleMultiplier: 1.03,
  heroYOffset: 92,
  npcYOffset: 30,
  heroLungeDistance: 230,
  npcLungeDistance: 220,
  speedLineDurationMs: 190,
};

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) {
  throw new Error('Missing #app element');
}

appRoot.innerHTML = `
<div id="game-root">
  <div id="hud-top">
    <div class="player-name">NPC</div>
    <div class="round-text">ROUND <span id="round-value">1</span></div>
    <div class="enemy-name">得分 0000</div>
  </div>

  <div id="bars-row">
    <div class="bar-wrap">
      <div class="bar-label">NPC 气势</div>
      <div class="bar-shell"><div id="npc-hp" class="bar-fill player"></div></div>
      <div id="npc-hp-text" class="bar-text">200/200</div>
    </div>
    <div class="bar-wrap right">
      <div class="bar-label">主角 气势</div>
      <div class="bar-shell"><div id="hero-hp" class="bar-fill enemy"></div></div>
      <div id="hero-hp-text" class="bar-text">200/200</div>
    </div>
  </div>

  <div id="canvas-holder"></div>

  <div id="slap-zone">
    <div class="zone-title">SLAP ZONE</div>
    <div id="zone-phase" class="zone-phase">ATTACK TURN</div>
    <div id="zone-time" class="zone-time">5.0</div>
    <div id="zone-hint" class="zone-hint">按住抬手，左/上滑攻击；右/下滑躲避</div>
  </div>

  <div id="status-line">你的回合：按住抬手，左/上滑出手</div>
</div>
`;

const el = {
  canvasHolder: document.querySelector<HTMLDivElement>('#canvas-holder'),
  npcHp: document.querySelector<HTMLDivElement>('#npc-hp'),
  heroHp: document.querySelector<HTMLDivElement>('#hero-hp'),
  npcHpText: document.querySelector<HTMLDivElement>('#npc-hp-text'),
  heroHpText: document.querySelector<HTMLDivElement>('#hero-hp-text'),
  roundValue: document.querySelector<HTMLSpanElement>('#round-value'),
  zonePhase: document.querySelector<HTMLDivElement>('#zone-phase'),
  zoneTime: document.querySelector<HTMLDivElement>('#zone-time'),
  zoneHint: document.querySelector<HTMLDivElement>('#zone-hint'),
  statusLine: document.querySelector<HTMLDivElement>('#status-line'),
};

for (const [key, value] of Object.entries(el)) {
  if (!value) {
    throw new Error(`Missing UI element: ${key}`);
  }
}

const app = new Application();
await app.init({
  resizeTo: el.canvasHolder as HTMLDivElement,
  background: '#060606',
  antialias: true,
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  autoDensity: true,
});
(el.canvasHolder as HTMLDivElement).appendChild(app.canvas as HTMLCanvasElement);

const world = new Container();
app.stage.addChild(world);

const sceneLayer = new Container();
const fxLayer = new Container();
const faceLayer = new Container();
faceLayer.visible = false;
world.addChild(sceneLayer, faceLayer, fxLayer);

const textures = await loadAllTextures();

const hero = createHero(textures.hero);
const npc = createNpc(textures.npc);
sceneLayer.addChild(npc.container, hero.container);

const npcFaceSprites = createNpcFaceSprites(textures.npcFace);
for (const sprite of Object.values(npcFaceSprites)) {
  faceLayer.addChild(sprite);
}

const attackCue = new Text({
  text: '啪!',
  style: {
    fill: '#ffd7e1',
    fontFamily: 'Georgia, serif',
    fontSize: 96,
    fontWeight: '700',
    stroke: { color: '#ff4a87', width: 6 },
    dropShadow: {
      alpha: 0.8,
      color: '#ff77a6',
      blur: 10,
      distance: 0,
      angle: 0,
    },
  },
});
attackCue.anchor.set(0.5);
attackCue.alpha = 0;
fxLayer.addChild(attackCue);

const hitBurst = new Graphics();
hitBurst.alpha = 0;
fxLayer.addChild(hitBurst);

const speedLines = new Graphics();
speedLines.alpha = 0;
fxLayer.addChild(speedLines);

const combat: CombatState = {
  round: 1,
  heroHp: CONFIG.maxHp,
  npcHp: CONFIG.maxHp,
  attacker: 'hero',
  turnState: 'ready',
  turnDeadlineMs: performance.now() + CONFIG.turnLimitMs,
  turnTimeLeftMs: CONFIG.turnLimitMs,
  chargeEndsAt: 0,
  swingEndsAt: 0,
  counterWindowFor: null,
  counterWindowEndsAt: 0,
  counterFromAttacker: null,
  isCounterAttack: false,
  dodgeCooldownUntil: { hero: 0, npc: 0 },
  dodgeSuccessBuff: { hero: 1, npc: 1 },
  dodgeSuccessThisAttack: { hero: false, npc: false },
  winner: null,
};

let pointerDown = false;
let pointerStartX = 0;
let pointerStartY = 0;
let activePointerId = -1;
let sceneShakeMs = 0;
let speedLineUntil = 0;
let facePopupUntil = 0;
let facePopupLevel = 1;
const dodgeOffset: Record<Side, number> = { hero: 0, npc: 0 };
const lungeUntil: Record<Side, number> = { hero: 0, npc: 0 };

let pendingAi = {
  prepareAt: 0,
  attackAt: 0,
  fakeReleaseAt: 0,
  dodgeAt: 0,
  counterAt: 0,
  dodgeCommitted: false,
};

layoutWorld();
setupInput();
updateUI();
refreshTurnHint();
planAiTurnIfNeeded();

window.addEventListener('resize', layoutWorld);

app.ticker.add((ticker) => {
  const now = performance.now();
  const deltaMs = ticker.deltaMS;

  if (combat.winner) {
    updateUI();
    return;
  }

  combat.turnTimeLeftMs = Math.max(0, combat.turnDeadlineMs - now);

  if (combat.turnState === 'charging' && now >= combat.chargeEndsAt) {
    enterSwingPhase(now);
  }

  if (combat.turnState === 'swinging' && now >= combat.swingEndsAt) {
    resolveAttack();
  }

  if (combat.counterWindowFor && now >= combat.counterWindowEndsAt) {
    expireCounterWindow();
  }

  if (combat.turnTimeLeftMs <= 0 && combat.turnState === 'ready') {
    setStatus(`${attackerName()} 超时未出手，回合切换`);
    finishTurnWithoutAttack();
  }

  updateAi(now);
  animateTransient(now, deltaMs);
  updateNpcFaceOverlay(now);
  updateUI();
});

function createHero(heroTextures: Record<HeroPose, Texture>): FighterVisual<HeroPose> {
  const container = new Container();
  const sprites = createPoseSprites(heroTextures);
  for (const sprite of Object.values(sprites)) {
    container.addChild(sprite);
  }

  const heroVisual: FighterVisual<HeroPose> = {
    side: 'hero',
    container,
    sprites,
    currentPose: 'idle',
    baseX: 0,
    baseY: 0,
    baseScale: 1,
    shakeUntil: 0,
  };
  setPose(heroVisual, 'idle');
  return heroVisual;
}

function createNpc(npcTextures: Record<NpcPose, Texture>): FighterVisual<NpcPose> {
  const container = new Container();
  const sprites = createPoseSprites(npcTextures);
  for (const sprite of Object.values(sprites)) {
    container.addChild(sprite);
  }

  const npcVisual: FighterVisual<NpcPose> = {
    side: 'npc',
    container,
    sprites,
    currentPose: 'idle',
    baseX: 0,
    baseY: 0,
    baseScale: 1,
    shakeUntil: 0,
  };
  setPose(npcVisual, 'idle');
  return npcVisual;
}

function createPoseSprites<TPose extends string>(texturesMap: Record<TPose, Texture>): Record<TPose, Sprite> {
  const sprites = {} as Record<TPose, Sprite>;
  for (const [pose, texture] of Object.entries(texturesMap) as [TPose, Texture][]) {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.visible = false;
    sprites[pose] = sprite;
  }
  return sprites;
}

function createNpcFaceSprites(faceTextures: Texture[]): Record<number, Sprite> {
  const sprites: Record<number, Sprite> = {};
  for (let index = 0; index < faceTextures.length; index += 1) {
    const sprite = new Sprite(faceTextures[index]);
    sprite.anchor.set(0.5, 0.5);
    sprite.visible = false;
    sprites[index] = sprite;
  }
  return sprites;
}

function setPose<TPose extends string>(fighter: FighterVisual<TPose>, pose: TPose): void {
  fighter.currentPose = pose;
  for (const [key, sprite] of Object.entries(fighter.sprites) as [TPose, Sprite][]) {
    sprite.visible = key === pose;
  }
}

function layoutWorld(): void {
  const width = app.renderer.width;
  const height = app.renderer.height;

  const stageScale = Math.min(width / CONFIG.width, height / CONFIG.height);
  world.scale.set(stageScale);
  world.position.set((width - CONFIG.width * stageScale) * 0.5, (height - CONFIG.height * stageScale) * 0.5);

  const baseY = CONFIG.height * CONFIG.fighterBaseYRatio;
  const npcX = CONFIG.width * CONFIG.npcXRatio;
  const heroX = CONFIG.width * CONFIG.heroXRatio;
  const baseScale = getBaseFighterScale();

  npc.baseX = npcX;
  npc.baseY = baseY + CONFIG.npcYOffset;
  npc.baseScale = baseScale * CONFIG.npcScaleMultiplier;
  npc.container.position.set(npc.baseX, npc.baseY);
  npc.container.scale.set(npc.baseScale);

  hero.baseX = heroX;
  hero.baseY = baseY + CONFIG.heroYOffset;
  hero.baseScale = baseScale * CONFIG.heroScaleMultiplier;
  hero.container.position.set(hero.baseX, hero.baseY);
  hero.container.scale.set(hero.baseScale);

  attackCue.position.set(CONFIG.width * 0.56, CONFIG.height * 0.35);
  drawSpeedLines();
  layoutNpcFaceSprites();
}

function layoutNpcFaceSprites(): void {
  for (const sprite of Object.values(npcFaceSprites)) {
    sprite.position.set(npc.baseX + 95 * npc.baseScale, npc.baseY - 1180 * npc.baseScale);
    sprite.scale.set(npc.baseScale * 0.33);
  }
}

function setupInput(): void {
  const root = document.querySelector<HTMLDivElement>('#game-root');
  if (!root) {
    return;
  }

  root.addEventListener('pointerdown', (event) => {
    if (combat.winner || combat.turnState !== 'ready') {
      return;
    }

    pointerDown = true;
    activePointerId = event.pointerId;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;

    if (combat.attacker === 'hero') {
      setPose(hero, 'prepare');
      setStatus(combat.counterWindowFor === 'hero' ? '反击：按住后左/上滑出手' : '按住抬手，可松开取消；左/上滑出手');
    }
  });

  root.addEventListener('pointerup', (event) => {
    if (event.pointerId !== activePointerId) {
      return;
    }

    pointerDown = false;
    activePointerId = -1;
    if (combat.attacker === 'hero' && combat.turnState === 'ready') {
      setPose(hero, 'idle');
    }
  });

  root.addEventListener('pointercancel', () => {
    pointerDown = false;
    activePointerId = -1;
    if (combat.attacker === 'hero' && combat.turnState === 'ready') {
      setPose(hero, 'idle');
    }
  });

  root.addEventListener('pointermove', (event) => {
    if (combat.winner || !pointerDown || event.pointerId !== activePointerId) {
      return;
    }

    const direction = detectSwipe(pointerStartX, pointerStartY, event.clientX, event.clientY);
    if (direction === 'none') {
      return;
    }

    const isAttackSwipe = direction === 'left' || direction === 'up';
    const isDodgeSwipe = direction === 'right' || direction === 'down';

    if (combat.attacker === 'hero' && combat.turnState === 'ready' && isAttackSwipe) {
      const isCounter = combat.counterWindowFor === 'hero';
      pointerDown = false;
      activePointerId = -1;
      setPose(hero, 'prepare');
      triggerAttack('hero', isCounter);
      return;
    }

    if (combat.attacker === 'npc' && isDodgeSwipe) {
      tryDodge('hero', performance.now());
      pointerStartX = event.clientX;
      pointerStartY = event.clientY;
      return;
    }

    if (combat.attacker === 'hero' && isDodgeSwipe) {
      setStatus('当前是攻击回合，请左/上滑出手');
    }
  });
}

function detectSwipe(startX: number, startY: number, endX: number, endY: number): SwipeDirection {
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.hypot(dx, dy);

  if (distance < CONFIG.minSwipeDistance) {
    return 'none';
  }

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left';
  }
  return dy < 0 ? 'up' : 'down';
}

function triggerAttack(attacker: Side, isCounter = false): void {
  if (combat.turnState !== 'ready') {
    return;
  }

  const now = performance.now();
  combat.turnState = 'charging';
  combat.chargeEndsAt = now + CONFIG.chargeWindowMs;
  combat.swingEndsAt = combat.chargeEndsAt + CONFIG.swingWindowMs;
  combat.turnDeadlineMs = combat.swingEndsAt;
  combat.turnTimeLeftMs = Math.max(0, combat.swingEndsAt - now);
  combat.isCounterAttack = isCounter;
  combat.counterWindowFor = null;
  combat.counterWindowEndsAt = 0;
  combat.counterFromAttacker = null;
  combat.dodgeSuccessThisAttack.hero = false;
  combat.dodgeSuccessThisAttack.npc = false;
  pendingAi.dodgeCommitted = false;
  pendingAi.dodgeAt = 0;

  if (attacker === 'hero') {
    setPose(hero, 'prepare');
    setPose(npc, 'idle');
    setStatus(isCounter ? '反击蓄力中' : '蓄力中，已不可取消');
  } else {
    setPose(npc, 'charge');
    setPose(hero, 'idle');
    setStatus(isCounter ? '对手反击蓄力中' : '对手蓄力中，注意出手瞬间躲避');
  }
  refreshTurnHint();
}

function enterSwingPhase(now: number): void {
  if (combat.turnState !== 'charging') {
    return;
  }

  const attacker = combat.attacker;
  combat.turnState = 'swinging';
  combat.turnDeadlineMs = combat.swingEndsAt;
  combat.turnTimeLeftMs = Math.max(0, combat.swingEndsAt - now);
  lungeUntil[attacker] = now + 220;

  if (attacker === 'hero') {
    setPose(hero, 'attack');
    setStatus(combat.isCounterAttack ? '反击挥击中' : '挥击中');
    if (!combat.isCounterAttack) {
      pendingAi.dodgeAt = now + randInt(CONFIG.aiReactionMinMs, CONFIG.aiReactionMaxMs);
    }
  } else {
    setPose(npc, 'attack');
    setStatus(combat.isCounterAttack ? '对手反击挥击中，右/下滑躲避' : '对手挥击中，右/下滑躲避');
  }

  speedLineUntil = now + CONFIG.speedLineDurationMs;
  refreshTurnHint();
}

function tryDodge(side: Side, now: number): void {
  if (combat.winner) {
    return;
  }
  if (now < combat.dodgeCooldownUntil[side]) {
    setStatus(`${nameOf(side)} 躲避冷却中`);
    return;
  }

  combat.dodgeCooldownUntil[side] = now + CONFIG.dodgeCooldownMs;
  const valid = combat.turnState === 'swinging' && side !== combat.attacker && now <= combat.swingEndsAt;

  if (side === 'hero') {
    setPose(hero, 'dodge');
  } else {
    setPose(npc, 'dodge');
  }

  dodgeOffset[side] = side === 'hero' ? 66 : -66;

  if (valid) {
    combat.dodgeSuccessThisAttack[side] = true;
    setStatus(`${nameOf(side)} 躲避成功`);
  } else {
    setStatus(`${nameOf(side)} 提前躲避，进入冷却`);
  }

  window.setTimeout(() => {
    dodgeOffset[side] = 0;
    if (combat.turnState === 'ready') {
      if (side === 'hero') {
        setPose(hero, 'idle');
      } else {
        setPose(npc, 'idle');
      }
    }
  }, 210);
}

function resolveAttack(): void {
  if (combat.turnState !== 'swinging') {
    return;
  }

  const attacker = combat.attacker;
  const defender: Side = attacker === 'hero' ? 'npc' : 'hero';
  const dodged = combat.dodgeSuccessThisAttack[defender];

  const damageFactor = combat.isCounterAttack ? CONFIG.counterDamageMultiplier : 1;
  const damage = Math.round(CONFIG.baseDamage * combat.dodgeSuccessBuff[attacker] * damageFactor);
  combat.dodgeSuccessBuff[attacker] = 1;

  if (dodged) {
    combat.turnState = 'resolved';
    combat.isCounterAttack = false;
    if (attacker === 'npc') {
      setPose(npc, 'miss');
    } else {
      setPose(hero, 'recover');
    }
    setStatus(`${nameOf(defender)} 躲避成功`);
    window.setTimeout(() => {
      startCounterWindow(defender, attacker);
    }, 120);
    return;
  } else {
    if (defender === 'npc') {
      combat.npcHp = Math.max(0, combat.npcHp - damage);
      npc.shakeUntil = performance.now() + 240;
      setPose(npc, 'hurt');
      if (attacker === 'hero') {
        setPose(hero, 'attack');
      }
    } else {
      combat.heroHp = Math.max(0, combat.heroHp - damage);
      hero.shakeUntil = performance.now() + 240;
      setPose(hero, 'recover');
      if (attacker === 'npc') {
        setPose(npc, 'hit');
      }
    }
    showHitFx(defender);
    setStatus(`${nameOf(attacker)} 命中，造成 ${damage} 伤害`);
  }

  combat.turnState = 'resolved';
  combat.isCounterAttack = false;

  window.setTimeout(() => {
    if (combat.npcHp <= 0 || combat.heroHp <= 0) {
      combat.winner = combat.npcHp > combat.heroHp ? 'npc' : 'hero';
      if (combat.winner === 'hero') {
        setPose(hero, 'victory');
        setPose(npc, 'defeat');
      }
      setStatus(`${nameOf(combat.winner)} 获胜`);
      refreshTurnHint();
      return;
    }

    if (attacker === 'hero') {
      setPose(hero, 'recover');
      setPose(npc, 'idle');
    } else {
      setPose(npc, 'idle');
      setPose(hero, 'idle');
    }

    window.setTimeout(() => {
      if (combat.turnState === 'resolved') {
        setPose(hero, 'idle');
        setPose(npc, 'idle');
        swapTurn();
      }
    }, 150);
  }, 240);
}

function swapTurn(): void {
  combat.counterWindowFor = null;
  combat.counterWindowEndsAt = 0;
  combat.counterFromAttacker = null;
  combat.isCounterAttack = false;
  combat.chargeEndsAt = 0;
  combat.swingEndsAt = 0;
  combat.attacker = combat.attacker === 'hero' ? 'npc' : 'hero';
  combat.turnState = 'ready';
  combat.turnDeadlineMs = performance.now() + CONFIG.turnLimitMs;
  combat.turnTimeLeftMs = CONFIG.turnLimitMs;

  if (combat.attacker === 'hero') {
    combat.round += 1;
  }

  refreshTurnHint();
  planAiTurnIfNeeded();
}

function finishTurnWithoutAttack(): void {
  combat.turnState = 'resolved';
  combat.chargeEndsAt = 0;
  combat.swingEndsAt = 0;
  setPose(hero, 'idle');
  setPose(npc, 'idle');
  window.setTimeout(() => {
    swapTurn();
  }, 160);
}

function planAiTurnIfNeeded(): void {
  if (combat.attacker !== 'npc') {
    return;
  }

  const now = performance.now();
  const prepareAt = now + randInt(260, 780);
  const holdMs = randInt(CONFIG.aiPrepareMinMs, CONFIG.aiPrepareMaxMs);
  const fake = Math.random() < CONFIG.aiFakeChance;

  pendingAi = {
    prepareAt,
    attackAt: prepareAt + holdMs,
    fakeReleaseAt: fake ? prepareAt + Math.floor(holdMs * 0.45) : 0,
    dodgeAt: 0,
    counterAt: 0,
    dodgeCommitted: false,
  };
}

function updateAi(now: number): void {
  if (combat.counterWindowFor === 'npc' && combat.turnState === 'ready') {
    if (pendingAi.counterAt && now >= pendingAi.counterAt) {
      pendingAi.counterAt = 0;
      triggerAttack('npc', true);
      return;
    }
  }

  if (combat.attacker === 'npc' && combat.turnState === 'ready') {
    if (pendingAi.prepareAt && now >= pendingAi.prepareAt) {
      setPose(npc, 'prepare');
      pendingAi.prepareAt = 0;
    }

    if (pendingAi.fakeReleaseAt && now >= pendingAi.fakeReleaseAt) {
      setPose(npc, 'idle');
      pendingAi.fakeReleaseAt = 0;
      pendingAi.attackAt = now + randInt(320, 760);
      return;
    }

    if (pendingAi.attackAt && now >= pendingAi.attackAt) {
      triggerAttack('npc');
      pendingAi.attackAt = 0;
    }
  }

  if (combat.attacker === 'hero' && combat.turnState === 'swinging') {
    if (!pendingAi.dodgeCommitted && pendingAi.dodgeAt && now >= pendingAi.dodgeAt) {
      pendingAi.dodgeCommitted = true;
      tryDodge('npc', now);
    }
  }
}

function animateTransient(now: number, deltaMs: number): void {
  updateFighterTransform(hero, now);
  updateFighterTransform(npc, now);

  if (attackCue.alpha > 0) {
    attackCue.alpha = Math.max(0, attackCue.alpha - deltaMs * 0.0052);
    attackCue.scale.set(attackCue.scale.x + deltaMs * 0.0014);
  }

  if (hitBurst.alpha > 0) {
    hitBurst.alpha = Math.max(0, hitBurst.alpha - deltaMs * 0.005);
    hitBurst.scale.set(hitBurst.scale.x + deltaMs * 0.0022);
  }

  if (speedLines.alpha > 0) {
    speedLines.alpha = Math.max(0, speedLines.alpha - deltaMs * 0.006);
  }

  if (speedLineUntil > now) {
    speedLines.alpha = 0.45;
  }

  if (sceneShakeMs > 0) {
    sceneShakeMs = Math.max(0, sceneShakeMs - deltaMs);
    const strength = sceneShakeMs > 60 ? 6 : 3;
    sceneLayer.x = (Math.random() - 0.5) * strength;
    faceLayer.x = sceneLayer.x;
    fxLayer.x = sceneLayer.x;
  } else {
    sceneLayer.x = 0;
    faceLayer.x = 0;
    fxLayer.x = 0;
  }
}

function updateFighterTransform<TPose extends Pose>(fighter: FighterVisual<TPose>, now: number): void {
  let scale = fighter.baseScale;
  let y = fighter.baseY;
  let rotation = 0;
  if (combat.turnState === 'ready' && combat.attacker === fighter.side && fighter.currentPose === 'prepare') {
    scale *= CONFIG.attackerHoldScale;
  }

  let x = fighter.baseX + dodgeOffset[fighter.side];
  if (lungeUntil[fighter.side] > now) {
    const remainRatio = (lungeUntil[fighter.side] - now) / 220;
    const lungeDistance = fighter.side === 'hero' ? CONFIG.heroLungeDistance : CONFIG.npcLungeDistance;
    const strength = Math.sin((1 - remainRatio) * Math.PI) * lungeDistance;
    x += fighter.side === 'hero' ? -strength : strength;
  }

  if (fighter.shakeUntil > now) {
    x += (Math.random() - 0.5) * 10;
  }

  if (fighter.side === 'hero' && fighter.currentPose === 'prepare') {
    x -= 10;
    y += 8;
    rotation = -0.055;
  }

  if (fighter.side === 'hero' && fighter.currentPose === 'attack') {
    x -= 120;
    y += 4;
    rotation = -0.02;
  }

  if (fighter.side === 'npc' && fighter.currentPose === 'charge') {
    x += 42;
    y += 4;
    rotation = 0.02;
  }

  if (fighter.side === 'npc' && fighter.currentPose === 'attack') {
    x += 110;
    y += 4;
    rotation = 0.024;
  }

  fighter.container.position.set(x, y);
  fighter.container.scale.set(scale);
  fighter.container.rotation = rotation;
}

function updateNpcFaceOverlay(now: number): void {
  const showPopup = facePopupUntil > now && combat.npcHp > 0;
  for (const [key, sprite] of Object.entries(npcFaceSprites)) {
    sprite.visible = showPopup && Number(key) === facePopupLevel;
    if (sprite.visible) {
      const remainRatio = Math.max(0, facePopupUntil - now) / 520;
      sprite.alpha = 0.56 + remainRatio * 0.38;
    }
  }
}

function drawSpeedLines(): void {
  speedLines.clear();
  const centerX = CONFIG.width * 0.53;
  const centerY = CONFIG.height * 0.36;

  for (let index = 0; index < 22; index += 1) {
    const angle = (-0.55 + (1.1 * index) / 21) * Math.PI;
    const innerR = 170;
    const outerR = 690;
    const x1 = centerX + Math.cos(angle) * innerR;
    const y1 = centerY + Math.sin(angle) * innerR;
    const x2 = centerX + Math.cos(angle) * outerR;
    const y2 = centerY + Math.sin(angle) * outerR;
    speedLines.moveTo(x1, y1).lineTo(x2, y2).stroke({ color: 0xffffff, width: 2, alpha: 0.18 });
  }
}

function showHitFx(defender: Side): void {
  const target = defender === 'npc' ? npc : hero;
  const centerX = target.container.x + (defender === 'npc' ? 105 : -85);
  const centerY = target.container.y - 530;

  attackCue.position.set(centerX, centerY - 110);
  attackCue.alpha = 1;
  attackCue.scale.set(0.78);

  hitBurst.clear();
  hitBurst.circle(centerX, centerY, 55).fill({ color: 0xff6c9d, alpha: 0.88 });
  hitBurst.circle(centerX, centerY, 110).stroke({ color: 0xffc4d6, width: 8, alpha: 0.9 });
  hitBurst.alpha = 1;
  hitBurst.scale.set(1);

  sceneShakeMs = 120;
}

function refreshTurnHint(): void {
  if (combat.winner) {
    (el.zonePhase as HTMLDivElement).textContent = 'VICTORY';
    (el.zoneHint as HTMLDivElement).textContent = `${nameOf(combat.winner)}赢下本局`;
    return;
  }

  if (combat.counterWindowFor) {
    (el.zonePhase as HTMLDivElement).textContent = 'COUNTER';
    (el.zoneHint as HTMLDivElement).textContent =
      combat.counterWindowFor === 'hero' ? '按住抬手后左/上滑反击' : '对手可能反击，准备防守';
    return;
  }

  if (combat.turnState === 'charging') {
    (el.zonePhase as HTMLDivElement).textContent = 'CHARGE';
    (el.zoneHint as HTMLDivElement).textContent = '已锁定出手，不可取消';
    return;
  }

  if (combat.turnState === 'swinging') {
    (el.zonePhase as HTMLDivElement).textContent = 'SWING';
    (el.zoneHint as HTMLDivElement).textContent =
      combat.attacker === 'npc' ? '立刻右/下滑躲避' : '挥击中';
    return;
  }

  if (combat.attacker === 'hero') {
    (el.zonePhase as HTMLDivElement).textContent = 'ATTACK TURN';
    (el.zoneHint as HTMLDivElement).textContent = '按住抬手，左/上滑攻击';
    setStatus('你的回合：按住抬手，可松开取消');
  } else {
    (el.zonePhase as HTMLDivElement).textContent = 'DEFENSE TURN';
    (el.zoneHint as HTMLDivElement).textContent = '右滑/下滑躲避对手攻击';
    setStatus('对手回合：观察前摇，攻击瞬间右/下滑');
  }
}

function updateUI(): void {
  const npcRatio = Math.max(0, combat.npcHp / CONFIG.maxHp);
  const heroRatio = Math.max(0, combat.heroHp / CONFIG.maxHp);

  (el.npcHp as HTMLDivElement).style.width = `${Math.round(npcRatio * 100)}%`;
  (el.heroHp as HTMLDivElement).style.width = `${Math.round(heroRatio * 100)}%`;

  (el.npcHpText as HTMLDivElement).textContent = `${combat.npcHp}/${CONFIG.maxHp}`;
  (el.heroHpText as HTMLDivElement).textContent = `${combat.heroHp}/${CONFIG.maxHp}`;
  (el.roundValue as HTMLSpanElement).textContent = String(combat.round);
  (el.zoneTime as HTMLDivElement).textContent = (combat.turnTimeLeftMs / 1000).toFixed(1);
}

function setStatus(text: string): void {
  (el.statusLine as HTMLDivElement).textContent = text;
}

function nameOf(side: Side): string {
  return side === 'hero' ? '你' : '对手';
}

function attackerName(): string {
  return nameOf(combat.attacker);
}

function getBaseFighterScale(): number {
  return (CONFIG.height * CONFIG.fighterTargetScreenHeightRatio) / CONFIG.fighterAlphaBoxHeight;
}

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

async function loadAllTextures(): Promise<{
  hero: Record<HeroPose, Texture>;
  npc: Record<NpcPose, Texture>;
  npcFace: Texture[];
}> {
  const hero = {
    idle: await loadTexture('/assets/characters/player/idle.png'),
    prepare: await loadTexture('/assets/characters/player/prepare.png'),
    attack: await loadTexture('/assets/characters/player/attack.png'),
    recover: await loadTexture('/assets/characters/player/recover.png'),
    dodge: await loadTexture('/assets/characters/player/dodge.png'),
    victory: await loadTexture('/assets/characters/player/victory.png'),
  } satisfies Record<HeroPose, Texture>;

  const npc = {
    idle: await loadTexture('/assets/characters/npc/idle.png'),
    prepare: await loadTexture('/assets/characters/npc/prepare.png'),
    charge: await loadTexture('/assets/characters/npc/charge.png'),
    attack: await loadTexture('/assets/characters/npc/attack.png'),
    hit: await loadTexture('/assets/characters/npc/hit.png'),
    miss: await loadTexture('/assets/characters/npc/miss.png'),
    dodge: await loadTexture('/assets/characters/npc/dodge.png'),
    hurt: await loadTexture('/assets/characters/npc/hurt.png'),
    defeat: await loadTexture('/assets/characters/npc/defeat.png'),
  } satisfies Record<NpcPose, Texture>;

  const npcFace = [
    await loadTexture('/assets/characters/npc_face/face_0.png'),
    await loadTexture('/assets/characters/npc_face/face_1.png'),
    await loadTexture('/assets/characters/npc_face/face_2.png'),
    await loadTexture('/assets/characters/npc_face/face_3.png'),
  ];

  return { hero, npc, npcFace };
}

function startCounterWindow(counterSide: Side, fromAttacker: Side): void {
  const now = performance.now();
  combat.turnState = 'ready';
  combat.chargeEndsAt = 0;
  combat.swingEndsAt = 0;
  combat.attacker = counterSide;
  combat.counterWindowFor = counterSide;
  combat.counterWindowEndsAt = now + CONFIG.counterWindowMs;
  combat.counterFromAttacker = fromAttacker;
  combat.isCounterAttack = false;
  combat.turnDeadlineMs = combat.counterWindowEndsAt;
  combat.turnTimeLeftMs = CONFIG.counterWindowMs;
  combat.dodgeSuccessBuff[counterSide] = 1.35;

  if (counterSide === 'hero') {
    setPose(hero, 'dodge');
    setStatus('完美躲避！立即左/上滑反击');
  } else {
    setPose(npc, 'dodge');
    setStatus('对手躲避成功，可能会立刻反击');
    pendingAi.counterAt = now + randInt(130, 280);
  }

  refreshTurnHint();
}

function expireCounterWindow(): void {
  const side = combat.counterWindowFor;
  if (!side) {
    return;
  }

  combat.counterWindowFor = null;
  combat.counterWindowEndsAt = 0;
  combat.counterFromAttacker = null;
  combat.turnDeadlineMs = performance.now() + CONFIG.turnLimitMs;
  combat.turnTimeLeftMs = CONFIG.turnLimitMs;
  pendingAi.counterAt = 0;

  if (side === 'hero') {
    setPose(hero, 'idle');
    setStatus('反击窗口结束，进入普通攻击回合');
  } else {
    setPose(npc, 'idle');
    setStatus('对手错过反击，进入普通回合');
    planAiTurnIfNeeded();
  }
  refreshTurnHint();
}

async function loadTexture(path: string): Promise<Texture> {
  try {
    return await Assets.load(path) as Texture;
  } catch (error) {
    console.error(`Texture load failed: ${path}`, error);
    return Texture.WHITE;
  }
}
