#!/usr/bin/env node
// DeckWriter Live relay
//
// Lets DeckWriter build buttons in a running Companion one key at a time, while Companion is live.
// Companion's editor talks to its server over a tRPC websocket that refuses connections from other web
// pages (by Origin), so a browser page can't use it directly. This relay runs on the same Mac, connects to
// that websocket as a local program, and exposes a tiny HTTP API that only DeckWriter's origins may call.
//
// Run it with Companion's own Node (no install needed):
//   /Applications/Companion.app/Contents/Resources/node-runtimes/node22/bin/node relay.mjs
// Options: --companion http://127.0.0.1:8000   --port 8790
//
// It only ever: creates/replaces the one key it is asked to push, clears a key it is asked to clear,
// reports status. It never deletes pages or touches keys it wasn't asked about.
// Built against Companion 5.0.x's internal API (controls.resetControl, controls.styles.*,
// controls.entities.*, controls.steps.add, pages.watch). Companion may change these between versions.
import http from 'node:http'

const arg = (name, def) => {
	const i = process.argv.indexOf(name)
	return i > 0 ? process.argv[i + 1] : def
}
const COMPANION = arg('--companion', 'http://127.0.0.1:8000').replace(/\/+$/, '')
const PORT = Number(arg('--port', 8790))
const ALLOWED = [/^https:\/\/bryanchorton\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, /^null$/]
const VERSION = '1.0.0'

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a)

/* ---------- Companion connection ---------- */
let ws = null
let connected = false
let nextId = 1
const pending = new Map()
const subs = new Map()
// page model: order of page ids and, per page id, { name, controls: { row: { col: controlId } } }
const pages = { order: [], byId: {} }

function connect() {
	const url = COMPANION.replace(/^http/, 'ws') + '/trpc'
	ws = new WebSocket(url) // a local program: no Origin header, which Companion accepts
	ws.onopen = () => {
		connected = true
		log('connected to Companion at', COMPANION)
		subscribe('pages.watch', undefined, onPages)
	}
	ws.onclose = () => {
		if (connected) log('lost Companion, retrying…')
		connected = false
		for (const p of pending.values()) p.reject(new Error('Companion connection closed'))
		pending.clear()
		subs.clear()
		setTimeout(connect, 2000)
	}
	ws.onerror = () => {}
	ws.onmessage = (ev) => {
		let msg
		try {
			msg = JSON.parse(ev.data)
		} catch {
			return
		}
		if (subs.has(msg.id)) {
			if (msg.result?.type === 'data') subs.get(msg.id)(msg.result.data)
			return
		}
		const p = pending.get(msg.id)
		if (!p) return
		pending.delete(msg.id)
		if (msg.error) p.reject(new Error(msg.error?.message || JSON.stringify(msg.error).slice(0, 300)))
		else p.resolve(msg.result?.data)
	}
}
function call(path, input, method = 'mutation') {
	return new Promise((resolve, reject) => {
		if (!connected) return reject(new Error('Not connected to Companion'))
		const id = nextId++
		pending.set(id, { resolve, reject })
		ws.send(JSON.stringify({ id, jsonrpc: '2.0', method, params: { path, input } }))
		setTimeout(() => pending.has(id) && (pending.delete(id), reject(new Error(path + ' timed out'))), 10000)
	})
}
function subscribe(path, input, onData) {
	const id = nextId++
	subs.set(id, onData)
	ws.send(JSON.stringify({ id, jsonrpc: '2.0', method: 'subscription', params: { path, input } }))
}
// one-shot read of a control's full config (the editor's watchControl subscription, stopped after "init")
function controlConfig(controlId) {
	return new Promise((resolve, reject) => {
		const id = nextId++
		const done = (fn, v) => {
			subs.delete(id)
			try {
				ws.send(JSON.stringify({ id, jsonrpc: '2.0', method: 'subscription.stop' }))
			} catch {}
			fn(v)
		}
		subs.set(id, (d) => d?.type === 'init' && done(resolve, d.config))
		ws.send(JSON.stringify({ id, jsonrpc: '2.0', method: 'subscription', params: { path: 'controls.watchControl', input: { controlId } } }))
		setTimeout(() => subs.has(id) && done(reject, new Error('reading the button timed out')), 5000)
	})
}
function onPages(d) {
	if (d.type === 'init') {
		pages.order = d.order
		pages.byId = structuredClone(d.pages)
		return
	}
	if (d.updatedOrder) pages.order = d.updatedOrder
	for (const p of d.added || []) pages.byId[p.id] = structuredClone(p)
	for (const id of d.removed || []) delete pages.byId[id]
	for (const ch of d.changes || []) {
		const p = (pages.byId[ch.id] ??= { name: '', controls: {} })
		if (ch.name != null) p.name = ch.name
		for (const c of ch.controls || []) {
			const row = (p.controls[c.row] ??= {})
			if (c.controlId) row[c.column] = c.controlId
			else delete row[c.column]
		}
	}
}
const controlAt = (page, row, column) => pages.byId[pages.order[page - 1]]?.controls?.[row]?.[column] ?? null
const waitFor = async (fn, ms = 3000) => {
	const t0 = Date.now()
	while (Date.now() - t0 < ms) {
		const v = fn()
		if (v) return v
		await new Promise((r) => setTimeout(r, 40))
	}
	return null
}

/* ---------- building one key ---------- */
const v = (value) => ({ value, isExpression: false })
const ALIGN_H = { left: 'left', center: 'center', right: 'right' }
const ALIGN_V = { top: 'top', center: 'center', bottom: 'bottom' }

// control: a DeckWriter export control (Companion export format 6 shape)
async function pushKey(page, row, column, control) {
	if (!pages.order[page - 1]) throw new Error(`Companion has no page ${page}`)
	const loc = { pageNumber: page, row, column }
	const notes = []
	if (['pageup', 'pagedown', 'pagenum'].includes(control.type)) {
		await call('controls.resetControl', { location: loc, newType: control.type })
		return { notes }
	}
	if (control.type !== 'button') throw new Error(`Can't build a "${control.type}" key`)

	const before = controlAt(page, row, column)
	await call('controls.resetControl', { location: loc, newType: 'button-layered' })
	const controlId = await waitFor(() => {
		const id = controlAt(page, row, column)
		return id && id !== before ? id : null
	})
	if (!controlId) throw new Error('Companion did not report the new button')

	const st = control.style || {}
	const set = (elementId, key, value) => call('controls.styles.updateOption', { controlId, elementId, key, value: v(value) })
	await set('canvas', 'decoration', st.show_topbar === true ? 'topbar' : st.show_topbar === false ? 'border' : 'default')
	if (st.bgcolor != null) await set('box0', 'color', st.bgcolor)
	if (st.png64) {
		const imageId = await call('controls.styles.addElement', { controlId, type: 'image', afterElementId: 'box0' })
		if (typeof imageId === 'string') {
			await set(imageId, 'base64Image', st.png64)
			const [ih, iv] = String(st.pngalignment || 'center:center').split(':')
			await set(imageId, 'halign', ALIGN_H[ih] || 'center')
			await set(imageId, 'valign', ALIGN_V[iv] || 'center')
			await set(imageId, 'fillMode', 'fit')
		} else notes.push('image layer could not be added')
	}
	await set('text0', 'text', st.text ?? '')
	if (st.color != null) await set('text0', 'color', st.color)
	const [h, va] = String(st.alignment || 'center:center').split(':')
	await set('text0', 'halign', ALIGN_H[h] || 'center')
	await set('text0', 'valign', ALIGN_V[va] || 'center')
	if (st.size != null && st.size !== 'auto') {
		// Companion's own legacy conversion: a size of n with no top bar becomes fontsize n / 0.6
		await set('text0', 'fontsize', Number((Number(st.size) / 0.6).toFixed(1)))
		await set('text0', 'fontsizeAllowShrink', false)
	}

	// steps and their actions
	const stepKeys = Object.keys(control.steps || {}).sort((a, b) => Number(a) - Number(b))
	const stepIds = ['0']
	for (let i = 1; i < stepKeys.length; i++) {
		const id = await call('controls.steps.add', { controlId })
		stepIds.push(typeof id === 'string' ? id : String(i))
	}
	for (let i = 0; i < stepKeys.length; i++) {
		const sets = control.steps[stepKeys[i]]?.action_sets || {}
		for (const [setId, actions] of Object.entries(sets)) {
			for (const a of actions || []) {
				const entityLocation = { stepId: stepIds[i], setId }
				const entityId = await call('controls.entities.add', {
					controlId,
					entityLocation,
					ownerId: null,
					connectionId: a.instance,
					entityType: 'action',
					entityDefinition: a.action,
				})
				if (!entityId) {
					notes.push(`action "${a.action}" isn't available on that connection`)
					continue
				}
				for (const [key, value] of Object.entries(a.options || {}))
					await call('controls.entities.setOption', { controlId, entityLocation, entityId, key, value: v(value) })
			}
		}
	}

	// feedbacks, with their colour / image overrides
	for (const f of control.feedbacks || []) {
		const entityId = await call('controls.entities.add', {
			controlId,
			entityLocation: 'feedbacks',
			ownerId: null,
			connectionId: f.instance_id,
			entityType: 'feedback',
			entityDefinition: f.type,
		})
		if (!entityId) {
			notes.push(`feedback "${f.type}" isn't available on that connection`)
			continue
		}
		for (const [key, value] of Object.entries(f.options || {}))
			await call('controls.entities.setOption', { controlId, entityLocation: 'feedbacks', entityId, key, value: v(value) })
		if (f.isInverted) await call('controls.entities.setInverted', { controlId, entityLocation: 'feedbacks', entityId, isInverted: v(true) })
		// Companion gives a new feedback its own default colour overrides. Edit those in place, drop the ones
		// DeckWriter didn't ask for, and add the rest, so the result matches importing the button from a file.
		const s = f.style || {}
		const want = new Map()
		if (s.bgcolor != null) want.set('box0|color', s.bgcolor)
		if (s.color != null) want.set('text0|color', s.color)
		if (s.text != null) want.set('text0|text', s.text)
		let existing = []
		try {
			const cfg = await controlConfig(controlId)
			existing = (cfg?.feedbacks || []).find((e) => e.id === entityId)?.styleOverrides || []
		} catch (e) {
			notes.push(e.message)
		}
		for (const o of existing) {
			const k = `${o.elementId}|${o.elementProperty}`
			if (want.has(k)) {
				await call('controls.entities.replaceStyleOverride', {
					controlId, entityLocation: 'feedbacks', entityId,
					override: { overrideId: o.overrideId, elementId: o.elementId, elementProperty: o.elementProperty, override: v(want.get(k)) },
				})
				want.delete(k)
			} else {
				await call('controls.entities.removeStyleOverride', { controlId, entityLocation: 'feedbacks', entityId, overrideId: o.overrideId })
			}
		}
		for (const [k, value] of want) {
			const [elementId, elementProperty] = k.split('|')
			await call('controls.entities.replaceStyleOverride', {
				controlId, entityLocation: 'feedbacks', entityId,
				override: { overrideId: Math.random().toString(36).slice(2, 12), elementId, elementProperty, override: v(value) },
			})
		}
	}
	return { notes, controlId }
}

async function clearKey(page, row, column) {
	if (!pages.order[page - 1]) throw new Error(`Companion has no page ${page}`)
	await call('controls.resetControl', { location: { pageNumber: page, row, column } })
}

/* ---------- HTTP API for DeckWriter ---------- */
let queue = Promise.resolve() // one change at a time, in order
const serial = (fn) => (queue = queue.then(fn, fn))

function cors(req, res) {
	const origin = req.headers.origin
	if (origin && !ALLOWED.some((re) => re.test(origin))) return false
	if (origin) {
		res.setHeader('Access-Control-Allow-Origin', origin)
		res.setHeader('Vary', 'Origin')
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
		res.setHeader('Access-Control-Allow-Private-Network', 'true')
	}
	return true
}
const send = (res, code, obj) => {
	res.writeHead(code, { 'Content-Type': 'application/json' })
	res.end(JSON.stringify(obj))
}
const body = (req) =>
	new Promise((resolve, reject) => {
		let data = ''
		req.on('data', (c) => {
			data += c
			if (data.length > 8e6) reject(new Error('too large'))
		})
		req.on('end', () => {
			try {
				resolve(data ? JSON.parse(data) : {})
			} catch (e) {
				reject(e)
			}
		})
	})

http
	.createServer(async (req, res) => {
		if (!cors(req, res)) return send(res, 403, { ok: false, error: 'Origin not allowed' })
		if (req.method === 'OPTIONS') return res.writeHead(204).end()
		const path = new URL(req.url, 'http://x').pathname
		try {
			if (req.method === 'GET' && path === '/status') {
				return send(res, 200, {
					ok: true,
					relay: VERSION,
					companion: connected,
					companionUrl: COMPANION,
					pages: pages.order.map((id, i) => {
						const p = pages.byId[id] || {}
						const keys = []
						for (const [r, row] of Object.entries(p.controls || {})) for (const c of Object.keys(row)) keys.push([Number(r), Number(c)])
						return { number: i + 1, name: p.name || '', keys }
					}),
				})
			}
			if (req.method === 'POST' && path === '/push') {
				const b = await body(req)
				const out = await serial(() => pushKey(Number(b.page), Number(b.row), Number(b.column), b.control))
				log(`pushed page ${b.page} row ${b.row} col ${b.column}`, out.notes.length ? out.notes.join('; ') : '')
				return send(res, 200, { ok: true, notes: out.notes })
			}
			if (req.method === 'POST' && path === '/clear') {
				const b = await body(req)
				await serial(() => clearKey(Number(b.page), Number(b.row), Number(b.column)))
				log(`cleared page ${b.page} row ${b.row} col ${b.column}`)
				return send(res, 200, { ok: true })
			}
			send(res, 404, { ok: false, error: 'Not found' })
		} catch (e) {
			log('error:', e.message)
			send(res, 500, { ok: false, error: e.message })
		}
	})
	.listen(PORT, '127.0.0.1', () => {
		log(`DeckWriter Live relay ${VERSION} on http://127.0.0.1:${PORT}`)
		connect()
	})
