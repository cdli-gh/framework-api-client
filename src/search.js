const { Console } = require('console')
const { getClient } = require('./command.js')

function buildQuery (options) {
    const parts = [
        ['limit', '1000']
    ]

    if (options.filterField) {
        const filters = Math.min(options.filterField.length, options.filterValue.length)
        for (let i = 0; i < filters; i++) {
            parts.push([
                'f[' + options.filterField[i] + '][]',
                options.filterValue[i]
            ])
        }
    }

    if (options.query) {
        for (let i = 0; i < options.query.length; i++) {
            parts.push(['simple-field[]', (options.queryCategory && options.queryCategory[i]) || 'keyword'])
            parts.push(['simple-value[]', options.query[i]])
            parts.push(['simple-op[]', (options.queryOperator && options.queryOperator[i]) || 'AND'])
        }
    }

    if (options.advancedField) {
        const fields = Math.min(options.advancedField.length, options.advancedField.length)
        for (let i = 0; i < fields; i++) {
            parts.push([options.advancedField[i], options.advancedValue[i]])
        }
    }

    return parts.map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&')
}

exports.command = 'search'
exports.describe = 'Search artifacts in the catalog'
exports.builder = {
    query: {
        group: 'Simple search:',
        alias: 'q',
        description: 'Search query',
        type: 'array'
    },
    queryCategory: {
        group: 'Simple search:',
        alias: 'qc',
        description: 'Search category',
        type: 'array',
        choices: ['keyword', 'publication', 'collection', 'provenience', 'period', 'transliteration', 'translation', 'id']
    },
    queryOperator: {
        group: 'Simple search:',
        alias: 'qo',
        description: 'Search operator',
        type: 'array',
        choices: ['AND', 'OR']
    },
    advancedField: {
        group: 'Advanced search:',
        alias: 'af',
        description: 'Search field',
        type: 'array'
    },
    advancedQuery: {
        group: 'Advanced search:',
        alias: 'aq',
        description: 'Search query',
        type: 'array'
    },
    filterField: {
        group: 'Filter:',
        alias: 'fk',
        description: 'Filter by field',
        type: 'array'
    },
    filterValue: {
        group: 'Filter:',
        alias: 'fv',
        description: 'Filter by value',
        type: 'array'
    },
}

exports.handler = async function (options) {
    const client = await getClient(options)
    const console = new Console(process.stderr)

    console.time('Search')
    return client
        .search(options.format, buildQuery(options), options.outputFile)
        .catch(reason => { console.error(reason) })
        .finally(() => { console.timeEnd('Search') })
}
