import * as THREE from 'three';
import {
	BackSide,
	BoxGeometry,
	Mesh,
	MeshLambertMaterial,
	MeshStandardMaterial,
	PointLight,
	Scene,
} from 'three';

/**
 * TavernEnvironment
 * A custom environment map scene designed to simulate a dimly lit tavern.
 * Features:
 * - Dark ambient surroundings (Wood/Stone) with PBR textures.
 * - Warm orange glow from the right (Fireplace).
 * - Cool blue glow from the left (Moonlit Window).
 * - Bright warm point near center (Candle).
 */
class TavernEnvironment extends Scene {

	constructor() {
		super();
		this.name = 'TavernEnvironment';
	}

	async load() {
		const geometry = new BoxGeometry();
		// We DO NOT delete UVs because we need them for textures!
		// geometry.deleteAttribute( 'uv' );

		const loader = new THREE.TextureLoader();

		// Load Textures asynchronously
		const [brickDiffuse, brickBump, brickRoughness] = await Promise.all([
			loader.loadAsync('./images/brick_diffuse.jpg'),
			loader.loadAsync('./images/brick_bump.jpg'),
			loader.loadAsync('./images/brick_roughness.jpg')
		]);

		[brickDiffuse, brickBump, brickRoughness].forEach(t => {
			t.wrapS = THREE.RepeatWrapping;
			t.wrapT = THREE.RepeatWrapping;
			t.repeat.set(4, 3);
		});

		brickDiffuse.colorSpace = THREE.SRGBColorSpace;
		brickBump.colorSpace = THREE.NoColorSpace;
		brickRoughness.colorSpace = THREE.NoColorSpace;

		// 1. The Room (Backdrop)
		// textured material to simulate stone walls in shadow.
		const roomMaterial = new MeshStandardMaterial( {
			side: BackSide,
			map: brickDiffuse,
			bumpMap: brickBump,
			bumpScale: 0.2,
			roughnessMap: brickRoughness,
			color: 0x221100 // Very dark brown tint for shadow
		} );

		const room = new Mesh( geometry, roomMaterial );
		room.position.set( 0, 10, 0 );
		room.scale.set( 40, 30, 40 ); // Large room
		this.add( room );

		// 2. Main Light (Candle)
		// High intensity point light for sharp reflections of the flame
		const mainLight = new PointLight( 0xffaa00, 500, 20, 2 );
		mainLight.position.set( 0, 5, 0 ); // Slightly above table
		this.add( mainLight );

		// 3. Fireplace Glow (Right / +X)
		// Large warm emissive surface
		const fireLight = new Mesh( geometry, createAreaLightMaterial( 0xff4400, 20 ) );
		fireLight.position.set( 19, 5, 0 ); // On the right wall
		fireLight.scale.set( 1, 10, 6 ); // Tall and moderately wide
		this.add( fireLight );

		// 4. Window Glow (Left / -X)
		// Large cool emissive surface
		const windowLight = new Mesh( geometry, createAreaLightMaterial( 0x4444ff, 15 ) );
		windowLight.position.set( -19, 5, -5 ); // On the left wall
		windowLight.scale.set( 1, 10, 6 );
		this.add( windowLight );

		// 5. Fill Lights (Subtle)
        // Ceiling (very dim)
        const ceilingLight = new Mesh( geometry, createAreaLightMaterial( 0x332211, 2 ) );
        ceilingLight.position.set( 0, 24, 0 );
        ceilingLight.scale.set( 20, 1, 20 );
        this.add( ceilingLight );
	}

	dispose() {
		const resources = new Set();
		this.traverse( ( object ) => {
			if ( object.isMesh ) {
				resources.add( object.geometry );
				resources.add( object.material );
				// Also dispose textures if any
				if (object.material.map) resources.add(object.material.map);
				if (object.material.bumpMap) resources.add(object.material.bumpMap);
				if (object.material.roughnessMap) resources.add(object.material.roughnessMap);
			}
		} );
		for ( const resource of resources ) {
			resource.dispose();
		}
	}
}

function createAreaLightMaterial( color, intensity ) {
	const material = new MeshLambertMaterial( {
		color: 0x000000,
		emissive: color,
		emissiveIntensity: intensity
	} );
	return material;
}

export { TavernEnvironment };
