<script lang="ts">
	import { onMount } from 'svelte';
	import Connect from '#lib/components/Connect.svelte';
	import ExportDialog from '#lib/components/ExportDialog.svelte';
	import WorklogDialog from '#lib/components/WorklogDialog.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Overview from '#lib/components/Overview.svelte';
	import TimePage from '#lib/components/TimePage.svelte';
	import ToolsPage from '#lib/components/ToolsPage.svelte';
	import SessionView from '#lib/components/SessionView.svelte';
	import SettingsDialog from '#lib/components/SettingsDialog.svelte';
	import Devices from '#lib/components/Devices.svelte';
	import SourcesDialog from '#lib/components/SourcesDialog.svelte';
	import { loadLivePrices } from '#lib/pricing.svelte.ts';
	import { ago, folder, fmt, sessionTotal } from '#lib/format.ts';
	import { prefs } from '#lib/prefs.svelte.ts';
	import { findUsernames, redactText, redactTitle } from '#lib/redact.ts';
	import { app } from '#lib/store.svelte.ts';
	import { sentState } from '#lib/worklog-sent.svelte.ts';
	import { TOOL_IDS, TOOLS, type SearchHit, type Session, type Tool } from '#lib/types.ts';

	let selected = $state<string | null>(null);
	let tools = $state(new Set<Tool>(TOOL_IDS));
	let q = $state('');
	let deep = $state(false);
	let hits = $state.raw<SearchHit[] | null>(null);
	let searching = $state(false);
	let sort = $state<'end' | 'tokens' | 'turns' | 'start'>('end');
	let project = $state('');
	let showSources = $state(false);
	let showSettings = $state(false);
	let exporting = $state(false);
	let logging = $state(false);
	let mobilePane = $state<'list' | 'main'>('list');

	type View = 'overview' | 'tools' | 'time';
	const VIEWS: { id: View; label: string }[] = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'tools', label: 'Tools' },
		{ id: 'time', label: 'Time' }
	];
	let view = $state<View>('overview');
	let overview = $state<ReturnType<typeof Overview>>();
	const RANGES = [
		{ id: '7', label: '7 days' },
		{ id: '30', label: '30 days' },
		{ id: '90', label: '90 days' },
		{ id: '365', label: '12 months' },
		{ id: 'all', label: 'All time' }
	] as const;
	type Range = (typeof RANGES)[number]['id'];
	let range = $state<Range>('all');
	try {
		const r = localStorage.getItem('sb-range');
		if (RANGES.some((x) => x.id === r)) range = r as Range;
	} catch {
		/* storage blocked */
	}
	function setRange(r: Range) {
		range = r;
		try {
			localStorage.setItem('sb-range', r);
		} catch {
			/* storage blocked */
		}
	}
	/** Sessions active since this time (start of the day `range` days ago), or 0 for all time */
	const since = $derived.by(() => {
		if (range === 'all') return 0;
		const d = new Date();
		d.setHours(0, 0, 0, 0);
		return d.getTime() - (Number(range) - 1) * 864e5;
	});
	function go(v: View) {
		selected = null;
		view = v;
		mobilePane = 'main';
		history.replaceState(null, '', v === 'overview' ? location.pathname : '#' + v);
	}

	onMount(() => {
		const fromHash = () => {
			const h = decodeURIComponent(location.hash.slice(1));
			if (h === 'tools' || h === 'time') {
				view = h;
				selected = null;
			} else selected = h || null;
			if (h) mobilePane = 'main';
		};
		fromHash();
		addEventListener('hashchange', fromHash);
		app.init();
		loadLivePrices();
		if (import.meta.env.DEV) (window as any).__app = app; // for local testing only
		return () => removeEventListener('hashchange', fromHash);
	});

	function open(id: string | null) {
		selected = id;
		mobilePane = 'main';
		history.replaceState(null, '', id ? '#' + encodeURIComponent(id) : location.pathname);
	}

	const roots = $derived(app.sessions.filter((s) => !s.parent));
	const present = $derived(TOOL_IDS.filter((t) => roots.some((s) => s.source === t)));
	const projects = $derived([...new Set(roots.map((s) => s.cwd).filter(Boolean) as string[])].sort());
	const counts = $derived(roots.reduce((a, s) => ((a[s.source] = (a[s.source] ?? 0) + 1), a), {} as Record<string, number>));

	const filtered = $derived.by(() => {
		const ql = q.trim().toLowerCase();
		let arr: (Session & { _snip?: string })[] = roots.filter((s) => tools.has(s.source) && (!project || s.cwd === project) && (!since || (s.end ?? s.start ?? 0) >= since));
		if (hits) {
			const m = new Map(hits.map((h) => [h.id, h.snippet]));
			arr = arr.filter((s) => m.has(s.id)).map((s) => ({ ...s, _snip: m.get(s.id) }));
		} else if (ql) arr = arr.filter((s) => [s.title, s.cwd, s.first_prompt, s.id, ...Object.keys(s.models ?? {})].join(' ').toLowerCase().includes(ql));
		const key: Record<typeof sort, (s: Session) => number> = {
			end: (s) => -(s.end ?? 0),
			start: (s) => s.start ?? 0,
			tokens: (s) => -sessionTotal(s),
			turns: (s) => -(s.turns ?? 0)
		};
		return arr.sort((a, b) => key[sort](a) - key[sort](b));
	});
	// Usage recovered from the agents' own totals has no session, title or text, so it's left out of a search;
	// usage known only for a period counts in a date range when the whole period is inside it.
	const older = $derived(
		q.trim() || hits ? [] : app.history.filter((h) => tools.has(h.source) && (!project || h.cwd === project) && (!since || h.from >= since))
	);
	const notes = $derived(app.notes.filter((n) => tools.has(n.source) && present.includes(n.source) && (n.kind !== 'gap' || !since || (n.to ?? 0) >= since)));
	const listTotal = $derived(filtered.reduce((a, s) => a + sessionTotal(s), 0));
	const users = $derived(prefs.redact ? findUsernames(app.sessions.flatMap((s) => [s.cwd, s.path])) : []);
	const show = (t: string | null | undefined) => (prefs.redact ? redactText(t, users).text : (t ?? ''));

	function toggle(t: Tool) {
		const n = new Set(tools);
		if (n.size === TOOL_IDS.length) {
			n.clear();
			n.add(t); // first click isolates a tool
		} else if (n.has(t)) {
			n.delete(t);
			if (!n.size) TOOL_IDS.forEach((x) => n.add(x));
		} else n.add(t);
		tools = n;
	}

	async function runSearch() {
		const term = q.trim();
		if (!deep || term.length < 2) return void (hits = null);
		searching = true;
		try {
			hits = await app.search(term);
		} finally {
			searching = false;
		}
	}

	const hasData = $derived(app.roots.length > 0 || app.sessions.length > 0);
	/** remembered folders the browser wants a click before reading again */
	const waiting = $derived(app.pendingRoots.length > 0);
</script>

{#if !app.ready}
	<div class="empty">Starting…</div>
{:else if !hasData}
	<main class="solo">
		{#if app.pendingRoots.length}
			<div class="reconnect">
				<span><b>Welcome back.</b> Your browser needs one click before it reads {app.pendingRoots.map((r) => r.name).join(', ')} again.</span>
				<button class="btn primary" onclick={() => app.sync()}><Icon name="refresh" size={14} /> Sync</button>
			</div>
		{/if}
		<Connect />
		<Devices bare />
	</main>
{:else}
	<div class="app" data-pane={mobilePane}>
		<aside>
			<div class="brand">
				<button class="logo" onclick={() => go('overview')}>
					<span class="mark" aria-hidden="true"><i></i><i></i><i></i></span>
					Sessions
				</button>
				<div class="actions">
					<button class="btn ghost icon" title="Sources" aria-label="Sources" onclick={() => (showSources = true)}>
						<Icon name="folder" />
						{#if waiting}<span class="pip" aria-hidden="true"></span>{/if}
					</button>
					<button class="btn ghost icon" title="Settings" aria-label="Settings" onclick={() => (showSettings = true)}><Icon name="settings" /></button>
					<button
						class="btn ghost sync"
						title={app.lastSync ? `Read your folders again · last synced ${ago(app.lastSync)}` : 'Read your folders again'}
						onclick={() => app.sync()}
						disabled={app.phase === 'scanning'}
					>
						<span class:spin={app.phase === 'scanning'}><Icon name="refresh" size={15} /></span>
						{app.phase === 'scanning' ? 'Syncing' : 'Sync'}
					</button>
				</div>
			</div>

			{#if waiting && app.phase !== 'scanning'}
				<button class="stale" onclick={() => app.sync()}>
					<Icon name="info" size={14} />
					<span>Showing your last sync{app.lastSync ? ` from ${ago(app.lastSync)}` : ''}. <b>Sync</b> to read your folders again.</span>
				</button>
			{/if}

			<div class="controls">
				<div class="search">
					<Icon name="search" size={15} />
					<input
						bind:value={q}
						onkeydown={(e) => e.key === 'Enter' && runSearch()}
						oninput={() => hits && !q.trim() && (hits = null)}
						placeholder={deep ? 'Search inside conversations…' : 'Filter sessions…'}
						autocomplete="off"
						aria-label="Search"
					/>
					<button
						class="deep"
						class:on={deep}
						title="Search the full text of every conversation (press Enter)"
						onclick={() => {
							deep = !deep;
							hits = null;
							if (deep) runSearch();
						}}>{searching ? '…' : 'Full text'}</button
					>
				</div>
				<div class="chips" role="group" aria-label="Tools">
					{#each present as k (k)}
						<button class="chip" aria-pressed={tools.has(k)} onclick={() => toggle(k)} title={TOOLS[k]}>
							<span class="dot {k}"></span>{TOOLS[k]}<span class="n">{counts[k] ?? 0}</span>
						</button>
					{/each}
				</div>
				<div class="row">
					<select bind:value={sort} aria-label="Sort">
						<option value="end">Recent</option>
						<option value="tokens">Most tokens</option>
						<option value="turns">Most prompts</option>
						<option value="start">Oldest</option>
					</select>
					<select bind:value={project} aria-label="Folder">
						<option value="">All folders</option>
						{#each projects as p (p)}<option value={p}>{folder(show(p))}</option>{/each}
					</select>
				</div>
			</div>

			<nav class="list" aria-label="Sessions">
				{#each filtered as s (s.id)}
					<button class="item" class:active={selected === s.id} onclick={() => open(s.id)}>
						<span class="t">{prefs.redact ? redactTitle(s, users) : s.title}</span>
						<span class="m">
							<span class="dot {s.source}"></span>
							<span class="f">{folder(show(s.cwd)) || TOOLS[s.source]}</span>
							{#if sentState(s)}
								{@const ws = sentState(s)!}
								<span class="wl" class:stale={ws.stale} title={ws.stale ? 'In Worklog, with new activity since it was sent' : 'In Worklog'}
									><Icon name={ws.stale ? 'refresh' : 'send'} size={11} /></span
								>
							{/if}
							{#if s.device}<span class="dev" title="Imported from {s.device}">{s.device}</span>{/if}
							<span class="r">{ago(s.end)}</span>
						</span>
						{#if s._snip}<span class="snip">{show(s._snip)}</span>{/if}
					</button>
				{:else}
					<div class="empty">{app.phase === 'scanning' ? 'Reading…' : 'No sessions match.'}</div>
				{/each}
			</nav>
			<div class="foot">
				{#if app.phase === 'scanning'}
					{app.progress.label} {app.progress.done}/{app.progress.total || '?'}
				{:else}
					{filtered.length} sessions · {fmt(listTotal)} tokens{hits ? ` · ${hits.length} matches` : ''}
				{/if}
				{#if app.errors.length}
					<details class="errs"><summary>{app.errors.length} couldn't be read</summary>{#each app.errors as e}<div>{e}</div>{/each}</details>
				{/if}
			</div>
		</aside>

		<main>
			<div class="wrap">
				<button class="btn ghost back" onclick={() => (mobilePane = 'list')}><Icon name="back" size={14} /> Sessions</button>
				{#if selected}
					<SessionView id={selected} onopen={open} onexport={() => (exporting = true)} onworklog={() => (logging = true)} />
				{:else if app.phase === 'scanning' && !app.sessions.length}
					<div class="empty">Reading your sessions… {app.progress.done}/{app.progress.total || '?'}</div>
				{:else}
					<div class="pagebar">
						<div class="tabs" role="tablist" aria-label="Pages">
							{#each VIEWS as v (v.id)}
								<button role="tab" aria-selected={view === v.id} class:on={view === v.id} onclick={() => go(v.id)}>{v.label}</button>
							{/each}
						</div>
						<div class="bar-actions">
							{#if view === 'overview'}
								<button class="btn" onclick={() => overview?.share()} disabled={!filtered.length} title="Make an image of these stats to share"><Icon name="image" size={14} /> Share</button>
							{/if}
							<button class="btn" onclick={() => (logging = true)} disabled={!filtered.length} title="Add these sessions to your Worklog timeline"><Icon name="send" size={14} /> Worklog</button>
							<button class="btn" onclick={() => (exporting = true)} disabled={!filtered.length} title="Export these sessions"><Icon name="download" size={14} /> Export</button>
						<select class="range" value={range} onchange={(e) => setRange((e.currentTarget as HTMLSelectElement).value as Range)} aria-label="Date range">
							{#each RANGES as r (r.id)}<option value={r.id}>{r.label}</option>{/each}
						</select>
						</div>
					</div>
					{#if filtered.length < roots.length}
						<p class="scope">
							Showing {filtered.length} of {roots.length} sessions{range !== 'all' ? ` from the last ${RANGES.find((r) => r.id === range)!.label}` : ''}{project ? ` in ${folder(show(project))}` : ''}{tools.size < present.length ? `, ${[...tools].filter((t) => present.includes(t)).map((t) => TOOLS[t]).join(', ')} only` : ''}{q.trim() ? `, matching “${q.trim()}”` : ''}.
							<button class="link" onclick={() => ((tools = new Set(TOOL_IDS)), (project = ''), (q = ''), (hits = null), setRange('all'))}>Show all</button>
						</p>
					{/if}
					{#if view === 'tools'}
						<ToolsPage sessions={filtered} />
					{:else if view === 'time'}
						<TimePage sessions={filtered} onopen={open} />
					{:else}
						<Overview bind:this={overview} sessions={filtered} history={older} {notes} rangeDays={range === 'all' ? null : Number(range)} onopen={open} />
					{/if}
				{/if}
			</div>
		</main>
	</div>
{/if}

{#if showSettings}
	<SettingsDialog onclose={() => (showSettings = false)} />
{/if}

{#if showSources}
	<SourcesDialog onclose={() => (showSources = false)} />
{/if}

{#if exporting}
	<ExportDialog current={selected ? (app.session(selected) ?? null) : null} list={filtered} onclose={() => (exporting = false)} />
{/if}

{#if logging}
	<WorklogDialog current={selected ? (app.session(selected) ?? null) : null} list={filtered} onclose={() => (logging = false)} />
{/if}

<style>
	.solo {
		min-height: 100vh;
	}
	.reconnect {
		max-width: 872px;
		margin: 32px auto -40px;
		padding: 12px 14px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r);
		display: flex;
		gap: 12px;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		font-size: 13.5px;
	}
	.app {
		display: grid;
		grid-template-columns: 320px minmax(0, 1fr);
		height: 100vh;
	}
	aside {
		border-right: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
		background: var(--surface);
	}
	.brand {
		padding: 12px 10px 8px 16px;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.logo {
		all: unset;
		display: flex;
		align-items: center;
		gap: 9px;
		font-weight: 650;
		font-size: 15px;
		letter-spacing: -0.01em;
		cursor: pointer;
	}
	.mark {
		display: grid;
		grid-template-columns: repeat(3, 5px);
		gap: 2px;
		align-items: end;
		height: 14px;
	}
	.mark i {
		display: block;
		border-radius: 1.5px;
		background: var(--ink);
	}
	.mark i:nth-child(1) {
		height: 7px;
	}
	.mark i:nth-child(2) {
		height: 14px;
	}
	.mark i:nth-child(3) {
		height: 10px;
	}
	.actions {
		display: flex;
		gap: 2px;
	}
	.actions .btn {
		position: relative;
	}
	.pip {
		position: absolute;
		top: 6px;
		right: 6px;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--warn);
		box-shadow: 0 0 0 2px var(--surface);
	}
	.sync {
		gap: 6px;
		padding: 0 10px;
		font-size: 12.5px;
	}
	.spin {
		display: inline-flex;
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.stale {
		all: unset;
		box-sizing: border-box;
		margin: 0 12px 8px;
		padding: 8px 10px;
		display: flex;
		gap: 8px;
		align-items: flex-start;
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--ink-2);
		background: var(--surface-2);
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		cursor: pointer;
	}
	.stale:hover {
		border-color: var(--ink-2);
	}
	.stale:focus-visible {
		outline: 2px solid var(--focus);
	}
	.stale :global(svg) {
		flex: none;
		margin-top: 1px;
	}
	.controls {
		padding: 4px 12px 10px;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 8px;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 4px 0 10px;
		height: 34px;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		background: var(--bg);
		color: var(--faint);
	}
	.search:focus-within {
		border-color: var(--ink-2);
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: transparent;
		outline: none;
		height: 100%;
		color: var(--ink);
	}
	.deep {
		all: unset;
		font-size: 11.5px;
		padding: 3px 7px;
		border-radius: 5px;
		cursor: pointer;
		color: var(--muted);
		white-space: nowrap;
	}
	.deep.on {
		background: var(--ink);
		color: var(--bg);
	}
	.deep:focus-visible {
		outline: 2px solid var(--focus);
	}
	.chips {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}
	.chip {
		all: unset;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 9px;
		border-radius: 999px;
		font-size: 12px;
		cursor: pointer;
		color: var(--faint);
		border: 1px solid transparent;
	}
	.chip[aria-pressed='true'] {
		color: var(--ink-2);
		background: var(--surface-2);
	}
	.chip[aria-pressed='false'] .dot {
		opacity: 0.35;
	}
	.chip:hover {
		border-color: var(--line);
	}
	.chip:focus-visible {
		outline: 2px solid var(--focus);
	}
	.chip .n {
		color: var(--faint);
		font-variant-numeric: tabular-nums;
	}
	.row {
		display: flex;
		gap: 6px;
	}
	select {
		flex: 1;
		min-width: 0;
		height: 30px;
		padding: 0 8px;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		background: var(--surface);
		font-size: 12.5px;
		color: var(--ink-2);
	}
	.list {
		overflow: auto;
		flex: 1;
		padding: 4px 6px;
		border-top: 1px solid var(--line-soft);
	}
	.item {
		all: unset;
		box-sizing: border-box;
		width: 100%;
		padding: 8px 10px;
		border-radius: var(--r-sm);
		cursor: pointer;
		display: grid;
		gap: 2px;
	}
	.item:hover {
		background: var(--surface-2);
	}
	.item:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.item.active {
		background: var(--surface-3);
	}
	.t {
		font-weight: 500;
		font-size: 13.5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.m {
		color: var(--faint);
		font-size: 12px;
		display: flex;
		gap: 7px;
		align-items: center;
		white-space: nowrap;
		min-width: 0;
	}
	.f {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.wl {
		display: inline-flex;
		color: var(--ok);
		flex: none;
	}
	.wl.stale {
		color: var(--warn);
	}
	.dev {
		flex: 0 1 auto;
		min-width: 0;
		max-width: 90px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding: 0 5px;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: 10.5px;
	}
	.r {
		margin-left: auto;
		flex: none;
	}
	.snip {
		font-size: 11.5px;
		color: var(--muted);
		font-family: var(--mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.foot {
		padding: 8px 16px;
		color: var(--faint);
		font-size: 12px;
		border-top: 1px solid var(--line-soft);
		font-variant-numeric: tabular-nums;
	}
	.errs div {
		font-family: var(--mono);
		overflow-wrap: anywhere;
	}
	main {
		overflow-y: auto;
		overflow-x: hidden;
		min-width: 0;
	}
	.wrap {
		max-width: 860px;
		margin: 0 auto;
		padding: 40px 40px 80px;
	}
	.pagebar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 28px;
		flex-wrap: wrap;
	}
	.tabs {
		display: inline-flex;
		background: var(--surface-2);
		border-radius: var(--r);
		padding: 3px;
	}
	.tabs button {
		all: unset;
		padding: 6px 14px;
		border-radius: 7px;
		cursor: pointer;
		font-size: 13.5px;
		font-weight: 550;
		color: var(--muted);
	}
	.tabs button.on {
		background: var(--surface);
		color: var(--ink);
		box-shadow: var(--shadow);
	}
	.tabs button:focus-visible {
		outline: 2px solid var(--focus);
	}
	.bar-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.range {
		flex: none;
		width: auto;
		height: 32px;
		padding: 0 10px;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		background: var(--surface);
		font-size: 13px;
	}
	.scope {
		margin: -16px 0 24px;
		font-size: 12.5px;
		color: var(--muted);
	}
	.link {
		all: unset;
		cursor: pointer;
		color: var(--ink-2);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.back {
		display: none;
		margin: -8px 0 12px -10px;
	}
	@media (max-width: 860px) {
		.app {
			grid-template-columns: minmax(0, 1fr);
		}
		.app[data-pane='list'] main,
		.app[data-pane='main'] aside {
			display: none;
		}
		.back {
			display: inline-flex;
		}
		.wrap {
			padding: 20px 16px 60px;
		}
	}
</style>
