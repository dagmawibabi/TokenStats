<script lang="ts">
	import { tick } from 'svelte';
	import { ago, date, fmt, md, num } from '#lib/format.ts';
	import { prefs, savePrefs } from '#lib/prefs.svelte.ts';
	import { priceSession, usd } from '#lib/pricing.svelte.ts';
	import { findUsernames, redactMessages, redactSession } from '#lib/redact.ts';
	import { app } from '#lib/store.svelte.ts';
	import { toBlocks } from '#lib/toolinfo.ts';
	import { TOOLS, totalTokens, type Msg } from '#lib/types.ts';
	import Icon from './Icon.svelte';
	import RemovedList from './RemovedList.svelte';
	import ToolStep from './ToolStep.svelte';
	import { sentState } from '#lib/worklog-sent.svelte.ts';

	let { id, onopen, onexport, onworklog }: { id: string; onopen: (id: string) => void; onexport: () => void; onworklog: () => void } = $props();

	let msgs = $state.raw<Msg[] | null>(null);
	const raw = $derived(app.session(id));
	const s = $derived(raw && prefs.redact ? redactSession(raw, findUsernames([raw.cwd, raw.path, ...(msgs ?? []).map((m) => m.text)])) : raw);
	let error = $state<string | null>(null);

	/** imported from another computer: totals only, no conversation to read */
	const elsewhere = $derived(raw?.device ?? null);

	$effect(() => {
		const current = id;
		msgs = null;
		error = null;
		if (app.session(current)?.device) return;
		app
			.messages(current)
			.then((m) => current === id && (msgs = m))
			.catch((e) => current === id && (error = e.message));
	});

	const price = $derived(raw ? priceSession(raw) : { usd: 0, unpriced: [], assumed: null });
	const redacted = $derived(msgs && prefs.redact ? redactMessages(msgs, [raw?.cwd, raw?.path]) : null);
	const view = $derived(redacted?.msgs ?? msgs ?? []);
	const counts = $derived({
		tools: view.filter((m) => m.kind === 'tool_call').length,
		thinking: view.filter((m) => m.kind === 'thinking').length,
		meta: view.filter((m) => m.kind === 'meta').length
	});
	const blocks = $derived(toBlocks(view, prefs));

	const STEP = 120;
	let limit = $state(STEP);
	$effect(() => {
		void id;
		limit = STEP;
	});

	const toggle = (k: 'redact' | 'tools' | 'thinking' | 'meta') => {
		prefs[k] = !prefs[k];
		savePrefs();
	};

	// ---- "Removed items" list and jumping to where an item was removed
	let showRemoved = $state(false);
	let focusMsg = $state<number | null>(null);
	$effect(() => {
		void id;
		showRemoved = false;
		focusMsg = null;
	});
	$effect(() => {
		if (!prefs.redact) showRemoved = false;
	});
	const position = $derived(new Map(view.map((m, i) => [m, i])));
	const at = (m: Msg | null | undefined) => (m ? (position.get(m) ?? -1) : -1);
	const blockHas = (b: (typeof blocks)[number], i: number) =>
		b.type === 'message' ? at(b.msg) === i : b.items.some((it) => (it.type === 'step' ? at(it.step.call) === i || at(it.step.result) === i : at(it.msg) === i));

	async function jump(i: number) {
		const m = view[i];
		if (!m) return;
		// Make sure the kind of message holding the item is visible.
		if ((m.kind === 'tool_call' || m.kind === 'tool_result') && !prefs.tools) toggle('tools');
		if (m.kind === 'thinking' && !prefs.thinking) toggle('thinking');
		if (m.kind === 'meta' && !prefs.meta) toggle('meta');
		await tick();
		const bi = blocks.findIndex((b) => blockHas(b, i));
		if (bi >= limit) limit = bi + 20;
		focusMsg = i;
		await tick();
		const el = document.querySelector<HTMLElement>(`[data-mi~="${i}"]`);
		if (!el) return;
		if (el instanceof HTMLDetailsElement) el.open = true;
		el.scrollIntoView({ block: 'center', behavior: 'smooth' });
		el.classList.remove('flash');
		void el.offsetWidth; // restart the animation
		el.classList.add('flash');
	}
</script>

{#if !s}
	<div class="empty">This session isn't in the current scan. It may have been deleted, or its folder removed.</div>
{:else}
	{@const t = s.tokens}
	<header class="head">
		{#if s.parent}
			<button class="btn ghost back-parent" onclick={() => onopen(s.parent!)}><Icon name="back" size={14} /> Parent session</button>
		{/if}
		<div class="title-row">
			<h2>{s.title}</h2>
			<div class="actions">
				<label class="switch" title="Hide API keys, tokens, passwords, .env contents, emails and your username">
					<input type="checkbox" checked={prefs.redact} onchange={() => toggle('redact')} />
					Remove sensitive info
				</label>
				<button class="btn" onclick={onworklog} title="Add this session to your Worklog timeline"><Icon name="send" size={14} /> Worklog</button>
				<button class="btn" onclick={onexport} disabled={!!elsewhere} title={elsewhere ? 'The conversation is on the computer it was recorded on' : undefined}><Icon name="download" size={14} /> Export</button>
			</div>
		</div>
		<div class="meta">
			<span class="tool"><span class="dot {s.source}"></span>{TOOLS[s.source]}</span>
			{#if Object.keys(s.models ?? {}).length}<span>{Object.keys(s.models).join(', ')}</span>{/if}
			<span>{date(s.start)}</span>
			{#if s.client}<span>{s.client}</span>{/if}
			{#if s.branch}<span class="mono">{s.branch}</span>{/if}
			{#if s.archived}<span class="pill">archived</span>{/if}
			{#if elsewhere}<span class="pill" title="Imported from this computer's device file">{elsewhere}</span>{/if}
			{#if sentState(s)}
				{@const ws = sentState(s)!}
				<button
					class="wl"
					class:stale={ws.stale}
					onclick={onworklog}
					title={ws.stale ? 'This session continued after it was sent. Send it again to update its Worklog entry.' : `Sent to Worklog ${new Date(ws.at).toLocaleString()}`}
				>
					<Icon name={ws.stale ? 'refresh' : 'check'} size={12} />
					{ws.stale ? 'In Worklog · new activity since' : `In Worklog · sent ${ago(ws.at)}`}
				</button>
			{/if}
		</div>
		{#if s.cwd}<div class="cwd mono">{s.cwd}</div>{/if}

		<div class="stats">
			{#if totalTokens(t)}
				<div title={s.estimated ? 'Counted from the transcript text: the tool didn’t record usage. System prompts, tool definitions and unrecorded tool output aren’t included.' : undefined}>
					<b>{s.estimated ? '~' : ''}{fmt(totalTokens(t))}</b> tokens{#if s.estimated}&nbsp;<span class="pill">estimated</span>{/if}
				</div>
				<div><b>{fmt(t.input)}</b> in</div>
				<div><b>{fmt(t.output)}</b> out</div>
				{#if t.cache_read}<div><b>{fmt(t.cache_read)}</b> cache read</div>{/if}
				{#if t.cache_write}<div><b>{fmt(t.cache_write)}</b> cache write</div>{/if}
				{#if t.reasoning}<div><b>{fmt(t.reasoning)}</b> reasoning</div>{/if}
			{:else}
				<div class="muted">{TOOLS[s.source]} didn't record token usage for this session</div>
			{/if}
			{#if price.usd}<div title={price.assumed ? `Priced as ${price.assumed}, chosen in Settings for ${TOOLS[raw!.source]}` : 'Estimated at list prices from models.dev'}><b>{usd(price.usd)}</b> estimated{#if price.assumed}&nbsp;<span class="muted">priced as {price.assumed.split('/').pop()}</span>{/if}</div>{/if}
			{#if s.cost}<div title="Cost the tool itself recorded"><b>${s.cost.toFixed(2)}</b> recorded by {TOOLS[s.source]}</div>{/if}
			{#if totalTokens(s.subagent_tokens)}<div><b>{fmt(totalTokens(s.subagent_tokens))}</b> in subagents</div>{/if}
			<div><b>{s.turns || '–'}</b> prompts</div>
		</div>

		{#if s.subagents.length}
			<div class="subs">
				{#each s.subagents as sub (sub.id)}
					<button class="sub" onclick={() => onopen(sub.id)}>
						<Icon name="agent" size={13} /><span>{sub.title}</span><span class="muted">{fmt(totalTokens(sub.tokens))}</span>
					</button>
				{/each}
			</div>
		{/if}

		<div class="filters">
			<button class="chip" class:on={prefs.tools} onclick={() => toggle('tools')}>Tool calls <span>{counts.tools}</span></button>
			<button class="chip" class:on={prefs.thinking} onclick={() => toggle('thinking')}>Thinking <span>{counts.thinking}</span></button>
			<button class="chip" class:on={prefs.meta} onclick={() => toggle('meta')}>System context <span>{counts.meta}</span></button>
			{#if redacted}
				{#if redacted.count}
					<button class="redacted" aria-expanded={showRemoved} onclick={() => (showRemoved = !showRemoved)}>
						<Icon name="shield" size={13} />
						{num(redacted.count)} sensitive {redacted.count === 1 ? 'item' : 'items'} hidden
						<span class="see">{showRemoved ? 'Hide list' : 'See list'}</span>
					</button>
				{:else}
					<span class="redacted"><Icon name="shield" size={13} /> Nothing sensitive found</span>
				{/if}
			{/if}
		</div>
		{#if showRemoved && redacted?.count}
			<RemovedList items={redacted.items} onjump={jump} onclose={() => (showRemoved = false)} />
		{/if}
	</header>

	{#if elsewhere}
		<div class="empty">This session was imported from {elsewhere}. Device files hold totals only, so the conversation can be read on that computer.</div>
	{:else if error}
		<div class="empty">Couldn't read this session: {error}</div>
	{:else if !msgs}
		<div class="empty">Reading conversation…</div>
	{:else}
		<div class="thread">
			{#each blocks.slice(0, limit) as b, i (i)}
				{#if b.type === 'activity'}
					<div class="activity">
						{#each b.items as it, j (j)}
							{#if it.type === 'step'}
								<div class="stepwrap" data-mi="{at(it.step.call)} {at(it.step.result)}">
									<ToolStep step={it.step} focus={focusMsg !== null && (at(it.step.call) === focusMsg || at(it.step.result) === focusMsg)} />
								</div>
							{:else}
								<details class="thought" data-mi={at(it.msg)}>
									<summary><span class="ico"><Icon name="brain" size={14} /></span> Thinking <span class="pv">{it.msg.text?.replace(/\s+/g, ' ').slice(0, 120)}</span></summary>
									<div class="thought-body">{it.msg.text}</div>
								</details>
							{/if}
						{/each}
					</div>
				{:else if b.msg.kind === 'meta'}
					<details class="ctx" data-mi={at(b.msg)}>
						<summary>{b.msg.role === 'system' ? 'System' : 'Injected'} context · <span class="pv">{b.msg.text?.replace(/\s+/g, ' ').slice(0, 100)}</span></summary>
						<pre>{b.msg.text}</pre>
					</details>
				{:else if b.msg.kind === 'image'}
					<div class="msg user" data-mi={at(b.msg)}>
						{#if b.msg.image}<img class="img" src={b.msg.image} alt="Attached by the user" />{:else}<span class="muted">[image]</span>{/if}
					</div>
				{:else if b.msg.role === 'user'}
					<div class="msg user" data-mi={at(b.msg)}>
						<div class="bubble">{@html md(b.msg.text ?? '')}</div>
						{#if b.msg.time}<div class="when">{date(b.msg.time)}</div>{/if}
					</div>
				{:else}
					<div class="msg assistant" data-mi={at(b.msg)}>
						<!-- md() escapes all HTML before adding its own tags -->
						<div class="body">{@html md(b.msg.text ?? '')}</div>
						{#if b.msg.usage}
							<div class="usage">
								{num(b.msg.usage.input)} in · {num(b.msg.usage.output)} out{#if b.msg.usage.cache_read}&nbsp;· {num(b.msg.usage.cache_read)} cached{/if}{#if b.msg.model}&nbsp;· {b.msg.model}{/if}
							</div>
						{/if}
					</div>
				{/if}
			{/each}
			{#if blocks.length > limit}
				<button class="btn more" onclick={() => (limit += STEP * 2)}>Show more · {blocks.length - limit} left</button>
			{/if}
			{#if !blocks.length}<div class="empty">No messages.</div>{/if}
		</div>
	{/if}
{/if}

<style>
	.head {
		display: grid;
		gap: 10px;
		padding-bottom: 20px;
		border-bottom: 1px solid var(--line-soft);
	}
	.back-parent {
		justify-self: start;
		margin-left: -10px;
	}
	.title-row {
		display: flex;
		gap: 16px;
		align-items: flex-start;
		justify-content: space-between;
	}
	.actions {
		display: flex;
		gap: 14px;
		align-items: center;
		flex: none;
		padding-top: 2px;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		color: var(--muted);
		font-size: 13px;
		align-items: center;
	}
	.tool {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--ink-2);
		font-weight: 500;
	}
	.wl {
		all: unset;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 11.5px;
		padding: 1px 8px;
		border-radius: 999px;
		cursor: pointer;
		color: var(--ok);
		background: color-mix(in srgb, var(--ok) 12%, transparent);
	}
	.wl.stale {
		color: var(--warn);
		background: color-mix(in srgb, var(--warn) 12%, transparent);
	}
	.wl:hover {
		filter: brightness(1.15);
	}
	.wl:focus-visible {
		outline: 2px solid var(--focus);
	}
	.pill {
		font-size: 11px;
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0 7px;
	}
	.cwd {
		color: var(--faint);
		overflow-wrap: anywhere;
	}
	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 18px;
		font-size: 13px;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
		margin-top: 4px;
	}
	.stats b {
		color: var(--ink);
		font-weight: 600;
	}
	.subs {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.sub {
		all: unset;
		display: inline-flex;
		gap: 6px;
		align-items: center;
		font-size: 12.5px;
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 3px 10px;
		cursor: pointer;
		max-width: 340px;
	}
	.sub span:first-of-type {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub:hover {
		background: var(--surface-2);
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		margin-top: 6px;
	}
	.chip {
		all: unset;
		font-size: 12.5px;
		padding: 3px 10px;
		border-radius: 999px;
		border: 1px solid var(--line);
		color: var(--muted);
		cursor: pointer;
	}
	.chip span {
		color: var(--faint);
		margin-left: 2px;
	}
	.chip.on {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--bg);
	}
	.chip.on span {
		color: color-mix(in srgb, var(--bg) 60%, transparent);
	}
	.chip:focus-visible {
		outline: 2px solid var(--focus);
	}
	.redacted {
		all: unset;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12.5px;
		color: var(--ok);
		margin-left: auto;
	}
	button.redacted {
		cursor: pointer;
		border-radius: var(--r-sm);
		padding: 2px 6px;
		margin-right: -6px;
	}
	button.redacted:hover {
		background: var(--surface-2);
	}
	button.redacted:focus-visible {
		outline: 2px solid var(--focus);
	}
	.see {
		color: var(--ink-2);
		text-decoration: underline;
		text-decoration-color: var(--faint);
		text-underline-offset: 2px;
		margin-left: 4px;
	}
	:global(.flash) {
		animation: flash 1.6s ease-out;
		border-radius: var(--r-sm);
	}
	@keyframes flash {
		0%,
		30% {
			box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 55%, transparent);
		}
		100% {
			box-shadow: 0 0 0 3px transparent;
		}
	}

	.thread {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 18px;
		padding: 24px 0 40px;
	}
	.msg.user {
		justify-self: end;
		max-width: min(85%, 680px);
		display: grid;
		justify-items: end;
		gap: 4px;
	}
	.bubble {
		background: var(--user-bubble);
		padding: 10px 14px;
		border-radius: 16px 16px 4px 16px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		min-width: 0;
		max-width: 100%;
	}
	.when {
		font-size: 11.5px;
		color: var(--faint);
	}
	.msg.assistant {
		min-width: 0;
	}
	.body {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		line-height: 1.65;
	}
	.body :global(pre),
	.bubble :global(pre) {
		padding: 12px 14px;
		border-radius: var(--r-sm);
		overflow: auto;
		white-space: pre;
		background: var(--code);
		border: 1px solid var(--line-soft);
		margin: 8px 0;
		line-height: 1.5;
	}
	.body :global(code),
	.bubble :global(code) {
		background: var(--code);
		padding: 1px 5px;
		border-radius: 4px;
		border: 1px solid var(--line-soft);
		font-size: 12.5px;
	}
	.body :global(pre code),
	.bubble :global(pre code) {
		background: none;
		padding: 0;
		border: 0;
	}
	.usage {
		font-size: 11.5px;
		color: var(--faint);
		font-variant-numeric: tabular-nums;
		margin-top: 6px;
	}
	.img {
		max-width: 100%;
		max-height: 420px;
		border-radius: var(--r);
		border: 1px solid var(--line);
	}

	.activity {
		display: grid;
		/* without this the column grows to fit the longest one-line summary and pushes the row off the right */
		grid-template-columns: minmax(0, 1fr);
		gap: 1px;
		padding-left: 10px;
		margin-left: 2px;
		border-left: 2px solid var(--line-soft);
		min-width: 0;
	}
	.thought > summary,
	.ctx > summary {
		list-style: none;
		cursor: pointer;
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 13px;
		color: var(--muted);
		padding: 5px 8px;
		border-radius: var(--r-sm);
		overflow: hidden;
		white-space: nowrap;
	}
	.thought > summary::-webkit-details-marker,
	.ctx > summary::-webkit-details-marker {
		display: none;
	}
	.thought > summary:hover,
	.ctx > summary:hover {
		background: var(--surface-2);
	}
	.ico {
		width: 22px;
		height: 22px;
		border-radius: 6px;
		display: grid;
		place-items: center;
		background: var(--surface-2);
		color: var(--ink-2);
		flex: none;
	}
	.pv {
		white-space: nowrap;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--faint);
		font-style: italic;
	}
	.thought-body {
		padding: 4px 10px 10px 38px;
		color: var(--muted);
		font-style: italic;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 13.5px;
	}
	.ctx pre {
		margin: 4px 0 0;
		padding: 10px 12px;
		background: var(--code);
		border-radius: var(--r-sm);
		max-height: 360px;
		overflow: auto;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.more {
		justify-self: center;
	}
	@media (max-width: 720px) {
		.title-row {
			flex-direction: column;
		}
		.msg.user {
			max-width: 92%;
		}
	}
</style>
