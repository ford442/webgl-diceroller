import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { VignetteShader } from './shaders/VignetteShader.js';

import { initPhysics, stepPhysics, createFloorAndWalls } from './physics.js';
import { diceTypes, diceModels, loadDiceModels, spawnObjects, updateDiceVisuals, updateDiceSet, throwDice, spawnedDice } from './dice.js';
import { initUI, createCrosshair } from './ui.js';
import { initInteraction, updateInteraction, registerInteractiveObject, isDragging, isHoveringOverDice } from './interaction.js';
import { createTable } from './environment/Table.js';
import { createTavernWalls } from './environment/TavernWalls.js';
import { createBookshelf } from './environment/Bookshelf.js';
import { createRoom } from './environment/Room.js';
import { createChair } from './environment/Chair.js';
import { createChest } from './environment/Chest.js';
import { createClutter } from './environment/Clutter.js';
import { createTavernMeal } from './environment/TavernMeal.js';
import { createDagger } from './environment/Dagger.js';
import { createShield } from './environment/Shield.js';
import { createBell } from './environment/Bell.js';
import { createBattleAxe } from './environment/BattleAxe.js';
import { createDiceBag } from './environment/DiceBag.js';
import { createHourglass } from './environment/Hourglass.js';
import { createAtmosphere, updateAtmosphere } from './environment/Atmosphere.js';
import { createLamp, LampMode } from './environment/Lamp.js';
import { createRug } from './environment/Rug.js';
import { createMap } from './environment/Map.js';
import { createCrystalBall } from './environment/CrystalBall.js';
import { createDiceTower } from './environment/DiceTower.js';
import { createDiceJail } from './environment/DiceJail.js';
import { createPotionSet } from './environment/PotionSet.js';
import { createSkull } from './environment/Skull.js';
import { createPocketWatch } from './environment/PocketWatch.js';
import { createScroll } from './environment/Scroll.js';
import { createMerchantScale } from './environment/MerchantScale.js';
import { createCompass } from './environment/Compass.js';
import { createSpellbook } from './environment/Spellbook.js';
import { createChalice } from './environment/Chalice.js';
import { createMiniature } from './environment/Miniature.js';
import { createCharacterSheet } from './environment/CharacterSheet.js';
import { createPencil } from './environment/Pencil.js';
import { createCoinPouch } from './environment/CoinPouch.js';
import { createLantern } from './environment/Lantern.js';
import { createLute } from './environment/Lute.js';
import { createRunestones } from './environment/Runestones.js';
import { createSmokingPipe } from './environment/SmokingPipe.js';
import { createGemstones } from './environment/Gemstones.js';
import { createWritingSet } from './environment/WritingSet.js';
import { createCheeseWheel } from './environment/CheeseWheel.js';
import { createFloatingCandles } from './environment/FloatingCandles.js';
import { createRunecircle } from './environment/Runecircle.js';
import { createMug } from './environment/Mug.js';
import { createTankard } from './environment/Tankard.js';
import { createWaxSeal } from './environment/WaxSeal.js';
import { createCrown } from './environment/Crown.js';
import { createGong } from './environment/Gong.js';
import { createMysticOrb } from './environment/MysticOrb.js';
import { createDMScreen } from './environment/DMScreen.js';
import { createDragonScale } from './environment/DragonScale.js';
import { createSpyglass } from './environment/Spyglass.js';
import { createPlayingCards } from './environment/PlayingCards.js';
import { createKey } from './environment/Key.js';
import { createDrinkingHorn } from './environment/DrinkingHorn.js';
import { createWand } from './environment/Wand.js';
import { createCoin } from './environment/Coin.js';
import { createBountyPoster } from './environment/BountyPoster.js';
import { createTarotDeck } from './environment/TarotDeck.js';
import { createAmulet } from './environment/Amulet.js';
import { createDiceTray } from './environment/DiceTray.js';
import { createAbacus } from './environment/Abacus.js';
import { createLeatherJournal } from './environment/LeatherJournal.js';
import { createPadlock } from './environment/Padlock.js';
import { createSpectacles } from './environment/Spectacles.js';
import { createLockpicks } from './environment/Lockpicks.js';
import { createDart } from './environment/Dart.js';
import { createMagnifyingGlass } from './environment/MagnifyingGlass.js';
import { TavernEnvironment } from './environment/TavernEnvironment.js';

let camera, scene, renderer, composer;
let physicsWorld;
let clock;
let ui, crosshairUI;
let pointLight; // Exposed for flickering
let fireplaceLight; // Fireplace light
let candleFlamePos; // Position of the candle flame
let lampData; // Lamp reference for key handling and rolling state
let gongData; // Gong reference for flash intensity
let gongFlashIntensity = 0; // Screen flash from gong

// Update registry - centralizes all per-frame update functions
const updateRegistry = {
    updates: [],
    register(name, fn) { this.updates.push({ name, fn }); },
    runAll(deltaTime, time) {
        for (const { fn } of this.updates) fn(deltaTime, time);
    }
};
let velocity = new THREE.Vector3();
let isOnGround = true;
const moveSpeed = 5; // Units per second
const jumpForce = 8;
const gravity = -20; // Downward acceleration

// Camera Control Variables
let yaw = 0;
let pitch = 0;
const maxPitch = Math.PI / 2 - 0.1;
const keys = {};

// "Eye-Head" Cursor Logic
let cursorPos = new THREE.Vector2(0, 0); // Pixel coordinates relative to center
let isLocked = false;
let interaction; // Interaction handler

// Dice Focus Logic
const DiceFocusState = {
    IDLE: 'IDLE',
    WAITING_FOR_STOP: 'WAITING_FOR_STOP',
    FOCUSING: 'FOCUSING',
    HOLDING: 'HOLDING',
    RETURNING: 'RETURNING'
};
let diceFocusState = DiceFocusState.IDLE;
let focusTimer = 0;
let savedCameraState = { position: new THREE.Vector3(), rotation: new THREE.Euler() };
let focusTargetPosition = new THREE.Vector3();
let focusStartPos = new THREE.Vector3();
let focusStartRot = new THREE.Quaternion();
let focusEndRot = new THREE.Quaternion();
let focusProgress = 0;

init();

async function init() {
    // Get canvas container
    const container = document.getElementById('canvas-container');
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111); // Darker for atmosphere

    // Camera setup - 1:1 aspect ratio
    camera = new THREE.PerspectiveCamera(80, 1, 0.1, 1000);
    camera.position.set(0, 6.0, 18); // Standing height proportional to room
    camera.lookAt(0, -3, 0);

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap pixel ratio for performance
    renderer.setSize(containerWidth, containerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8; // Darker exposure for mood
    container.appendChild(renderer.domElement);

    // Lights
    // Ambient light (low intensity)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.05); // Very low ambient to make candle pop
    scene.add(ambientLight);

    // Warm PointLight (Candle) - Key Light
    // Initial setup, position will be updated by clutter
    // Deeper orange/red for a warmer, cozier feel (0xff9933)
    pointLight = new THREE.PointLight(0xff9933, 2.5, 20);
    pointLight.position.set(3, 6, 3); // Default if no candle
    pointLight.castShadow = true;
    pointLight.shadow.bias = -0.001; // Adjusted bias to prevent acne
    pointLight.shadow.mapSize.width = 1024;
    pointLight.shadow.mapSize.height = 1024;
    pointLight.shadow.radius = 5; // Softer shadows
    pointLight.shadow.camera.near = 0.5;
    pointLight.shadow.camera.far = 15;
    scene.add(pointLight);

    // Cool SpotLight (Moonlight) - Shining through the window
    // More blue, lower intensity for contrast (0x4444dd)
    const spotLight = new THREE.SpotLight(0x4444dd, 5.0);
    spotLight.position.set(-45, 15, -5); // Outside the window
    spotLight.target.position.set(0, -3, 0); // Aim at table center
    spotLight.angle = Math.PI / 10;
    spotLight.distance = 100;
    spotLight.penumbra = 0.5;
    spotLight.castShadow = true;
    spotLight.shadow.bias = -0.0001;
    spotLight.shadow.mapSize.width = 1024;
    spotLight.shadow.mapSize.height = 1024;
    scene.add(spotLight);
    scene.add(spotLight.target);

    // Fog for depth
    scene.fog = new THREE.FogExp2(0x111111, 0.02);

    // Post-Processing
    const params = new URLSearchParams(window.location.search);
    if (!params.has('no-post')) {
        composer = new EffectComposer(renderer);

        const renderPass = new RenderPass(scene, camera);
        composer.addPass(renderPass);

        // Bloom
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(containerWidth, containerHeight), 1.5, 0.4, 0.85);
        bloomPass.threshold = 0.6; // High threshold to only catch flames/lights
        bloomPass.strength = 0.6; // Soft glow
        bloomPass.radius = 0.4;
        composer.addPass(bloomPass);

        // Vignette
        const vignettePass = new ShaderPass(VignetteShader);
        vignettePass.uniforms['offset'].value = 1.2;
        vignettePass.uniforms['darkness'].value = 1.8; // Darker vignette
        composer.addPass(vignettePass);

        // Output Pass
        const outputPass = new OutputPass();
        composer.addPass(outputPass);
    }

    // Environment Map
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const tavernEnvironment = new TavernEnvironment();
    await tavernEnvironment.load();
    scene.environment = pmremGenerator.fromScene(tavernEnvironment).texture;
    pmremGenerator.dispose();
    tavernEnvironment.dispose();

    // Helper to yield to browser between loading tiers
    const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));
    function updateLoadingBar(percent) {
        const bar = document.getElementById('loading-bar');
        if (bar) bar.style.width = percent + '%';
    }
    function updateLoadingText(text) {
        const el = document.getElementById('loading-text');
        if (el) el.textContent = text;
    }

    // ==========================================
    // TIER 0: Critical (must exist before first render)
    // ==========================================
    updateLoadingText("Initializing physics engine...");
    updateLoadingBar(10);

    // Initialize Physics
    try {
        physicsWorld = await initPhysics();
    } catch (e) {
        console.error("Failed to initialize physics", e);
        updateLoadingText("Error: Physics failed to load");
        return;
    }

    updateLoadingText("Building tavern environment...");
    updateLoadingBar(20);

    // Core environment (walls, room, table, candle light)
    const wallData = createTavernWalls(scene, physicsWorld);
    if (wallData) {
        if (wallData.fireplaceLight) fireplaceLight = wallData.fireplaceLight;
        if (wallData.update) updateRegistry.register('walls', wallData.update);
    }

    createRoom(scene);

    const tableConfig = createTable(scene);
    createFloorAndWalls(scene, physicsWorld, tableConfig);

    // Clutter & Candle (positions the key candle light)
    const clutterData = createClutter(scene, physicsWorld);

    // Tarot Deck scattered on the table
    createTarotDeck(scene, physicsWorld);
    if (clutterData) {
        if (clutterData.flamePosition) {
            candleFlamePos = clutterData.flamePosition;
            pointLight.position.copy(candleFlamePos);
            pointLight.position.y += 0.05;
        }
        if (clutterData.update) updateRegistry.register('clutter', clutterData.update);
    }

    updateLoadingText("Loading dice models...");
    updateLoadingBar(30);
    // Load dice models sequentially with granular progress (30% to 40%)
    await loadDiceModels((done, total, label) => {
        const percent = 30 + ((done / total) * 10);
        updateLoadingBar(percent);
        if (label) updateLoadingText(`Loading dice models... (${label})`);
    });
    spawnObjects(scene, physicsWorld);

    updateLoadingText("Setting up game...");
    updateLoadingBar(40);

    // UI Setup
    ui = initUI(
        (newCounts) => {
            updateDiceSet(scene, physicsWorld, newCounts);
        },
        () => {
            throwDice(scene, physicsWorld);
            diceFocusState = DiceFocusState.WAITING_FOR_STOP;
        }
    );
    crosshairUI = createCrosshair();

    // Interaction Setup
    interaction = initInteraction(camera, scene, physicsWorld);
    setupInput();

    clock = new THREE.Clock();

    // Expose for debugging/verification
    window.camera = camera;
    window.scene = scene;
    window.physicsWorld = physicsWorld;
    window.THREE = THREE;
    window.renderer = renderer;

    window.addEventListener('resize', onWindowResize);

    // Start rendering immediately after Tier 0 - scene is playable
    renderer.setAnimationLoop(animate);

    // ==========================================
    // TIER 1: Important (visible from default camera, yield first)
    // ==========================================
    updateLoadingText("Loading furniture and props...");
    await yieldToMain();
    updateLoadingBar(55);

    // Bookshelf (Background Prop)
    createBookshelf(scene, physicsWorld, { x: -18, y: -10, z: 0 }, Math.PI / 2);

    // Chairs (Background Props)
    createChair(scene, physicsWorld, { x: -14, y: -9.5, z: 6 }, Math.PI / 3);
    createChair(scene, physicsWorld, { x: 14, y: -9.5, z: -6 }, -Math.PI / 3);

    // Wooden Chest (Background Prop with enhanced materials)
    const chestData = createChest(scene, physicsWorld, { x: -10, y: -9.5, z: -18 }, Math.PI / 8);
    if (chestData && chestData.update) {
        updateRegistry.register('chest', chestData.update);
    }

    // Rug
    createRug(scene);

    // Atmosphere (Dust Motes)
    createAtmosphere(scene);

    // Billiard Lamp (async OBJ load)
    const lampResult = await createLamp(scene);
    lampResult.group.position.set(0, 13.5, 0);
    registerInteractiveObject(lampResult.group, lampResult.toggle);
    lampData = lampResult;
    updateRegistry.register('lamp', lampResult.update);

    // Floating Candles (Magical)
    const floatingCandlesData = createFloatingCandles(scene);
    if (floatingCandlesData && floatingCandlesData.update) {
        updateRegistry.register('floatingCandles', floatingCandlesData.update);
    }

    // Arcane Runecircle (Magical)
    const runecircleData = createRunecircle(scene);
    if (runecircleData && runecircleData.update) {
        updateRegistry.register('runecircle', runecircleData.update);
    }

    updateLoadingBar(70);

    // ==========================================
    // TIER 2: Secondary tabletop props - arranged around dice zone edges
    // Table is 36x36, dice zone is 16x16 in center (±8 from center)
    // Place decorations between x/z = ±9 and ±16 (edge zone)
    // ==========================================
    updateLoadingText("Adding tabletop items...");
    await yieldToMain();

    // Dice Tower - back edge
    createDiceTower(scene, physicsWorld, { x: 0, y: -3.0, z: -14 }, 0);

    // Dice Tray - front right
    createDiceTray(scene, physicsWorld, { x: 12, y: -2.75, z: 10 }, Math.PI / 6);

    // Dice Jail - back left corner
    createDiceJail(scene, physicsWorld, { x: -13, y: -2.75, z: -13 }, -Math.PI / 4);

    // Dice Bag - front left
    createDiceBag(scene, physicsWorld, { x: -10, y: -1.95, z: 12 }, Math.PI / 8);

    // Bell - front center edge
    createBell(scene, { x: 0, y: -2.75, z: 15 });

    // Tavern Meal (Tankard & Plate) - right edge
    createTavernMeal(scene, physicsWorld, { x: 14, y: -2.75, z: 5 }, -Math.PI / 6);

    // Hourglass - back right
    createHourglass(scene, physicsWorld, { x: 11, y: -1.75, z: -11 }, Math.PI / 12);

    // Map - left edge
    createMap(scene, physicsWorld, { x: -14, y: -2.75, z: 0 }, Math.PI / 3);

    // Sealed Scroll - front right
    createScroll(scene, physicsWorld, { x: 10, y: -2.4, z: 13 }, -Math.PI / 8);

    // Crystal Ball - back right corner
    createCrystalBall(scene, physicsWorld, { x: 13, y: -2.75, z: -13 }, 0);

    // Alchemist's Potion Set - left edge
    createPotionSet(scene, physicsWorld, { x: -13, y: -2.75, z: -6 }, Math.PI / 5);

    // Skull Prop (Interactive) - front left corner
    const skullData = createSkull(scene, physicsWorld, { x: -11, y: -2.4, z: 11 }, Math.PI / 6);
    if (skullData && skullData.toggleGlow) {
        registerInteractiveObject(skullData.group, skullData.toggleGlow);
    }

    // Merchant Scale - right edge
    const scaleData = createMerchantScale(scene, physicsWorld, { x: 14, y: -2.75, z: -3 }, -Math.PI / 4);
    if (scaleData && scaleData.update) {
        updateRegistry.register('scale', scaleData.update);
    }

    // Lantern Prop - back edge
    const lanternData = createLantern(scene, physicsWorld, { x: -6, y: -2.75, z: -14 }, 0);
    if (lanternData && lanternData.update) {
        updateRegistry.register('lantern', lanternData.update);
    }

    // Spellbook Prop - left edge
    createSpellbook(scene, physicsWorld, { x: -14, y: -2.35, z: 7 }, Math.PI / 2);

    // Mug Prop - front edge
    const mugData = createMug(scene, physicsWorld, { x: -5, y: -2.75, z: 14 }, Math.PI / 4);
    if (mugData && mugData.update) {
        updateRegistry.register('mug', mugData.update);
    }

    // Tankard Prop - right front
    const tankardData = createTankard(scene, physicsWorld, { x: 12, y: -2.75, z: 9 }, -Math.PI / 6);
    if (tankardData && tankardData.update) {
        updateRegistry.register('tankard', tankardData.update);
    }

    updateLoadingBar(85);

    // ==========================================
    // TIER 3: Background / decorative props - edges only
    // ==========================================
    updateLoadingText("Adding decorative items...");
    await yieldToMain();

    // Dagger - right front
    createDagger(scene, physicsWorld, { x: 13, y: -2.45, z: 11 }, Math.PI / 3);

    // Shield (Wall Mount) - on back wall
    createShield(scene, physicsWorld, { x: 0, y: 2, z: -24 }, 0);

    // Battle Axe (Leaning) - left back corner
    createBattleAxe(scene, physicsWorld, { x: -16, y: -6, z: -16 }, -Math.PI / 3);

    // Vintage Pocket Watch - right edge
    createPocketWatch(scene, physicsWorld, { x: 14, y: -2.65, z: 3 }, 0);

    // Compass Prop - front edge
    createCompass(scene, physicsWorld, { x: 7, y: -2.65, z: 14 }, Math.PI / 8);

    // Chalice Prop - back edge
    createChalice(scene, physicsWorld, { x: 6, y: -2.75, z: -13 }, 0);

    // Character Miniature Prop - left edge
    createMiniature(scene, physicsWorld, { x: -13, y: -2.75, z: -8 }, Math.PI / 4);

    // Character Sheet Prop - right edge
    createCharacterSheet(scene, physicsWorld, { x: 14, y: -2.75, z: 8 }, -Math.PI / 6);

    // Bounty Poster Prop - wall
    createBountyPoster(scene, physicsWorld, { x: -20, y: 4, z: -20 }, Math.PI / 4);

    // Pencil Prop - front edge
    createPencil(scene, physicsWorld, { x: -8, y: -2.75, z: 14 }, Math.PI / 5);

    // Coin Pouch Prop - front edge
    createCoinPouch(scene, physicsWorld, { x: 9, y: -2.75, z: 13 }, -Math.PI / 8);

    // Lute Prop (Tabletop) - left back
    createLute(scene, physicsWorld, { x: -14, y: -1.85, z: -10 }, Math.PI / 4);

    // Runestones Prop - right back
    createRunestones(scene, physicsWorld, { x: 12, y: -2.75, z: -12 }, -Math.PI / 12);

    // Smoking Pipe and Tobacco Pouch - front edge
    const pipeData = createSmokingPipe(scene, physicsWorld, { x: -4, y: -2.73, z: 14 }, Math.PI / 8);
    if (pipeData && pipeData.update) {
        updateRegistry.register('pipe', pipeData.update);
    }

    // Gemstones Collection - right edge
    const gemsData = createGemstones(scene, physicsWorld, { x: 14, y: -2.73, z: -8 }, -Math.PI / 12);
    if (gemsData && gemsData.update) {
        updateRegistry.register('gems', gemsData.update);
    }

    // Writing Set (Quill and Inkwell) - back edge
    const writingData = createWritingSet(scene, physicsWorld, { x: -10, y: -2.73, z: -14 }, Math.PI / 6);
    if (writingData && writingData.update) {
        updateRegistry.register('writing', writingData.update);
    }

    // Cheese Wheel Prop - left front
    createCheeseWheel(scene, physicsWorld, { x: -12, y: -2.75, z: 11 }, Math.PI / 4);

    // Wax Seal Stamp Prop - front edge
    createWaxSeal(scene, physicsWorld, { x: 4, y: -2.75, z: 14 }, 0);

    // Kings Crown Prop - back edge center
    createCrown(scene, physicsWorld, { x: 0, y: -2.75, z: -13 }, 0);

    // Gong Prop (Interactive) - back wall
    const gongResult = createGong(scene, physicsWorld, { x: 0, y: 0, z: -24 }, 0);
    if (gongResult) {
        registerInteractiveObject(gongResult.group, gongResult.interact);
        gongData = gongResult;
        updateRegistry.register('gong', gongResult.update);
    }

    // Mystic Orb Prop (Interactive) - right back corner
    const mysticOrbData = createMysticOrb(scene, physicsWorld, { x: 15, y: -2.75, z: -15 }, 0);
    if (mysticOrbData) {
        registerInteractiveObject(mysticOrbData.group, mysticOrbData.interact);
        updateRegistry.register('mysticOrb', mysticOrbData.update);
    }

    // Dungeon Master Screen - back edge
    createDMScreen(scene, physicsWorld, { x: 0, y: -2.75, z: -16 }, 0);

    // Dragon Scale Prop - left edge
    createDragonScale(scene, physicsWorld, { x: -14, y: -2.75, z: 0 }, Math.PI / 3);

    // Spyglass Prop - right edge
    createSpyglass(scene, physicsWorld, { x: 14, y: -2.75, z: 6 }, -Math.PI / 6);

    // Playing Cards Prop - scattered on front edge
    createPlayingCards(scene, physicsWorld, { x: -2, y: -2.75, z: 13 }, Math.PI / 8);

    // Old Rusty Key Prop - front edge
    createKey(scene, physicsWorld, { x: 10, y: -2.75, z: 13 }, Math.PI / 4);

    // Heavy Iron Padlock Prop - left edge
    createPadlock(scene, physicsWorld, { x: -14, y: -2.75, z: -4 }, Math.PI / 6);

    // Lockpicks Prop - near padlock
    createLockpicks(scene, physicsWorld, { x: -13, y: -2.75, z: -3 }, Math.PI / 8);

    // Spectacles Prop - front edge
    createSpectacles(scene, physicsWorld, { x: 3, y: -2.75, z: 14 }, 0);

    // Leather Journal Prop - back right
    createLeatherJournal(scene, physicsWorld, { x: 12, y: -2.5, z: -13 }, Math.PI / 5);

    // Drinking Horn Prop - right edge
    createDrinkingHorn(scene, physicsWorld, { x: 14, y: -2.75, z: 2 }, -Math.PI / 4);

    // Magic Wand Prop (Interactive) - left edge
    createWand(scene, physicsWorld, { x: -14, y: -2.70, z: 9 }, Math.PI / 3);

    // Scattered Coins Prop - scattered around edges
    createCoin(scene, physicsWorld, { x: 11, y: -2.75, z: 11 }, 0);

    // Amulet Prop - back edge
    createAmulet(scene, physicsWorld, { x: -8, y: -2.74, z: -14 }, Math.PI / 6);

    // Abacus Prop - right back
    createAbacus(scene, physicsWorld, { x: 13, y: -2.75, z: -10 }, -Math.PI / 8);

    // Dart Prop - front edge
    createDart(scene, physicsWorld, { x: 8, y: -2.75, z: 14 }, Math.PI / 4);

    // Magnifying Glass Prop - back edge
    createMagnifyingGlass(scene, physicsWorld, { x: 9, y: -2.75, z: -14 }, Math.PI / 3);

    updateLoadingText("Finalizing...");
    updateLoadingBar(95);

    // Disable castShadow on small decorative props to reduce shadow pass draw calls
    const noShadowNames = ['Dart', 'Bell', 'Pencil', 'Key', 'CoinPouch', 'Compass', 'WaxSeal',
        'PocketWatch', 'Dagger', 'PlayingCards', 'DragonScale', 'CharacterSheet', 'BountyPoster',
        'CheeseWheel', 'Runestones', 'Gemstones', 'WritingSet', 'CoinPouch',
        'SmokingPipe', 'Crown', 'Chalice', 'Miniature', 'Scroll', 'Coin', 'Amulet', 'Abacus', 'Padlock', 'Spectacles', 'Lockpicks', 'LeatherJournal', 'MagnifyingGlass'];
    scene.traverse(child => {
        if (child.isMesh) {
            let p = child.parent;
            let shouldDisableShadow = false;
            while(p && p !== scene) {
                if (p.name && noShadowNames.some(n => p.name.includes(n))) {
                    shouldDisableShadow = true;
                    break;
                }
                p = p.parent;
            }
            if (shouldDisableShadow) {
                child.castShadow = false;
            }
        }
    });

    // Fade out loading overlay
    updateLoadingText("Ready!");
    updateLoadingBar(100);
    await yieldToMain();
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.transition = 'opacity 0.5s';
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 500);
    }
}

function setupInput() {
    window.addEventListener('keydown', (event) => {
        keys[event.code] = true;
        if (event.code === 'KeyR') {
            throwDice(scene, physicsWorld);
            diceFocusState = DiceFocusState.WAITING_FOR_STOP;
            // Trigger lamp strobe/rolling effect
            if (lampData) {
                lampData.setRolling(true);
            }
        }
        // ESC to exit pointer lock / enter UI mode
        if (event.code === 'Escape') {
            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
        }
        // Lamp mode controls
        if (lampData) {
            lampData.handleKey(event.key);
        }
    });
    window.addEventListener('keyup', (event) => {
        keys[event.code] = false;
    });

    // Pointer Lock Request - only when not clicking on dice
    renderer.domElement.addEventListener('click', (event) => {
        if (!isLocked) {
            // Check if we clicked on a die
            const rect = getContainerRect();
            const relX = event.clientX - rect.left;
            const relY = event.clientY - rect.top;
            const normX = (relX / rect.width) * 2 - 1;
            const normY = -(relY / rect.height) * 2 + 1;
            
            // Only request pointer lock if we didn't hit a die
            // The mousedown handler will pick up the die
            setTimeout(() => {
                if (!isDragging() && diceFocusState === DiceFocusState.IDLE) {
                    renderer.domElement.requestPointerLock();
                }
            }, 50);
        }
    });

    document.addEventListener('pointerlockchange', () => {
        const wasLocked = isLocked;
        isLocked = document.pointerLockElement === renderer.domElement;
        crosshairUI.setVisible(isLocked);
        if (isLocked && !wasLocked) {
             // Reset cursor to center when locking
             cursorPos.set(0, 0);
        }
    });

    // Get container dimensions helper
    const getContainerRect = () => {
        const container = document.getElementById('canvas-container');
        return container ? container.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
    };

    // Mouse Movement Tracking for FPS camera AND normal interaction
    document.addEventListener('mousemove', (event) => {
        if (diceFocusState !== DiceFocusState.IDLE) return;

        if (isLocked) {
            // FPS mode: accumulate raw mouse movement for camera rotation
            cursorPos.x += event.movementX;
            cursorPos.y += event.movementY;
            // Note: rotation is applied in animate() loop, then cursorPos is reset
        } else {
            // Unlocked: Use coordinates relative to canvas container for dice interaction
            const rect = getContainerRect();
            const relX = event.clientX - rect.left;
            const relY = event.clientY - rect.top;
            const normX = (relX / rect.width) * 2 - 1;
            const normY = -(relY / rect.height) * 2 + 1;
            if (interaction) interaction.handleMove(normX, normY);
        }
    });

    // Pass clicks to interaction
    document.addEventListener('mousedown', (event) => {
        if (diceFocusState === DiceFocusState.IDLE) {
            if (isLocked) {
                // FPS mode: crosshair is always centered, shoot ray from center
                if (interaction) interaction.handleDown(0, 0);
            } else {
                // Unlocked: Allow clicking dice with coordinates relative to canvas
                const rect = getContainerRect();
                const relX = event.clientX - rect.left;
                const relY = event.clientY - rect.top;
                const normX = (relX / rect.width) * 2 - 1;
                const normY = -(relY / rect.height) * 2 + 1;
                if (interaction) interaction.handleDown(normX, normY);
            }
        }
    });

    document.addEventListener('mouseup', () => {
        // Always trigger handleUp so we can drop dice regardless of lock state
        if (interaction) interaction.handleUp();
    });
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    if (!container) return;
    
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    camera.aspect = 1; // Fixed 1:1 aspect ratio
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    if (composer) composer.setSize(width, height);
}

function checkDiceStability() {
    if (spawnedDice.length === 0) return true;
    let allStable = true;
    spawnedDice.forEach(d => {
        if (!d.body) return;
        const v = d.body.getLinearVelocity();
        const a = d.body.getAngularVelocity();

        // Calculate squared length manually to avoid Ammo.js missing method crashes
        const velSq = v.x() * v.x() + v.y() * v.y() + v.z() * v.z();
        const angSq = a.x() * a.x() + a.y() * a.y() + a.z() * a.z();

        // Increased threshold to 1.0 (squared) to account for physics resting micro-jitters
        if (velSq > 1.0 || angSq > 1.0) allStable = false;
    });

    // Update lamp rolling state when dice stop
    if (allStable && lampData && lampData.getMode() === LampMode.NORMAL) {
        lampData.setRolling(false);
    }
    
    return allStable;
}

function animate() {
    const deltaTime = clock.getDelta();
    const time = clock.getElapsedTime();

    // Step physics
    if (physicsWorld) {
        stepPhysics(physicsWorld, deltaTime);
        updateDiceVisuals();
        updateInteraction();
    }

    // Update Crosshair UI Position - always centered in FPS mode
    const container = document.getElementById('canvas-container');
    const rect = container ? container.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
    const screenCenterX = rect.width / 2;
    const screenCenterY = rect.height / 2;
    crosshairUI.updatePosition(screenCenterX, screenCenterY);

    // Update Atmosphere
    updateAtmosphere(time);

    // Run all registered update functions (clutter, walls, mug, chest, tankard,
    // scale, lantern, pipe, gems, writing, gong, mysticOrb, floatingCandles,
    // runecircle, lamp)
    updateRegistry.runAll(deltaTime, time);

    // Get gong flash intensity for screen effect
    if (gongData && gongData.getFlashIntensity) {
        gongFlashIntensity = gongData.getFlashIntensity();
    }

    // Candle Flicker
    if (pointLight && candleFlamePos) {
        // More organic flicker
        // 1. Low frequency breathing (wind drafts)
        const breathing = Math.sin(time * 2.0) * 0.2;
        // 2. High frequency flicker
        const flicker = (Math.random() - 0.5) * 0.3;

        pointLight.intensity = 2.5 + breathing + flicker;

        // Jitter position based on flicker intensity (flame moves when it flickers)
        const jitterAmount = 0.03;
        const jitterX = (Math.random() - 0.5) * jitterAmount;
        const jitterY = (Math.random() - 0.5) * jitterAmount * 0.5;
        const jitterZ = (Math.random() - 0.5) * jitterAmount;

        pointLight.position.set(
            candleFlamePos.x + jitterX,
            candleFlamePos.y + 0.1 + jitterY, // Slightly higher above wick
            candleFlamePos.z + jitterZ
        );
    }

    // Fireplace Flicker
    if (fireplaceLight) {
        // Slower, deeper flicker for a big fire
        const deepPulse = Math.sin(time * 3.0) * 0.5; // Slow breath
        const crackle = (Math.random() - 0.5) * 1.0; // Random intense crackle

        fireplaceLight.intensity = 5.0 + deepPulse + crackle;
    }

  
    // --- Camera & Movement Logic ---

    // Dice Focus State Machine
    if (diceFocusState === DiceFocusState.WAITING_FOR_STOP) {
        if (checkDiceStability()) {
            diceFocusState = DiceFocusState.FOCUSING;

            // Save current state
            savedCameraState.position.copy(camera.position);
            savedCameraState.rotation.copy(camera.rotation);

            // Calculate center
            const center = new THREE.Vector3();
            spawnedDice.forEach(d => center.add(d.mesh.position));
            if (spawnedDice.length > 0) center.divideScalar(spawnedDice.length);

            // Calculate Spread (Standard Deviation-ish) to determine camera distance
            let maxDist = 0;
            spawnedDice.forEach(d => {
                const dist = d.mesh.position.distanceTo(center);
                if (dist > maxDist) maxDist = dist;
            });

            // Dynamic camera offset:
            // Higher (y) and further back (z) if dice are spread out.
            // Base offset (0, 8, 4) + spread factor
            const zoomOut = Math.max(1, maxDist * 0.8);
            focusTargetPosition.copy(center).add(new THREE.Vector3(0, 8 + zoomOut, 4 + zoomOut));

            // Setup Tween
            focusStartPos.copy(camera.position);
            focusStartRot.setFromEuler(camera.rotation);

            // Calculate look rotation
            const dummyCam = camera.clone();
            dummyCam.position.copy(focusTargetPosition);
            dummyCam.lookAt(center);
            focusEndRot.copy(dummyCam.quaternion);

            focusProgress = 0;
        }
    } else if (diceFocusState === DiceFocusState.FOCUSING) {
        focusProgress += deltaTime * 2.0; // 0.5s transition
        if (focusProgress > 1) focusProgress = 1;

        // Slerp/Lerp
        camera.position.lerpVectors(focusStartPos, focusTargetPosition, focusProgress);
        camera.quaternion.slerpQuaternions(focusStartRot, focusEndRot, focusProgress);

        if (focusProgress === 1) {
            diceFocusState = DiceFocusState.HOLDING;
            focusTimer = 2.0; // Hold for 2s
        }
    } else if (diceFocusState === DiceFocusState.HOLDING) {
        focusTimer -= deltaTime;
        if (focusTimer <= 0) {
            diceFocusState = DiceFocusState.RETURNING;
            focusStartPos.copy(camera.position);
            focusStartRot.copy(camera.quaternion);

            focusTargetPosition.copy(savedCameraState.position);
            const dummyCam = camera.clone();
            dummyCam.rotation.copy(savedCameraState.rotation); // Euler to Quat
            focusEndRot.copy(dummyCam.quaternion);

            focusProgress = 0;
        }
    } else if (diceFocusState === DiceFocusState.RETURNING) {
        focusProgress += deltaTime * 2.0;
        if (focusProgress > 1) focusProgress = 1;

        camera.position.lerpVectors(focusStartPos, focusTargetPosition, focusProgress);
        camera.quaternion.slerpQuaternions(focusStartRot, focusEndRot, focusProgress);

        if (focusProgress === 1) {
            diceFocusState = DiceFocusState.IDLE;
            // Restore exact Euler to prevent gimbal issues or drift
            camera.rotation.copy(savedCameraState.rotation);
            // Sync pitch/yaw vars
            pitch = camera.rotation.x;
            yaw = camera.rotation.y;
        }
    }

    // Only allow player control if IDLE
    if (diceFocusState === DiceFocusState.IDLE) {
        // FPS Camera Logic - direct mouse-to-rotation mapping
        const turnSensitivity = 0.002; // Mouse sensitivity

        if (isLocked) {
            // Apply accumulated mouse movement directly to rotation
            // Mouse X controls yaw (left/right), Mouse Y controls pitch (up/down)
            yaw -= cursorPos.x * turnSensitivity;
            pitch -= cursorPos.y * turnSensitivity;
            
            // Reset cursor position since we've consumed the movement
            cursorPos.set(0, 0);

            // Clamp pitch to prevent flipping
            pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
        }

        // Movement logic
        const direction = new THREE.Vector3();
        if (keys['KeyW']) direction.z -= 1; // Back (towards camera) -> Forward
        if (keys['KeyS']) direction.z += 1; // Forward (away from camera) -> Backward
        if (keys['KeyA']) direction.x -= 1; // Left
        if (keys['KeyD']) direction.x += 1; // Right
        if (keys['Space'] && isOnGround) {
            velocity.y = jumpForce;
            isOnGround = false;
        }

        // Normalize direction and apply to velocity
        if (direction.length() > 0) {
            direction.normalize();
            // Rotate direction by camera yaw for forward/back relative to view
            direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
            velocity.x = direction.x * moveSpeed;
            velocity.z = direction.z * moveSpeed;
        } else {
            velocity.x = 0;
            velocity.z = 0;
        }

        // Apply gravity
        velocity.y += gravity * deltaTime;

        // Update position
        camera.position.add(velocity.clone().multiplyScalar(deltaTime));

    // Ground collision
    // 6.0 is the standing eye height relative to the floor.
    // (Floor Y = -9.5, Table Y = -3.0. Standing height ~15.5 units above floor -> -9.5 + 15.5 = 6.0)
        if (camera.position.y <= 6.0) {
            camera.position.y = 6.0;
            velocity.y = 0;
            isOnGround = true;
        }

        // Optional: Simple bounds to stay in room (adjust based on your room size)
        camera.position.x = Math.max(-18, Math.min(18, camera.position.x));
        camera.position.z = Math.max(-18, Math.min(18, camera.position.z));

        // Update camera rotation
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }

    if (composer) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}
