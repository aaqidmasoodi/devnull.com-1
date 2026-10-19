import { AudioLines, Code2, PictureInPicture2, Play } from 'lucide-react';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { useCallback, useState } from 'react';
import { ActionTooltip } from '@/components/action-tooltip';
import { cn } from '@/lib/utils';
import {
    playVideo,
    playVideoHere,
    popOutVideo,
    registerVideoSlot,
    useDockedVideo,
    useIsVideoFloating,
} from '@/lib/video-dock';
import { parseAspectRatio } from '@/lib/video-dock-geometry';
import type { Embed, LinkPreview } from '@/types';

const icons = { video: Play, audio: AudioLines, code: Code2 };

function isTall(embed: Embed): boolean {
    const aspectRatio = parseAspectRatio(embed.aspect_ratio);

    return aspectRatio !== null && aspectRatio < 1;
}

function frameStyle(embed: Embed): CSSProperties {
    return embed.aspect_ratio === null
        ? { height: embed.height ?? undefined }
        : { aspectRatio: embed.aspect_ratio };
}

function Thumbnail({
    src,
    className,
}: {
    src: string | null;
    className?: string;
}) {
    const [isBroken, setIsBroken] = useState(false);

    if (!src || isBroken) {
        return <span className={cn('bg-muted', className)} />;
    }

    return (
        <img
            src={src}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setIsBroken(true)}
            className={cn('bg-muted object-cover', className)}
        />
    );
}

export function EmbedFrame({
    src,
    title,
    style,
    className,
    ref,
}: {
    src: string;
    title: string;
    style?: CSSProperties;
    className?: string;
    ref?: Ref<HTMLIFrameElement>;
}) {
    return (
        <iframe
            ref={ref}
            src={src}
            title={title}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            style={style}
            className={cn('block w-full border-0 bg-muted', className)}
            data-test="link-embed-frame"
        />
    );
}

/**
 * Where a playing video sits in the post. The player itself lives in the layout and is laid over this slot, so it keeps
 * playing in a corner of the screen once the post is gone. While it plays there, the slot says so and offers to bring it
 * back.
 */
function VideoSlot({ embed, poster }: { embed: Embed; poster: string | null }) {
    const register = useCallback(
        (element: HTMLDivElement | null) =>
            element === null
                ? undefined
                : registerVideoSlot(embed.src, element),
        [embed.src],
    );

    return (
        <div
            ref={register}
            style={frameStyle(embed)}
            className="relative block w-full overflow-hidden"
            data-test="link-embed-slot"
        >
            <Thumbnail
                src={poster}
                className="absolute inset-0 size-full scale-110 opacity-50 blur-md"
            />
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 p-4 text-center text-white">
                <PictureInPicture2 aria-hidden className="size-7 opacity-80" />
                <span className="text-sm font-medium">
                    Playing in picture-in-picture
                </span>
                <button
                    type="button"
                    onClick={(event) => {
                        const slot = event.currentTarget.closest<HTMLElement>(
                            '[data-test="link-embed-slot"]',
                        );

                        if (slot !== null) {
                            playVideoHere(slot);
                        }
                    }}
                    className="flex cursor-pointer items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-sm font-medium ring-1 ring-white/25 backdrop-blur-sm transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
                    data-test="link-embed-play-here"
                >
                    <Play aria-hidden className="size-3.5 fill-current" />
                    Play here
                </button>
            </span>
        </div>
    );
}

function Details({ preview, embed }: { preview: LinkPreview; embed: Embed }) {
    return (
        <span className="flex min-w-0 flex-1 flex-col justify-center text-left">
            <span className="truncate font-mono text-[13px] text-muted-foreground">
                {preview.site_name ?? embed.provider}
            </span>
            {preview.title && (
                <span className="line-clamp-2 text-[15px] leading-snug font-medium wrap-break-word">
                    {preview.title}
                </span>
            )}
        </span>
    );
}

function PlayTrigger({
    isStatic,
    label,
    onPlay,
    style,
    className,
    children,
}: {
    isStatic: boolean;
    label: string;
    onPlay: () => void;
    style?: CSSProperties;
    className: string;
    children: ReactNode;
}) {
    if (isStatic) {
        return (
            <span style={style} className={className}>
                {children}
            </span>
        );
    }

    return (
        <button
            type="button"
            onClick={onPlay}
            aria-label={label}
            style={style}
            className={cn(
                'cursor-pointer focus-visible:outline-none',
                className,
            )}
            data-test="link-embed-play"
        >
            {children}
        </button>
    );
}

export function LinkEmbed({
    preview,
    embed,
    isStatic = false,
}: {
    preview: LinkPreview;
    embed: Embed;
    isStatic?: boolean;
}) {
    const [isPlaying, setIsPlaying] = useState(false);
    const dockedVideo = useDockedVideo();
    const isVideoFloating = useIsVideoFloating();
    const Icon = icons[embed.kind];
    const label = `Play ${preview.title ?? preview.url} from ${embed.provider}`;
    const isVideo = embed.aspect_ratio !== null;
    const poster = preview.image_url ?? embed.poster ?? null;
    const title = preview.title ?? `${embed.provider} player`;
    const aspectRatio = parseAspectRatio(embed.aspect_ratio);
    const isDocked = !isStatic && dockedVideo?.src === embed.src;
    const play = () =>
        aspectRatio === null
            ? setIsPlaying(true)
            : playVideo({
                  src: embed.src,
                  title,
                  aspectRatio,
              });

    const frame = (
        <EmbedFrame src={embed.src} title={title} style={frameStyle(embed)} />
    );

    return (
        <div
            onClick={isStatic ? undefined : (event) => event.stopPropagation()}
            className="mt-3 overflow-hidden rounded-lg border"
            data-test="link-embed"
            data-provider={embed.provider}
        >
            {isVideo ? (
                <>
                    <div
                        className={cn(
                            'mx-auto bg-black',
                            isTall(embed) && 'max-w-[min(100%,20rem)]',
                        )}
                    >
                        {isPlaying ? (
                            frame
                        ) : isDocked ? (
                            <VideoSlot embed={embed} poster={poster} />
                        ) : (
                            <PlayTrigger
                                isStatic={isStatic}
                                label={label}
                                onPlay={play}
                                style={frameStyle(embed)}
                                className="group relative block w-full overflow-hidden"
                            >
                                <Thumbnail
                                    src={poster}
                                    className="absolute inset-0 size-full"
                                />
                                <span className="absolute inset-0 bg-black/20 transition-colors group-hover:bg-black/10" />
                                <span className="absolute top-1/2 left-1/2 flex size-14 -translate-1/2 items-center justify-center rounded-full bg-black/70 text-white ring-white/60 transition-transform group-hover:scale-105 group-focus-visible:ring-2">
                                    <Icon className="ml-0.5 size-6 fill-current" />
                                </span>
                            </PlayTrigger>
                        )}
                    </div>
                    {isStatic ? (
                        <span className="flex border-t px-3 py-2">
                            <Details preview={preview} embed={embed} />
                        </span>
                    ) : (
                        <div className="flex border-t">
                            <a
                                href={preview.url}
                                target="_blank"
                                rel="noopener noreferrer nofollow ugc"
                                className="flex min-w-0 flex-1 px-3 py-2 transition-colors hover:bg-accent focus-visible:bg-accent"
                            >
                                <Details preview={preview} embed={embed} />
                            </a>
                            {isDocked && !isVideoFloating && (
                                <span className="flex items-center pr-2 pl-1">
                                    <ActionTooltip label="Picture-in-picture">
                                        <button
                                            type="button"
                                            onClick={popOutVideo}
                                            aria-label="Play in picture-in-picture"
                                            className="flex size-9 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:outline-none"
                                            data-test="link-embed-pop-out"
                                        >
                                            <PictureInPicture2 className="size-5" />
                                        </button>
                                    </ActionTooltip>
                                </span>
                            )}
                        </div>
                    )}
                </>
            ) : isPlaying ? (
                frame
            ) : (
                <PlayTrigger
                    isStatic={isStatic}
                    label={label}
                    onPlay={play}
                    className={cn(
                        'group flex w-full items-center',
                        !isStatic &&
                            'transition-colors hover:bg-accent focus-visible:bg-accent',
                    )}
                >
                    <span className="relative my-2 ml-2 size-20 shrink-0 overflow-hidden rounded-md">
                        <Thumbnail src={poster} className="size-full" />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white transition-colors group-hover:bg-black/40">
                            <Icon className="size-7 fill-current" />
                        </span>
                    </span>
                    <span className="flex min-w-0 flex-1 px-3 py-2">
                        <Details preview={preview} embed={embed} />
                    </span>
                </PlayTrigger>
            )}
        </div>
    );
}
