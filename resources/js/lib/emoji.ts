const shortcodeEmoji = {
    heart: '❤️',
    like: '👍',
} as const;

const shortcodeNames = Object.keys(shortcodeEmoji).sort(
    (left, right) => right.length - left.length,
);

const shortcodePattern = new RegExp(
    `:(${shortcodeNames.join('|')})(?![A-Za-z0-9_])`,
    'g',
);

export function emojify(text: string): string {
    return text.replace(
        shortcodePattern,
        (_, name: string) =>
            shortcodeEmoji[name as keyof typeof shortcodeEmoji],
    );
}
