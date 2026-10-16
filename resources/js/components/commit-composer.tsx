import { Form } from '@inertiajs/react';
import { Loader2, Plus, Sparkles, Wand2, X } from 'lucide-react';
import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import CommitController from '@/actions/App/Http/Controllers/CommitController';
import CommitSeriesController from '@/actions/App/Http/Controllers/CommitSeriesController';
import {
    ImagePickerButton,
    ImagePickerPreviews,
    imageErrorFrom,
} from '@/components/commit-image-picker';
import { EmojiSuggestionHint } from '@/components/emoji-suggestion';
import { GraphRail, RailAvatar } from '@/components/graph-rail';
import InputError from '@/components/input-error';
import { MentionTextarea } from '@/components/mention-textarea';
import { StashLabel } from '@/components/stash-label';
import { Button } from '@/components/ui/button';
import { useImageAttachments } from '@/hooks/use-image-attachments';
import { moveCaretToEnd, useSeriesStash } from '@/hooks/use-stash';
import { useAIIntegration } from '@/hooks/use-ai-integration';
import { useUser } from '@/hooks/use-user';
import { completeEmoji, suggestEmoji } from '@/lib/emoji';
import { composeWithAI, rewriteWithAI } from '@/lib/ai-providers';
import { characterCount, cn, laneColor } from '@/lib/utils';

const minBodyLength = 3;
const maxBodyLength = 280;
const maxParts = 10;

const partId = (index: number): string =>
    index === 0 ? 'body' : `body-${index + 1}`;

function focusPart(index: number, atEnd = false): void {
    requestAnimationFrame(() => {
        const part = document.getElementById(partId(index));

        if (!(part instanceof HTMLTextAreaElement)) {
            return;
        }

        part.focus();

        if (atEnd) {
            part.setSelectionRange(part.value.length, part.value.length);
        }
    });
}

function RemainingCount({ id, body }: { id: string; body: string }) {
    const remaining = maxBodyLength - characterCount(body);

    return (
        <span
            id={id}
            aria-label={`${remaining} characters left`}
            className={cn('font-mono text-[13px] text-muted-foreground', {
                'text-amber-700 dark:text-amber-400': remaining <= 20,
                'text-destructive': remaining === 0,
            })}
        >
            {remaining}
        </span>
    );
}

export function CommitComposer() {
    const { user } = useUser();
    const { bodies, isRestored, updateBody, insertPart, removePart, drop } =
        useSeriesStash(user.id, 'commit');
    const attachments = useImageAttachments();
    const { config: aiConfig } = useAIIntegration();
    const [aiMode, setAIMode] = useState<
        'idle' | 'rewriting' | 'compose-input' | 'composing'
    >('idle');
    const [composePrompt, setComposePrompt] = useState('');
    const [aiError, setAIError] = useState<string | null>(null);

    const isSeries = bodies.length > 1;
    const canAddPart = bodies.length < maxParts;
    const isCommittable = bodies.every(
        (body) => characterCount(body.trim()) >= minBodyLength,
    );

    const addPartAfter = (index: number) => {
        if (!canAddPart) {
            return;
        }

        insertPart(index + 1);
        focusPart(index + 1);
    };

    const removePartAt = (index: number) => {
        removePart(index);
        focusPart(Math.max(index - 1, 0), true);
    };

    const onKeyDown = (
        index: number,
        event: KeyboardEvent<HTMLTextAreaElement>,
    ) => {
        if (event.key === 'Tab' && suggestEmoji(bodies[index]) !== null) {
            const completed = completeEmoji(bodies[index]);

            if (completed !== null) {
                event.preventDefault();
                updateBody(index, completed);
            }

            return;
        }

        const isModEnter =
            event.key === 'Enter' && (event.metaKey || event.ctrlKey);

        if (isModEnter && event.shiftKey) {
            event.preventDefault();
            addPartAfter(index);

            return;
        }

        if (isModEnter && isCommittable) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();

            return;
        }

        if (event.key === 'Backspace' && isSeries && bodies[index] === '') {
            event.preventDefault();
            removePartAt(index);
        }
    };

    const handleRewrite = async (index: number): Promise<void> => {
        const body = bodies[index];
        if (!aiConfig || !body.trim()) return;
        setAIMode('rewriting');
        setAIError(null);
        try {
            const result = await rewriteWithAI(body, aiConfig);
            updateBody(index, result.slice(0, maxBodyLength));
        } catch (err) {
            setAIError(
                err instanceof Error
                    ? err.message
                    : 'Rewrite failed. Check your API key.',
            );
        } finally {
            setAIMode('idle');
        }
    };

    const handleCompose = async (index: number): Promise<void> => {
        if (!aiConfig || !composePrompt.trim()) return;
        setAIMode('composing');
        setAIError(null);
        try {
            const result = await composeWithAI(composePrompt, aiConfig);
            updateBody(index, result.slice(0, maxBodyLength));
            setComposePrompt('');
            setAIMode('idle');
        } catch (err) {
            setAIError(
                err instanceof Error
                    ? err.message
                    : 'Compose failed. Check your API key.',
            );
            setAIMode('compose-input');
        }
    };

    return (
        <Form
            {...(isSeries
                ? CommitSeriesController.store.form()
                : CommitController.store.form())}
            transform={(data) =>
                attachments.images.length > 0
                    ? { ...data, images: attachments.images }
                    : data
            }
            options={{ preserveScroll: true }}
            onSuccess={(page) => {
                if (!page.flash.committed) {
                    return;
                }

                drop();
                attachments.clear();
                focusPart(0);
                setAIMode('idle');
                setComposePrompt('');
                setAIError(null);
            }}
            className="flex flex-col"
            data-test="commit-composer"
        >
            {({ processing, errors }) => (
                <>
                    {bodies.map((body, index) => {
                        const id = partId(index);
                        const isLast = index === bodies.length - 1;
                        const isFilled =
                            characterCount(body.trim()) >= minBodyLength;
                        const suggestion = suggestEmoji(body);
                        const error =
                            errors[`bodies.${index}`] ??
                            (index === 0 ? errors.body : undefined);

                        return (
                            <div
                                key={index}
                                className="flex"
                                data-test="commit-composer-part"
                            >
                                <GraphRail
                                    lane={laneColor(user.lane)}
                                    previousLane={
                                        index > 0 ? 'var(--rail)' : undefined
                                    }
                                    variant="staged"
                                    isFilled={isFilled}
                                    node={
                                        index === 0 ? (
                                            <RailAvatar
                                                user={user}
                                                isStaged={!isFilled}
                                            />
                                        ) : undefined
                                    }
                                />

                                <div
                                    className={cn(
                                        'flex min-w-0 flex-1 pt-3 pr-4',
                                        { 'border-b pb-3': isLast },
                                    )}
                                >
                                    <div className="min-w-0 flex-1">
                                        <label htmlFor={id} className="sr-only">
                                            {isSeries
                                                ? `Commit ${index + 1} of ${bodies.length}`
                                                : 'Body'}
                                        </label>
                                        <MentionTextarea
                                            id={id}
                                            name={
                                                isSeries ? 'bodies[]' : 'body'
                                            }
                                            rows={1}
                                            value={body}
                                            onValueChange={(text) =>
                                                updateBody(index, text)
                                            }
                                            onPaste={
                                                index === 0
                                                    ? attachments.onPaste
                                                    : undefined
                                            }
                                            onDragOver={
                                                index === 0
                                                    ? attachments.onDragOver
                                                    : undefined
                                            }
                                            onDrop={
                                                index === 0
                                                    ? attachments.onDrop
                                                    : undefined
                                            }
                                            onKeyDown={(event) =>
                                                onKeyDown(index, event)
                                            }
                                            onFocus={
                                                isRestored
                                                    ? moveCaretToEnd
                                                    : undefined
                                            }
                                            maxLength={maxBodyLength}
                                            placeholder={
                                                index === 0
                                                    ? 'What did you ship?'
                                                    : 'And then?'
                                            }
                                            autoComplete="off"
                                            aria-invalid={
                                                error ? true : undefined
                                            }
                                            aria-describedby={`${id}-count`}
                                            className={cn(
                                                'block field-sizing-content min-h-10 w-full resize-none overflow-x-hidden bg-transparent py-1.5 text-[17px] leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:outline-none transition-opacity duration-150',
                                                isLast &&
                                                    (aiMode === 'rewriting' ||
                                                        aiMode ===
                                                            'composing') &&
                                                    'opacity-40',
                                            )}
                                        />

                                        <EmojiSuggestionHint
                                            suggestion={suggestion}
                                            className="mt-1.5"
                                        />

                                        <InputError message={error} />

                                        {index === 0 && (
                                            <>
                                                <ImagePickerPreviews
                                                    images={attachments.images}
                                                    onRemove={
                                                        attachments.remove
                                                    }
                                                />
                                                <InputError
                                                    message={
                                                        attachments.error ??
                                                        imageErrorFrom(errors)
                                                    }
                                                    className="mt-1"
                                                />
                                            </>
                                        )}

                                        {isSeries && (
                                            <div className="mt-1 flex items-center gap-3">
                                                <span
                                                    className="font-mono text-[13px] text-muted-foreground"
                                                    data-test="commit-composer-position"
                                                >
                                                    {index + 1}/{bodies.length}
                                                </span>
                                                <span className="ml-auto">
                                                    <RemainingCount
                                                        id={`${id}-count`}
                                                        body={body}
                                                    />
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        removePartAt(index)
                                                    }
                                                    aria-label={`Remove commit ${index + 1}`}
                                                    title="Remove this commit"
                                                    className="-mr-1.5 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                                    data-test="remove-commit-part-button"
                                                >
                                                    <X className="size-4" />
                                                </button>
                                            </div>
                                        )}

                                        {isLast && (
                                            <>
                                                <InputError
                                                    message={errors.bodies}
                                                />

                                                <div className="mt-2 flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
                                                    <div className="mr-auto flex min-w-0 items-center gap-3">
                                                        <ImagePickerButton
                                                            count={
                                                                attachments
                                                                    .images
                                                                    .length
                                                            }
                                                            disabled={
                                                                processing
                                                            }
                                                            onPick={
                                                                attachments.attach
                                                            }
                                                            className="-ml-2"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                addPartAfter(
                                                                    index,
                                                                )
                                                            }
                                                            disabled={
                                                                !canAddPart
                                                            }
                                                            title={
                                                                canAddPart
                                                                    ? 'Add another commit (⌘/Ctrl + Shift + Enter)'
                                                                    : `A series has at most ${maxParts} commits`
                                                            }
                                                            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                                                            data-test="add-commit-part-button"
                                                        >
                                                            <Plus className="size-4" />
                                                            Add commit
                                                        </button>
                                                        {isRestored && (
                                                            <StashLabel
                                                                onDrop={() => {
                                                                    drop();
                                                                    focusPart(
                                                                        0,
                                                                    );
                                                                }}
                                                                className="text-[13px]"
                                                            />
                                                        )}
                                                        {aiConfig && (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        void handleRewrite(
                                                                            index,
                                                                        )
                                                                    }
                                                                    disabled={
                                                                        processing ||
                                                                        aiMode !==
                                                                            'idle' ||
                                                                        !bodies[
                                                                            index
                                                                        ].trim()
                                                                    }
                                                                    title="Rewrite with AI"
                                                                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                                                                    data-test="rewrite-with-ai-button"
                                                                >
                                                                    {aiMode ===
                                                                    'rewriting' ? (
                                                                        <Loader2 className="size-4 animate-spin" />
                                                                    ) : (
                                                                        <Sparkles className="size-4" />
                                                                    )}
                                                                    {aiMode ===
                                                                    'rewriting'
                                                                        ? 'Rewriting…'
                                                                        : 'Rewrite'}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setAIMode(
                                                                            aiMode ===
                                                                                'compose-input'
                                                                                ? 'idle'
                                                                                : 'compose-input',
                                                                        )
                                                                    }
                                                                    disabled={
                                                                        processing ||
                                                                        aiMode ===
                                                                            'rewriting' ||
                                                                        aiMode ===
                                                                            'composing'
                                                                    }
                                                                    title="Compose with AI"
                                                                    className={cn(
                                                                        'flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-50',
                                                                        aiMode ===
                                                                            'compose-input'
                                                                            ? 'bg-accent text-foreground'
                                                                            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                                                                    )}
                                                                    data-test="compose-with-ai-button"
                                                                >
                                                                    <Wand2 className="size-4" />
                                                                    Compose
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                    {!isSeries && (
                                                        <RemainingCount
                                                            id="body-count"
                                                            body={body}
                                                        />
                                                    )}
                                                    <Button
                                                        type="submit"
                                                        disabled={
                                                            processing ||
                                                            !isCommittable
                                                        }
                                                        title="Commit (⌘/Ctrl + Enter)"
                                                        className="min-w-[7.5rem]"
                                                        data-test="create-commit-button"
                                                    >
                                                        {processing
                                                            ? 'Committing…'
                                                            : isSeries
                                                              ? `Commit ${bodies.length}`
                                                              : 'Commit'}
                                                    </Button>
                                                </div>
                                                {aiConfig &&
                                                    (aiMode ===
                                                        'compose-input' ||
                                                        aiMode ===
                                                            'composing') && (
                                                        <div className="mt-2 flex items-center gap-2">
                                                            <input
                                                                type="text"
                                                                value={
                                                                    composePrompt
                                                                }
                                                                onChange={(e) =>
                                                                    setComposePrompt(
                                                                        e.target
                                                                            .value,
                                                                    )
                                                                }
                                                                onKeyDown={(
                                                                    e,
                                                                ) => {
                                                                    if (
                                                                        e.key ===
                                                                        'Enter'
                                                                    )
                                                                        void handleCompose(
                                                                            index,
                                                                        );
                                                                    if (
                                                                        e.key ===
                                                                        'Escape'
                                                                    ) {
                                                                        setAIMode(
                                                                            'idle',
                                                                        );
                                                                        setComposePrompt(
                                                                            '',
                                                                        );
                                                                    }
                                                                }}
                                                                placeholder="Describe what you want to write…"
                                                                // eslint-disable-next-line jsx-a11y/no-autofocus
                                                                autoFocus
                                                                disabled={
                                                                    aiMode ===
                                                                    'composing'
                                                                }
                                                                className="block h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                                                                data-test="compose-prompt-input"
                                                            />
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                onClick={() =>
                                                                    void handleCompose(
                                                                        index,
                                                                    )
                                                                }
                                                                disabled={
                                                                    !composePrompt.trim() ||
                                                                    aiMode ===
                                                                        'composing'
                                                                }
                                                            >
                                                                {aiMode ===
                                                                'composing' ? (
                                                                    <Loader2 className="animate-spin" />
                                                                ) : (
                                                                    'Generate'
                                                                )}
                                                            </Button>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setAIMode(
                                                                        'idle',
                                                                    );
                                                                    setComposePrompt(
                                                                        '',
                                                                    );
                                                                    setAIError(
                                                                        null,
                                                                    );
                                                                }}
                                                                aria-label="Cancel compose"
                                                                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                                            >
                                                                <X className="size-4" />
                                                            </button>
                                                        </div>
                                                    )}
                                                {aiError && (
                                                    <p
                                                        className="mt-1.5 text-[13px] text-destructive"
                                                        data-test="ai-error"
                                                    >
                                                        {aiError}
                                                    </p>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </>
            )}
        </Form>
    );
}
