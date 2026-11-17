// Usage that no session file holds any more.
// Some agents delete old transcripts (Claude Code after `cleanupPeriodDays`, 30 by default), but keep
// running totals elsewhere: Claude Code in ~/.claude/stats-cache.json, Codex in ~/.codex/state_<n>.sqlite.
// This module turns those totals into history entries that sit next to the sessions, counting only the part
// the surviving files don't already cover, and works out which periods can't be accounted for at all.
import type { CodexThread } from './parsers/codex';
import { tryJson } from './parsers/common';
import { addTokens, callTokens, emptyTokens, totalTokens, type Call, type Tokens, type Tool } from './types';

const DAY = 864e5;

export interface HistoryEntry {
	source: Tool;
	/** local midnight of the first and last day this usage falls on (the same day when it's known exactly) */
	from: number;
	to: number;
	tokens: Tokens;
	models: Record<string, Tokens>;
	/** the file it was read from, e.g. "stats-cache.json" */
	origin: string;
	/** the input/output/cache split is estimated from the model's overall mix, not recorded */
	approx?: boolean;
	cwd?: string | null;
	title?: string;
	/** name of the computer it was imported from (a device file) */
	device?: string;
}

export interface CoverageNote {
	source: Tool;
	/** gap: a period whose usage can't be counted · missing: usage that exists but can't be read · info: how numbers were found · tip: how to keep more */
	kind: 'gap' | 'missing' | 'info' | 'tip';
	text: string;
	/** for gaps: local midnights of the first and last day (from = 0: everything before `to`) */
	from?: number;
	to?: number;
}

export interface Coverage {
	history: HistoryEntry[];
	notes: CoverageNote[];
}

export const dayStart = (t: number) => {
	const d = new Date(t);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
};

// Local midnights of the next and previous day (a day isn't always 24 hours where clocks change).
const nextDay = (t: number) => dayStart(t + 36 * 36e5);
const prevDay = (t: number) => dayStart(t - 12 * 36e5);

/** "2026-07-02" -> local midnight */
export function parseDay(s: unknown): number | null {
	const m = typeof s === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s) : null;
	return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null;
}

export const shortDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

// ---- Claude Code ---------------------------------------------------------------

/**
 * Responses that appear in more than one file (a resumed or forked session copies the earlier messages)
 * are counted in the earliest file only. Returns every response once, and per file the usage to take
 * back off its totals.
 */
export function dedupeCalls(files: { id: string; start: number | null; calls?: Call[] }[]) {
	const seen = new Set<string>();
	const calls: Call[] = [];
	const extra = new Map<string, { tokens: Tokens; models: Record<string, Tokens> }>();
	const ordered = [...files].sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || a.id.localeCompare(b.id));
	for (const f of ordered) {
		for (const c of f.calls ?? []) {
			if (!seen.has(c[0])) {
				seen.add(c[0]);
				calls.push(c);
				continue;
			}
			const x = extra.get(f.id) ?? { tokens: emptyTokens(), models: {} };
			addTokens(x.tokens, callTokens(c));
			addTokens((x.models[c[1]] ??= emptyTokens()), callTokens(c));
			extra.set(f.id, x);
		}
	}
	return { calls, extra };
}

/** Take `minus` off `t`, never below zero. */
export function subtractTokens(t: Tokens, minus: Partial<Tokens>): Tokens {
	const out = { ...t };
	for (const k of Object.keys(out) as (keyof Tokens)[]) out[k] = Math.max(0, out[k] - (minus[k] ?? 0));
	return out;
}

export interface ClaudeStatsCache {
	/** last day the cache was brought up to date (Claude Code refreshes it when `/stats` runs) */
	lastComputed: number;
	firstSession: number | null;
	/** per day: total tokens (input + output + cache read + cache write) per model */
	daily: Map<number, Record<string, number>>;
	/** messages per day, also for days before `daily` starts */
	activity: Map<number, number>;
	/** all-time totals per model, split by kind */
	models: Record<string, Tokens>;
}

/** ~/.claude/stats-cache.json, or null when it isn't in a shape we know. */
export function parseClaudeStatsCache(text: string): ClaudeStatsCache | null {
	const o = tryJson(text);
	const lastComputed = parseDay(o?.lastComputedDate);
	if (!o || lastComputed == null || typeof o.modelUsage !== 'object' || !o.modelUsage) return null;
	const daily = new Map<number, Record<string, number>>();
	for (const d of Array.isArray(o.dailyModelTokens) ? o.dailyModelTokens : []) {
		const day = parseDay(d?.date);
		if (day == null || typeof d.tokensByModel !== 'object') continue;
		const row = daily.get(day) ?? {};
		for (const [m, v] of Object.entries(d.tokensByModel ?? {})) row[m] = (row[m] ?? 0) + (Number(v) || 0);
		daily.set(day, row);
	}
	const activity = new Map<number, number>();
	for (const d of Array.isArray(o.dailyActivity) ? o.dailyActivity : []) {
		const day = parseDay(d?.date);
		if (day != null) activity.set(day, (activity.get(day) ?? 0) + (Number(d.messageCount) || 0));
	}
	const models: Record<string, Tokens> = {};
	for (const [m, u] of Object.entries<any>(o.modelUsage)) {
		const t: Tokens = {
			input: Number(u?.inputTokens) || 0,
			output: Number(u?.outputTokens) || 0,
			cache_read: Number(u?.cacheReadInputTokens) || 0,
			cache_write: Number(u?.cacheCreationInputTokens) || 0,
			reasoning: 0
		};
		if (totalTokens(t)) models[m] = t;
	}
	const first = typeof o.firstSessionDate === 'string' ? Date.parse(o.firstSessionDate) : NaN;
	return { lastComputed, firstSession: Number.isNaN(first) ? null : dayStart(first), daily, activity, models };
}

/** ~/.claude/settings.json -> cleanupPeriodDays, or null when not set */
export function claudeRetention(text: string): number | null {
	const v = tryJson(text)?.cleanupPeriodDays;
	return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** `total` tokens of a model, split like `mix` (that model's all-time split), rounded so the parts add up. */
function splitLike(total: number, mix: Tokens): Tokens {
	const all = totalTokens(mix);
	if (!all) return { ...emptyTokens(), input: total };
	const out = emptyTokens();
	const keys = ['input', 'output', 'cache_read', 'cache_write'] as const;
	let left = total;
	for (const k of keys.slice(1)) left -= out[k] = Math.round((total * mix[k]) / all);
	out.input = Math.max(0, left);
	return out;
}

export interface ClaudeInputs {
	cache: ClaudeStatsCache | null;
	/** cleanupPeriodDays from settings.json; undefined when settings.json wasn't found, null when it doesn't set one */
	retention?: number | null;
	/** every response still in a transcript, already de-duplicated */
	calls: Call[];
	now?: number;
}

/**
 * What stats-cache.json adds over the transcripts that are left, and the periods neither covers.
 *
 * The cache was computed from the transcripts that existed when it ran, so for every model, its total minus
 * what the surviving transcripts hold up to its last day is usage whose transcripts have since been deleted.
 * That amount is spread over days in proportion to what the cache recorded for each day beyond the
 * transcripts, so the chart stays close to the real shape; usage the cache only has as an all-time total
 * (it began recording per-day tokens later than per-day activity) is spread over its active days by messages.
 */
export function claudeCoverage({ cache, retention, calls, now = Date.now() }: ClaudeInputs): Coverage {
	const history: HistoryEntry[] = [];
	const notes: CoverageNote[] = [];
	const today = dayStart(now);
	let earliest: number | null = null;
	for (const c of calls) if (c[2] != null) earliest = Math.min(earliest ?? Infinity, dayStart(c[2]));

	if (cache) {
		const lastEnd = nextDay(cache.lastComputed);
		// What the surviving transcripts hold up to the cache's last day, per model and per model per day.
		const seen: Record<string, number> = {};
		const seenDaily = new Map<number, Record<string, number>>();
		for (const c of calls) {
			if (c[2] == null || c[2] >= lastEnd) continue;
			const n = c[3] + c[4] + c[5] + c[6];
			seen[c[1]] = (seen[c[1]] ?? 0) + n;
			const day = dayStart(c[2]);
			const row = seenDaily.get(day) ?? {};
			row[c[1]] = (row[c[1]] ?? 0) + n;
			seenDaily.set(day, row);
		}
		const firstDaily = Math.min(...cache.daily.keys());
		const byDay = new Map<number, Record<string, Tokens>>();
		const undated: Record<string, Tokens> = {};
		for (const [model, mix] of Object.entries(cache.models)) {
			const missing = totalTokens(mix) - (seen[model] ?? 0);
			if (missing <= 0) continue;
			// Weight each cached day by what it holds beyond the transcripts; the rest of the all-time total has no day.
			const weights: [number, number][] = [];
			let dated = 0;
			for (const [day, row] of cache.daily) {
				const v = row[model] ?? 0;
				dated += v;
				const w = v - (seenDaily.get(day)?.[model] ?? 0);
				if (w > 0) weights.push([day, w]);
			}
			let early = 0;
			for (const [day, row] of seenDaily) if (!(day >= firstDaily)) early += row[model] ?? 0;
			const rest = Math.max(0, totalTokens(mix) - dated - early);
			const sum = weights.reduce((a, [, w]) => a + w, 0) + rest;
			const share = (w: number) => Math.round((missing * w) / sum);
			for (const [day, w] of weights) {
				const row = byDay.get(day) ?? {};
				row[model] = splitLike(share(w), mix);
				byDay.set(day, row);
			}
			if (rest > 0) undated[model] = splitLike(share(rest), mix);
		}

		const entry = (from: number, to: number, models: Record<string, Tokens>): HistoryEntry => ({
			source: 'claude',
			from,
			to,
			models,
			tokens: Object.values(models).reduce((a, t) => addTokens(a, t), emptyTokens()),
			origin: 'stats-cache.json',
			approx: true
		});
		for (const [day, models] of byDay) history.push(entry(day, day, models));

		// Usage with no day: spread it over the days the cache saw activity before per-day tokens begin.
		if (Object.keys(undated).length) {
			const days = [...cache.activity].filter(([d, n]) => n > 0 && !(d >= firstDaily) && !seenDaily.has(d));
			const msgs = days.reduce((a, [, n]) => a + n, 0);
			if (msgs) {
				for (const [day, n] of days) {
					const models: Record<string, Tokens> = {};
					for (const [m, t] of Object.entries(undated)) {
						const part = emptyTokens();
						for (const k of Object.keys(part) as (keyof Tokens)[]) part[k] = Math.round((t[k] * n) / msgs);
						if (totalTokens(part)) models[m] = part;
					}
					if (Object.keys(models).length) history.push(entry(day, day, models));
				}
			} else {
				const from = cache.firstSession ?? cache.lastComputed;
				history.push(entry(from, Number.isFinite(firstDaily) ? prevDay(firstDaily) : cache.lastComputed, undated));
			}
		}
		history.sort((a, b) => a.from - b.from);

		const recovered = history.reduce((a, h) => a + totalTokens(h.tokens), 0);
		if (recovered)
			notes.push({
				source: 'claude',
				kind: 'info',
				text: `Includes usage from stats-cache.json up to ${shortDate(cache.lastComputed)} whose transcripts were deleted. Its split into input, output and cache is estimated per model.`
			});

		// Between the cache's last day and the oldest transcript left, nothing records what was used.
		const gapFrom = nextDay(cache.lastComputed);
		const gapTo = earliest != null ? prevDay(earliest) : today;
		if (gapTo >= gapFrom)
			notes.push({
				source: 'claude',
				kind: 'gap',
				from: gapFrom,
				to: gapTo,
				text: `No record of usage from ${shortDate(gapFrom)} to ${shortDate(gapTo)}: stats-cache.json was last updated ${shortDate(cache.lastComputed)}${earliest != null ? ` and the oldest transcript left is from ${shortDate(earliest)}` : ' and no transcripts are left'}. Anything used in between isn't counted. Running /stats in Claude Code brings stats-cache.json up to date.`
			});
	} else if (earliest != null) {
		// Without the cache, transcripts that start right at the retention limit mean older ones were deleted.
		const days = retention ?? 30;
		if (days > 0 && earliest - (today - days * DAY) <= 2 * DAY)
			notes.push({
				source: 'claude',
				kind: 'gap',
				from: 0,
				to: prevDay(earliest),
				text: `Claude Code deletes transcripts after ${days} days${retention == null ? ' by default' : ''}, and the oldest one left is from ${shortDate(earliest)}. Usage before that isn't counted. Add ~/.claude/stats-cache.json (pick the whole ~/.claude folder) to include the totals Claude Code keeps there.`
			});
	}

	// Short retention (or none set) will keep deleting history.
	if (calls.length && retention !== undefined && (retention == null || retention <= 365))
		notes.push({
			source: 'claude',
			kind: 'tip',
			text: `Claude Code deletes transcripts older than ${retention ?? 30} days${retention == null ? ' by default' : ''}. To keep them, set "cleanupPeriodDays" to a larger number (e.g. 3650) in ~/.claude/settings.json.`
		});
	return { history, notes };
}

// ---- Codex ---------------------------------------------------------------------

/**
 * Threads Codex still lists in its state database whose rollout files are gone. Codex only keeps their
 * total, so it's split like that model's surviving sessions (or all Codex sessions) to price it.
 */
export function codexCoverage(threads: CodexThread[], present: Set<string>, mixes: Record<string, Tokens>): Coverage {
	const all = Object.values(mixes).reduce((a, t) => addTokens(a, t), emptyTokens());
	const history: HistoryEntry[] = [];
	for (const t of threads) {
		if (present.has(t.id) || !(t.tokens > 0)) continue;
		const mix = (t.model && mixes[t.model]) || all;
		const tokens = splitLike(t.tokens, mix);
		const when = dayStart(t.end ?? t.start ?? 0);
		history.push({
			source: 'codex',
			from: when,
			to: when,
			tokens,
			models: t.model ? { [t.model]: tokens } : {},
			origin: 'state database',
			approx: true,
			cwd: t.cwd,
			title: t.title
		});
	}
	const notes: CoverageNote[] = history.length
		? [
				{
					source: 'codex',
					kind: 'info',
					text: `Includes ${history.length} ${history.length === 1 ? 'thread' : 'threads'} whose rollout files are gone, from Codex's state database. Only their totals are kept, so the split into input, output and cache is estimated.`
				}
			]
		: [];
	return { history, notes };
}

// ---- Tools with nothing to recover -----------------------------------------------

export function otherNotes(found: { cursor: number; agEncrypted: number }): CoverageNote[] {
	const notes: CoverageNote[] = [];
	if (found.cursor)
		notes.push({
			source: 'cursor',
			kind: 'missing',
			text: "Cursor doesn't save token usage on this computer, so its numbers are estimated from the transcripts. Your exact usage is on cursor.com/dashboard."
		});
	if (found.agEncrypted)
		notes.push({
			source: 'antigravity',
			kind: 'missing',
			text: `${found.agEncrypted} older Antigravity ${found.agEncrypted === 1 ? 'conversation is' : 'conversations are'} saved encrypted (.pb), so their usage can't be read and isn't counted.`
		});
	return notes;
}
