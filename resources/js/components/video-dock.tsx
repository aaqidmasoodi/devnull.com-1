import { router } from '@inertiajs/react';
import { Maximize2, X } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EmbedFrame } from '@/components/link-embed';
import { cn } from '@/lib/utils';
import {
    closeVideo,
    currentPageUrl,
    dockedVideo,
    readDockPlacement,
    takeClaimedSlot,
    useDockedVideo,
    videoSlot,
    writeDockPlacement,
} from '@/lib/video-dock';
import type { DockedVideo } from '@/lib/video-dock';
import {
    cornerBox,
    dockSize,
    isMostlyInView,
    nearestCorner,
    resizedLength,
} from '@/lib/video-dock-geometry';
import type {
    Box,
    Corner,
    DockPlacement,
    Obstacle,
    Point,
    Size,
} from '@/lib/video-dock-geometry';

/**
 * How long a page has to hold still before the player moves: long enough for the page to restore its scroll after a
 * visit, and for a list that re-renders the post to put it back.
 */
const settleDelay = 150;
const flightDuration = 450;
const controlsDelay = 1500;
const flight = [
    `transform ${flightDuration}ms cubic-bezier(0.34, 1.3, 0.64, 1)`,
    `width ${flightDuration}ms cubic-bezier(0.16, 1, 0.3, 1)`,
    `height ${flightDuration}ms cubic-bezier(0.16, 1, 0.3, 1)`,
].join(', ');

const resizeHandles: Record<Corner, string> = {
    'bottom-right': 'top-0 left-0 cursor-nwse-resize',
    'bottom-left': 'top-0 right-0 cursor-nesw-resize',
    'top-right': 'bottom-0 left-0 cursor-nesw-resize',
    'top-left': 'right-0 bottom-0 cursor-nwse-resize',
};

const resizeGrips: Record<Corner, string> = {
    'bottom-right': 'top-1.5 left-1.5 rounded-tl-md border-t-2 border-l-2',
    'bottom-left': 'top-1.5 right-1.5 rounded-tr-md border-t-2 border-r-2',
    'top-right': 'bottom-1.5 left-1.5 rounded-bl-md border-b-2 border-l-2',
    'top-left': 'right-1.5 bottom-1.5 rounded-br-md border-r-2 border-b-2',
};

type Stage = 'pending' | 'inline' | 'holding' | 'flying' | 'floating';

type Interaction =
    | { kind: 'drag'; offset: Point; samples: (Point & { time: number })[] }
    | { kind: 'resize'; start: Box; length: number };

type Controller = {
    stage: Stage;
    since: number;
    slot: HTMLElement | null;
    candidate: HTMLElement | null;
    candidateSince: number;
    box: Box;
    lastSlotRect: Box;
    placement: DockPlacement;
    interaction: Interaction | null;
    flight: number | null;
};

function viewport(): Size {
    return {
        width: document.documentElement.clientWidth,
        height: window.innerHeight,
    };
}

function obstacles(): Obstacle[] {
    return Array.from(
        document.querySelectorAll<HTMLElement>('[data-video-dock-obstacle]'),
    )
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map(({ left, right, top }) => ({ left, right, top }));
}

function prefersReducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function toBox(rect: DOMRect): Box {
    return {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
    };
}

function isSameBox(first: Box, second: Box): boolean {
    return (
        Math.abs(first.x - second.x) < 0.5 &&
        Math.abs(first.y - second.y) < 0.5 &&
        Math.abs(first.width - second.width) < 0.5 &&
        Math.abs(first.height - second.height) < 0.5
    );
}

/**
 * Laid over the embed, the player is positioned against the document rather than the viewport, so it scrolls with the
 * page natively instead of trailing it by a frame.
 */
function documentBox(slot: HTMLElement): Box {
    const rect = slot.getBoundingClientRect();
    const body = document.body;
    const origin = (
        getComputedStyle(body).position === 'static'
            ? document.documentElement
            : body
    ).getBoundingClientRect();

    return {
        x: rect.left - origin.left,
        y: rect.top - origin.top,
        width: rect.width,
        height: rect.height,
    };
}

/**
 * The embed's card rounds its top corners, so the player does too while it sits in them.
 */
function slotRadius(slot: HTMLElement): string {
    const card = slot.closest<HTMLElement>('[data-test="link-embed"]');

    if (card === null) {
        return '0px';
    }

    const style = getComputedStyle(card);
    const border = Number.parseFloat(style.borderTopWidth) || 0;
    const radius = Math.max(
        0,
        (Number.parseFloat(style.borderTopLeftRadius) || 0) - border,
    );
    const slotRect = slot.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const isInCorners =
        Math.abs(slotRect.top - cardRect.top - border) < 1 &&
        Math.abs(slotRect.width - (cardRect.width - border * 2)) < 1;

    return isInCorners ? `${radius}px ${radius}px 0 0` : '0px';
}

export function VideoDock() {
    const video = useDockedVideo();

    // Pages outside the layout have nowhere to keep the player, so leaving for one ends the video.
    useEffect(() => closeVideo, []);

    if (video === null) {
        return null;
    }

    return createPortal(
        <DockedPlayer key={video.src} video={video} />,
        document.body,
    );
}

function DockedPlayer({ video }: { video: DockedVideo }) {
    const wrapper = useRef<HTMLDivElement>(null);
    const surface = useRef<HTMLDivElement>(null);
    const controller = useRef<Controller | null>(null);
    const hideControls = useRef<number | null>(null);
    const [isFloating, setIsFloating] = useState(false);
    const [corner, setCorner] = useState<Corner>('bottom-right');
    const [isInteracting, setIsInteracting] = useState(false);
    const [isShowingControls, setIsShowingControls] = useState(false);

    const state = (): Controller => {
        if (controller.current === null) {
            controller.current = {
                stage: 'pending',
                since: performance.now(),
                slot: null,
                candidate: null,
                candidateSince: 0,
                box: { x: 0, y: 0, width: 0, height: 0 },
                lastSlotRect: { x: 0, y: 0, width: 0, height: 0 },
                placement: readDockPlacement(viewport()),
                interaction: null,
                flight: null,
            };
        }

        return controller.current;
    };

    const place = (
        position: 'absolute' | 'fixed',
        box: Box,
        isAnimated = false,
    ) => {
        const element = wrapper.current;

        if (element === null) {
            return;
        }

        element.style.position = position;
        element.style.transition =
            isAnimated && !prefersReducedMotion() ? flight : 'none';
        element.style.transform = `translate3d(${box.x}px, ${box.y}px, 0)`;
        element.style.width = `${box.width}px`;
        element.style.height = `${box.height}px`;
        element.style.visibility = 'visible';
        state().box = box;
    };

    /**
     * Pins the player to the viewport where it is now, without moving it, so it can fly from there.
     */
    const lift = (box: Box) => {
        place('fixed', box);
        void wrapper.current?.offsetWidth;
    };

    const cornerTarget = (): Box => {
        const { placement } = state();

        return cornerBox(
            placement.corner,
            dockSize(placement.length, video.aspectRatio, viewport()),
            viewport(),
            obstacles(),
        );
    };

    const attach = (slot: HTMLElement) => {
        const current = state();

        current.stage = 'inline';
        current.slot = slot;
        current.candidate = null;
        current.lastSlotRect = toBox(slot.getBoundingClientRect());

        if (surface.current !== null) {
            surface.current.style.borderRadius = slotRadius(slot);
        }

        place('absolute', documentBox(slot));
        setIsFloating(false);
    };

    const land = (stage: Stage, onLanded: () => void) => {
        const current = state();

        current.stage = stage;

        if (current.flight !== null) {
            window.clearTimeout(current.flight);
        }

        current.flight = window.setTimeout(
            () => {
                current.flight = null;
                onLanded();
            },
            prefersReducedMotion() ? 0 : flightDuration,
        );
    };

    const flyInto = (slot: HTMLElement) => {
        const current = state();

        current.slot = slot;
        setIsFloating(false);

        if (surface.current !== null) {
            surface.current.style.borderRadius = slotRadius(slot);
        }

        place('fixed', toBox(slot.getBoundingClientRect()), true);
        land('flying', () => (slot.isConnected ? attach(slot) : flyToCorner()));
    };

    const flyToCorner = () => {
        const current = state();

        current.slot = null;
        setCorner(current.placement.corner);
        setIsFloating(true);

        if (surface.current !== null) {
            surface.current.style.borderRadius = '';
        }

        place('fixed', cornerTarget(), true);
        land('flying', () => {
            current.stage = 'floating';
        });
    };

    useLayoutEffect(() => {
        let frame = 0;

        const tick = (now: number) => {
            frame = requestAnimationFrame(tick);

            const current = state();

            if (current.interaction !== null || current.stage === 'flying') {
                return;
            }

            const claimed = takeClaimedSlot();

            if (claimed !== null) {
                if (current.stage === 'pending') {
                    attach(claimed);
                } else if (claimed !== current.slot) {
                    if (current.stage === 'inline') {
                        lift(current.lastSlotRect);
                    }

                    flyInto(claimed);
                }

                return;
            }

            if (current.stage === 'inline') {
                const slot = current.slot;

                if (slot !== null && slot.isConnected) {
                    const box = documentBox(slot);

                    current.lastSlotRect = toBox(slot.getBoundingClientRect());

                    if (!isSameBox(box, current.box)) {
                        place('absolute', box);
                    }

                    return;
                }

                lift(current.lastSlotRect);
                current.slot = null;
                current.stage = 'holding';
                current.since = now;
            }

            // Only the page the video was playing on takes it back by itself; anywhere else, its embeds offer to.
            const slot =
                currentPageUrl() === dockedVideo()?.pageUrl
                    ? videoSlot(video.src)
                    : null;
            const visibleSlot =
                slot !== null &&
                isMostlyInView(slot.getBoundingClientRect(), viewport())
                    ? slot
                    : null;

            if (current.stage === 'pending') {
                if (visibleSlot !== null) {
                    attach(visibleSlot);
                } else if (now - current.since >= settleDelay) {
                    setCorner(current.placement.corner);
                    setIsFloating(true);
                    place('fixed', cornerTarget());
                    current.stage = 'floating';
                }

                return;
            }

            if (visibleSlot !== current.candidate) {
                current.candidate = visibleSlot;
                current.candidateSince = now;
            }

            if (
                current.candidate !== null &&
                now - current.candidateSince >= settleDelay
            ) {
                flyInto(current.candidate);

                return;
            }

            if (current.stage === 'holding') {
                if (now - current.since >= settleDelay) {
                    flyToCorner();
                }

                return;
            }

            const target = cornerTarget();

            if (!isSameBox(target, current.box)) {
                place('fixed', target, true);
            }
        };

        frame = requestAnimationFrame(tick);

        return () => {
            cancelAnimationFrame(frame);

            const { flight: pending } = state();

            if (pending !== null) {
                window.clearTimeout(pending);
            }
        };
        // The player is keyed by its video, and everything else it reads lives in the controller.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(
        () => () => {
            if (hideControls.current !== null) {
                window.clearTimeout(hideControls.current);
            }
        },
        [],
    );

    const showControls = () => {
        if (hideControls.current !== null) {
            window.clearTimeout(hideControls.current);
            hideControls.current = null;
        }

        setIsShowingControls(true);
    };

    const scheduleHidingControls = () => {
        if (hideControls.current !== null) {
            window.clearTimeout(hideControls.current);
        }

        hideControls.current = window.setTimeout(() => {
            hideControls.current = null;
            setIsShowingControls(false);
        }, controlsDelay);
    };

    const startInteraction = (
        event: ReactPointerEvent<HTMLElement>,
        interaction: Interaction,
    ) => {
        if (event.button !== 0 || state().stage !== 'floating') {
            return;
        }

        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        state().interaction = interaction;
        setIsInteracting(true);
    };

    const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const { box } = state();

        startInteraction(event, {
            kind: 'drag',
            offset: { x: event.clientX - box.x, y: event.clientY - box.y },
            samples: [
                { x: event.clientX, y: event.clientY, time: event.timeStamp },
            ],
        });
    };

    const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
        const { box, placement } = state();

        startInteraction(event, {
            kind: 'resize',
            start: box,
            length: placement.length,
        });
    };

    const move = (event: ReactPointerEvent<HTMLDivElement>) => {
        const current = state();
        const interaction = current.interaction;

        if (interaction === null) {
            return;
        }

        const size = viewport();

        if (interaction.kind === 'drag') {
            const { box } = current;

            interaction.samples = [
                ...interaction.samples.filter(
                    (sample) => event.timeStamp - sample.time < 100,
                ),
                { x: event.clientX, y: event.clientY, time: event.timeStamp },
            ];

            place('fixed', {
                ...box,
                x: Math.min(
                    Math.max(event.clientX - interaction.offset.x, 0),
                    size.width - box.width,
                ),
                y: Math.min(
                    Math.max(event.clientY - interaction.offset.y, 0),
                    size.height - box.height,
                ),
            });

            return;
        }

        const { start } = interaction;
        const resized = dockSize(
            resizedLength(
                current.placement.corner,
                start,
                { x: event.clientX, y: event.clientY },
                video.aspectRatio,
            ),
            video.aspectRatio,
            size,
        );

        interaction.length = Math.max(resized.width, resized.height);
        place('fixed', {
            ...resized,
            x: current.placement.corner.endsWith('right')
                ? start.x + start.width - resized.width
                : start.x,
            y: current.placement.corner.startsWith('bottom')
                ? start.y + start.height - resized.height
                : start.y,
        });
    };

    const endInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
        const current = state();
        const interaction = current.interaction;

        if (interaction === null) {
            return;
        }

        current.interaction = null;
        setIsInteracting(false);

        if (interaction.kind === 'drag') {
            const [first] = interaction.samples;
            const elapsed = Math.max(event.timeStamp - first.time, 1);
            const { box } = current;

            current.placement = {
                ...current.placement,
                corner: nearestCorner(
                    {
                        x: box.x + box.width / 2,
                        y: box.y + box.height / 2,
                    },
                    {
                        x: (event.clientX - first.x) / elapsed,
                        y: (event.clientY - first.y) / elapsed,
                    },
                    viewport(),
                ),
            };
            setCorner(current.placement.corner);
        } else {
            current.placement = {
                ...current.placement,
                length: interaction.length,
            };
        }

        writeDockPlacement(current.placement);
        place('fixed', cornerTarget(), true);
    };

    const goBack = () => {
        const reveal = () =>
            videoSlot(video.src)?.scrollIntoView({
                block: 'center',
                behavior: prefersReducedMotion() ? 'auto' : 'smooth',
            });

        if (currentPageUrl() === video.pageUrl) {
            reveal();

            return;
        }

        router.visit(video.pageUrl, {
            onSuccess: () =>
                requestAnimationFrame(() => requestAnimationFrame(reveal)),
        });
    };

    return (
        <div
            ref={wrapper}
            role={isFloating ? 'region' : undefined}
            aria-label={isFloating ? 'Video player' : undefined}
            onPointerEnter={showControls}
            onPointerLeave={scheduleHidingControls}
            className={cn(
                'group/dock invisible fixed top-0 left-0 will-change-transform',
                isFloating ? 'z-40' : 'z-1',
            )}
            data-test="video-dock"
            data-floating={isFloating}
        >
            <div
                ref={surface}
                className={cn('relative size-full overflow-hidden bg-black', {
                    'rounded-xl shadow-2xl ring-1 ring-white/10': isFloating,
                })}
            >
                <EmbedFrame
                    src={video.src}
                    title={video.title}
                    className={cn('h-full bg-black', {
                        'pointer-events-none': isInteracting,
                    })}
                />

                {isFloating && (
                    <div
                        className={cn(
                            'pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-has-focus-visible/dock:opacity-100 [@media(hover:none)]:opacity-100',
                            {
                                'opacity-100':
                                    isShowingControls || isInteracting,
                            },
                        )}
                    >
                        <div
                            onPointerDown={startDrag}
                            onPointerMove={move}
                            onPointerUp={endInteraction}
                            onPointerCancel={endInteraction}
                            onLostPointerCapture={endInteraction}
                            className={cn(
                                'absolute inset-x-0 top-0 flex h-12 touch-none items-start justify-end gap-1 bg-linear-to-b from-black/70 to-transparent p-1.5 select-none',
                                isInteracting
                                    ? 'cursor-grabbing'
                                    : 'cursor-grab',
                                {
                                    'pointer-events-auto':
                                        isShowingControls || isInteracting,
                                },
                                'group-has-focus-visible/dock:pointer-events-auto [@media(hover:none)]:pointer-events-auto',
                            )}
                            data-test="video-dock-handle"
                        >
                            <span
                                aria-hidden
                                className="absolute top-2 left-1/2 h-1 w-8 -translate-x-1/2 rounded-full bg-white/60"
                            />
                            <DockButton label="Back to video" onClick={goBack}>
                                <Maximize2 className="size-4" />
                            </DockButton>
                            <DockButton
                                label="Close video"
                                onClick={closeVideo}
                            >
                                <X className="size-4" />
                            </DockButton>
                        </div>

                        <div
                            onPointerDown={startResize}
                            onPointerMove={move}
                            onPointerUp={endInteraction}
                            onPointerCancel={endInteraction}
                            onLostPointerCapture={endInteraction}
                            aria-hidden
                            className={cn(
                                'absolute size-6 touch-none',
                                resizeHandles[corner],
                                {
                                    'pointer-events-auto':
                                        isShowingControls || isInteracting,
                                },
                                'group-has-focus-visible/dock:pointer-events-auto [@media(hover:none)]:pointer-events-auto',
                            )}
                            data-test="video-dock-resize"
                        >
                            <span
                                className={cn(
                                    'absolute size-2.5 border-white/80',
                                    resizeGrips[corner],
                                )}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function DockButton({
    label,
    onClick,
    children,
}: {
    label: string;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onClick}
            onPointerDown={(event) => event.stopPropagation()}
            className="relative flex size-8 cursor-pointer items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
        >
            {children}
        </button>
    );
}
