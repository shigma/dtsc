import fs from 'fs/promises'
import { compile, load, TsConfig } from 'tsconfig-utils'
import { createRequire } from 'module'
import { join, resolve } from 'path'
import { bundle } from './bundle.js'

declare module 'tsconfig-utils' {
  interface TsConfig {
    dtsc: Config
  }
}

export interface Config {
  inline?: string[]
  exclude?: string[]
}

async function compileToFile(filename: string, config: TsConfig) {
  filename = filename.replace(/\.d\.ts$/, '') + '.tmp.d.ts'
  config.set('project', '.', false)
  config.set('outFile', filename)
  config.set('composite', 'false')
  config.set('incremental', 'false')
  const code = await compile(config.args, { cwd: config.cwd })
  if (code) process.exit(code)
  const content = await fs.readFile(filename, 'utf8')
  await fs.rm(filename)
  return content
}

async function getModules(path: string, prefix = ''): Promise<string[]> {
  const files = await fs.readdir(path, { withFileTypes: true })
  return ([] as string[]).concat(...await Promise.all(files.map(async (file) => {
    if (file.isDirectory()) {
      return getModules(join(path, file.name), `${prefix}${file.name}/`)
    } else if (file.name.endsWith('.ts')) {
      return [prefix + file.name.slice(0, -3)]
    } else {
      return []
    }
  })))
}

export async function build(cwd: string, args: string[] = []) {
  const require = createRequire(cwd + '/')
  const config = await load(cwd, args)
  const outFile = config.get('outFile')
  if (!outFile) throw new Error('outFile is required')
  const rootDir = config.get('rootDir')
  if (!rootDir) throw new Error('rootDir is required')

  const srcpath = `${cwd.replace(/\\/g, '/')}/${rootDir}`
  const destpath = resolve(cwd, outFile)
  const [files, input] = await Promise.all([
    getModules(srcpath),
    compileToFile(destpath, config),
  ])

  let source = input
  const { inline = [], exclude = [] } = config.dtsc || {}
  files.push(...inline)
  for (const extra of inline) {
    const meta = require(extra + '/package.json')
    const filename = join(extra, meta.typings || meta.types)
    const content = await fs.readFile(require.resolve(filename), 'utf8')
    source += [`declare module "${extra}" {`, ...content.split('\n')].join('\n    ') + '\n}\n'
  }

  const output = await bundle({ files, source, exclude })
  await fs.writeFile(destpath, output)
}
