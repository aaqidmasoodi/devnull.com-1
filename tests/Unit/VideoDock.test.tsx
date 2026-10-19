/// <reference types="node" />
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, test, vi } from 'vite-plus/test';
import type { Embed, LinkPreview } from '../../resources/js/types';

vi.doMock('react', () => ({
    ...React,
    useSyncExternalStore: (
        _subscribe: (callback: () => void) => () => void,
        snapshot: () => unknown,
    ) => snapshot(),
}));

const location = { pathname: '/', search: '' };
const stored = new Map<string, string>();

Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
        location,
        localStorage: {
            getItem: (key: string) => stored.get(key) ?? null,
            setItem: (key: string, value: string) => stored.set(key, value),
            removeItem: (key: string) => stored.delete(key),
        },
    },
});

const { LinkEmbed } = await import('../../resources/js/components/link-embed');
const { TooltipProvider } = await import(
    '../../resources/js/components/ui/tooltip'
);
const {
    canPlayFloating,
    closeVideo,
    dockedVideo,
    playVideo,
    playVideoHere,
    popOutVideo,
    readDockPlacement,
    registerVideoSlot,
    setVideoFloating,
    takeClaimedSlot,
    takePopOutRequest,
    videoSlot,
    writeDockPlacement,
} = await import('../../resources/js/lib/video-dock');

const embed: Embed = {
    provider: 'YouTube',
    kind: 'video',
    src: 'https://www.youtube-nocookie.com/embed/first?autoplay=1',
    aspect_ratio: '16/9',
    height: null,
};

const other: Embed = {
    ...embed,
    src: 'https://www.youtube-nocookie.com/embed/second?autoplay=1',
};

const preview: LinkPreview = {
    url: 'https://www.youtube.com/watch?v=first',
    title: 'Shipping on a Friday',
    description: null,
    image_url: 'https://i.ytimg.com/vi/first/hqdefault.jpg',
    site_name: 'YouTube',
    is_pending: false,
};

const slot = (isConnected = true) => ({ isConnected }) as HTMLElement;

const render = (shown: Embed, isStatic = false) =>
    renderToStaticMarkup(
        <TooltipProvider>
            <LinkEmbed preview={preview} embed={shown} isStatic={isStatic} />
        </TooltipProvider>,
    );

beforeEach(() => {
    stored.clear();
    closeVideo();
    setVideoFloating(false);
    location.pathname = '/';
    location.search = '';
});

test('shows a play button until the video is played', () => {
    const markup = render(embed);

    assert.ok(markup.includes('data-test="link-embed-play"'));
    assert.ok(!markup.includes('data-test="link-embed-slot"'));
});

test('hands the video to the player, which remembers the page it was played on', () => {
    location.pathname = '/log';
    location.search = '?lane=latest';

    playVideo({ src: embed.src, title: 'Shipping on a Friday', aspectRatio: 16 / 9 });

    assert.deepEqual(dockedVideo(), {
        src: embed.src,
        title: 'Shipping on a Friday',
        aspectRatio: 16 / 9,
        pageUrl: '/log?lane=latest',
    });
});

test('shows where the video is playing in every embed of it', () => {
    playVideo({ src: embed.src, title: 'Shipping', aspectRatio: 16 / 9 });

    const markup = render(embed);

    assert.ok(markup.includes('data-test="link-embed-slot"'));
    assert.ok(markup.includes('Playing in picture-in-picture'));
    assert.ok(markup.includes('data-test="link-embed-play-here"'));
    assert.ok(!markup.includes('<iframe'));
});

test('leaves other videos and quoted embeds as they are', () => {
    playVideo({ src: embed.src, title: 'Shipping', aspectRatio: 16 / 9 });

    assert.ok(render(other).includes('data-test="link-embed-play"'));
    assert.ok(!render(embed, true).includes('data-test="link-embed-slot"'));
});

test('playing another video replaces the one playing', () => {
    playVideo({ src: embed.src, title: 'Shipping', aspectRatio: 16 / 9 });
    playVideo({ src: other.src, title: 'Second', aspectRatio: 16 / 9 });

    assert.equal(dockedVideo()?.src, other.src);
    assert.ok(render(embed).includes('data-test="link-embed-play"'));
    assert.ok(render(other).includes('data-test="link-embed-slot"'));
});

test('closing the player puts the play button back', () => {
    playVideo({ src: embed.src, title: 'Shipping', aspectRatio: 16 / 9 });
    closeVideo();

    assert.equal(dockedVideo(), null);
    assert.ok(render(embed).includes('data-test="link-embed-play"'));
});

test('playing here moves the video to this page and claims the embed once', () => {
    playVideo({ src: embed.src, title: 'Shipping', aspectRatio: 16 / 9 });
    location.pathname = '/@nunomaduro';

    const here = slot();

    playVideoHere(here);

    assert.equal(dockedVideo()?.pageUrl, '/@nunomaduro');
    assert.equal(takeClaimedSlot(), here);
    assert.equal(takeClaimedSlot(), null);
});

test('drops a claim on an embed that has left the page', () => {
    playVideo({ src: embed.src, title: 'Shipping', aspectRatio: 16 / 9 });
    playVideoHere(slot(false));

    assert.equal(takeClaimedSlot(), null);
});

test('ignores playing here when nothing is playing', () => {
    playVideoHere(slot());

    assert.equal(dockedVideo(), null);
    assert.equal(takeClaimedSlot(), null);
});

test('a new video drops a claim made for the previous one', () => {
    playVideo({ src: embed.src, title: 'Shipping', aspectRatio: 16 / 9 });
    playVideoHere(slot());
    playVideo({ src: other.src, title: 'Second', aspectRatio: 16 / 9 });

    assert.equal(takeClaimedSlot(), null);
});

test('goes back to the first embed of the video still on the page', () => {
    const first = slot();
    const second = slot();
    const elsewhere = slot();
    const unregisterFirst = registerVideoSlot(embed.src, first);
    const unregisterSecond = registerVideoSlot(embed.src, second);
    const unregisterElsewhere = registerVideoSlot(other.src, elsewhere);

    assert.equal(videoSlot(embed.src), first);

    unregisterFirst();

    assert.equal(videoSlot(embed.src), second);

    unregisterSecond();
    unregisterElsewhere();

    assert.equal(videoSlot(embed.src), null);
});

test('skips an embed that is no longer on the page', () => {
    const gone = slot(false);
    const unregister = registerVideoSlot(embed.src, gone);

    assert.equal(videoSlot(embed.src), null);

    unregister();
});

test('offers picture-in-picture under a video playing in its embed', () => {
    playVideo({ src: embed.src, title: 'Shipping', aspectRatio: 16 / 9 });

    assert.ok(render(embed).includes('data-test="link-embed-pop-out"'));
    assert.ok(!render(other).includes('data-test="link-embed-pop-out"'));
});

test('stops offering picture-in-picture once the video floats', () => {
    playVideo({ src: embed.src, title: 'Shipping', aspectRatio: 16 / 9 });
    setVideoFloating(true);

    assert.ok(!render(embed).includes('data-test="link-embed-pop-out"'));
});

test('asks the player to pop out once', () => {
    playVideo({ src: embed.src, title: 'Shipping', aspectRatio: 16 / 9 });
    popOutVideo();

    assert.equal(takePopOutRequest(), true);
    assert.equal(takePopOutRequest(), false);
});

test('ignores popping out when nothing is playing', () => {
    popOutVideo();

    assert.equal(takePopOutRequest(), false);
});

test('a new video drops a pop out asked for the previous one', () => {
    playVideo({ src: embed.src, title: 'Shipping', aspectRatio: 16 / 9 });
    popOutVideo();
    playVideo({ src: other.src, title: 'Second', aspectRatio: 16 / 9 });

    assert.equal(takePopOutRequest(), false);
});

const phone = { width: 390, height: 844 };
const desktop = { width: 1440, height: 900 };

test('opens small in the top right of a phone until it is moved or resized', () => {
    assert.deepEqual(readDockPlacement(phone), {
        corner: 'top-right',
        length: 234,
    });
    assert.deepEqual(readDockPlacement(desktop), {
        corner: 'bottom-right',
        length: 360,
    });
});

test('remembers where it was put and how big it was made', () => {
    writeDockPlacement({ corner: 'bottom-left', length: 300 }, phone);

    assert.deepEqual(readDockPlacement(phone), {
        corner: 'bottom-left',
        length: 300,
    });
});

test('remembers a phone and a wide screen apart', () => {
    writeDockPlacement({ corner: 'top-left', length: 640 }, desktop);

    assert.deepEqual(readDockPlacement(phone), {
        corner: 'top-right',
        length: 234,
    });
    assert.deepEqual(readDockPlacement(desktop), {
        corner: 'top-left',
        length: 640,
    });
});

type FakeNode = {
    parentElement: FakeNode | null;
    style: { overflowY: string; position: string };
    isMain?: boolean;
    isDialog?: boolean;
    closest: (selector: string) => FakeNode | null;
};

const fakeNode = (
    parent: FakeNode | null,
    style: Partial<FakeNode['style']> = {},
    flags: { isMain?: boolean; isDialog?: boolean } = {},
): FakeNode => {
    const node: FakeNode = {
        parentElement: parent,
        style: { overflowY: 'visible', position: 'static', ...style },
        ...flags,
        closest: (selector) => {
            for (let current: FakeNode | null = node; current !== null; current = current.parentElement) {
                if (selector.includes('data-main') && current.isMain) {
                    return current;
                }

                if (selector.includes('dialog') && current.isDialog) {
                    return current;
                }
            }

            return null;
        },
    };

    return node;
};

const canFloatIn = (embed: FakeNode): boolean => {
    const original = globalThis.getComputedStyle;

    globalThis.getComputedStyle = ((node: FakeNode) =>
        node.style) as unknown as typeof getComputedStyle;

    try {
        return canPlayFloating(embed as unknown as Element);
    } finally {
        globalThis.getComputedStyle = original;
    }
};

test('floats a video played from the page itself', () => {
    const main = fakeNode(null, {}, { isMain: true });
    const card = fakeNode(fakeNode(main), { overflowY: 'hidden' });

    assert.equal(canFloatIn(fakeNode(card)), true);
});

test('plays in place inside a thread that scrolls on its own, like a conversation', () => {
    const main = fakeNode(null, {}, { isMain: true });
    const thread = fakeNode(main, { overflowY: 'auto' });

    assert.equal(canFloatIn(fakeNode(fakeNode(thread))), false);
});

test('plays in place inside a panel fixed above the page', () => {
    const main = fakeNode(null, {}, { isMain: true });
    const panel = fakeNode(main, { position: 'fixed' });

    assert.equal(canFloatIn(fakeNode(panel)), false);
});

test('plays in place inside a dialog', () => {
    const main = fakeNode(null, {}, { isMain: true });
    const dialog = fakeNode(main, {}, { isDialog: true });

    assert.equal(canFloatIn(fakeNode(dialog)), false);
});

test('plays in place outside the page, like the chat dock or the photo viewer', () => {
    const dock = fakeNode(null, { position: 'fixed' });

    assert.equal(canFloatIn(fakeNode(dock)), false);
});
