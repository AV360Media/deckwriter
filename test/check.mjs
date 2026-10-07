// Checks for DeckWriter. No packages needed.
//   node test/check.mjs           -> checks the test build (and that index.test.html is current)
//   node test/check.mjs --prod    -> also checks that index.html matches a fresh production build
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { build, body } from '../build.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
let passed = 0
const check = (name, fn) => {
	try {
		const r = fn()
		if (r === false) throw new Error('returned false')
		passed++
	} catch (e) {
		failures.push(`${name}: ${e.message}`)
	}
}

const app = body()
const scripts = [...app.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])

check('one inline app script', () => scripts.length === 1)
check('app script parses', () => new vm.Script(scripts[0], { filename: 'app.js' }))
check('data markers were all filled', () => !app.includes('/*@data:'))

const lib = JSON.parse(readFileSync(join(root, 'src/data/library.json'), 'utf8'))
const cat = JSON.parse(readFileSync(join(root, 'src/data/catalog.json'), 'utf8'))
check('module library has its five apps', () => {
	for (const m of ['bmd-atem', 'studiocoast-vmix', 'resolume-arena', 'zinc-oscpoint', 'imimot-mitti'])
		if (!lib[m]) throw new Error(`missing ${m}`)
})
check('every library preset has steps and a category', () => {
	for (const [m, L] of Object.entries(lib))
		for (const p of L.presets) if (!Array.isArray(p.st) || !p.cat) throw new Error(`${m}: ${p.n}`)
})
check('no preset still uses a Companion 5 local variable', () => {
	for (const [m, L] of Object.entries(lib)) if (JSON.stringify(L.presets).includes('$(local:')) throw new Error(m)
})
check('connection catalog is complete', () => cat.length > 800 && cat.every((m) => typeof m[0] === 'string'))

// every $("#id") the script looks up must exist somewhere in the markup or templates
const ids = new Set([...app.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]))
// colorField("x", …) builds the inputs xC (picker) and xH (hex text)
for (const m of app.matchAll(/colorField\("([\w-]+)"/g)) ids.add(m[1] + 'C').add(m[1] + 'H')
// bootSlider("x", …) builds the range input x and its value label xv
for (const m of app.matchAll(/bootSlider\("([\w-]+)"/g)) ids.add(m[1]).add(m[1] + 'v')
const used = new Set([...scripts[0].matchAll(/\$\("#([\w-]+)[^"]*"\)/g)].map((m) => m[1]))
check('every element the script looks up exists', () => {
	const missing = [...used].filter((id) => !ids.has(id))
	if (missing.length) throw new Error(missing.join(', '))
})

// Companion import format: exports must stay on version 6 with the top bar off
check('pages export as Companion format 6', () => scripts[0].includes('let data={version:6,type:"page"'))
check('no logic blocks in exports', () => !scripts[0].includes('logic_if'))
check('page keys skip a separate boot page', () => scripts[0].includes('const nav=navSkipBoot(b,pi)'))
check('buttons export without the top bar', () => scripts[0].includes('show_topbar:false'))
check('boot trigger is a v6 trigger list', () => scripts[0].includes('version:6,type:"trigger_list"'))
check('boot trigger cannot overlap itself', () => scripts[0].includes('condition:[notBusy]') && scripts[0].includes('name:BOOT_BUSY,value:"0"}));\n  const notBusy'))

const test = build('test')
check('test build is marked', () => test.includes('TEST BUILD') && test.includes('"deckwright.test.v1"'))
check('index.test.html is up to date (run npm run build)', () => readFileSync(join(root, 'index.test.html'), 'utf8') === test)
if (process.argv.includes('--prod')) {
	const prod = build('prod')
	check('production build is not marked as test', () => !prod.includes('TEST BUILD') && prod.includes('"deckwright.v1"'))
}

if (failures.length) {
	console.error(`\n${failures.length} check(s) failed:\n - ` + failures.join('\n - '))
	process.exit(1)
}
console.log(`all ${passed} checks passed`)
