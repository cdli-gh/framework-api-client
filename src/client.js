const FormData = require('form-data')
const fs = require('fs')
const fetch = require('node-fetch')
const parseLinks = require('parse-link-header')
const Emitter = require('./emitter')
const resumableExport = require('./resume')

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

module.exports.STATUS_SETTING_UP = 0
module.exports.STATUS_RUNNING = 1
module.exports.STATUS_DONE = 2

module.exports.Client = class Client extends Emitter {
    constructor (base) {
        super()

        this.base = base
        this.retryMax = 3
        this.retryDelay = 500
        this._cookies = {}
    }

    _validateUrl (value) {
        const url = new URL(value, this.base)
        if (!['http:', 'https:'].includes(url.protocol) ||
            url.origin !== new URL(this.base).origin || url.username || url.password) {
            throw new Error('Request URL must belong to the export host and contain no credentials')
        }
        return url.href
    }

    async _request (value, options = {}) {
        let url = this._validateUrl(value)
        let request = { ...options }
        for (let redirects = 0; ; redirects++) {
            const response = await fetch(url, {
                ...request,
                headers: { ...request.headers, ...this._getCookieHeaders() },
                redirect: 'manual'
            })
            this._setCookies(response)
            const location = response.headers.get('location')
            if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
                return response
            }
            let next
            try {
                next = this._validateUrl(new URL(location, url).href)
            } finally {
                // Redirect bodies are unused; release the connection even on rejection.
                if (response.body) response.body.resume()
            }
            if (options.redirect === 'manual') return response
            if (redirects >= 20) throw new Error('Too many redirects')
            if (response.status === 303 ||
                ([301, 302].includes(response.status) && request.method === 'POST')) {
                request = { ...request, method: 'GET', body: undefined }
            } else if (request.body) {
                // FormData bodies are streams and cannot safely be replayed.
                throw new Error('Cannot replay a request body after a redirect')
            }
            url = next
        }
    }

    async * _fetchPages (path, format, label = path, checkpoint) {
        const mimeType = MIME_TYPES[format]
        if (!mimeType) {
            throw new TypeError(`Format "${format}" unknown`)
        }

        const skipHeader = format === 'csv' || format === 'tsv'

        let retries = 0
        let next = checkpoint ? checkpoint.next : this.base + path
        let hasHeader = checkpoint && checkpoint.hasHeader
        while (next) {
            const response = await this._request(next, {
                headers: { Accept: mimeType }
            })

            if (response.status === 504 && retries < this.retryMax) {
                if (response.body) response.body.resume()
                await sleep(this.retryDelay)
                retries++
                this.trigger('entityStateChange', { label, retry: retries })
                continue
            }

            if (response.status >= 400) {
                const error = `'${next}' returned code ${response.status}`
                this.trigger('entityStateChange', { label, error })
                throw new Error(error)
            }

            retries = 0
            this.trigger('entityStateChange', { label, retry: retries, status: module.exports.STATUS_RUNNING })

            const responseType = (response.headers.get('content-type') || '').split(';')[0]
            if (responseType !== mimeType) {
                const error = `'${next}' did not return '${format}' but '${responseType}'`
                this.trigger('entityStateChange', { label, error })
                throw new Error(error)
            }

            const links = parseLinks(response.headers.get('Link'))
            next = links && links.next
                ? this._validateUrl(new URL(links.next.url, response.url).href)
                : null
            this.trigger('entityStateChange', { label, ...links })

            const text = await response.text()
            let data = text
            if (skipHeader && (checkpoint ? hasHeader : links && links.prev)) {
                const newline = text.indexOf('\n')
                data = newline < 0 ? '' : text.slice(newline + 1)
            }
            hasHeader = hasHeader || text.length > 0
            yield checkpoint ? { data, next: next || null, hasHeader } : data
        }

        this.trigger('entityStateChange', { label, status: module.exports.STATUS_DONE })
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
            const response = await this._request(this.base + 'login')
            if (response.body) response.body.resume()
        }

        const loginBody = new FormData()
        loginBody.append('username', username)
        loginBody.append('password', password)

        const loginResponse = await this._request(this.base + 'login', {
            method: 'POST',
            body: loginBody,
            headers: this._getCookieHeaders()
        })
        if (loginResponse.body) loginResponse.body.resume()

        if (loginResponse.status >= 400) {
            throw new Error('Login failed')
        }

        const tokenBody = new FormData()
        tokenBody.append('code', token || 'random_code_value')

        const tokenResponse = await this._request(loginResponse.url, {
            method: 'POST',
            body: tokenBody,
            headers: this._getCookieHeaders(),
            redirect: 'manual'
        })
        if (tokenResponse.body) tokenResponse.body.resume()

        if (tokenResponse.status >= 400) {
            throw new Error('2FA failed')
        }
    }

    async export (format = 'ntriples', entities = [], fileName, options = {}) {
        if (options.checkpoint || options.resume) {
            if (!Object.prototype.hasOwnProperty.call(MIME_TYPES, format)) {
                throw new TypeError(`Format "${format}" unknown`)
            }
            return resumableExport(this, format, entities, fileName, options)
        }

        const file = fileName
            ? fs.createWriteStream(fileName)
            : process.stdout

        return Promise.allSettled(entities.map(async entity => {
            this.trigger('entityStateChange', { label: entity, status: module.exports.STATUS_SETTING_UP })

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
        this.trigger('entityStateChange', { label, status: module.exports.STATUS_SETTING_UP })

        const pages = this._fetchPages('search?' + query, format, label)

        for await (const page of pages) {
            file.write(page)
        }
    }
}
