import { describe, expect, it } from 'vitest';
import { resolvePublicAssetUrl } from '../../src/core/publicAssetUrl.js';

const WOOD = 'images/wood_diffuse.jpg';

describe('resolvePublicAssetUrl', () => {
    it('joins a path-absolute BASE_URL against origin when the page has no trailing slash', () => {
        expect(resolvePublicAssetUrl(WOOD, '/dice-roller/', 'https://go.1ink.us/dice-roller')).toBe(
            'https://go.1ink.us/dice-roller/images/wood_diffuse.jpg'
        );
    });

    it('keeps relative BASE_URL assets under the subdirectory without a trailing slash', () => {
        expect(resolvePublicAssetUrl(WOOD, './', 'https://go.1ink.us/dice-roller')).toBe(
            'https://go.1ink.us/dice-roller/images/wood_diffuse.jpg'
        );
    });

    it('resolves relative BASE_URL against a trailing-slash directory URL', () => {
        expect(resolvePublicAssetUrl(WOOD, './', 'https://go.1ink.us/dice-roller/')).toBe(
            'https://go.1ink.us/dice-roller/images/wood_diffuse.jpg'
        );
    });

    it('strips index.html so relative BASE_URL stays in the app directory', () => {
        expect(resolvePublicAssetUrl(WOOD, './', 'https://go.1ink.us/dice-roller/index.html')).toBe(
            'https://go.1ink.us/dice-roller/images/wood_diffuse.jpg'
        );
    });
});
