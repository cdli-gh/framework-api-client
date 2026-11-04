// Only reject combinations known to be unsupported. Other endpoints, including
// custom indexes, remain available without assuming that empty pages are errors.
const ALTERNATIVES = {
    atf: {
        artifacts: 'inscriptions'
    }
}

module.exports = function validateExport (format = 'ntriples', entities = []) {
    for (const entity of entities) {
        const alternative = ALTERNATIVES[format] && ALTERNATIVES[format][entity]
        if (typeof alternative === 'string') {
            throw new TypeError(
                `Cannot export "${entity}" as "${format}". ` +
                `Use --entities ${alternative} --format ${format} instead.`
            )
        }
    }
}
