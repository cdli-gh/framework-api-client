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
    },
    outputFile: {
        alias: 'o',
        description: 'Output file name(s)',
        type: 'array',
        default: []
    }
}

exports.handler = async function (options) {
    const client = await getClient(options)
    const console = new Console(process.stderr)

    console.time('Export')

    const tasks = []
    const targets = [...options.entities, ...options.index]
    if (targets.length !== options.outputFile.length) {
        console.error('The number of entities and output files must match.')
        process.exit(1)
    }

    for (let i = 0; i < targets.length; i++) {
        tasks.push(
            client
                .export(options.format, [targets[i]], options.outputFile[i])
                .then(entities => {
                    for (const { status, reason } of entities) {
                        if (status === 'rejected') {
                            console.error(reason)
                        }
                    }
                })
        )
    }

    return Promise.all(tasks)
        .then(() => {
            console.timeEnd('Export')
        })
        .catch(err => {
            console.error('Error during export:', err)
            console.timeEnd('Export')
        })
}
