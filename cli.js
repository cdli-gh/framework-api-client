const yargs = require('yargs')
const CDLI = require('./src/client')

const options = yargs
    .option('host', {
        alias: 'h',
        type: 'string',
        default: 'https://cdli.ucla.edu',
        description: 'Host URL to use for API calls'
    })
    .command(require('./src/export'))
    .help()
    .argv
