const yargs = require('yargs')
const CDLI = require('./src/client')

const options = yargs
    .option('host', {
        alias: 'h',
        type: 'string',
        default: 'https://cdli.ucla.edu',
        description: 'Host URL to use for API calls'
    })
    .option('output-file', {
        alias: 'o',
        description: 'Output file (outputs to stdout by default)'
    })
    .option('entities', {
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
    })
    .argv

const client = new CDLI.Client(options.host)
client.on('log', msg => process.stderr.write(msg))

console.time('Export')
client
    .export(options.entities, options.outputFile)
    .then(() => console.timeEnd('Export'))
    .catch(console.error)
