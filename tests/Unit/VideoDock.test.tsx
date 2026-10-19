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

Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location },
});

const { LinkEmbed } = await import('../../resources/js/components/link-embed');
const {
    closeVideo,
    dockedVideo,
    playVideo,
    playVideoHere,
    registerVideoSlot,
    takeClaimedSlot,
    videoSlot,
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
        <LinkEmbed preview={preview} embed={shown} isStatic={isStatic} />,
    );

beforeEach(() => {
    closeVideo();
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
