const FormData = require('form-data')
const fs = require('fs')
const fetch = require('node-fetch')
const parseLinks = require('parse-link-header')
const Emitter = require('./emitter')

function progressBar (state) {
    if (state.error) {
        return state.error
    }

    const current = state.current.page
    const last = state.last.page
    const SIZE = 50
    const progress = SIZE * current / last
    const bar = ('='.repeat(progress) + ' '.repeat(SIZE - progress)).replace(/= /, '> ')

    return `[${bar}] ${current}/${last}`
}

const MIME_TYPES = {
    ndjson: 'application/x-ndjson',
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    ntriples: 'application/n-triples',
    bibtex: 'application/x-bibtex',
    atf: 'text/x-c-atf',
}

module.exports.Client = class Client extends Emitter {
    constructor (base) {
        super()

        this.base = base
        this._cookies = {}
        this._pageStates = {}
    }

    async * _fetchPages (path, format) {
        const mimeType = MIME_TYPES[format]
        if (!mimeType) {
            throw new TypeError(`Format "${format}" unknown`)
        }

        const skipHeader = format === 'csv' || format === 'tsv'

        let next = this.base + path
        while (next) {
            const response = await fetch(next, {
                headers: { Accept: mimeType, ...this._getCookieHeaders() }
            })
            this._setCookies(response)

            if (response.status >= 400) {
                const error = `Path '${path}' returned code ${response.status}`
                this._pageStates[path] = { error }
                throw new Error(error)
            }

            const links = parseLinks(response.headers.get('Link'))
            next = links && links.next && links.next.url
            this._pageStates[path] = links

            if (skipHeader && links && links.prev) {
                const text = await response.text()
                yield text.slice(text.indexOf('\n') + 1)
                continue
            }

            yield response.text()
        }
    }

    _log (...args) {
        this.trigger('log', args.join(' ') + '\n')
    }

    _setupPageStates (entities) {
        this._pageStates = {}
        this._log(entities.join('\n'))
    }

    _logPageStates () {
        const states = Object.entries(this._pageStates)
        this._log(`\u001b[${states.length}A` + states
            .map(([name, state]) => name.padEnd(30, ' ') + ': ' + progressBar(state))
            .join('\n')
        )
    }

    _getCookieHeaders () {
        return {
            'X-CSRF-Token': this._cookies.csrfToken,
            Cookie: Object.entries(this._cookies).map(pair => pair.join('=')).join('; ')
        }
    }

    _setCookies (response) {
        const header = response.headers.raw()['set-cookie']

        if (!header) {
            return
        }

        for (const cookie of header) {
            const [key, ...value] = cookie.split(';')[0].split('=')
            this._cookies[key] = decodeURIComponent(value.join('='))
        }
    }

    async login (username, password, token) {
        if (!this._cookies.csrfToken) {
            this._setCookies(await fetch(this.base + 'login'))
        }

        const loginBody = new FormData()
        loginBody.append('username', username)
        loginBody.append('password', password)

        const loginResponse = await fetch(this.base + 'login', {
            method: 'POST',
            body: loginBody,
            headers: this._getCookieHeaders()
        })
        this._setCookies(loginResponse)

        if (loginResponse.status >= 400) {
            throw new Error('Login failed')
        }

        const tokenBody = new FormData()
        tokenBody.append('code', token || 'random_code_value')

        const tokenResponse = await fetch(loginResponse.url, {
            method: 'POST',
            body: tokenBody,
            headers: this._getCookieHeaders(),
            redirect: 'manual'
        })
        this._setCookies(tokenResponse)

        if (tokenResponse.status >= 400) {
            throw new Error('2FA failed')
        }
    }

    async export (format = 'ntriples', entities = [], fileName) {
        const file = fileName
            ? fs.createWriteStream(fileName)
            : process.stdout

        this._setupPageStates(entities)

        return Promise.allSettled(entities.map(async entity => {
            const pages = this._fetchPages(entity, format)

            for await (const page of pages) {
                this._logPageStates()
                file.write(page)
            }
        }))
    }
}
