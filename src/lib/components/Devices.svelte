<script lang="ts">
	import { deviceFileName } from '#lib/devices.ts';
	import { download } from '#lib/export.ts';
	import { ago, fmt, sessionTotal } from '#lib/format.ts';
	import { app } from '#lib/store.svelte.ts';
	import { totalTokens } from '#lib/types.ts';
	import Icon from './Icon.svelte';

	/** bare: only the import control, for the first screen where this computer has nothing to save yet */
	let { bare = false }: { bare?: boolean } = $props();

	let input: HTMLInputElement;
	let message = $state<{ ok: boolean; text: string } | null>(null);

	// Sessions and tokens per computer, as they count in the combined totals (a session on two computers counts once).
	const rows = $derived.by(() => {
		const tally = (device: string | undefined) => ({
			sessions: app.sessions.filter((s) => !s.parent && s.device === device).length,
			tokens:
				app.sessions.reduce((a, s) => a + (!s.parent && s.device === device ? sessionTotal(s) : 0), 0) +
				app.history.reduce((a, h) => a + (h.device === device ? totalTokens(h.tokens) : 0), 0)
		});
		return {
			own: tally(undefined),
			others: app.devices.map((d) => ({ id: d.device.id, name: d.device.name, at: d.exportedAt, ...tally(d.device.name) }))
		};
	});
	const hasOwn = $derived(app.ownSessions.length > 0 || app.ownHistory.length > 0);

	function save() {
		const f = app.deviceFile();
		download(deviceFileName(f), JSON.stringify(f), 'application/json');
		message = { ok: true, text: `Saved ${deviceFileName(f)}. Import it on your other computers.` };
	}

	async function add(files: FileList | null) {
		const done: string[] = [];
		const failed: string[] = [];
		for (const file of files ?? []) {
			try {
				const f = await app.importDevice(await file.text());
				done.push(`${f.device.name} (${f.sessions.filter((s) => !s.parent).length} sessions)`);
			} catch (e) {
				failed.push(`${file.name}: ${(e as Error).message}`);
			}
		}
		if (input) input.value = ''; // gone when the first import replaced the start screen
		const added = done.length ? `Added ${done.join(', ')}.` : '';
		message = failed.length ? { ok: false, text: [added, ...failed].filter(Boolean).join(' ') } : added ? { ok: true, text: added } : null;
	}
</script>

<section class="devices" class:bare>
	{#if !bare}
		<div class="top">
			<div>
				<h4>Your computers</h4>
				<p>Save a file of this computer's totals and import it on another to see them combined. It holds numbers, models, dates, titles and folders, not conversations.</p>
			</div>
		</div>
		<div class="row">
			<Icon name="terminal" size={14} />
			<input
				class="name"
				value={app.device.name}
				onchange={(e) => app.renameDevice(e.currentTarget.value)}
				aria-label="This computer's name"
				title="The name your other computers show for this one"
				maxlength="60"
			/>
			<span class="muted">this computer · {rows.own.sessions} sessions · {fmt(rows.own.tokens)}</span>
		</div>
		{#each rows.others as d (d.id)}
			<div class="row">
				<Icon name="terminal" size={14} />
				<span class="dn">{d.name}</span>
				<span class="muted">{d.sessions} sessions · {fmt(d.tokens)} · saved {ago(d.at)}</span>
				<button class="link" title="Remove this computer's totals from this browser" onclick={() => app.removeDevice(d.id)}>Remove</button>
			</div>
		{/each}
	{/if}
	<div class="acts">
		{#if !bare}
			<button class="btn sm" onclick={save} disabled={!hasOwn} title={hasOwn ? 'Download this computer’s totals as a file' : 'Choose a folder first'}>
				<Icon name="download" size={14} /> Save this computer's file
			</button>
		{/if}
		<button class="btn sm" class:ghost={bare} onclick={() => input.click()}><Icon name="plus" size={14} /> Import {bare ? 'a file from another computer' : 'another computer'}</button>
		<input bind:this={input} type="file" accept=".json,application/json" multiple hidden onchange={(e) => add(e.currentTarget.files)} />
	</div>
	{#if message}<p class="msg" class:bad={!message.ok} role="status">{message.text}</p>{/if}
</section>

<style>
	.devices {
		display: grid;
		gap: 8px;
		font-size: 13px;
		border-top: 1px solid var(--line-soft);
		padding-top: 14px;
	}
	.devices.bare {
		border: 0;
		padding: 0;
		justify-items: center;
		text-align: center;
	}
	h4 {
		margin: 0;
		font-size: 13.5px;
		font-weight: 650;
	}
	p {
		margin: 2px 0 0;
		color: var(--muted);
		font-size: 12.5px;
	}
	.row {
		display: flex;
		gap: 8px;
		align-items: center;
		min-width: 0;
		flex-wrap: wrap;
	}
	.name {
		font: inherit;
		color: var(--ink);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--r-sm, 6px);
		padding: 3px 7px;
		width: 150px;
		min-width: 0;
	}
	.name:focus-visible {
		outline: 2px solid var(--focus);
	}
	.dn {
		font-weight: 550;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 180px;
	}
	.muted {
		color: var(--muted);
		flex: 1;
		min-width: 0;
		font-size: 12.5px;
	}
	.acts {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		margin-top: 2px;
	}
	.msg {
		color: var(--ok);
	}
	.msg.bad {
		color: var(--danger);
	}
	.link {
		all: unset;
		cursor: pointer;
		color: var(--muted);
		font-size: 12.5px;
		text-decoration: underline;
		text-decoration-color: var(--faint);
		text-underline-offset: 2px;
	}
	.link:hover {
		color: var(--danger);
	}
	.link:focus-visible {
		outline: 2px solid var(--focus);
	}
</style>
