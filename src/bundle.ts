import { EOL } from 'os'

export interface BundleOptions {
  files: string[]
  source: string
  exclude?: string[]
  dependencies?: string[]
}

export async function bundle(options: BundleOptions) {
  const { files, source, exclude = [] } = options

  const moduleRE = `["'](${files.join('|')})(\\.[jt]s)?["']`
  const internalImport = new RegExp('import\\(' + moduleRE + '\\)\\.', 'g')
  const internalExport = new RegExp('^ {4}export .+ from ' + moduleRE + ';$')
  const internalInject = new RegExp('^declare module ' + moduleRE + ' {$')
  const importMap: Record<string, Record<string, string>> = {}
  const namespaceMap: Record<string, string> = {}

  let prolog = '', cap: RegExpExecArray | null
  let current: string, temporary: string[] | null
  let identifier: string, isExportDefault: boolean
  const platforms: Record<string, Record<string, string[]>> = {}
  const output = source.split(/\r?\n/g).filter((line) => {
    // Step 1: collect informations
    if (isExportDefault) {
      if (line === '    }') isExportDefault = false
      return false
    } else if (temporary) {
      if (line === '}') return temporary = null
      temporary.push(line)
    } else if ((cap = /^declare module ["'](.+)["'] \{( \})?$/.exec(line))) {
      //                                   ^1
      // ignore empty module declarations
      if (cap[2]) return temporary = null
      if (exclude.includes(cap[1])) return temporary = null
      current = cap[1]
      const segments = current.split(/\//g)
      const lastName = segments.pop()!
      if (['node', 'browser'].includes(lastName) && segments.length) {
        temporary = (platforms[segments.join('/')] ||= {})[lastName] = []
      } else {
        return true
      }
    } else if ((cap = /^ {4}import ["'](.+)["'];$/.exec(line))) {
      //                               ^1
      // import module directly
      if (!files.includes(cap[1])) prolog += line.trimStart() + EOL
    } else if ((cap = /^ {4}import (type )?\* as (.+) from ["'](.+)["'];$/.exec(line))) {
      //                           ^1            ^2            ^3
      // import as namespace
      if (files.includes(cap[3])) {
        // mark internal module as namespace
        namespaceMap[cap[3]] = cap[2]
      } else if (!prolog.includes(line.trimStart())) {
        // preserve external module imports once
        prolog += line.trimStart() + EOL
      }
    } else if ((cap = /^ {4}import (type )?(\S*)(?:, *)?(?:\{(.*)\})? from ["'](.+)["'];$/.exec(line))) {
      //                           ^1      ^2                ^3                ^4
      // ignore internal imports
      if (files.includes(cap[4])) return
      // handle aliases from external imports
      const map = importMap[cap[4]] ||= {}
      cap[2] && Object.defineProperty(map, 'default', { value: cap[2] })
      cap[3] && cap[3].split(',').map((part) => {
        part = part.trim()
        if (part.startsWith('type ')) {
          part = part.slice(5)
        }
        if (part.includes(' as ')) {
          const [left, right] = part.split(' as ')
          map[left.trimEnd()] = right.trimStart()
        } else {
          map[part] = part
        }
      })
    } else if (line.startsWith('///')) {
      prolog += line + EOL
    } else if (line.startsWith('#!')) {
      return false
    } else if (line.startsWith('    export default ')) {
      if (current === 'index') return true
      if (line.endsWith('{')) isExportDefault = true
      return false
    } else {
      return line.trim() !== 'export {};'
    }
  }).map((line) => {
    // Step 2: flatten module declarations
    if ((cap = /^declare module ["'](.+)["'] \{$/.exec(line))) {
      if ((identifier = namespaceMap[cap[1]])) {
        return `declare namespace ${identifier} {`
      } else {
        return ''
      }
    } else if (line === '}') {
      return identifier ? '}' : ''
    } else if (!internalExport.exec(line)) {
      if (!identifier) line = line.slice(4)
      return line
        .replace(internalImport, '')
        .replace(/import\("index"\)/g, "import('.')")
        .replace(/^(module|class|namespace|const|global|function|interface) /, (_) => `declare ${_}`)
    } else {
      return ''
    }
  }).map((line) => {
    if ((cap = internalInject.exec(line))) {
      identifier = '@internal'
      return ''
    } else if (line === '}') {
      return identifier ? identifier = '' : '}'
    } else {
      if (identifier) line = line.slice(4)
      return line.replace(/^((abstract|class|namespace|interface) .+ \{)$/, (_) => `export ${_}`)
    }
  }).filter(line => line).join(EOL)

  Object.entries(importMap).forEach(([name, map]) => {
    const output: string[] = []
    const entries = Object.entries(map)
    if (map.default) output.push(map.default)
    if (entries.length) {
      output.push('{ ' + entries.map(([left, right]) => {
        if (left === right) return left
        return `${left} as ${right}`
      }).join(', ') + ' }')
    }
    prolog += `import ${output.join(', ')} from '${name}';${EOL}`
  })

  return prolog + output + EOL
}
