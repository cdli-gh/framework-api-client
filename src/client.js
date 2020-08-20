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

module.exports.Client = class Client extends Emitter {
    constructor (base) {
        super()

        this.base = base
        this._pageStates = {}
    }

    async * _fetchPages (path, format) {
        let next = this.base + path
        while (next) {
            const response = await fetch(next, {
                headers: { Accept: format }
            })

            if (response.status >= 400) {
                const error = `Path '${path}' returned code ${response.status}`
                this._pageStates[path] = { error }
                throw new Error(error)
            }

            const links = parseLinks(response.headers.get('Link'))
            next = links && links.next && links.next.url
            this._pageStates[path] = links

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

    async export (entities = [], fileName) {
        const file = fileName
            ? fs.createWriteStream(fileName)
            : process.stdout

        this._setupPageStates(entities)

        return Promise.allSettled(entities.map(async entity => {
            const pages = this._fetchPages(entity, 'application/n-triples')

            for await (const page of pages) {
                this._logPageStates()
                file.write(page)
            }
        }))
    }
}
