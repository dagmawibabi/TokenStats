import type { SessionStats } from './stats';

export type Tool = 'claude' | 'codex' | 'opencode' | 'grok' | 'antigravity' | 'cursor';

export const TOOLS: Record<Tool, string> = {
	claude: 'Claude Code',
	codex: 'Codex',
	opencode: 'OpenCode',
	grok: 'Grok',
	antigravity: 'Antigravity',
	cursor: 'Cursor'
};

export const TOOL_IDS = Object.keys(TOOLS) as Tool[];

export interface Tokens {
	input: number;
	output: number;
	cache_read: number;
	cache_write: number;
	reasoning: number;
}

export interface Summary {
	title: string;
	first_prompt: string;
	cwd: string | null;
	branch: string | null;
	start: number | null;
	end: number | null;
	tokens: Tokens;
	models: Record<string, Tokens>;
	cost: number | null;
	turns: number;
	messages: number;
	client: string | null;
	archived?: boolean;
	/** tokens counted from the transcript text because the tool didn't record usage */
	estimated?: boolean;
	/** tool calls and timing, for the Tools and Time pages */
	stats?: SessionStats;
	/** Claude Code: usage per model response, so a response copied into several files (resumed or forked sessions) is counted once */
	calls?: Call[];
}

/** One model response's usage: message id, model, time, input, output, cache read, cache write */
export type Call = [id: string, model: string, time: number | null, input: number, output: number, cache_read: number, cache_write: number];

export const callTokens = (c: Call): Tokens => ({ input: c[3], output: c[4], cache_read: c[5], cache_write: c[6], reasoning: 0 });

export interface SubagentRef {
	id: string;
	title: string;
	tokens: Tokens;
	models: Record<string, Tokens>;
	estimated?: boolean;
	stats?: SessionStats;
}

export interface Session extends Summary {
	id: string;
	source: Tool;
	path: string;
	size: number | null;
	parent: string | null;
	subagents: SubagentRef[];
	subagent_tokens: Tokens;
	/** name of the computer this session was imported from (a device file); absent for this computer's own */
	device?: string;
}

export type MsgKind = 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'meta' | 'image';

export interface Usage {
	input?: number;
	output?: number;
	cache_read?: number;
	cache_write?: number;
	reasoning?: number;
}

export interface Msg {
	role: 'user' | 'assistant' | 'tool' | 'system';
	kind: MsgKind;
	text?: string;
	name?: string;
	id?: string;
	error?: boolean;
	image?: string | null;
	time: number | null;
	model?: string | null;
	usage?: Usage;
	/** first message of a model response, where the transcript marks them (used for token estimates) */
	call?: boolean;
}

export interface SearchHit {
	id: string;
	snippet: string;
}

export const emptyTokens = (): Tokens => ({
	input: 0,
	output: 0,
	cache_read: 0,
	cache_write: 0,
	reasoning: 0
});

export function addTokens(a: Tokens, b: Partial<Tokens> | null | undefined) {
	if (!b) return a;
	for (const k of Object.keys(a) as (keyof Tokens)[]) a[k] += Number(b[k] ?? 0) || 0;
	return a;
}

export const totalTokens = (t: Partial<Tokens> | null | undefined) =>
	t ? (t.input ?? 0) + (t.output ?? 0) + (t.cache_read ?? 0) + (t.cache_write ?? 0) : 0;
