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
 * - Dark ambient surroundings (Wood/Stone).
 * - Warm orange glow from the right (Fireplace).
 * - Cool blue glow from the left (Moonlit Window).
 * - Bright warm point near center (Candle).
 */
class TavernEnvironment extends Scene {

	constructor() {

		super();

		this.name = 'TavernEnvironment';

		const geometry = new BoxGeometry();
		geometry.deleteAttribute( 'uv' );

		// 1. The Room (Backdrop)
		// Dark, rough material to simulate wood/stone walls in shadow.
		const roomMaterial = new MeshStandardMaterial( {
			side: BackSide,
			color: 0x221100, // Very dark brown
			roughness: 1.0
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
