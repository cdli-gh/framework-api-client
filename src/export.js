const { Console } = require('console')
const { getClient } = require('./command.js')
const validateExport = require('./export-validation.js')

exports.command = 'export'
exports.describe = 'Export catalog and text data'
exports.builder = {
    entities: {
        alias: 'e',
        description: 'Which types of entities to fetch',
        type: 'array',
        default: [],
        choices: [
            'abbreviations',
            'archives',
            'artifact-assets',
            'artifact-types',
            'artifacts',
            'artifacts-external-resources',
            'artifacts-materials',
            'entities-external-resources',
            'entities-names',
            'authors',
            'collections',
            'dynasties',
            'external-resources',
            'genres',
            'inscriptions',
            'journals',
            'languages',
            'locations',
            'materials',
            'material-aspects',
            'material-colors',
            'periods',
            'places',
            'proveniences',
            'publications',
            'regions',
            'rulers'
        ]
    },
    index: {
        alias: 'i',
        description: 'Which index(es) to fetch',
        type: 'array',
        default: []
    }
}

exports.handler = async function (options) {
    const entities = [...options.entities, ...options.index]
    try {
        validateExport(options.format, entities)
    } catch (error) {
        process.stderr.write(`Error: ${error.message}\n`)
        process.exitCode = 1
        return
    }

    const client = await getClient(options)
    const console = new Console(process.stderr)

    console.time('Export')
    return client
        .export(options.format, entities, options.outputFile)
        .then(entities => {
            console.timeEnd('Export')

            for (const { status, reason } of entities) {
                if (status === 'rejected') {
                    console.error(reason)
                }
            }
        })
}
