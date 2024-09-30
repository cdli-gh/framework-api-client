const FormData = require('form-data')
const fs = require('fs')
const fetch = require('node-fetch')
const parseLinks = require('parse-link-header')
const Emitter = require('./emitter')

function progressBar (state) {
    if (state.error) {
        return state.error
    }

    let message

    if (!state.current || !state.current.page) {
        message = ''
    } else if (!state.last || !state.last.page) {
        message = `page: ${state.current.page}`
    } else {
        const current = state.current.page
        const last = state.last.page
        const SIZE = 50
        const progress = Math.floor(SIZE * current / last) || current > 0
        const bar = ('='.repeat(progress) + ' '.repeat(SIZE - progress)).replace(/= /, '> ')

        message = `[${bar}] ${current}/${last}`
    }

    if (state.retry) {
        message += `, retry ${state.retry}`
    }

    return message
}

function sleep (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

const MIME_TYPES = {
    ndjson: 'application/x-ndjson',
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    ntriples: 'application/n-triples',
    ttl: 'text/turtle',
    bibtex: 'application/x-bibtex',
    atf: 'text/x-c-atf'
}

module.exports.Client = class Client extends Emitter {
    constructor (base) {
        super()

        this.base = base
        this.retryMax = 3
        this.retryDelay = 500
        this._cookies = {}
        this._pageStates = {}
    }

    async * _fetchPages (path, format, label = path) {
        const mimeType = MIME_TYPES[format]
        if (!mimeType) {
            throw new TypeError(`Format "${format}" unknown`)
        }

        const skipHeader = format === 'csv' || format === 'tsv'

        let retries = 0
        let next = this.base + path
        while (next) {
            const response = await fetch(next, {
                headers: { Accept: mimeType, ...this._getCookieHeaders() }
            })
            this._setCookies(response)

            if (response.status === 504 && retries < this.retryMax) {
                await sleep(this.retryDelay)
                retries++
                this._updatePageState(label, { retry: retries })
                continue
            }

            if (response.status >= 400) {
                const error = `'${label}' returned code ${response.status}`
                this._updatePageState(label, { error })
                throw new Error(error)
            }

            retries = 0
            this._updatePageState(label, { retry: retries })

            const responseType = response.headers.get('content-type').split(';')[0]
            if (responseType !== mimeType) {
                const error = `'${label}' did not return '${format}' but '${responseType}'`
                this._updatePageState(label, { error })
                throw new Error(error)
            }

            const links = parseLinks(response.headers.get('Link'))
            next = links && links.next && links.next.url
            this._updatePageState(label, links)

            if (skipHeader && links && links.prev) {
                const text = await response.text()
                yield text.slice(text.indexOf('\n') + 1)
            } else {
                yield response.text()
            }
        }
    }

    _log (...args) {
        this.trigger('log', args.join(' ') + '\n')
    }

    _setupPageStates (entities) {
        this._pageStates = {}
        this._log(entities.join('\n'))
    }

    _updatePageState (entity, links) {
        if (!this._pageStates[entity]) {
            this._pageStates[entity] = {}
        }

        Object.assign(this._pageStates[entity], links)
        this._logPageStates()
    }

    _logPageStates () {
        const states = Object.entries(this._pageStates)
        this._log(`\u001b[${states.length}A` + states
            .map(([name, state]) => {
                const line = name.padEnd(30, ' ') + ': ' + progressBar(state)
                return line + ' '.repeat(process.stdout.columns - line.length)
            })
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
                file.write(page)
            }
        }))
    }

    async search (format = 'ntriples', query, fileName) {
        const file = fileName
            ? fs.createWriteStream(fileName)
            : process.stdout

        const label = 'search'
        this._setupPageStates([label])

        const pages = this._fetchPages('search?' + query, format, label)

        for await (const page of pages) {
            file.write(page)
        }
    }
}
