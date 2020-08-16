const fs = require('fs')
const fetch = require('node-fetch')
const parseLinks = require('parse-link-header')
const rdf = require('rdf')
const Emitter = require('./emitter')

function progressBar (state) {
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
        let next = this.base + path + '?limit=100'
        while (next) {
            const response = await fetch(next, {
                headers: { Accept: format }
            })

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

    async export (entities = [], fileName = '-') {
        const file = fileName === '-'
            ? process.stdout
            : fs.createWriteStream(fileName)

        this._setupPageStates(entities)

        return Promise.all(entities.map(async entity => {
            const pages = this._fetchPages(entity, 'application/n-triples')
            let number = 0

            for await (const page of pages) {
                this._logPageStates()
                file.write(page)
            }
        }))
    }
}
