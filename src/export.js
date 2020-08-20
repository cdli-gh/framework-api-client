const CDLI = require('./client')

exports.command = 'export'
exports.describe = 'Export linked data'
exports.builder = {
  'output-file': {
      alias: 'o',
      description: 'Output file (outputs to stdout by default)'
  },
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
        .export(options.entities, options.outputFile)
        .then(entities => {
            console.timeEnd('Export')

            for (const { status, reason } of entities) {
                if (status === 'rejected') {
                    console.error(reason)
                }
            }
        })
}
