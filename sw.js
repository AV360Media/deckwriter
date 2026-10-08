// DeckWriter offline copy. Lets the app open at a venue with no internet, once it has been opened on this computer
// before. Pages: newest from the network first (so updates always arrive), the saved copy when offline. The icon and
// file libraries from CDNs: the saved copy first. Never touches DeckWriter Live (the relay on this Mac) or anything
// that isn't a plain GET.
const CACHE = 'deckwriter-v2'
const LIBS = [
	'https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js',
	'https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js',
	'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
]

self.addEventListener('install', (e) => {
	self.skipWaiting()
	e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(LIBS.map((u) => c.add(new Request(u, { mode: 'cors' }))))))
})
self.addEventListener('activate', (e) => {
	e.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim()),
	)
})

const isLocal = (u) => /^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname) && u.origin !== self.location.origin
const isLib = (u) => /(^|\.)(unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(u.hostname)

self.addEventListener('fetch', (e) => {
	const req = e.request
	if (req.method !== 'GET') return
	const u = new URL(req.url)
	if (isLocal(u) || (u.protocol !== 'https:' && u.origin !== self.location.origin)) return // Live relay, iPad remote, Companion
	if (req.headers.get('accept')?.includes('text/event-stream')) return

	if (u.origin === self.location.origin) {
		// the app itself: network first (3 s), saved copy when offline
		e.respondWith(
			(async () => {
				const cache = await caches.open(CACHE)
				try {
					const ctl = new AbortController()
					const t = setTimeout(() => ctl.abort(), 3000)
					const res = await fetch(req.url, { signal: ctl.signal, cache: 'no-store', credentials: 'same-origin' }) // by URL: a page-load request can't be re-sent with options
					clearTimeout(t)
					// a hotel/venue Wi-Fi sign-in page answers in place of DeckWriter: never keep or show that instead of the app
					if (!res.ok || res.redirected || new URL(res.url).origin !== self.location.origin) throw new Error('not DeckWriter')
					if (/\.html$|\/$/.test(u.pathname) && !(await res.clone().text()).includes('<title>DeckWriter')) throw new Error('not DeckWriter')
					cache.put(req, res.clone())
					return res
				} catch (err) {
					const hit = (await cache.match(req, { ignoreSearch: false })) || (await cache.match(req, { ignoreSearch: true }))
					if (hit) return hit
					throw err
				}
			})(),
		)
		return
	}
	if (isLib(u)) {
		// libraries and fonts: saved copy first, refreshed in the background
		e.respondWith(
			(async () => {
				const cache = await caches.open(CACHE)
				const hit = await cache.match(req)
				const fresh = fetch(req)
					.then((res) => {
						if (res.ok || res.type === 'opaque') cache.put(req, res.clone())
						return res
					})
					.catch(() => null)
				return hit || (await fresh) || Response.error()
			})(),
		)
	}
})
