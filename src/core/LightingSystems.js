export function createCandleFlickerSystem(pointLight, getFlamePosition) {
    return ({ time }) => {
        const flamePosition = getFlamePosition();
        if (!pointLight || !flamePosition) return;

        const breathing = Math.sin(time * 2.0) * 0.2;
        const flicker = (Math.random() - 0.5) * 0.3;

        pointLight.intensity = 2.5 + breathing + flicker;

        const jitterAmount = 0.03;
        pointLight.position.set(
            flamePosition.x + (Math.random() - 0.5) * jitterAmount,
            flamePosition.y + 0.1 + (Math.random() - 0.5) * jitterAmount * 0.5,
            flamePosition.z + (Math.random() - 0.5) * jitterAmount
        );
    };
}

export function createFireplaceFlickerSystem(getFireplaceLight) {
    return ({ time }) => {
        const fireplaceLight = getFireplaceLight();
        if (!fireplaceLight) return;

        const deepPulse = Math.sin(time * 3.0) * 0.5;
        const crackle = (Math.random() - 0.5) * 1.0;
        fireplaceLight.intensity = 5.0 + deepPulse + crackle;
    };
}
