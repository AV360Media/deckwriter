// Stand-in for the Companion host: starts one module, asks for its config fields,
// initialises it with default config, and records the definitions it reports.
// Usage: node harness.js <moduleDir> <outFile> [nodeBinary]
const { fork } = require('child_process')
const path = require('path')
const fs = require('fs')

const [moduleDirRel, outFile, nodeBin] = process.argv.slice(2)
const moduleDir = path.resolve(moduleDirRel)
const manifestPath = path.join(moduleDir, 'companion', 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const moduleEntry = path.resolve(path.dirname(manifestPath), manifest.runtime.entrypoint)
const isV2 = String(manifest.runtime.apiVersion).startsWith('2')
// v2 modules only export a class; Companion's own ConnectionThread.js hosts them
const entry = isV2 ? '/Applications/Companion.app/Contents/Resources/ConnectionThread.js' : moduleEntry

const result = { id: manifest.id, version: manifest.version, apiVersion: manifest.runtime.apiVersion,
	manufacturer: manifest.manufacturer, products: manifest.products, actions: null, feedbacks: null, presets: null,
	variables: null, configFields: null, errors: [] }

const child = fork(entry, [], {
	cwd: moduleDir,
	execPath: nodeBin || process.execPath,
	env: { ...process.env, MODULE_MANIFEST: manifestPath, MODULE_ENTRYPOINT: moduleEntry, CONNECTION_ID: 'harness', VERIFICATION_TOKEN: 'harness', NODE_ENV: 'production' },
	stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
	serialization: 'json',
})
let stderr = ''
child.stderr.on('data', (d) => { if (stderr.length < 4000) stderr += d })

let nextId = 1
const pending = new Map()
function call(name, payload, timeout = 8000) {
	const id = nextId++
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject })
		child.send({ direction: 'call', name, payload: enc(payload), callbackId: id })
		setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(name + ' timed out')) } }, timeout)
	})
}
const parse = (p) => { if (typeof p !== 'string') return p; try { return JSON.parse(p) } catch { return undefined } }
const enc = (v) => (isV2 ? v : JSON.stringify(v))

let registered
const registeredP = new Promise((r) => (registered = r))
child.on('message', (msg) => {
	if (!msg || typeof msg !== 'object') return
	if (msg.direction === 'response') {
		const p = pending.get(msg.callbackId); if (!p) return
		pending.delete(msg.callbackId)
		msg.success ? p.resolve(parse(msg.payload)) : p.reject(new Error(JSON.stringify(msg.payload).slice(0, 300)))
		return
	}
	if (msg.direction !== 'call') return
	if (process.env.HDEBUG) console.error('MSG', msg.name, msg.name === 'log-message' ? JSON.stringify(msg.payload).slice(0, 400) : JSON.stringify(msg.payload ?? '').length)
	const payload = parse(msg.payload)
	const reply = (data) => { if (msg.callbackId !== undefined) child.send({ direction: 'response', callbackId: msg.callbackId, success: true, payload: enc(data ?? null) }) }
	switch (msg.name) {
		case 'register': reply({ connectionId: 'harness', moduleApiVersion: manifest.runtime.apiVersion }); registered(); break
		case 'setActionDefinitions': result.actions = payload?.actions ?? null; reply(); break
		case 'setFeedbackDefinitions': result.feedbacks = payload?.feedbacks ?? null; reply(); break
		case 'setPresetDefinitions': result.presets = payload?.presets ?? null; result.presetMeta = Object.fromEntries(Object.entries(payload || {}).filter(([k]) => k !== 'presets')); reply(); break
		case 'setVariableDefinitions': result.variables = (payload?.variables ?? []).map((v) => ({ id: v.id, name: v.name })); reply(); break
		case 'parseVariablesInString': reply({ text: payload?.text ?? '', variableIds: [] }); break
		case 'sharedUdpSocketJoin': reply('harness-socket'); break
		default: reply(); break
	}
})

function finish(code) {
	if (stderr && !result.actions) result.errors.push(stderr.slice(0, 1500))
	fs.writeFileSync(outFile, JSON.stringify(result))
	try { child.kill('SIGKILL') } catch {}
	process.exit(code)
}
child.on('exit', () => setTimeout(() => finish(0), 50))
setTimeout(() => { result.errors.push('overall timeout'); finish(0) }, 20000)

;(async () => {
	await Promise.race([registeredP, new Promise((_, rej) => setTimeout(() => rej(new Error('no register')), 10000))])
	let config = {}
	try {
		const cf = await call('getConfigFields', {})
		const fields = cf?.fields ?? []
		result.configFields = fields.map((f) => ({ id: f.id, type: f.type, label: f.label, default: f.default, choices: f.choices, regex: f.regex, width: f.width, min: f.min, max: f.max, value: f.type === 'static-text' ? f.value : undefined }))
		for (const f of fields) if (f.id && f.default !== undefined) config[f.id] = f.default
		if (process.env.CONFIG_OVERRIDE) Object.assign(config, JSON.parse(process.env.CONFIG_OVERRIDE))
	} catch (e) { result.errors.push('config: ' + e.message) }
	if (process.env.CONFIG_OVERRIDE) Object.assign(config, JSON.parse(process.env.CONFIG_OVERRIDE))
	try {
		await call('init', { label: 'harness', isFirstInit: true, config, secrets: {}, lastUpgradeIndex: -1, feedbacks: {}, actions: {} }, 12000)
	} catch (e) { result.errors.push('init: ' + e.message) }
	// give modules that publish definitions asynchronously a moment
	const t0 = Date.now()
	while (Date.now() - t0 < 4000 && !(result.actions && result.feedbacks && result.presets)) await new Promise((r) => setTimeout(r, 200))
	if (!result.configFields) {
		try {
			const cf = await call('getConfigFields', {})
			result.configFields = (cf?.fields ?? []).map((f) => ({ id: f.id, type: f.type, label: f.label, default: f.default, choices: f.choices, regex: f.regex, width: f.width, min: f.min, max: f.max, value: f.type === 'static-text' ? f.value : undefined }))
			result.errors = result.errors.filter((e) => !e.startsWith('config:'))
		} catch (e) { result.errors.push('config after init: ' + e.message) }
	}
	await new Promise((r) => setTimeout(r, 600))
	finish(0)
})().catch((e) => { result.errors.push(e.message); finish(0) })
