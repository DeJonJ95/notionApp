// DeepSeek retired the `deepseek-chat` alias on 2026-07-24; requests using it now hang
// instead of failing. Flash defaults to thinking mode, which these short prompts don't need.
export const DEEPSEEK_MODEL = { model: 'deepseek-flash', thinking: { type: 'disabled' } } as const;
