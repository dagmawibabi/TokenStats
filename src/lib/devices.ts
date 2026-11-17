// One person, several computers. Each computer saves a device file: its sessions' totals (tokens, models,
// dates, tool and time stats, titles and folders) with no conversation text. Importing the other computers'
// files here shows everything combined. Files are read in this browser and never sent anywhere.
import type { Coverage, CoverageNote, HistoryEntry } from './history';
import { emptyTokens, TOOLS, type Session } from './types';

export const DEVICE_FORMAT = 'session-browser-device';
export const DEVICE_VERSION = 1;

export interface Device {
	id: string;
	name: string;
}

export interface DeviceFile extends Coverage {
	format: typeof DEVICE_FORMAT;
	version: number;
	device: Device;
	/** when the device's folders were last read */
	syncedAt: number | null;
	exportedAt: number;
	sessions: Session[];
}

export interface Own extends Coverage {
	sessions: Session[];
}

/** What leaves this computer: numbers, models, dates, titles and folders. No prompts, file paths or per-response usage. */
function strip(s: Session): Session {
	const { calls: _calls, device: _device, ...rest } = s;
	return { ...rest, first_prompt: '', path: '', size: null };
}

export function buildDeviceFile(device: Device, own: Own, syncedAt: number | null, now = Date.now()): DeviceFile {
	return {
		format: DEVICE_FORMAT,
		version: DEVICE_VERSION,
		device: { id: device.id, name: device.name },
		syncedAt,
		exportedAt: now,
		sessions: own.sessions.map(strip),
		history: own.history,
		notes: own.notes
	};
}

export const deviceFileName = (f: DeviceFile) =>
	`sessions-${f.device.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'device'}-${new Date(f.exportedAt).toISOString().slice(0, 10)}.json`;

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Reads a device file, keeping only well-formed entries. Throws with a message for the person when it isn't one. */
export function parseDeviceFile(text: string): DeviceFile {
	let j: unknown;
	try {
		j = JSON.parse(text);
	} catch {
		throw new Error("This isn't a device file (it isn't JSON).");
	}
	if (!isObj(j) || j.format !== DEVICE_FORMAT || !isObj(j.device) || typeof j.device.id !== 'string' || !j.device.id || !Array.isArray(j.sessions))
		throw new Error("This isn't a device file. Make one on the other computer with “Save this computer’s file”.");
	if (typeof j.version !== 'number' || j.version > DEVICE_VERSION) throw new Error('This device file was made by a newer version of the site. Reload this page and try again.');
	const known = (v: any) => isObj(v) && typeof v.source === 'string' && v.source in TOOLS && isObj(v.tokens);
	const sessions = (j.sessions as any[])
		.filter((s) => known(s) && typeof s.id === 'string' && s.id)
		.map((s): Session => ({
			...s,
			title: String(s.title ?? ''),
			first_prompt: '',
			path: '',
			size: null,
			parent: typeof s.parent === 'string' ? s.parent : null,
			models: isObj(s.models) ? s.models : {},
			subagents: Array.isArray(s.subagents) ? s.subagents.filter((x: any) => isObj(x) && typeof x.id === 'string' && isObj(x.tokens)) : [],
			subagent_tokens: isObj(s.subagent_tokens) ? s.subagent_tokens : emptyTokens()
		}));
	const history = (Array.isArray(j.history) ? j.history : []).filter((h: any) => known(h) && typeof h.from === 'number' && typeof h.to === 'number') as HistoryEntry[];
	const notes = (Array.isArray(j.notes) ? j.notes : []).filter((n: any) => isObj(n) && n.source in TOOLS && typeof n.text === 'string') as CoverageNote[];
	return {
		format: DEVICE_FORMAT,
		version: j.version,
		device: { id: j.device.id, name: String(j.device.name || 'Another computer').slice(0, 60) },
		syncedAt: typeof j.syncedAt === 'number' ? j.syncedAt : null,
		exportedAt: typeof j.exportedAt === 'number' ? j.exportedAt : Date.now(),
		sessions,
		history,
		notes
	};
}

/**
 * This computer's sessions plus every imported device's. A session present on two computers (a copied or
 * synced folder) is counted once: this computer's copy wins, then the most recently exported file's.
 */
export function combine(own: Own, files: DeviceFile[], selfId?: string): Own {
	if (!files.length) return own;
	const seen = new Set(own.sessions.map((s) => s.id));
	const sessions = [...own.sessions];
	const history = [...own.history];
	const notes = [...own.notes];
	for (const f of [...files].sort((a, b) => b.exportedAt - a.exportedAt)) {
		if (f.device.id === selfId) continue;
		const added = new Set<string>();
		for (const s of f.sessions) {
			if (seen.has(s.id)) continue;
			added.add(s.id);
			sessions.push({ ...s, device: f.device.name });
		}
		added.forEach((id) => seen.add(id));
		history.push(...f.history.map((h) => ({ ...h, device: f.device.name })));
		notes.push(...f.notes.map((n) => ({ ...n, text: `${f.device.name}: ${n.text}` })));
	}
	return { sessions, history, notes };
}

/** A starting name for this computer, from what the browser says it runs on. */
export function guessDeviceName(ua: string): string {
	if (/iPad|iPhone|Android/i.test(ua)) return 'Phone or tablet';
	if (/Mac/i.test(ua)) return 'Mac';
	if (/Windows/i.test(ua)) return 'Windows PC';
	if (/CrOS/i.test(ua)) return 'Chromebook';
	if (/Linux/i.test(ua)) return 'Linux PC';
	return 'This computer';
}
