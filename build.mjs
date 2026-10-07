// Builds DeckWriter from src/.
//   node build.mjs             -> index.test.html (test build: red TEST BUILD tag, its own autosave)
//   node build.mjs --prod      -> index.html      (production)
//   node build.mjs --artifact  -> dist/artifact.html (page body only, for publishing as a Claude artifact)
//   node build.mjs --watch     -> rebuild the test build on every save in src/
import { readFileSync, writeFileSync, mkdirSync, watch } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(root, p), 'utf8')

// The reset Claude's artifact viewer adds around a page; GitHub Pages needs it written out.
const HEAD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
`
const TAIL = `
</body>
</html>
`

/** Inline src/data/*.json into the app body. */
export function body() {
	let html = read('src/app.html')
	for (const name of ['library', 'catalog']) {
		const marker = `/*@data:${name}*/null`
		if (!html.includes(marker)) throw new Error(`src/app.html is missing ${marker}`)
		const data = JSON.stringify(JSON.parse(read(`src/data/${name}.json`)))
		html = html.replace(marker, () => data)
	}
	return html
}

/** mode: 'prod' | 'test' | 'artifact' */
export function build(mode = 'test') {
	let html = body()
	if (mode === 'artifact') return html
	if (mode === 'test') {
		// separate autosave so testing never touches the production project
		html = html.replaceAll('"deckwright.v1"', '"deckwright.test.v1"').replaceAll('"deckwright.drawer"', '"deckwright.test.drawer"')
		html = html.replace('<title>DeckWriter</title>', '<title>DeckWriter (test)</title>')
		html +=
			'\n<div style="position:fixed;left:12px;bottom:12px;z-index:200;background:#e5484d;color:#fff;font:700 11px/1 system-ui,sans-serif;letter-spacing:.08em;padding:6px 8px;border-radius:6px;pointer-events:none">TEST BUILD</div>'
	}
	return HEAD + html + TAIL
}

const out = { prod: 'index.html', test: 'index.test.html', artifact: 'dist/artifact.html' }
function run(mode) {
	const file = join(root, out[mode])
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, build(mode))
	console.log(`built ${out[mode]}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2)
	const mode = args.includes('--prod') ? 'prod' : args.includes('--artifact') ? 'artifact' : 'test'
	run(mode)
	if (args.includes('--watch')) {
		let t
		watch(join(root, 'src'), { recursive: true }, () => {
			clearTimeout(t)
			t = setTimeout(() => {
				try {
					run('test')
				} catch (e) {
					console.error(e.message)
				}
			}, 150)
		})
		console.log('watching src/ …')
	}
}
