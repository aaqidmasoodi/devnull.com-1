import { usePage } from '@inertiajs/react';
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
    setVideoFloating,
    takeClaimedSlot,
    takePopOutRequest,
    useDockedVideo,
    videoSlot,
    writeDockPlacement,
} from '@/lib/video-dock';
import type { DockedVideo } from '@/lib/video-dock';
import {
    afterEmbedLeft,
    closeAction,
    returnsByItself,
    cornerBox,
    dockSize,
    isSpringSettled,
    restingVelocity,
    stepSpring,
    popOutBelow,
    returnAbove,
    visibleFraction,
    nearestCorner,
    oppositeCorner,
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
import {
    canGoFullscreen,
    goFullscreen,
    playerApiSrc,
    watchPlayback,
} from '@/lib/video-player-state';
import type { Playback } from '@/lib/video-player-state';

/**
 * How long a page has to hold still before the player moves: long enough for the page to restore its scroll after a
 * visit, and for a list that re-renders the post to put it back.
 */
const settleDelay = 150;
const controlsDelay = 1500;

/**
 * Frames further apart than this, like after the tab was in the background, move the spring no further than one would.
 */
const longestFrame = 1 / 20;

const corners: Corner[] = [
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
];

/**
 * Each handle sits over a corner from just outside the player, its arc drawn for the top left and turned to fit.
 */
const resizeHandles: Record<Corner, string> = {
    'top-left': '-top-3.5 -left-3.5 cursor-nwse-resize',
    'top-right': '-top-3.5 -right-3.5 rotate-90 cursor-nesw-resize',
    'bottom-right': '-right-3.5 -bottom-3.5 rotate-180 cursor-nwse-resize',
    'bottom-left': '-bottom-3.5 -left-3.5 -rotate-90 cursor-nesw-resize',
};

type Stage =
    | 'pending'
    | 'inline'
    | 'holding'
    | 'to-slot'
    | 'to-corner'
    | 'floating';

type Interaction =
    | { kind: 'drag'; offset: Point; samples: (Point & { time: number })[] }
    | { kind: 'resize'; anchor: Corner; start: Box; length: number };

type Controller = {
    stage: Stage;
    since: number;
    slot: HTMLElement | null;
    candidate: HTMLElement | null;
    candidateSince: number;
    box: Box;
    lastSlotRect: Box;
    slotVelocity: Box;
    velocity: Box;
    lastFrame: number;
    placement: DockPlacement;
    interaction: Interaction | null;
    wasPoppedOutByHand: boolean;
    hiddenSince: number | null;
    playback: Playback;
    isAutomatic: boolean;
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
    const { autoPictureInPicture } = usePage().props;
    const wrapper = useRef<HTMLDivElement>(null);
    const frame = useRef<HTMLIFrameElement>(null);
    const [src] = useState(() =>
        playerApiSrc(video.src, window.location.origin),
    );
    const [isFullscreenSupported] = useState(canGoFullscreen);
    const surface = useRef<HTMLDivElement>(null);
    const controller = useRef<Controller | null>(null);
    const hideControls = useRef<number | null>(null);
    const [isFloating, setIsFloating] = useState(false);
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
                slotVelocity: restingVelocity,
                velocity: restingVelocity,
                lastFrame: performance.now(),
                placement: readDockPlacement(viewport()),
                interaction: null,
                wasPoppedOutByHand: false,
                hiddenSince: null,
                playback: 'unknown',
                isAutomatic: autoPictureInPicture,
            };
        }

        return controller.current;
    };

    const place = (position: 'absolute' | 'fixed', box: Box) => {
        const element = wrapper.current;

        if (element === null) {
            return;
        }

        element.style.position = position;
        element.style.transform = `translate3d(${box.x}px, ${box.y}px, 0)`;
        element.style.width = `${box.width}px`;
        element.style.height = `${box.height}px`;
        element.style.visibility = 'visible';
        state().box = box;
    };

    /**
     * Pins the player to the viewport where the embed is now, so it can fly off from there.
     */
    const lift = () => {
        const current = state();

        if (current.stage === 'inline') {
            place('fixed', current.lastSlotRect);
        }
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
        current.hiddenSince = null;
        current.velocity = restingVelocity;
        current.slotVelocity = restingVelocity;
        current.lastSlotRect = toBox(slot.getBoundingClientRect());

        if (surface.current !== null) {
            surface.current.style.borderRadius = slotRadius(slot);
        }

        place('absolute', documentBox(slot));
        setIsFloating(false);
    };

    const flyInto = (slot: HTMLElement) => {
        const current = state();

        lift();
        current.stage = 'to-slot';
        current.slot = slot;
        current.candidate = null;
        current.hiddenSince = null;
        setIsFloating(false);

        if (surface.current !== null) {
            surface.current.style.borderRadius = slotRadius(slot);
        }
    };

    /**
     * Leaving an embed that is scrolling, the player sets off at the embed's speed, so it peels away rather than stops.
     */
    const flyToCorner = () => {
        const current = state();

        if (current.stage === 'inline') {
            lift();
            current.velocity = current.slotVelocity;
        }

        current.stage = 'to-corner';
        current.slot = null;
        current.candidate = null;
        current.hiddenSince = null;
        setIsFloating(true);

        if (surface.current !== null) {
            surface.current.style.borderRadius = '';
        }
    };

    /**
     * Moves the player one frame along its spring toward where the target is now, and says whether it has arrived.
     */
    const chase = (target: Box, seconds: number): boolean => {
        const current = state();

        if (prefersReducedMotion()) {
            current.velocity = restingVelocity;
            place('fixed', target);

            return true;
        }

        const spring = stepSpring(
            { position: current.box, velocity: current.velocity },
            target,
            seconds,
        );
        const hasArrived = isSpringSettled(spring, target);

        current.velocity = hasArrived ? restingVelocity : spring.velocity;
        place('fixed', hasArrived ? target : spring.position);

        return hasArrived;
    };

    /**
     * A playing video leaves its embed once the embed has all but scrolled away, after it has stayed away a moment.
     */
    const hasScrolledPast = (rect: DOMRect, now: number): boolean => {
        const current = state();
        const isAway =
            current.isAutomatic &&
            visibleFraction(rect, viewport()) < popOutBelow &&
            current.playback !== 'paused';

        if (!isAway) {
            current.hiddenSince = null;

            return false;
        }

        current.hiddenSince ??= now;

        return now - current.hiddenSince >= settleDelay;
    };

    /**
     * Only the page the video was playing on takes it back by itself; anywhere else, its embeds offer to.
     */
    const homeSlot = (): HTMLElement | null =>
        currentPageUrl() === dockedVideo()?.pageUrl
            ? videoSlot(video.src)
            : null;

    const close = () => {
        const current = state();
        const slot = homeSlot();
        const fraction =
            slot === null
                ? null
                : visibleFraction(slot.getBoundingClientRect(), viewport());

        if (slot === null || closeAction(fraction) === 'stop') {
            closeVideo();

            return;
        }

        current.wasPoppedOutByHand = false;
        flyInto(slot);
    };

    useLayoutEffect(() => {
        let frame = 0;

        const tick = (now: number) => {
            frame = requestAnimationFrame(tick);

            const current = state();
            const seconds = Math.min(
                (now - current.lastFrame) / 1000,
                longestFrame,
            );

            current.lastFrame = now;

            if (current.interaction !== null) {
                return;
            }

            const claimed = takeClaimedSlot();

            if (claimed !== null) {
                current.wasPoppedOutByHand = false;

                if (current.stage === 'pending') {
                    attach(claimed);
                } else if (
                    claimed !== current.slot ||
                    current.stage !== 'inline'
                ) {
                    flyInto(claimed);
                }

                return;
            }

            if (current.stage === 'inline') {
                const slot = current.slot;

                // Popped out by hand, it stays out on every page until Play here or closing it asks it back.
                if (takePopOutRequest() && slot !== null && slot.isConnected) {
                    current.wasPoppedOutByHand = true;
                    flyToCorner();

                    return;
                }

                if (slot !== null && slot.isConnected) {
                    const rect = slot.getBoundingClientRect();
                    const box = documentBox(slot);
                    const viewportBox = toBox(rect);

                    if (seconds > 0) {
                        current.slotVelocity = {
                            x:
                                (viewportBox.x - current.lastSlotRect.x) /
                                seconds,
                            y:
                                (viewportBox.y - current.lastSlotRect.y) /
                                seconds,
                            width: 0,
                            height: 0,
                        };
                    }

                    current.lastSlotRect = viewportBox;

                    if (!isSameBox(box, current.box)) {
                        place('absolute', box);
                    }

                    if (hasScrolledPast(rect, now)) {
                        flyToCorner();
                    }

                    return;
                }

                lift();
                current.slot = null;
                current.slotVelocity = restingVelocity;
                current.stage = 'holding';
                current.since = now;
            }

            if (current.stage === 'to-slot') {
                const slot = current.slot;

                if (slot === null || !slot.isConnected) {
                    current.slot = null;
                    current.stage = 'holding';
                    current.since = now;

                    return;
                }

                const rect = slot.getBoundingClientRect();

                // Scrolled away again before it got there, it turns back for the corner.
                if (hasScrolledPast(rect, now)) {
                    flyToCorner();

                    return;
                }

                if (chase(toBox(rect), seconds)) {
                    attach(slot);
                }

                return;
            }

            const slot = homeSlot();
            const visibleSlot =
                returnsByItself(
                    current.isAutomatic,
                    current.wasPoppedOutByHand,
                ) &&
                slot !== null &&
                visibleFraction(slot.getBoundingClientRect(), viewport()) >=
                    returnAbove
                    ? slot
                    : null;

            if (current.stage === 'pending') {
                // Just played from its embed, it starts there, however much of the embed is showing.
                if (slot !== null) {
                    attach(slot);
                } else if (now - current.since >= settleDelay) {
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
                if (now - current.since < settleDelay) {
                    return;
                }

                const action = afterEmbedLeft(
                    current.isAutomatic,
                    slot !== null,
                );

                if (action === 'float') {
                    flyToCorner();
                } else if (action === 'return' && slot !== null) {
                    flyInto(slot);
                } else {
                    closeVideo();
                }

                return;
            }

            const target = cornerTarget();

            if (current.stage === 'floating') {
                if (!isSameBox(target, current.box)) {
                    current.stage = 'to-corner';
                }

                return;
            }

            if (chase(target, seconds)) {
                current.stage = 'floating';
            }
        };

        frame = requestAnimationFrame(tick);

        return () => cancelAnimationFrame(frame);
        // The player is keyed by its video, and everything else it reads lives in the controller.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => setVideoFloating(isFloating), [isFloating]);

    useEffect(() => {
        state().isAutomatic = autoPictureInPicture;
        // The controller is created once and lives as long as the player.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoPictureInPicture]);

    useEffect(() => {
        if (frame.current === null) {
            return;
        }

        return watchPlayback(frame.current, src, (playback) => {
            state().playback = playback;
        });
        // The controller is created once and lives as long as the player.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src]);

    useEffect(
        () => () => {
            setVideoFloating(false);

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
        const current = state();

        // It can be caught mid-flight to its corner, as well as once it rests there.
        if (
            event.button !== 0 ||
            (current.stage !== 'floating' && current.stage !== 'to-corner')
        ) {
            return;
        }

        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        current.interaction = interaction;
        current.velocity = restingVelocity;
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

    const startResize = (
        event: ReactPointerEvent<HTMLDivElement>,
        handle: Corner,
    ) => {
        const { box, placement } = state();

        startInteraction(event, {
            kind: 'resize',
            anchor: oppositeCorner(handle),
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

        const { anchor, start } = interaction;
        const resized = dockSize(
            resizedLength(
                anchor,
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
            x: anchor.endsWith('right')
                ? start.x + start.width - resized.width
                : start.x,
            y: anchor.startsWith('bottom')
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
            const fling = {
                x: (event.clientX - first.x) / elapsed,
                y: (event.clientY - first.y) / elapsed,
            };

            current.placement = {
                ...current.placement,
                corner: nearestCorner(
                    {
                        x: box.x + box.width / 2,
                        y: box.y + box.height / 2,
                    },
                    fling,
                    viewport(),
                ),
            };
            // The throw carries on into the spring, so letting go doesn't stop it dead before it settles.
            current.velocity = {
                x: fling.x * 1000,
                y: fling.y * 1000,
                width: 0,
                height: 0,
            };
        } else {
            current.placement = {
                ...current.placement,
                length: interaction.length,
            };
        }

        writeDockPlacement(current.placement);
        current.stage = 'to-corner';
    };

    const areControlsActive = isShowingControls || isInteracting;
    const controlPointerEvents = cn(
        'group-has-focus-visible/dock:pointer-events-auto [@media(hover:none)]:pointer-events-auto',
        { 'pointer-events-auto': areControlsActive },
    );

    return (
        <div
            ref={wrapper}
            role={isFloating ? 'region' : undefined}
            aria-label={isFloating ? 'Video player' : undefined}
            onPointerEnter={showControls}
            onPointerLeave={scheduleHidingControls}
            className={cn(
                'group/dock invisible fixed top-0 left-0 will-change-transform',
                // Only while floating: in its post, it belongs under the sticky headers like the rest of the page.
                isFloating ? 'z-40 [view-transition-name:video-dock]' : 'z-1',
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
                    ref={frame}
                    src={src}
                    title={video.title}
                    className={cn('h-full bg-black', {
                        'pointer-events-none': isInteracting,
                    })}
                />
            </div>

            {isFloating && (
                <div
                    className={cn(
                        'pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-has-focus-visible/dock:opacity-100 [@media(hover:none)]:opacity-100',
                        { 'opacity-100': areControlsActive },
                    )}
                >
                    {corners.map((handle) => (
                        <div
                            key={handle}
                            onPointerDown={(event) =>
                                startResize(event, handle)
                            }
                            onPointerMove={move}
                            onPointerUp={endInteraction}
                            onPointerCancel={endInteraction}
                            onLostPointerCapture={endInteraction}
                            aria-hidden
                            className={cn(
                                'group/handle absolute size-10 touch-none',
                                resizeHandles[handle],
                                controlPointerEvents,
                            )}
                            data-test="video-dock-resize"
                        >
                            <svg
                                viewBox="0 0 40 40"
                                className="size-full text-neutral-900 drop-shadow-[0_1px_3px_rgb(0_0_0/0.2)] transition-transform duration-200 group-hover/handle:scale-110 dark:text-white dark:drop-shadow-[0_1px_3px_rgb(0_0_0/0.45)]"
                            >
                                <path
                                    d="M7 26A19 19 0 0 1 26 7"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={5}
                                    strokeLinecap="round"
                                />
                            </svg>
                        </div>
                    ))}

                    <div className="absolute top-[calc(100%+8px)] left-1/2 flex -translate-x-1/2 items-center gap-2">
                        <DockButton
                            label="Close video"
                            onClick={close}
                            className={controlPointerEvents}
                        >
                            <X className="size-4" />
                        </DockButton>
                        <div
                            onPointerDown={startDrag}
                            onPointerMove={move}
                            onPointerUp={endInteraction}
                            onPointerCancel={endInteraction}
                            onLostPointerCapture={endInteraction}
                            aria-hidden
                            className={cn(
                                'group/grabber flex h-8 w-32 touch-none items-center justify-center select-none',
                                isInteracting
                                    ? 'cursor-grabbing'
                                    : 'cursor-grab',
                                controlPointerEvents,
                            )}
                            data-test="video-dock-handle"
                        >
                            <span className="h-2 w-28 rounded-full bg-neutral-900 shadow-[0_2px_8px_rgb(0_0_0/0.2)] transition-[width] duration-200 group-hover/grabber:w-32 dark:bg-white dark:shadow-[0_0_0_1px_rgb(0_0_0/0.15),0_2px_8px_rgb(0_0_0/0.35)]" />
                        </div>
                        <DockButton
                            label="Full screen"
                            onClick={() =>
                                frame.current && goFullscreen(frame.current)
                            }
                            className={cn(
                                controlPointerEvents,
                                !isFullscreenSupported && 'invisible',
                            )}
                        >
                            <Maximize2 className="size-4" />
                        </DockButton>
                    </div>
                </div>
            )}
        </div>
    );
}

function DockButton({
    label,
    onClick,
    className,
    children,
}: {
    label: string;
    onClick: () => void;
    className?: string;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onClick}
            onPointerDown={(event) => event.stopPropagation()}
            className={cn(
                'flex size-8 cursor-pointer items-center justify-center rounded-full bg-neutral-900 text-white shadow-[0_2px_8px_rgb(0_0_0/0.2)] transition-colors hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-neutral-900/40 focus-visible:ring-offset-2 focus-visible:outline-none dark:bg-white dark:text-neutral-900 dark:shadow-[0_2px_8px_rgb(0_0_0/0.35)] dark:hover:bg-neutral-200 dark:focus-visible:ring-white/60',
                className,
            )}
        >
            {children}
        </button>
    );
}
