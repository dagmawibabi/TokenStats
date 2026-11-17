<script lang="ts">
	import { ago } from '#lib/format.ts';
	import { app } from '#lib/store.svelte.ts';
	import Connect from './Connect.svelte';
	import Devices from './Devices.svelte';
	import Icon from './Icon.svelte';

	let { onclose }: { onclose: () => void } = $props();

	let dialog: HTMLDialogElement;
	let confirmForget = $state(false);

	$effect(() => {
		dialog.showModal();
	});

	// Folders remembered from before tools were recorded per folder
	const other = $derived([...app.roots, ...app.pendingRoots].filter((r) => !r.tools?.length));
</script>

<dialog bind:this={dialog} onclose={onclose} onclick={(e) => e.target === dialog && dialog.close()}>
	<div class="box">
		<header>
			<div>
				<h3>Sources</h3>
				<p>
					Folders are remembered in this browser.
					{#if app.lastSync}Last synced {ago(app.lastSync)}.{/if}
				</p>
			</div>
			<div class="ha">
				<button class="btn sm" onclick={() => app.sync()} disabled={app.phase === 'scanning' || !(app.roots.length || app.pendingRoots.length)}>
					<Icon name="refresh" size={14} />
					{app.phase === 'scanning' ? 'Syncing…' : 'Sync all'}
				</button>
				<button class="btn ghost icon" aria-label="Close" onclick={() => dialog.close()}><Icon name="x" /></button>
			</div>
		</header>

		<Connect compact />

		{#if other.length}
			<div class="other">
				<span class="muted">Other folders</span>
				{#each other as r (r.id)}
					<div class="orow">
						<Icon name="folder" size={14} />
						<span class="mono">{r.name}</span>
						<button class="link" title="Remove this folder and its cached data" onclick={() => app.removeRoot(r)}>Remove</button>
					</div>
				{/each}
			</div>
		{/if}

		<Devices />

		<footer>
			{#if confirmForget}
				<span>Forget every folder, imported computer and all cached data in this browser?</span>
				<span class="fa">
					<button class="btn ghost" onclick={() => (confirmForget = false)}>Cancel</button>
					<button class="btn danger" onclick={() => (app.forgetEverything(), dialog.close())}>Forget all</button>
				</span>
			{:else}
				<button class="link" onclick={() => (confirmForget = true)}>Forget all folders and cached data</button>
			{/if}
		</footer>
	</div>
</dialog>

<style>
	dialog {
		border: 0;
		padding: 0;
		background: transparent;
		color: var(--ink);
		max-width: min(560px, calc(100vw - 32px));
		max-height: calc(100dvh - 32px);
		width: 100%;
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.35);
		backdrop-filter: blur(2px);
	}
	.box {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-lg);
		padding: 20px;
		display: grid;
		gap: 16px;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
	}
	.ha {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	h3 {
		margin: 0;
		font-size: 16px;
		font-weight: 650;
	}
	header p {
		margin: 2px 0 0;
		color: var(--muted);
		font-size: 13px;
	}
	.other {
		display: grid;
		gap: 6px;
		font-size: 13px;
	}
	.orow {
		display: flex;
		gap: 8px;
		align-items: center;
		color: var(--muted);
	}
	.orow .mono {
		flex: 1;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	footer {
		border-top: 1px solid var(--line-soft);
		padding-top: 12px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
		font-size: 13px;
	}
	.fa {
		display: flex;
		gap: 6px;
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
	.btn.danger {
		background: var(--danger);
		border-color: var(--danger);
		color: #fff;
	}
</style>
