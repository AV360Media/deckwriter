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
check('boot keys stay black until the animation is done', () => scripts[0].includes('bootFeedbacksAt(b.boot.r,b.boot.c,["done"])') && scripts[0].includes('Object.assign(style,{png64:null,text:"",bgcolor:0})'))
check('boot trigger cannot overlap itself', () => scripts[0].includes('condition:[notBusy]') && scripts[0].includes('name:BOOT_BUSY,value:"0"}));\n  const notBusy'))

import { execFileSync } from 'node:child_process'
check('live relay script parses', () => execFileSync(process.execPath, ['--check', join(root, 'tools/live/relay.mjs')]) !== undefined)
check('live relay only accepts DeckWriter origins', () => readFileSync(join(root, 'tools/live/relay.mjs'), 'utf8').includes("const ALLOWED = [/^https:\\/\\/bryanchorton\\.github\\.io$/"))
check('live moves never use the deleting moveControl', () => !readFileSync(join(root, 'tools/live/relay.mjs'), 'utf8').includes("call('controls.moveControl'"))
check('live never sends to the boot screen page', () => scripts[0].includes('{const b=liveBlocked(num,cp);if(b){liveRT.lastMsg=b') && scripts[0].includes('{const b=liveBlocked(num,cp);if(b)return why(b)}'))
check('undo never rolls back what Live sent', () => scripts[0].includes('S=JSON.parse(json);if(live)S.live=live'))
check('project files leave Live state behind and open old saves', () => scripts[0].includes('delete st.live;return JSON.stringify({deckwriter:"project"') && scripts[0].includes('o?.deckwriter==="project"?o.state:o'))
check('new pages start with page up, title and page down', () => scripts[0].includes('buttons:starterKeys(name)') && scripts[0].includes('kind:"pageup"};') && scripts[0].includes('pageTitle:true'))
check('live adds missing pages only at the end of Companion', () => readFileSync(join(root, 'tools/live/relay.mjs'), 'utf8').includes('for (let n = pages.order.length + 1; n <= upTo; n++)'))
check('deleting or restoring a page mirrors it in Companion', () => scripts[0].includes('await post("/removepage",{page:num,name})') && scripts[0].includes('await post("/insertpage"') && readFileSync(join(root, 'tools/live/relay.mjs'), 'utf8').includes('async function removePage(n, expectName) {\n\tguardPage(n)'))
check('live loads Companion and reads layered buttons', () => scripts[0].includes('async function livePull(why)') && scripts[0].includes('ctl.type==="button-layered"&&ctl.style?.layers') && readFileSync(join(root, 'tools/live/relay.mjs'), 'utf8').includes('includeSecrets=false'))
check('page up/down targets are kept up to date on every page', () => scripts[0].includes('async function liveNavSync()') && (scripts[0].match(/liveNavSync\(\)/g)||[]).length>=3)
check('live starts off and sends nothing before loading Companion', () => scripts[0].includes('if(s.live)s.live.on=false') && scripts[0].includes('if(!liveRT.pulled&&!force)return') && scripts[0].includes('return blankProject()'))
check('readout presets have no icon and auto-size text', () => scripts[0].includes('if(isReadout(p)){b.png64=null;'))
check('mirror, show mode and colour themes are wired to the relay', () => scripts[0].includes('/live?page=${num}') && scripts[0].includes('RELAY+"/press"') && scripts[0].includes('RELAY+"/restyle"') && readFileSync(join(root, 'tools/live/relay.mjs'), 'utf8').includes("'preview.graphics.location'"))
check('iPad remote needs the secret link and only shows and presses keys', () => { const r = readFileSync(join(root, 'tools/live/relay.mjs'), 'utf8'); return r.includes('crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(remote.token))') && !/remote\.server = http\.createServer[\s\S]{0,2500}(pushKey|clearKey|transferKey|removePage|insertPage)/.test(r) })
check('live follows the open page with no page picker', () => !scripts[0].includes('livePage"') && !app.includes('id="livePage"'))
check('live only clears keys DeckWriter sent or had when Live started', () => scripts[0].includes('if(owned[k]==null&&!occupied.has(k)){delete c.base[pg.id]?.[k];continue}'))
check('relay never edits the boot page', () => { const r = readFileSync(join(root, 'tools/live/relay.mjs'), 'utf8'); return (r.match(/\tguardPage\(page\)/g) || []).length >= 3 })

const test = build('test')
check('test build is marked', () => test.includes('TEST BUILD') && test.includes('"deckwright.test.v1"'))
const unstamp = (h) => h.replace(/TEST BUILD · [^<]*/, 'TEST BUILD').replace(/const BUILD="[^"]*";/, 'const BUILD="";')
check('index.test.html is up to date (run npm run build)', () => unstamp(readFileSync(join(root, 'index.test.html'), 'utf8')) === unstamp(test))
if (process.argv.includes('--prod')) {
	const prod = build('prod')
	check('production build is not marked as test', () => !prod.includes('TEST BUILD') && prod.includes('"deckwright.v1"'))
}

if (failures.length) {
	console.error(`\n${failures.length} check(s) failed:\n - ` + failures.join('\n - '))
	process.exit(1)
}
console.log(`all ${passed} checks passed`)
