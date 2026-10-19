import { useSyncExternalStore } from 'react';
import { readStorage, writeStorage } from '@/lib/storage';
import {
    defaultDockCorner,
    defaultDockLength,
    isCompact,
} from '@/lib/video-dock-geometry';
import type { Corner, DockPlacement, Size } from '@/lib/video-dock-geometry';

/**
 * The video playing on the page. Its player lives in the layout, so it keeps playing while the user moves between
 * pages: over the embed it was started from while that embed is on the page, and floating in a corner while it is not.
 */
export type DockedVideo = {
    src: string;
    title: string;
    aspectRatio: number;
    pageUrl: string;
};

/**
 * A phone and a wide screen each remember their own corner and size, so a player made large at a desk doesn't open
 * large on a phone.
 */
const storageKey = (viewport: Size): string =>
    isCompact(viewport) ? 'video-dock:compact' : 'video-dock';
const listeners = new Set<() => void>();
const slots: { src: string; element: HTMLElement }[] = [];
let video: DockedVideo | null = null;
let claimedSlot: HTMLElement | null = null;
let isFloating = false;
let isPopOutRequested = false;

function notify(): void {
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);

    return () => listeners.delete(listener);
}

export function currentPageUrl(): string {
    return window.location.pathname + window.location.search;
}

/**
 * Starting a video replaces the one playing, wherever it is: one player keeps the page from talking over itself.
 */
export function playVideo(next: Omit<DockedVideo, 'pageUrl'>): void {
    video = { ...next, pageUrl: currentPageUrl() };
    claimedSlot = null;
    isPopOutRequested = false;
    notify();
}

export function closeVideo(): void {
    video = null;
    claimedSlot = null;
    isPopOutRequested = false;
    notify();
}

/**
 * Sends the video playing in its embed to the corner of the screen, without leaving the page.
 */
export function popOutVideo(): void {
    if (video === null) {
        return;
    }

    isPopOutRequested = true;
    notify();
}

export function takePopOutRequest(): boolean {
    const isRequested = isPopOutRequested;

    isPopOutRequested = false;

    return isRequested;
}

export function setVideoFloating(next: boolean): void {
    if (isFloating !== next) {
        isFloating = next;
        notify();
    }
}

export function useIsVideoFloating(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => isFloating,
        () => false,
    );
}

/**
 * Brings the floating video into an embed of it on this page, which it then goes back to after a visit elsewhere.
 */
export function playVideoHere(slot: HTMLElement): void {
    if (video === null) {
        return;
    }

    video = { ...video, pageUrl: currentPageUrl() };
    claimedSlot = slot;
    notify();
}

export function takeClaimedSlot(): HTMLElement | null {
    const slot = claimedSlot;

    claimedSlot = null;

    return slot?.isConnected ? slot : null;
}

export function dockedVideo(): DockedVideo | null {
    return video;
}

export function useDockedVideo(): DockedVideo | null {
    return useSyncExternalStore(subscribe, dockedVideo, () => null);
}

/**
 * The embeds that can hold the video, in the order they appeared on the page, so a video posted twice goes back to
 * the first.
 */
export function registerVideoSlot(
    src: string,
    element: HTMLElement,
): () => void {
    const slot = { src, element };

    slots.push(slot);

    return () => {
        const index = slots.indexOf(slot);

        if (index !== -1) {
            slots.splice(index, 1);
        }
    };
}

/**
 * Only an embed in the page itself, scrolled by the window, can hand its video to the floating player, which is laid
 * over the page. One in a panel that scrolls on its own or floats above the page, like a chat or the photo viewer,
 * would leave the player behind it or drifting over its edges, so it plays in place.
 */
export function canPlayFloating(element: Element): boolean {
    const main = element.closest('[data-main]');

    if (main === null || element.closest('[role="dialog"]') !== null) {
        return false;
    }

    for (
        let node = element.parentElement;
        node !== null && node !== main;
        node = node.parentElement
    ) {
        const { overflowY, position } = getComputedStyle(node);

        if (
            overflowY === 'auto' ||
            overflowY === 'scroll' ||
            position === 'fixed'
        ) {
            return false;
        }
    }

    return true;
}

export function videoSlot(src: string): HTMLElement | null {
    return (
        slots.find((slot) => slot.src === src && slot.element.isConnected)
            ?.element ?? null
    );
}

export function readDockPlacement(viewport: Size): DockPlacement {
    const fallback: DockPlacement = {
        corner: defaultDockCorner(viewport),
        length: defaultDockLength(viewport),
    };

    try {
        const stored = JSON.parse(
            readStorage(storageKey(viewport)) || 'null',
        ) as Partial<DockPlacement> | null;
        const corners: Corner[] = [
            'top-left',
            'top-right',
            'bottom-left',
            'bottom-right',
        ];

        return {
            corner:
                stored?.corner && corners.includes(stored.corner)
                    ? stored.corner
                    : fallback.corner,
            length:
                typeof stored?.length === 'number' &&
                Number.isFinite(stored.length)
                    ? stored.length
                    : fallback.length,
        };
    } catch {
        return fallback;
    }
}

export function writeDockPlacement(
    placement: DockPlacement,
    viewport: Size,
): void {
    writeStorage(storageKey(viewport), JSON.stringify(placement));
}
