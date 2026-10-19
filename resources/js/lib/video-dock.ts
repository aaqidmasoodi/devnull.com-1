import { useSyncExternalStore } from 'react';
import { readStorage, writeStorage } from '@/lib/storage';
import { defaultDockLength } from '@/lib/video-dock-geometry';
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

const storageKey = 'video-dock';
const listeners = new Set<() => void>();
const slots: { src: string; element: HTMLElement }[] = [];
let video: DockedVideo | null = null;
let claimedSlot: HTMLElement | null = null;

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
    notify();
}

export function closeVideo(): void {
    video = null;
    claimedSlot = null;
    notify();
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

export function videoSlot(src: string): HTMLElement | null {
    return (
        slots.find((slot) => slot.src === src && slot.element.isConnected)
            ?.element ?? null
    );
}

export function readDockPlacement(viewport: Size): DockPlacement {
    const fallback: DockPlacement = {
        corner: 'bottom-right',
        length: defaultDockLength(viewport),
    };

    try {
        const stored = JSON.parse(
            readStorage(storageKey) || 'null',
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

export function writeDockPlacement(placement: DockPlacement): void {
    writeStorage(storageKey, JSON.stringify(placement));
}
