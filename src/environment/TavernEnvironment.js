import * as THREE from 'three';
import {
	BackSide,
	BoxGeometry,
	Mesh,
	MeshLambertMaterial,
	MeshStandardMaterial,
	PointLight,
	SphereGeometry,
	CanvasTexture,
	SRGBColorSpace,
	Scene,
} from 'three';
import { getBrickTextures } from '../core/TexturePipeline.js';

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

		const { diffuse: brickDiffuse, bump: brickBump, roughness: brickRoughness } = getBrickTextures();
		brickDiffuse.repeat.set(4, 3);
		brickBump.repeat.set(4, 3);
		brickRoughness.repeat.set(4, 3);

		brickDiffuse.colorSpace = SRGBColorSpace;
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
		// Large warm emissive surface with gradient (darker at top, brighter at bottom)
		const fireLight = new Mesh( geometry, createAreaLightMaterial( 0x220000, 20, 0xff8800 ) );
		fireLight.position.set( 19, 5, 0 ); // On the right wall
		fireLight.scale.set( 1, 10, 6 ); // Tall and moderately wide
		this.add( fireLight );

		// 4. Window Glow (Left / -X)
		// Large cool emissive surface with gradient
		const windowLight = new Mesh( geometry, createAreaLightMaterial( 0x111144, 15, 0x8888ff ) );
		windowLight.position.set( -19, 5, -5 ); // On the left wall
		windowLight.scale.set( 1, 10, 6 );
		this.add( windowLight );

		// 5. Fill Lights (Subtle)
        // Ceiling (very dim)
        const ceilingLight = new Mesh( geometry, createAreaLightMaterial( 0x332211, 2 ) );
        ceilingLight.position.set( 0, 24, 0 );
        ceilingLight.scale.set( 20, 1, 20 );
        this.add( ceilingLight );

		// 6. Additional small light sources for varied reflections
		const sphereGeo = new SphereGeometry(0.5, 16, 16);
		const smallLightMat = new MeshLambertMaterial({ color: 0x000000, emissive: 0xffaa44, emissiveIntensity: 50 });

		const candle1 = new Mesh(sphereGeo, smallLightMat);
		candle1.position.set(15, 8, 15);
		this.add(candle1);

		const candle2 = new Mesh(sphereGeo, smallLightMat);
		candle2.position.set(-15, 8, -15);
		this.add(candle2);

		const candle3 = new Mesh(sphereGeo, smallLightMat);
		candle3.position.set(15, 8, -15);
		this.add(candle3);

		const candle4 = new Mesh(sphereGeo, smallLightMat);
		candle4.position.set(-15, 8, 15);
		this.add(candle4);
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
				if (object.material.emissiveMap) resources.add(object.material.emissiveMap);
			}
		} );
		for ( const resource of resources ) {
			resource.dispose();
		}
	}
}

function createGradientTexture(color1Hex, color2Hex) {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 256;
	const context = canvas.getContext('2d');
	const gradient = context.createLinearGradient(0, 0, 0, 256);

	const c1 = '#' + color1Hex.toString(16).padStart(6, '0');
	const c2 = '#' + color2Hex.toString(16).padStart(6, '0');

	gradient.addColorStop(0, c1);
	gradient.addColorStop(1, c2);
	context.fillStyle = gradient;
	context.fillRect(0, 0, 256, 256);
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	return texture;
}

function createAreaLightMaterial( color, intensity, color2 = null ) {
	const materialOptions = {
		color: 0x000000,
		emissive: color,
		emissiveIntensity: intensity
	};

	if (color2 !== null) {
		const texture = createGradientTexture(color, color2);
		materialOptions.emissiveMap = texture;
		materialOptions.emissive = 0xffffff;
	}

	const material = new MeshLambertMaterial( materialOptions );
	return material;
}

export { TavernEnvironment };
