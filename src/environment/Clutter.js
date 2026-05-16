import { createMug, createCoins, createBook, createMiniature, createD20Holder, createGemstone, createPotionBottle, createPencil } from './clutter/TabletopItems.js';
import { createParchment, createTarotCards, createWantedPoster, createDMScreen } from './clutter/DocumentsAndCards.js';
import { createCandle, createKey, createQuill, createPipe, createSpyglass } from './clutter/ToolsAndGear.js';

export function createClutter(scene, physicsWorld) {
    createMug(scene, physicsWorld);
    createCoins(scene, physicsWorld);
    createBook(scene, physicsWorld);
    createParchment(scene, physicsWorld);
    const candleData = createCandle(scene, physicsWorld);
    createPencil(scene, physicsWorld);
    createD20Holder(scene, physicsWorld);
    createPotionBottle(scene, physicsWorld);
    createDMScreen(scene, physicsWorld);
    createKey(scene, physicsWorld);
    createQuill(scene, physicsWorld);
    createPipe(scene, physicsWorld);
    createSpyglass(scene, physicsWorld);
    createGemstone(scene, physicsWorld);
    createWantedPoster(scene, physicsWorld);
    createTarotCards(scene, physicsWorld);
    createMiniature(scene, physicsWorld);

    return {
        flamePosition: candleData.flamePosition,
        update: candleData.update
    };
}
