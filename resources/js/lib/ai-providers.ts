import type { AIConfig, AIProvider } from '@/hooks/use-ai-integration';

export const AI_PROVIDER_META: Record<
    AIProvider,
    { label: string; placeholder: string; model: string }
> = {
    openai: {
        label: 'OpenAI',
        placeholder: 'sk-...',
        model: 'gpt-4o-mini',
    },
    anthropic: {
        label: 'Anthropic',
        placeholder: 'sk-ant-...',
        model: 'claude-haiku-4-5',
    },
    grok: {
        label: 'Grok (xAI)',
        placeholder: 'xai-...',
        model: 'grok-3-mini',
    },
} as const;

export class AIError extends Error {
    constructor(
        message: string,
        public readonly kind: 'auth' | 'rate_limit' | 'network' | 'unknown',
    ) {
        super(message);
        this.name = 'AIError';
    }
}

export function formatAIError(error: unknown): string {
    if (error instanceof AIError) {
        switch (error.kind) {
            case 'auth':
                return 'Invalid API key. Update it in Settings → Profile.';
            case 'rate_limit':
                return 'Rate limit reached. Try again in a moment.';
            case 'network':
                return 'Network error. Check your connection.';
        }
    }
    return error instanceof Error ? error.message : 'Something went wrong.';
}

function classifyError(status: number, message: string): AIError {
    if (status === 401 || status === 403) {
        return new AIError('Invalid API key.', 'auth');
    }
    if (status === 429) {
        return new AIError(
            'Rate limit reached. Try again in a moment.',
            'rate_limit',
        );
    }
    return new AIError(message, 'unknown');
}

const REWRITE_SYSTEM =
    'You are a writing assistant for a developer social network. ' +
    'Rewrite the given commit message or post to be cleaner, more precise, and engaging. ' +
    'Return ONLY the rewritten text, no quotes or explanation. Keep it under 280 characters.';

const COMPOSE_SYSTEM =
    'You are a writing assistant for a developer social network. ' +
    'Generate a developer commit message or post based on the description. ' +
    'Return ONLY the text, no quotes or explanation. Keep it under 280 characters.';

const SUGGEST_REPLY_SYSTEM =
    'You are a writing assistant for a developer social network. ' +
    'Suggest a thoughtful, concise reply to the developer post below. ' +
    'Return ONLY the reply text, no quotes, attribution, or explanation. Keep it under 280 characters.';

const SUMMARIZE_THREAD_SYSTEM =
    'You are a writing assistant for a developer social network. ' +
    'Summarize the following discussion thread in 1-2 concise sentences, capturing the key points. ' +
    'Return ONLY the summary, no labels, quotes, or preamble.';

async function openAICompatible(
    endpoint: string,
    apiKey: string,
    model: string,
    system: string,
    userContent: string,
    signal?: AbortSignal,
    maxTokens = 300,
): Promise<string> {
    let response: Response;

    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                max_tokens: maxTokens,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: userContent },
                ],
            }),
            signal,
        });
    } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        throw new AIError('Network error. Check your connection.', 'network');
    }

    if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
            error?: { message?: string };
        };
        throw classifyError(
            response.status,
            body.error?.message ?? `Request failed (${response.status})`,
        );
    }

    const data = (await response.json()) as {
        choices: [{ message: { content: string } }];
    };
    return data.choices[0].message.content.trim();
}

async function anthropicMessages(
    apiKey: string,
    model: string,
    system: string,
    userContent: string,
    signal?: AbortSignal,
    maxTokens = 300,
): Promise<string> {
    let response: Response;

    try {
        response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                max_tokens: maxTokens,
                system,
                messages: [{ role: 'user', content: userContent }],
            }),
            signal,
        });
    } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        throw new AIError('Network error. Check your connection.', 'network');
    }

    if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
            error?: { message?: string };
        };
        throw classifyError(
            response.status,
            body.error?.message ?? `Request failed (${response.status})`,
        );
    }

    const data = (await response.json()) as {
        content: [{ type: string; text: string }];
    };
    return data.content[0].text.trim();
}

async function callAI(
    userContent: string,
    config: AIConfig,
    system: string,
    signal?: AbortSignal,
    maxTokens = 300,
): Promise<string> {
    const meta = AI_PROVIDER_META[config.provider];

    if (config.provider === 'anthropic') {
        return anthropicMessages(
            config.apiKey,
            meta.model,
            system,
            userContent,
            signal,
            maxTokens,
        );
    }

    const endpoint =
        config.provider === 'grok'
            ? 'https://api.x.ai/v1/chat/completions'
            : 'https://api.openai.com/v1/chat/completions';

    return openAICompatible(
        endpoint,
        config.apiKey,
        meta.model,
        system,
        userContent,
        signal,
        maxTokens,
    );
}

/** Validates that the key works by making a minimal API call. Throws AIError on failure. */
export async function validateApiKey(config: AIConfig): Promise<void> {
    await callAI('ping', config, 'Respond with: ok', undefined, 5);
}

export async function rewriteWithAI(
    text: string,
    config: AIConfig,
    signal?: AbortSignal,
): Promise<string> {
    return callAI(text, config, REWRITE_SYSTEM, signal);
}

export async function composeWithAI(
    prompt: string,
    config: AIConfig,
    signal?: AbortSignal,
): Promise<string> {
    return callAI(prompt, config, COMPOSE_SYSTEM, signal);
}

export async function suggestReplyWithAI(
    parentBody: string,
    config: AIConfig,
    signal?: AbortSignal,
): Promise<string> {
    return callAI(`Post: ${parentBody}`, config, SUGGEST_REPLY_SYSTEM, signal);
}

export async function summarizeThreadWithAI(
    commitBody: string,
    replyBodies: string[],
    config: AIConfig,
    signal?: AbortSignal,
): Promise<string> {
    const replies = replyBodies.slice(0, 20).join('\n');
    const userContent = `Post: ${commitBody}\n\nReplies:\n${replies}`;
    return callAI(userContent, config, SUMMARIZE_THREAD_SYSTEM, signal, 150);
}
