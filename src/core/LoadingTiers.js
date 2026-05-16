import { loadDiceModels, spawnObjects, updateDiceSet, throwDice } from '../dice.js';
import { initUI, createCrosshair } from '../ui.js';
import { initResultsUI } from '../results.js';
import { initInteraction, registerInteractiveObject } from '../interaction.js';
import { createTable } from '../environment/Table.js';
import { createTavernWalls } from '../environment/TavernWalls.js';
import { createBookshelf } from '../environment/Bookshelf.js';
import { createDecorativeWalls } from '../environment/DecorativeWalls.js';
import { createRoom } from '../environment/Room.js';
import { createChair } from '../environment/Chair.js';
import { createChest } from '../environment/Chest.js';
import { createClutter } from '../environment/Clutter.js';
import { createTavernMeal } from '../environment/TavernMeal.js';
import { createDagger } from '../environment/Dagger.js';
import { createSword } from '../environment/Sword.js';
import { createShield } from '../environment/Shield.js';
import { createBell } from '../environment/Bell.js';
import { createBattleAxe } from '../environment/BattleAxe.js';
import { createDiceBag } from '../environment/DiceBag.js';
import { createHourglass } from '../environment/Hourglass.js';
import { createAtmosphere } from '../environment/Atmosphere.js';
import { createLamp, LampMode } from '../environment/Lamp.js';
import { createRug } from '../environment/Rug.js';
import { createMap } from '../environment/Map.js';
import { createCrystalBall } from '../environment/CrystalBall.js';
import { createDiceTower } from '../environment/DiceTower.js';
import { createDiceJail } from '../environment/DiceJail.js';
import { createPotionSet } from '../environment/PotionSet.js';
import { createSkull } from '../environment/Skull.js';
import { createPocketWatch } from '../environment/PocketWatch.js';
import { createScroll } from '../environment/Scroll.js';
import { createMerchantScale } from '../environment/MerchantScale.js';
import { createCompass } from '../environment/Compass.js';
import { createSpellbook } from '../environment/Spellbook.js';
import { createChalice } from '../environment/Chalice.js';
import { createMiniature } from '../environment/Miniature.js';
import { createCharacterSheet } from '../environment/CharacterSheet.js';
import { createPencil } from '../environment/Pencil.js';
import { createCoinPouch } from '../environment/CoinPouch.js';
import { createLantern } from '../environment/Lantern.js';
import { createLute } from '../environment/Lute.js';
import { createRunestones } from '../environment/Runestones.js';
import { createSmokingPipe } from '../environment/SmokingPipe.js';
import { createGemstones } from '../environment/Gemstones.js';
import { createCandelabra } from '../environment/Candelabra.js';
import { createWritingSet } from '../environment/WritingSet.js';
import { createCheeseWheel } from '../environment/CheeseWheel.js';
import { createFloatingCandles } from '../environment/FloatingCandles.js';
import { createRunecircle } from '../environment/Runecircle.js';
import { createMug } from '../environment/Mug.js';
import { createTankard } from '../environment/Tankard.js';
import { createWaxSeal } from '../environment/WaxSeal.js';
import { createCrown } from '../environment/Crown.js';
import { createHelmet } from '../environment/Helmet.js';
import { createApple } from '../environment/Apple.js';
import { createPocketFlask } from '../environment/PocketFlask.js';
import { createGong } from '../environment/Gong.js';
import { createMysticOrb } from '../environment/MysticOrb.js';
import { createDMScreen } from '../environment/DMScreen.js';
import { createDragonScale } from '../environment/DragonScale.js';
import { createSpyglass } from '../environment/Spyglass.js';
import { createPlayingCards } from '../environment/PlayingCards.js';
import { createKey } from '../environment/Key.js';
import { createDrinkingHorn } from '../environment/DrinkingHorn.js';
import { createWand } from '../environment/Wand.js';
import { createCoin } from '../environment/Coin.js';
import { createBountyPoster } from '../environment/BountyPoster.js';
import { createTarotDeck } from '../environment/TarotDeck.js';
import { createAmulet } from '../environment/Amulet.js';
import { createDiceTray } from '../environment/DiceTray.js';
import { createAbacus } from '../environment/Abacus.js';
import { createLeatherJournal } from '../environment/LeatherJournal.js';
import { createPadlock } from '../environment/Padlock.js';
import { createSpectacles } from '../environment/Spectacles.js';
import { createLockpicks } from '../environment/Lockpicks.js';
import { createDart } from '../environment/Dart.js';
import { createScrollCase } from '../environment/ScrollCase.js';
import { createMagnifyingGlass } from '../environment/MagnifyingGlass.js';
import { createRope } from '../environment/Rope.js';
import { createGoblet } from '../environment/Goblet.js';
import { createCrossbow } from '../environment/Crossbow.js';
import { createWaterskin } from '../environment/Waterskin.js';
import { createAstrolabe } from '../environment/Astrolabe.js';
import { createSundial } from '../environment/Sundial.js';
import { createAleKeg } from '../environment/AleKeg.js';
import { createFlute } from '../environment/Flute.js';
import { createFloorAndWalls } from '../physics.js';

const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

function updateLoadingBar(percent) {
    const bar = document.getElementById('loading-bar');
    if (bar) bar.style.width = percent + '%';
}

function updateLoadingText(text) {
    const el = document.getElementById('loading-text');
    if (el) el.textContent = text;
}

export async function loadTiers(scene, camera, physicsWorld, updateRegistry, callbacks) {
    const { onDiceRoll, setLampData, setGongData, setCandleFlamePos, setInteraction } = callbacks;

    // ==========================================
    // TIER 0: Critical (must exist before first render)
    // ==========================================
    updateLoadingText("Initializing physics engine...");
    updateLoadingBar(10);

    updateLoadingText("Building tavern environment...");
    updateLoadingBar(20);

    // Core environment (walls, room, table, candle light)
    const wallData = createTavernWalls(scene, physicsWorld);
    let fireplaceLight = null;
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
            setCandleFlamePos(clutterData.flamePosition);
        }
        if (clutterData.update) updateRegistry.register('clutter', clutterData.update);
    }

    updateLoadingText("Loading dice models...");
    updateLoadingBar(30);
    // Load dice models in parallel with granular progress (30% to 40%)
    await loadDiceModels((done, total, label) => {
        const percent = 30 + ((done / total) * 10);
        updateLoadingBar(percent);
        if (label) updateLoadingText(`Loading dice models... (${label})`);
    });
    spawnObjects(scene, physicsWorld);

    updateLoadingText("Setting up game...");
    updateLoadingBar(40);

    // UI Setup
    const ui = initUI(
        (newCounts) => {
            updateDiceSet(scene, physicsWorld, newCounts);
        },
        () => {
            throwDice(scene, physicsWorld);
            onDiceRoll();
        }
    );
    const crosshairUI = createCrosshair();

    // Results UI (overlay + history panel)
    initResultsUI();

    // Interaction Setup
    const interaction = initInteraction(camera, scene, physicsWorld);
    if (setInteraction) setInteraction(interaction);

    // ==========================================
    // TIER 1: Important (visible from default camera, yield first)
    // ==========================================
    updateLoadingText("Loading furniture and props...");
    await yieldToMain();
    updateLoadingBar(55);

    // Bookshelf (Background Prop)
    createBookshelf(scene, physicsWorld, { x: -18, y: -10, z: 0 }, Math.PI / 2);

    // Decorative Walls (Multiple Bookshelves)
    createDecorativeWalls(scene, physicsWorld);

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
    lampResult.group.position.set(0, 10.5, 0);
    registerInteractiveObject(lampResult.group, lampResult.toggle);
    const lampData = lampResult;
    if (setLampData) setLampData(lampData);
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

    // Sword (Resting on table edge)
    createSword(scene, physicsWorld, { x: -14, y: -2.45, z: 12 }, -Math.PI / 6);

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

    // Candelabra
    const candelabraData = createCandelabra(scene, physicsWorld, { x: 6, y: -2.75, z: -10 }, Math.PI / 4);
    if (candelabraData && candelabraData.update) {
        updateRegistry.register('candelabra', candelabraData.update);
    }

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
    createHelmet(scene, physicsWorld, { x: -15, y: -2.75, z: 8 }, Math.PI / 6);

    // Gong Prop (Interactive) - back wall
    const gongResult = createGong(scene, physicsWorld, { x: 0, y: 0, z: -24 }, 0);
    if (gongResult) {
        registerInteractiveObject(gongResult.group, gongResult.interact);
        if (setGongData) setGongData(gongResult);
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

    // Scroll Case - on the table
    createScrollCase(scene, physicsWorld, { x: 1, y: -2.43, z: 10 }, Math.PI / 6);

    // Magnifying Glass Prop - back edge
    createMagnifyingGlass(scene, physicsWorld, { x: 9, y: -2.75, z: -14 }, Math.PI / 3);

    // Coiled Rope Prop - near the magnifying glass
    createRope(scene, physicsWorld, { x: 6, y: -2.75, z: -15 }, Math.PI / 6);

    // Candelabra Prop - on the back edge of the table (moved to front left)
    const candelabraData2 = createCandelabra(scene, physicsWorld, { x: -8, y: -2.75, z: 12 }, Math.PI / 4);
    if (candelabraData2 && candelabraData2.update) {
        updateRegistry.register('candelabra2', candelabraData2.update);
    }

    // Goblet Prop - near the tavern meal
    createGoblet(scene, physicsWorld, { x: 5, y: -2.75, z: 12 }, 0);
    createCrossbow(scene, physicsWorld, { x: -8, y: -2.75, z: -2 }, Math.PI / 4);
    createWaterskin(scene, physicsWorld, { x: 7, y: -2.75, z: 2 }, Math.PI / 6);

    // Astrolabe Prop - right edge
    const astrolabeData = createAstrolabe(scene, physicsWorld, { x: 10, y: -2.75, z: -8 }, Math.PI / 4);
    if (astrolabeData && astrolabeData.update) {
        updateRegistry.register('astrolabe', astrolabeData.update);
    }

    // Sundial Prop
    createSundial(scene, physicsWorld, { x: 8, y: -2.75, z: 8 }, -Math.PI / 6);

    // Ale Keg Prop - left back
    createAleKeg(scene, physicsWorld, { x: -16, y: -2.75, z: -10 }, Math.PI / 4);
    createFlute(scene, physicsWorld, { x: -16, y: -2.75, z: -10 }, Math.PI / 4);

    // Flute Prop - front edge
    createFlute(scene, physicsWorld, { x: 2, y: -2.75, z: 14 }, -Math.PI / 8);

    // Apple Prop - right edge
    createApple(scene, physicsWorld, { x: 13, y: -2.75, z: 7 }, Math.PI / 6);
    createPocketFlask(scene, physicsWorld, { x: -4, y: -2.75, z: 2 }, Math.PI / 4);

    updateLoadingText("Finalizing...");
    updateLoadingBar(95);

    // Disable castShadow on small decorative props to reduce shadow pass draw calls
    const noShadowNames = ['Dart', 'Bell', 'Pencil', 'Key', 'CoinPouch', 'PocketFlask', 'Compass', 'WaxSeal',
        'PocketWatch', 'Dagger', 'PlayingCards', 'DragonScale', 'CharacterSheet', 'BountyPoster',
        'CheeseWheel', 'Runestones', 'Gemstones', 'WritingSet',
        'SmokingPipe', 'Crown', 'Chalice', 'Miniature', 'Scroll', 'Coin', 'Amulet', 'Abacus', 'Padlock', 'Spectacles', 'Lockpicks', 'LeatherJournal', 'MagnifyingGlass', 'Rope', 'Candelabra', 'Waterskin', 'Astrolabe', 'Sundial', 'Flute', 'Apple'];
    scene.traverse(child => {
        if (child.isMesh) {
            let p = child.parent;
            let shouldDisableShadow = false;
            while (p && p !== scene) {
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

    // Flag to indicate all async tiers have finished loading
    window.sceneReady = true;

    return { ui, crosshairUI, interaction, lampData, gongResult, fireplaceLight };
}

export { LampMode };
