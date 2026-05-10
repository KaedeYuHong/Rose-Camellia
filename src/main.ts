import './style.css';
import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';

type Side = 'hero' | 'npc';
type TurnState = 'ready' | 'charging' | 'swinging' | 'resolved';
type SwipeDirection = 'up' | 'down' | 'left' | 'right' | 'none';
type ActionState = 'idle' | 'raiseCancelable' | 'chargeLocked' | 'swing' | 'followThrough' | 'dodge' | 'hit' | 'recover';
type HeroPose = 'idle' | 'prepare' | 'charge' | 'attackTransition' | 'attack' | 'dodge' | 'hit' | 'victory';
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

interface SideActionState {
  state: ActionState;
  until: number;
  durationMs: number;
  recoverFrom: 'dodge' | 'hit' | null;
}

const CONFIG = {
  width: 1080,
  height: 1920,
  maxHp: 200,
  baseDamage: 32,
  chargeWindowMinMs: 120,
  chargeWindowMaxMs: 180,
  swingWindowMs: 195,
  heroAttackTransitionMs: 90,
  counterWindowMs: 850,
  counterDamageMultiplier: 1.45,
  dodgeCooldownMs: 1000,
  turnLimitMs: 5000,
  aiPrepareMinMs: 380,
  aiPrepareMaxMs: 1700,
  aiFakeChance: 0.55,
  aiDodgeChance: 0.32,
  aiBaitedDodgeChance: 0.22,
  aiBaitedDodgeMinMs: 120,
  aiBaitedDodgeMaxMs: 260,
  aiReactionMinMs: 75,
  aiReactionMaxMs: 200,
  attackerHoldScale: 1,
  defenderDodgeShift: 72,
  minSwipeDistance: 42,
  fighterAlphaBoxHeight: 1512,
  fighterTargetScreenHeightRatio: 0.76,
  fighterBaseYRatio: 0.87,
  heroXRatio: 0.8,
  npcXRatio: 0.45,
  heroScaleMultiplier: 1.7,
  npcScaleMultiplier: 0.92,
  heroYOffset: 1500,
  npcYOffset: 140,
  heroLungeDistance: 230,
  npcLungeDistance: 220,
  speedLineDurationMs: 190,
  hitStopNormalMs: 220,
  hitStopCounterMs: 320,
  attackerRecoverNormalMs: 440,
  attackerRecoverCounterMs: 500,
  defenderRecoverNormalMs: 780,
  defenderRecoverCounterMs: 860,
  hitFlashAlpha: 0.6,
  hitFlashNormalMs: 120,
  hitFlashCounterMs: 150,
  shakeNormalMs: 140,
  shakeCounterMs: 220,
  shakeNormalStrength: 7,
  shakeCounterStrength: 12,
  followThroughHitMinMs: 440,
  followThroughHitMaxMs: 500,
  followThroughMissMinMs: 250,
  followThroughMissMaxMs: 350,
  hitHoldMinMs: 700,
  hitHoldMaxMs: 900,
  recoverMs: 220,
  dodgeRecoverMs: 200,
  fakeOutExtraCooldownMs: 280,
  fakeOutStaggerMs: 170,
  raisePulseAmplitude: 0.0035,
  raisePulseRate: 0.019,
};

const VIEWPORT_WIDTH = 560;
const VIEWPORT_HEIGHT = Math.round((VIEWPORT_WIDTH * CONFIG.height) / CONFIG.width);

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) {
  throw new Error('Missing #app element');
}

appRoot.innerHTML = `
<div id="game-viewport">
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
      <div id="zone-hint" class="zone-hint">按住后任意方向滑动：进攻出手 / 防守躲避</div>
    </div>

    <div id="status-line">你的回合：按住抬手，任意方向滑动出手</div>
    <button id="restart-btn" class="restart-btn" type="button" hidden>重新开始</button>
  </div>
</div>
`;

const el = {
  gameViewport: document.querySelector<HTMLDivElement>('#game-viewport'),
  gameRoot: document.querySelector<HTMLDivElement>('#game-root'),
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
  restartBtn: document.querySelector<HTMLButtonElement>('#restart-btn'),
};

for (const [key, value] of Object.entries(el)) {
  if (!value) {
    throw new Error(`Missing UI element: ${key}`);
  }
}

const app = new Application();
await app.init({
  width: VIEWPORT_WIDTH,
  height: VIEWPORT_HEIGHT,
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
const stageBackground = createStageBackground(textures.stageBackground);

const hero = createHero(textures.hero);
const npc = createNpc(textures.npc);
sceneLayer.addChild(stageBackground, npc.container, hero.container);

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

const screenFlash = new Graphics();
screenFlash.rect(0, 0, CONFIG.width, CONFIG.height).fill({ color: 0xffffff, alpha: 1 });
screenFlash.alpha = 0;
fxLayer.addChild(screenFlash);

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

const actionState: Record<Side, SideActionState> = {
  hero: { state: 'idle', until: 0, durationMs: 0, recoverFrom: null },
  npc: { state: 'idle', until: 0, durationMs: 0, recoverFrom: null },
};

let pointerDown = false;
let pointerStartX = 0;
let pointerStartY = 0;
let activePointerId = -1;
let heroAttackPoseSwitchAt = 0;
let sceneShakeMs = 0;
let sceneShakeStrength = CONFIG.shakeNormalStrength;
let speedLineUntil = 0;
let facePopupUntil = 0;
let facePopupLevel = 1;
let hitStopUntil = 0;
let screenFlashUntil = 0;
let screenFlashFadeMs = CONFIG.hitFlashNormalMs;
const dodgeOffset: Record<Side, number> = { hero: 0, npc: 0 };
const dodgeOffsetUntil: Record<Side, number> = { hero: 0, npc: 0 };
const lungeUntil: Record<Side, number> = { hero: 0, npc: 0 };

let pendingAi = {
  prepareAt: 0,
  attackAt: 0,
  fakeReleaseAt: 0,
  dodgeAt: 0,
  counterAt: 0,
  dodgeCommitted: false,
  baitDodgeAt: 0,
  baitCommitted: false,
};

layoutWorld();
applyViewportScale();
setupInput();
setupRestart();
updateUI();
refreshTurnHint();
planAiTurnIfNeeded();

window.addEventListener('resize', applyViewportScale);

app.ticker.add((ticker) => {
  const now = performance.now();
  const deltaMs = ticker.deltaMS;
  const inHitStop = now < hitStopUntil;

  if (combat.winner) {
    animateTransient(now, deltaMs, false);
    updateNpcFaceOverlay(now);
    updateUI();
    return;
  }

  combat.turnTimeLeftMs = Math.max(0, combat.turnDeadlineMs - now);

  if (!inHitStop) {
    if (combat.turnState === 'charging' && now >= combat.chargeEndsAt) {
      enterSwingPhase(now);
    }

    if (
      heroAttackPoseSwitchAt > 0 &&
      now >= heroAttackPoseSwitchAt &&
      combat.attacker === 'hero' &&
      combat.turnState === 'swinging' &&
      hero.currentPose === 'attackTransition'
    ) {
      setPose(hero, 'attack');
      heroAttackPoseSwitchAt = 0;
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

    updateActionStates(now);
    updateAi(now);
  }

  animateTransient(now, deltaMs, inHitStop);
  if (!inHitStop) {
    updateNpcFaceOverlay(now);
  }
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

function createStageBackground(texture: Texture): Sprite {
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5, 0.5);
  sprite.position.set(CONFIG.width * 0.5, CONFIG.height * 0.5);
  const scale = Math.max(CONFIG.width / texture.width, CONFIG.height / texture.height);
  sprite.scale.set(scale);
  sprite.alpha = 1;
  return sprite;
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

function applyViewportScale(): void {
  const viewport = el.gameViewport as HTMLDivElement;
  const root = el.gameRoot as HTMLDivElement;
  const viewportWidth = viewport.clientWidth;
  const viewportHeight = viewport.clientHeight;
  const scale = Math.min(viewportWidth / VIEWPORT_WIDTH, viewportHeight / VIEWPORT_HEIGHT);
  const offsetX = (viewportWidth - VIEWPORT_WIDTH * scale) * 0.5;
  const offsetY = (viewportHeight - VIEWPORT_HEIGHT * scale) * 0.5;
  root.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
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
    if (combat.winner) {
      return;
    }
    if (performance.now() < hitStopUntil) {
      return;
    }

    if (combat.attacker === 'hero' && combat.turnState !== 'ready') {
      return;
    }
    if (combat.attacker === 'npc' && combat.turnState !== 'ready' && combat.turnState !== 'swinging') {
      return;
    }

    pointerDown = true;
    activePointerId = event.pointerId;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;

    if (combat.attacker === 'hero') {
      setPose(hero, 'prepare');
      setActionState('hero', 'raiseCancelable');
      setStatus(
        combat.counterWindowFor === 'hero'
          ? '反击：按住后任意方向滑动出手'
          : '按住抬手，可松开取消；任意方向滑动出手',
      );
    } else {
      setStatus('防守中：按住后任意方向滑动躲避');
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
      setActionState('hero', 'idle');
      pendingAi.baitDodgeAt = 0;
      pendingAi.baitCommitted = false;
    }
  });

  root.addEventListener('pointercancel', () => {
    pointerDown = false;
    activePointerId = -1;
    if (combat.attacker === 'hero' && combat.turnState === 'ready') {
      setPose(hero, 'idle');
      setActionState('hero', 'idle');
      pendingAi.baitDodgeAt = 0;
      pendingAi.baitCommitted = false;
    }
  });

  root.addEventListener('pointermove', (event) => {
    if (combat.winner || !pointerDown || event.pointerId !== activePointerId) {
      return;
    }
    if (performance.now() < hitStopUntil) {
      return;
    }

    const direction = detectSwipe(pointerStartX, pointerStartY, event.clientX, event.clientY);
    if (direction === 'none') {
      return;
    }

    if (combat.attacker === 'hero' && combat.turnState === 'ready') {
      const isCounter = combat.counterWindowFor === 'hero';
      pointerDown = false;
      activePointerId = -1;
      triggerAttack('hero', isCounter);
      return;
    }

    if (
      combat.attacker === 'npc' &&
      (combat.turnState === 'swinging' || (combat.turnState === 'ready' && actionState.npc.state === 'raiseCancelable'))
    ) {
      tryDodge('hero', performance.now());
      pointerStartX = event.clientX;
      pointerStartY = event.clientY;
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
  const chargeWindowMs = randInt(CONFIG.chargeWindowMinMs, CONFIG.chargeWindowMaxMs);
  combat.turnState = 'charging';
  combat.chargeEndsAt = now + chargeWindowMs;
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
  pendingAi.baitCommitted = false;
  pendingAi.baitDodgeAt = 0;
  heroAttackPoseSwitchAt = 0;

  if (attacker === 'hero') {
    setPose(hero, 'charge');
    setActionState('hero', 'chargeLocked', chargeWindowMs);
    setActionState('npc', 'idle');
    setPose(npc, 'idle');
    setStatus(isCounter ? '反击蓄力中' : '蓄力中，已不可取消');
  } else {
    setPose(npc, 'charge');
    setActionState('npc', 'chargeLocked', chargeWindowMs);
    setActionState('hero', 'idle');
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
  setActionState(attacker, 'swing', Math.max(1, combat.swingEndsAt - now));

  if (attacker === 'hero') {
    setPose(hero, 'attackTransition');
    heroAttackPoseSwitchAt = Math.min(combat.swingEndsAt, now + CONFIG.heroAttackTransitionMs);
    setStatus(combat.isCounterAttack ? '反击挥击中' : '挥击中');
    if (!combat.isCounterAttack && Math.random() < CONFIG.aiDodgeChance) {
      pendingAi.dodgeAt = now + randInt(CONFIG.aiReactionMinMs, CONFIG.aiReactionMaxMs);
    } else {
      pendingAi.dodgeAt = 0;
    }
  } else {
    setPose(npc, 'attack');
    setStatus(combat.isCounterAttack ? '对手反击挥击中，任意方向滑动躲避' : '对手挥击中，任意方向滑动躲避');
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
  const fakedOut = !valid && combat.turnState === 'ready' && actionState[combat.attacker].state === 'raiseCancelable';

  if (side === 'hero') {
    setPose(hero, 'dodge');
  } else {
    setPose(npc, 'dodge');
  }

  dodgeOffset[side] = side === 'hero' ? 66 : -66;
  dodgeOffsetUntil[side] = now + 230;

  if (valid) {
    combat.dodgeSuccessThisAttack[side] = true;
    setActionState(side, 'dodge', 220);
    setStatus(`${nameOf(side)} 躲避成功`);
  } else if (fakedOut) {
    combat.dodgeCooldownUntil[side] += CONFIG.fakeOutExtraCooldownMs;
    setActionState(side, 'recover', CONFIG.fakeOutStaggerMs, 'dodge');
    setStatus(`${nameOf(side)} 被假动作骗到，出现短暂硬直`);
  } else {
    setActionState(side, 'dodge', 160);
    setStatus(`${nameOf(side)} 提前躲避，进入冷却`);
  }
}

function resolveAttack(): void {
  if (combat.turnState !== 'swinging') {
    return;
  }

  heroAttackPoseSwitchAt = 0;

  const attacker = combat.attacker;
  const defender: Side = attacker === 'hero' ? 'npc' : 'hero';
  const dodged = combat.dodgeSuccessThisAttack[defender];
  const isCounterHit = combat.isCounterAttack;

  const damageFactor = isCounterHit ? CONFIG.counterDamageMultiplier : 1;
  const damage = Math.round(CONFIG.baseDamage * combat.dodgeSuccessBuff[attacker] * damageFactor);
  combat.dodgeSuccessBuff[attacker] = 1;

  if (dodged) {
    const missFollowThroughMs = randInt(CONFIG.followThroughMissMinMs, CONFIG.followThroughMissMaxMs);
    combat.turnState = 'resolved';
    combat.isCounterAttack = false;
    if (attacker === 'npc') {
      setPose(npc, 'miss');
    } else {
      setPose(hero, 'attack');
    }
    setActionState(attacker, 'followThrough', missFollowThroughMs);
    setStatus(`${nameOf(defender)} 躲避成功`);
    window.setTimeout(() => {
      if (combat.turnState === 'resolved' && !combat.winner) {
        startCounterWindow(defender, attacker);
      }
    }, missFollowThroughMs);
    return;
  }

  if (defender === 'npc') {
    combat.npcHp = Math.max(0, combat.npcHp - damage);
    npc.shakeUntil = performance.now() + 240;
    setPose(npc, combat.npcHp <= 0 ? 'defeat' : 'hurt');
    if (attacker === 'hero') {
      setPose(hero, 'attack');
    }
  } else {
    combat.heroHp = Math.max(0, combat.heroHp - damage);
    hero.shakeUntil = performance.now() + 240;
    setPose(hero, 'hit');
    if (attacker === 'npc') {
      setPose(npc, 'hit');
    }
  }

  const hitStopMs = isCounterHit ? CONFIG.hitStopCounterMs : CONFIG.hitStopNormalMs;
  const attackerFollowThroughMs = randInt(CONFIG.followThroughHitMinMs, CONFIG.followThroughHitMaxMs);
  const defenderHitHoldMs = randInt(CONFIG.hitHoldMinMs, CONFIG.hitHoldMaxMs);
  hitStopUntil = performance.now() + hitStopMs;
  triggerScreenFlash(isCounterHit);
  showHitFx(defender, isCounterHit);
  setStatus(`${nameOf(attacker)} 命中，造成 ${damage} 伤害`);

  combat.turnState = 'resolved';
  combat.isCounterAttack = false;
  setActionState(attacker, 'followThrough', attackerFollowThroughMs + hitStopMs);
  setActionState(defender, 'hit', defenderHitHoldMs + hitStopMs);

  window.setTimeout(() => {
    if (combat.turnState !== 'resolved') {
      return;
    }
    setActionState(attacker, 'recover', CONFIG.recoverMs);
  }, hitStopMs + attackerFollowThroughMs);

  window.setTimeout(() => {
    if (combat.turnState !== 'resolved') {
      return;
    }
    enterRecoverState(defender, 'hit', CONFIG.recoverMs);
  }, hitStopMs + defenderHitHoldMs);

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

    if (combat.turnState === 'resolved') {
      setPose(hero, 'idle');
      setPose(npc, 'idle');
      swapTurn();
    }
  }, hitStopMs + defenderHitHoldMs + CONFIG.recoverMs);
}

function setupRestart(): void {
  (el.restartBtn as HTMLButtonElement).addEventListener('click', () => {
    restartBattle();
  });
}

function setActionState(side: Side, state: ActionState, durationMs = 0, recoverFrom: 'dodge' | 'hit' | null = null): void {
  actionState[side].state = state;
  actionState[side].recoverFrom = recoverFrom;
  actionState[side].durationMs = durationMs;
  actionState[side].until = durationMs > 0 ? performance.now() + durationMs : 0;
}

function enterRecoverState(side: Side, from: 'dodge' | 'hit', durationMs: number): void {
  if ((side === 'hero' && combat.heroHp <= 0) || (side === 'npc' && combat.npcHp <= 0)) {
    setActionState(side, 'idle');
    return;
  }

  setActionState(side, 'recover', durationMs, from);
  if (from === 'hit') {
    if (side === 'hero') {
      setPose(hero, 'hit');
    } else {
      setPose(npc, 'hurt');
    }
  } else {
    if (side === 'hero') {
      setPose(hero, 'dodge');
    } else {
      setPose(npc, 'dodge');
    }
  }
}

function updateActionStates(now: number): void {
  for (const side of ['hero', 'npc'] as Side[]) {
    const current = actionState[side];
    if (current.until <= 0 || now < current.until) {
      continue;
    }

    if (current.state === 'dodge') {
      enterRecoverState(side, 'dodge', CONFIG.dodgeRecoverMs);
      continue;
    }

    if (current.state === 'hit') {
      enterRecoverState(side, 'hit', CONFIG.recoverMs);
      continue;
    }

    if (current.state === 'recover') {
      setActionState(side, 'idle');
      if ((side === 'hero' && combat.heroHp <= 0) || (side === 'npc' && combat.npcHp <= 0)) {
        continue;
      }
      if (combat.turnState === 'ready' || combat.turnState === 'resolved') {
        if (side === 'hero') {
          setPose(hero, 'idle');
        } else {
          setPose(npc, 'idle');
        }
      }
      continue;
    }

    setActionState(side, 'idle');
  }
}

function swapTurn(): void {
  heroAttackPoseSwitchAt = 0;
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
  setActionState('hero', 'idle');
  setActionState('npc', 'idle');

  if (combat.attacker === 'hero') {
    combat.round += 1;
  }

  refreshTurnHint();
  planAiTurnIfNeeded();
}

function finishTurnWithoutAttack(): void {
  heroAttackPoseSwitchAt = 0;
  combat.turnState = 'resolved';
  combat.chargeEndsAt = 0;
  combat.swingEndsAt = 0;
  setPose(hero, 'idle');
  setPose(npc, 'idle');
  setActionState('hero', 'idle');
  setActionState('npc', 'idle');
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
    baitDodgeAt: 0,
    baitCommitted: false,
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
      setActionState('npc', 'raiseCancelable');
      pendingAi.prepareAt = 0;
    }

    if (pendingAi.fakeReleaseAt && now >= pendingAi.fakeReleaseAt) {
      setPose(npc, 'idle');
      setActionState('npc', 'idle');
      pendingAi.fakeReleaseAt = 0;
      pendingAi.attackAt = now + randInt(320, 760);
      return;
    }

    if (pendingAi.attackAt && now >= pendingAi.attackAt) {
      triggerAttack('npc');
      pendingAi.attackAt = 0;
    }
  }

  if (combat.attacker === 'hero' && combat.turnState === 'ready') {
    if (actionState.hero.state === 'raiseCancelable') {
      if (!pendingAi.baitCommitted && pendingAi.baitDodgeAt === 0 && Math.random() < CONFIG.aiBaitedDodgeChance) {
        pendingAi.baitDodgeAt = now + randInt(CONFIG.aiBaitedDodgeMinMs, CONFIG.aiBaitedDodgeMaxMs);
      }

      if (!pendingAi.baitCommitted && pendingAi.baitDodgeAt > 0 && now >= pendingAi.baitDodgeAt) {
        pendingAi.baitCommitted = true;
        pendingAi.baitDodgeAt = 0;
        tryDodge('npc', now);
      }
    } else {
      pendingAi.baitDodgeAt = 0;
      pendingAi.baitCommitted = false;
    }
  } else {
    pendingAi.baitDodgeAt = 0;
    pendingAi.baitCommitted = false;
  }

  if (combat.attacker === 'hero' && combat.turnState === 'swinging') {
    if (!pendingAi.dodgeCommitted && pendingAi.dodgeAt && now >= pendingAi.dodgeAt) {
      pendingAi.dodgeCommitted = true;
      tryDodge('npc', now);
    }
  }
}

function animateTransient(now: number, deltaMs: number, freezeFighterMotion: boolean): void {
  if (!freezeFighterMotion) {
    updateFighterTransform(hero, now);
    updateFighterTransform(npc, now);
  }

  if (attackCue.alpha > 0) {
    attackCue.alpha = Math.max(0, attackCue.alpha - deltaMs * 0.0026);
    attackCue.scale.set(attackCue.scale.x + deltaMs * 0.00095);
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

  if (screenFlashUntil > now) {
    const remain = screenFlashUntil - now;
    const ratio = Math.min(1, remain / screenFlashFadeMs);
    screenFlash.alpha = CONFIG.hitFlashAlpha * ratio;
  } else {
    screenFlash.alpha = 0;
  }

  if (sceneShakeMs > 0) {
    sceneShakeMs = Math.max(0, sceneShakeMs - deltaMs);
    const strength = sceneShakeMs > 70 ? sceneShakeStrength : Math.max(2, sceneShakeStrength * 0.45);
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
  if (now >= dodgeOffsetUntil[fighter.side]) {
    dodgeOffset[fighter.side] = 0;
  }

  const sideAction = actionState[fighter.side];
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

  if (sideAction.state === 'raiseCancelable') {
    const pulse = Math.sin(now * CONFIG.raisePulseRate);
    scale *= 1 + pulse * CONFIG.raisePulseAmplitude;
    y += pulse * 0.45;
    rotation += fighter.side === 'hero' ? -0.004 : 0.004;
  }

  if (sideAction.state === 'chargeLocked') {
    const chargePull = fighter.side === 'hero' ? -26 : 24;
    x += chargePull;
    scale *= 0.986;
    y += 10;
  }

  if (sideAction.state === 'swing') {
    x += fighter.side === 'hero' ? -42 : 42;
    rotation += fighter.side === 'hero' ? -0.03 : 0.03;
  }

  if (sideAction.state === 'followThrough') {
    x += fighter.side === 'hero' ? -54 : 54;
    y += 2;
  }

  if (sideAction.state === 'recover' && sideAction.durationMs > 0) {
    const progress = 1 - Math.max(0, sideAction.until - now) / sideAction.durationMs;
    const rebound = Math.sin(progress * Math.PI) * (sideAction.recoverFrom === 'hit' ? 18 : 12);
    x += fighter.side === 'hero' ? rebound * 0.45 : -rebound * 0.45;
    y += (1 - progress) * 8;
    rotation += fighter.side === 'hero' ? rebound * 0.0009 : -rebound * 0.0009;
  }

  if (fighter.side === 'hero' && fighter.currentPose === 'prepare') {
    x -= 10;
    y += 8;
    rotation += -0.055;
  }

  if (fighter.side === 'hero' && fighter.currentPose === 'charge') {
    x -= 22;
    y += 10;
    rotation += -0.08;
  }

  if (fighter.side === 'hero' && fighter.currentPose === 'attackTransition') {
    x -= 85;
    y += 6;
    rotation += -0.038;
  }

  if (fighter.side === 'hero' && fighter.currentPose === 'attack') {
    x -= 120;
    y += 4;
    rotation += -0.02;
  }

  if (fighter.side === 'hero' && fighter.currentPose === 'hit') {
    x += 22;
    y += 8;
    rotation += 0.07;
  }

  if (fighter.side === 'npc' && fighter.currentPose === 'charge') {
    x += 42;
    y += 4;
    rotation += 0.02;
  }

  if (fighter.side === 'npc' && fighter.currentPose === 'attack') {
    x += 110;
    y += 4;
    rotation += 0.024;
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

function showHitFx(defender: Side, isCounterHit: boolean): void {
  const target = defender === 'npc' ? npc : hero;
  const centerX = target.container.x + (defender === 'npc' ? 105 : -85);
  const centerY = target.container.y - 530;
  const scaleBoost = isCounterHit ? 1.28 : 1;
  const coreRadius = 55 * scaleBoost;
  const ringRadius = 112 * scaleBoost;
  const particleCount = isCounterHit ? 20 : 12;

  attackCue.position.set(centerX, centerY - 110);
  attackCue.alpha = 1;
  attackCue.scale.set(isCounterHit ? 0.92 : 0.78);

  hitBurst.clear();
  hitBurst.circle(centerX, centerY, coreRadius).fill({ color: 0xff6c9d, alpha: 0.9 });
  hitBurst.circle(centerX, centerY, ringRadius).stroke({ color: 0xffc4d6, width: 8, alpha: 0.92 });
  hitBurst.circle(centerX, centerY, 28 * scaleBoost).fill({ color: 0xffffff, alpha: 0.96 });

  for (let index = 0; index < particleCount; index += 1) {
    const angle = (Math.PI * 2 * index) / particleCount;
    const inner = 66 * scaleBoost + Math.random() * 16;
    const outer = inner + 28 + Math.random() * (isCounterHit ? 52 : 34);
    const sx = centerX + Math.cos(angle) * inner;
    const sy = centerY + Math.sin(angle) * inner;
    const ex = centerX + Math.cos(angle) * outer;
    const ey = centerY + Math.sin(angle) * outer;
    hitBurst.moveTo(sx, sy).lineTo(ex, ey).stroke({ color: 0xffffff, width: isCounterHit ? 3 : 2, alpha: 0.75 });
  }

  hitBurst.alpha = 1;
  hitBurst.scale.set(1);

  sceneShakeMs = isCounterHit ? CONFIG.shakeCounterMs : CONFIG.shakeNormalMs;
  sceneShakeStrength = isCounterHit ? CONFIG.shakeCounterStrength : CONFIG.shakeNormalStrength;
}

function triggerScreenFlash(isCounterHit: boolean): void {
  const fadeMs = isCounterHit ? CONFIG.hitFlashCounterMs : CONFIG.hitFlashNormalMs;
  screenFlashFadeMs = fadeMs;
  screenFlashUntil = performance.now() + fadeMs;
  screenFlash.alpha = CONFIG.hitFlashAlpha;
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
      combat.counterWindowFor === 'hero' ? '按住抬手后任意方向滑动反击' : '对手可能反击，准备防守';
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
      combat.attacker === 'npc' ? '立刻任意方向滑动躲避' : '挥击中';
    return;
  }

  if (combat.attacker === 'hero') {
    (el.zonePhase as HTMLDivElement).textContent = 'ATTACK TURN';
    (el.zoneHint as HTMLDivElement).textContent = '按住抬手，任意方向滑动攻击';
    setStatus('你的回合：按住抬手，可松开取消');
  } else {
    (el.zonePhase as HTMLDivElement).textContent = 'DEFENSE TURN';
    (el.zoneHint as HTMLDivElement).textContent = '按住后任意方向滑动躲避对手攻击';
    setStatus('对手回合：观察前摇，攻击瞬间任意方向滑动');
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
  (el.restartBtn as HTMLButtonElement).hidden = !combat.winner;
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

function restartBattle(): void {
  pointerDown = false;
  activePointerId = -1;
  heroAttackPoseSwitchAt = 0;
  sceneShakeMs = 0;
  sceneShakeStrength = CONFIG.shakeNormalStrength;
  speedLineUntil = 0;
  facePopupUntil = 0;
  facePopupLevel = 1;
  hitStopUntil = 0;
  screenFlashUntil = 0;
  screenFlashFadeMs = CONFIG.hitFlashNormalMs;
  dodgeOffset.hero = 0;
  dodgeOffset.npc = 0;
  dodgeOffsetUntil.hero = 0;
  dodgeOffsetUntil.npc = 0;
  lungeUntil.hero = 0;
  lungeUntil.npc = 0;

  attackCue.alpha = 0;
  hitBurst.alpha = 0;
  speedLines.alpha = 0;
  screenFlash.alpha = 0;
  sceneLayer.x = 0;
  faceLayer.x = 0;
  fxLayer.x = 0;

  combat.round = 1;
  combat.heroHp = CONFIG.maxHp;
  combat.npcHp = CONFIG.maxHp;
  combat.attacker = 'hero';
  combat.turnState = 'ready';
  combat.turnDeadlineMs = performance.now() + CONFIG.turnLimitMs;
  combat.turnTimeLeftMs = CONFIG.turnLimitMs;
  combat.chargeEndsAt = 0;
  combat.swingEndsAt = 0;
  combat.counterWindowFor = null;
  combat.counterWindowEndsAt = 0;
  combat.counterFromAttacker = null;
  combat.isCounterAttack = false;
  combat.dodgeCooldownUntil.hero = 0;
  combat.dodgeCooldownUntil.npc = 0;
  combat.dodgeSuccessBuff.hero = 1;
  combat.dodgeSuccessBuff.npc = 1;
  combat.dodgeSuccessThisAttack.hero = false;
  combat.dodgeSuccessThisAttack.npc = false;
  combat.winner = null;

  pendingAi = {
    prepareAt: 0,
    attackAt: 0,
    fakeReleaseAt: 0,
    dodgeAt: 0,
    counterAt: 0,
    dodgeCommitted: false,
    baitDodgeAt: 0,
    baitCommitted: false,
  };

  setPose(hero, 'idle');
  setPose(npc, 'idle');
  setActionState('hero', 'idle');
  setActionState('npc', 'idle');
  setStatus('新的回合开始：按住抬手，任意方向滑动出手');
  refreshTurnHint();
  planAiTurnIfNeeded();
  updateUI();
}

function getBaseFighterScale(): number {
  return (CONFIG.height * CONFIG.fighterTargetScreenHeightRatio) / CONFIG.fighterAlphaBoxHeight;
}

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

async function loadAllTextures(): Promise<{
  stageBackground: Texture;
  hero: Record<HeroPose, Texture>;
  npc: Record<NpcPose, Texture>;
  npcFace: Texture[];
}> {
  const stageBackground = await loadTexture('/assets/backgrounds/temp-design.jpg');

  const hero = {
    idle: await loadTexture('/assets/characters/player/00.png'),
    prepare: await loadTexture('/assets/characters/player/001.png'),
    charge: await loadTexture('/assets/characters/player/002.png'),
    attackTransition: await loadTexture('/assets/characters/player/003.png'),
    attack: await loadTexture('/assets/characters/player/004.png'),
    dodge: await loadTexture('/assets/characters/player/005.png'),
    hit: await loadTexture('/assets/characters/player/006.png'),
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

  return { stageBackground, hero, npc, npcFace };
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
    setActionState('hero', 'dodge', 210);
    setActionState('npc', 'followThrough', 240);
    setStatus('完美躲避！立即按住后任意方向滑动反击');
  } else {
    setPose(npc, 'dodge');
    setActionState('npc', 'dodge', 210);
    setActionState('hero', 'followThrough', 240);
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
    setActionState('hero', 'idle');
    setStatus('反击窗口结束，进入普通攻击回合');
  } else {
    setPose(npc, 'idle');
    setActionState('npc', 'idle');
    setStatus('对手错过反击，进入普通回合');
    planAiTurnIfNeeded();
  }
  refreshTurnHint();
}

async function loadTexture(path: string): Promise<Texture> {
  const resolvedPath = resolveAssetPath(path);
  try {
    return await Assets.load(resolvedPath) as Texture;
  } catch (error) {
    console.error(`Texture load failed: ${resolvedPath}`, error);
    return Texture.WHITE;
  }
}

function resolveAssetPath(path: string): string {
  if (/^(?:https?:)?\/\//.test(path) || path.startsWith('data:')) {
    return path;
  }

  const normalized = path.startsWith('/') ? path.slice(1) : path;
  return `${import.meta.env.BASE_URL}${normalized}`;
}
