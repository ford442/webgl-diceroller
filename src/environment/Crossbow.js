import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

export function createCrossbow(scene, physicsWorld, position = { x: 5, y: -2.75, z: 8 }, rotationY = Math.PI / 3) {
    const group = new THREE.Group();
    group.name = 'Crossbow';

    // Materials
    const woodMaterial = new THREE.MeshStandardMaterial({
        color: 0x3e2723, // Dark oak
        roughness: 0.8,
        metalness: 0.05
    });

    const ironMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a4a4a, // Wrought iron
        metalness: 0.8,
        roughness: 0.4
    });

    const stringMaterial = new THREE.MeshStandardMaterial({
        color: 0xdddddd,
        roughness: 0.9,
        metalness: 0.0
    });

    // 1. Main Stock (Tiller)
    // Tapered box
    const stockGeo = new THREE.BoxGeometry(0.8, 0.6, 6.0);
    const stock = new THREE.Mesh(stockGeo, woodMaterial);
    stock.position.z = 0;
    stock.position.y = 0.3; // Half height to sit on table
    stock.castShadow = true;
    stock.receiveShadow = true;
    group.add(stock);

    // 2. Prod (Bow part)
    // Curved or angled arms. We'll use two angled boxes.
    const armGeo = new THREE.BoxGeometry(3.5, 0.2, 0.4);

    // Left arm
    const leftArm = new THREE.Mesh(armGeo, woodMaterial);
    leftArm.position.set(-1.6, 0.3, 2.0);
    leftArm.rotation.y = -Math.PI / 8; // Angled back
    leftArm.castShadow = true;
    leftArm.receiveShadow = true;
    group.add(leftArm);

    // Right arm
    const rightArm = new THREE.Mesh(armGeo, woodMaterial);
    rightArm.position.set(1.6, 0.3, 2.0);
    rightArm.rotation.y = Math.PI / 8; // Angled back
    rightArm.castShadow = true;
    rightArm.receiveShadow = true;
    group.add(rightArm);

    // 3. Stirrup (Front foot loop)
    const stirrupGeo = new THREE.TorusGeometry(0.5, 0.08, 8, 16, Math.PI);
    const stirrup = new THREE.Mesh(stirrupGeo, ironMaterial);
    stirrup.position.set(0, 0.3, 3.0);
    stirrup.rotation.x = Math.PI / 2;
    stirrup.castShadow = true;
    stirrup.receiveShadow = true;
    group.add(stirrup);

    // 4. Trigger Mechanism (Nut and Tickler)
    const nutGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.5, 16);
    const nut = new THREE.Mesh(nutGeo, ironMaterial);
    nut.position.set(0, 0.6, -1.0);
    nut.rotation.z = Math.PI / 2;
    nut.castShadow = true;
    nut.receiveShadow = true;
    group.add(nut);

    const triggerGeo = new THREE.BoxGeometry(0.1, 0.8, 0.3);
    const trigger = new THREE.Mesh(triggerGeo, ironMaterial);
    trigger.position.set(0, -0.2, -1.2);
    trigger.rotation.x = Math.PI / 6;
    trigger.castShadow = true;
    trigger.receiveShadow = true;
    group.add(trigger);

    // 5. Bowstring
    // Connects tips of arms to the nut (cocked position)
    // Using two thin cylinders
    const stringGeo = new THREE.CylinderGeometry(0.02, 0.02, 3.4, 8);

    // Left string
    const leftString = new THREE.Mesh(stringGeo, stringMaterial);
    leftString.position.set(-1.5, 0.4, 0.3); // Midpoint between arm tip (-3, 0.3, 1.4 approx) and nut (0, 0.6, -1)
    // Actually, calculate distance and rotate
    // Let's just approximate the look.
    leftString.rotation.x = Math.PI / 2;
    leftString.rotation.z = -0.55;
    leftString.castShadow = true;
    group.add(leftString);

    // Right string
    const rightString = new THREE.Mesh(stringGeo, stringMaterial);
    rightString.position.set(1.5, 0.4, 0.3);
    rightString.rotation.x = Math.PI / 2;
    rightString.rotation.z = 0.55;
    rightString.castShadow = true;
    group.add(rightString);

    // Position the whole crossbow
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;

    scene.add(group);

    // Physics
    const Ammo = getAmmo();
    if (Ammo && physicsWorld) {
        // We'll use a compound shape or a simple box that covers the main body
        // A box for the stock is sufficient to prevent dice clipping
        if (Ammo && physicsWorld) {
            const stockShape = new Ammo.btBoxShape(new Ammo.btVector3(0.4, 0.3, 3.0));
    
            // Compound shape to include the bow arms
            if (Ammo && physicsWorld) {
                const compoundShape = new Ammo.btCompoundShape();
        
                // Stock transform
                if (Ammo && physicsWorld) {
                    const stockTrans = new Ammo.btTransform();
                    stockTrans.setIdentity();
                    stockTrans.setOrigin(new Ammo.btVector3(0, 0.3, 0));
                    compoundShape.addChildShape(stockTrans, stockShape);
            
                    // Arm box
                    if (Ammo && physicsWorld) {
                        const armShape = new Ammo.btBoxShape(new Ammo.btVector3(3.2, 0.1, 0.2));
                        if (Ammo && physicsWorld) {
                            const armTrans = new Ammo.btTransform();
                            armTrans.setIdentity();
                            armTrans.setOrigin(new Ammo.btVector3(0, 0.3, 2.0));
                            compoundShape.addChildShape(armTrans, armShape);
                    
                            createStaticBody(physicsWorld, group, compoundShape);
                        }
                    }
                }
            }
        }
    }

    return { group };
}
