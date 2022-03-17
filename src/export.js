const readline = require('readline')
const CDLI = require('./client')

function promisify (fn) {
    return (...args) => new Promise(resolve => fn(...args, resolve))
}

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

exports.handler = async function (options) {
    const client = new CDLI.Client(options.host)
    client.on('log', msg => process.stderr.write(msg))

    if (options.auth) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        const question = promisify(rl.question.bind(rl))
        const username = await question('username: ')
        const password = await question('password: ')
        const token = await question('2FA token: ')
        await client.login(username, password, token)
    }

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
