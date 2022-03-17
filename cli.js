#!/usr/bin/env node

const yargs = require('yargs')
const CDLI = require('./src/client')

const options = yargs
    .option('host', {
        alias: 'h',
        type: 'string',
        default: 'https://cdli.ucla.edu/',
        description: 'Host URL to use for API calls'
    })
    .option('format', {
        alias: 'f',
        description: 'File format',
        choices: [
            'ndjson',
            'csv',
            'tsv',
            'ntriples',
            'bibtex',
            'atf'
        ]
    })
    .option('output-file', {
        alias: 'o',
        description: 'Output file (outputs to stdout by default)'
    })
    .command(require('./src/export'))
    .help()
    .argv
