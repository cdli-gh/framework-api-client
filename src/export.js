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
            'artifacts',
            'artifact-assets',
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

    console.time('Export')
    return client
        .export(options.format, [...options.entities, ...options.index], options.outputFile)
        .then(entities => {
            console.timeEnd('Export')

            for (const { status, reason } of entities) {
                if (status === 'rejected') {
                    console.error(reason)
                }
            }
        })
}
