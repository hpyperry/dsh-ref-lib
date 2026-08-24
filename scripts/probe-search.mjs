import { searchDirectory } from '../src/search.ts'
const root = '/Users/hpy/dev/PROJECTS/dsh-plugins/ref-lib'
const hits = await searchDirectory(root, 'ref-lib', { maxResults: 10 })
console.log(`total: ${hits.length}`)
for (const h of hits) console.log(`- ${h.path}:${h.lineNumber} | ${h.snippet.slice(0, 70)}`)
