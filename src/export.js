const CDLI = require('./client')

exports.command = 'export'
exports.describe = 'Export catalogue and text data'
exports.builder = {
    'entities': {
        alias: 'e',
        description: 'Which types of entities to fetch',
        type: 'array',
        choices: [
            'archives',
            'artifacts',
            'artifactsExternalResources',
            'artifactsMaterials',
            'collections',
            'dates',
            'dynasties',
            'genres',
            'inscriptions',
            'languages',
            'materials',
            'materialAspects',
            'materialColors',
            'periods',
            'proveniences',
            'publications',
            'regions',
            'rulers'
        ]
    }
}

exports.handler = function (options) {
    const client = new CDLI.Client(options.host)
    client.on('log', msg => process.stderr.write(msg))

    console.time('Export')
    return client
        .export(options.format, options.entities, options.outputFile)
        .then(entities => {
            console.timeEnd('Export')

            for (const { status, reason } of entities) {
                if (status === 'rejected') {
                    console.error(reason)
                }
            }
        })
}
