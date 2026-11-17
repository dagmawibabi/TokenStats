import { describe, expect, it } from 'vitest';
import { buildDeviceFile, combine, deviceFileName, guessDeviceName, parseDeviceFile, type DeviceFile } from './devices';
import type { HistoryEntry } from './history';
import { emptyTokens, type Session } from './types';

const session = (id: string, input: number, extra: Partial<Session> = {}): Session => ({
	id,
	source: 'claude',
	path: `.claude/projects/x/${id}.jsonl`,
	size: 10,
	parent: null,
	subagents: [],
	subagent_tokens: emptyTokens(),
	title: 'Title ' + id,
	first_prompt: 'a private prompt',
	cwd: '/home/me/x',
	branch: null,
	start: 1,
	end: 2,
	tokens: { ...emptyTokens(), input },
	models: { opus: { ...emptyTokens(), input } },
	cost: null,
	turns: 1,
	messages: 2,
	client: null,
	...extra
});
const hist = (input: number): HistoryEntry => ({ source: 'claude', from: 0, to: 0, tokens: { ...emptyTokens(), input }, models: {}, origin: 'stats-cache.json' });
const file = (id: string, name: string, sessions: Session[], exportedAt = 1000, history: HistoryEntry[] = []): DeviceFile =>
	buildDeviceFile({ id, name }, { sessions, history, notes: [{ source: 'claude', kind: 'info', text: 'note' }] }, 500, exportedAt);
const sum = (ss: Session[]) => ss.reduce((a, s) => a + s.tokens.input, 0);

describe('device files', () => {
	it('leaves prompts, paths and per-response usage out of the file', () => {
		const f = file('a', 'Laptop', [session('claude:1', 5, { calls: [['m', 'opus', 1, 5, 0, 0, 0]] })]);
		const text = JSON.stringify(f);
		expect(text).not.toContain('private prompt');
		expect(text).not.toContain('.jsonl');
		expect(f.sessions[0].calls).toBeUndefined();
		expect(f.sessions[0].title).toBe('Title claude:1');
		expect(f.sessions[0].tokens.input).toBe(5);
	});

	it('round-trips through JSON', () => {
		const f = file('a', 'Laptop', [session('claude:1', 5)], 1000, [hist(7)]);
		const back = parseDeviceFile(JSON.stringify(f));
		expect(back).toEqual(f);
		expect(deviceFileName(f)).toBe('sessions-laptop-1970-01-01.json');
	});

	it('rejects other files and drops malformed entries', () => {
		expect(() => parseDeviceFile('not json')).toThrow(/JSON/);
		expect(() => parseDeviceFile('{"sessions":[]}')).toThrow(/device file/);
		const f = file('a', 'Laptop', [session('claude:1', 5)]);
		expect(() => parseDeviceFile(JSON.stringify({ ...f, version: 99 }))).toThrow(/newer/);
		const messy = { ...f, sessions: [...f.sessions, { id: 'x' }, { ...f.sessions[0], id: 'claude:2', source: 'nope' }, null], history: [{ source: 'claude' }] };
		const back = parseDeviceFile(JSON.stringify(messy));
		expect(back.sessions.map((s) => s.id)).toEqual(['claude:1']);
		expect(back.history).toEqual([]);
	});
});

describe('combine', () => {
	const own = { sessions: [session('claude:1', 5)], history: [hist(1)], notes: [] };

	it('returns this computer alone when nothing is imported', () => {
		expect(combine(own, [])).toBe(own);
	});

	it('adds other computers, labelled by name', () => {
		const all = combine(own, [file('b', 'Desktop', [session('claude:2', 10)], 1000, [hist(100)]), file('c', 'Work', [session('codex:3', 20, { source: 'codex' })])], 'a');
		expect(sum(all.sessions)).toBe(35);
		expect(all.sessions.map((s) => s.device)).toEqual([undefined, 'Desktop', 'Work']);
		expect(all.history.map((h) => [h.tokens.input, h.device])).toEqual([[1, undefined], [100, 'Desktop']]);
		expect(all.notes.map((n) => n.text)).toEqual(['Desktop: note', 'Work: note']);
	});

	it('counts a session found on two computers once, keeping this computer’s copy', () => {
		const all = combine(own, [file('b', 'Desktop', [session('claude:1', 999), session('claude:2', 10)])]);
		expect(all.sessions.map((s) => [s.id, s.tokens.input, s.device])).toEqual([['claude:1', 5, undefined], ['claude:2', 10, 'Desktop']]);
	});

	it('prefers the most recently saved file between two other computers', () => {
		const all = combine({ sessions: [], history: [], notes: [] }, [file('b', 'Old', [session('claude:9', 1)], 100), file('c', 'New', [session('claude:9', 2)], 200)]);
		expect(all.sessions.map((s) => [s.tokens.input, s.device])).toEqual([[2, 'New']]);
	});

	it('ignores a file saved by this computer', () => {
		expect(combine(own, [file('a', 'Me', [session('claude:7', 50)])], 'a').sessions).toHaveLength(1);
	});
});

it('guesses a name for this computer', () => {
	expect(guessDeviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('Mac');
	expect(guessDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows PC');
	expect(guessDeviceName('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux PC');
	expect(guessDeviceName('')).toBe('This computer');
});
