import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    cornerBox,
    defaultDockLength,
    dockMargin,
    dockSize,
    isMostlyInView,
    maxDockLength,
    minDockLength,
    nearestCorner,
    parseAspectRatio,
    resizedLength,
} from '../../resources/js/lib/video-dock-geometry.ts';

const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };

await test('reads the aspect ratio of an embed', () => {
    assert.equal(parseAspectRatio('16/9'), 16 / 9);
    assert.equal(parseAspectRatio('9 / 16'), 9 / 16);
    assert.equal(parseAspectRatio(null), null);
    assert.equal(parseAspectRatio('wide'), null);
    assert.equal(parseAspectRatio('16/0'), null);
});

await test('starts smaller on narrow screens', () => {
    assert.equal(defaultDockLength(desktop), 360);
    assert.equal(defaultDockLength(phone), 234);
});

await test('sizes the player by its longer side', () => {
    assert.deepEqual(dockSize(400, 16 / 9, desktop), {
        width: 400,
        height: 225,
    });
    assert.deepEqual(dockSize(400, 9 / 16, desktop), {
        width: 225,
        height: 400,
    });
});

await test('keeps the player between its smallest and largest size', () => {
    assert.equal(dockSize(10, 16 / 9, desktop).width, minDockLength);
    assert.equal(dockSize(5000, 16 / 9, desktop).width, maxDockLength);
});

await test('shrinks the player to fit the screen', () => {
    const size = dockSize(maxDockLength, 16 / 9, phone);

    assert.equal(size.width, phone.width - dockMargin * 2);
    assert.equal(size.height, Math.round(size.width / (16 / 9)));
});

await test('places the player in each corner of the screen', () => {
    const size = { width: 320, height: 180 };

    assert.deepEqual(cornerBox('top-left', size, desktop), {
        x: 16,
        y: 16,
        ...size,
    });
    assert.deepEqual(cornerBox('bottom-right', size, desktop), {
        x: 1104,
        y: 704,
        ...size,
    });
});

await test('rests above what is fixed to the bottom of the screen beneath it', () => {
    const size = { width: 320, height: 180 };
    const mobileNav = { left: 0, right: 1440, top: 836 };
    const chatDock = { left: 1056, right: 1416, top: 852 };

    assert.equal(cornerBox('bottom-left', size, desktop, [mobileNav]).y, 640);
    assert.equal(cornerBox('bottom-right', size, desktop, [chatDock]).y, 656);
    assert.equal(cornerBox('bottom-left', size, desktop, [chatDock]).y, 704);
});

await test('settles in the corner it is let go nearest to', () => {
    const still = { x: 0, y: 0 };

    assert.equal(nearestCorner({ x: 200, y: 200 }, still, desktop), 'top-left');
    assert.equal(
        nearestCorner({ x: 1200, y: 700 }, still, desktop),
        'bottom-right',
    );
});

await test('carries a fling on to the corner it was thrown toward', () => {
    assert.equal(
        nearestCorner({ x: 600, y: 400 }, { x: 2, y: -1 }, desktop),
        'top-right',
    );
});

await test('resizes from the corner that faces the page', () => {
    const box = { x: 1104, y: 704, width: 320, height: 180 };

    assert.equal(
        resizedLength('bottom-right', box, { x: 1024, y: 704 }, 16 / 9),
        400,
    );
    assert.equal(
        resizedLength('top-left', box, { x: 1504, y: 704 }, 16 / 9),
        400,
    );
});

await test('follows the longer pull when resizing', () => {
    const box = { x: 1104, y: 704, width: 320, height: 180 };

    assert.equal(
        resizedLength('bottom-right', box, { x: 1104, y: 584 }, 16 / 9),
        (884 - 584) * (16 / 9),
    );
});

await test('counts an embed as in view once half of it shows', () => {
    assert.ok(isMostlyInView({ top: 100, height: 200 }, desktop));
    assert.ok(isMostlyInView({ top: 800, height: 200 }, desktop));
    assert.ok(!isMostlyInView({ top: 801, height: 200 }, desktop));
    assert.ok(!isMostlyInView({ top: -101, height: 200 }, desktop));
    assert.ok(!isMostlyInView({ top: 100, height: 0 }, desktop));
});
