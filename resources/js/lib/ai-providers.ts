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

const REWRITE_SYSTEM =
    'You are a writing assistant for a developer social network. ' +
    'Rewrite the given commit message or post to be cleaner, more precise, and engaging. ' +
    'Return ONLY the rewritten text, no quotes or explanation. Keep it under 280 characters.';

const COMPOSE_SYSTEM =
    'You are a writing assistant for a developer social network. ' +
    'Generate a developer commit message or post based on the description. ' +
    'Return ONLY the text, no quotes or explanation. Keep it under 280 characters.';

async function openAICompatible(
    endpoint: string,
    apiKey: string,
    model: string,
    system: string,
    userContent: string,
): Promise<string> {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            max_tokens: 300,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: userContent },
            ],
        }),
    });

    if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
            error?: { message?: string };
        };
        throw new Error(
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
): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            max_tokens: 300,
            system,
            messages: [{ role: 'user', content: userContent }],
        }),
    });

    if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
            error?: { message?: string };
        };
        throw new Error(
            body.error?.message ?? `Request failed (${response.status})`,
        );
    }

    const data = (await response.json()) as {
        content: [{ type: string; text: string }];
    };
    return data.content[0].text.trim();
}

export async function rewriteWithAI(
    text: string,
    config: AIConfig,
): Promise<string> {
    const meta = AI_PROVIDER_META[config.provider];

    if (config.provider === 'anthropic') {
        return anthropicMessages(
            config.apiKey,
            meta.model,
            REWRITE_SYSTEM,
            text,
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
        REWRITE_SYSTEM,
        text,
    );
}

export async function composeWithAI(
    prompt: string,
    config: AIConfig,
): Promise<string> {
    const meta = AI_PROVIDER_META[config.provider];

    if (config.provider === 'anthropic') {
        return anthropicMessages(
            config.apiKey,
            meta.model,
            COMPOSE_SYSTEM,
            prompt,
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
        COMPOSE_SYSTEM,
        prompt,
    );
}
