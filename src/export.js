const { Console } = require('console')
const { getClient } = require('./command.js')

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
    const client = await getClient(options)
    const console = new Console(process.stderr)

    if (options.entities.length === 0 && options.index.length === 0) {
        process.stderr.write('Error: No entities specified. Use --entities to specify what to export.\n')
        process.exit(1)
    }

    console.time('Export')
    return client
        .export(options.format, [...options.entities, ...options.index], options.outputFile)
        .then(entities => {
            console.timeEnd('Export')

            const rejected = entities.filter(e => e.status === 'rejected')
            const fulfilled = entities.filter(e => e.status === 'fulfilled')

            for (const { reason } of rejected) {
                process.stderr.write(`Error: ${reason.message}\n`)
            }

            if (rejected.length > 0 && fulfilled.length === 0) {
                process.stderr.write(`\nAll exports failed. Please check your format and entity options.\n`)
                process.stderr.write(`Note: Some formats like 'atf' may not be available for direct export.\n`)
                process.stderr.write(`Try using a different format such as 'ndjson', 'csv', or 'ntriples'.\n`)
                process.exit(1)
            }
        })
}
