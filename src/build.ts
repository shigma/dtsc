import fs from 'fs-extra'
import tsconfig, { compile, option } from 'tsconfig-utils'
import { createRequire } from 'module'
import { join, resolve } from 'path'
import { bundle } from './bundle'
import { SpawnOptions } from 'child_process'

declare module 'tsconfig-utils' {
  interface tsconfig {
    dtsc: Config
  }
}

export interface Config {
  inline?: string[]
}

async function compileToFile(filename: string, args: string[], options?: SpawnOptions) {
  filename = filename.replace(/\.d\.ts$/, '') + '.tmp.d.ts'
  option(args, ['--composite'])
  option(args, ['--incremental'])
  await compile([
    '--outFile', filename,
    '--composite', 'false',
    '--incremental', 'false',
    ...args,
  ], options)
  const content = await fs.readFile(filename, 'utf8')
  await fs.rm(filename)
  return content
}

async function getModules(path: string, prefix = ''): Promise<string[]> {
  const files = await fs.readdir(path, { withFileTypes: true })
  return [].concat(...await Promise.all(files.map(async (file) => {
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
  const filename = option(args, ['-p', '--project'], () => {
    args.push('-p', '.')
    return 'tsconfig.json'
  }, true)

  const config = await tsconfig(resolve(cwd, filename))
  const { outFile, rootDir } = config.compilerOptions
  if (!outFile) return compile(args)

  const srcpath = `${cwd.replace(/\\/g, '/')}/${rootDir}`
  const destpath = resolve(cwd, option(args, ['--outfile'], () => outFile))
  const [files, input] = await Promise.all([
    getModules(srcpath),
    compileToFile(destpath, args, { cwd }),
  ])

  let source = input
  const { inline = [] } = config.dtsc || {}
  files.push(...inline)
  for (let extra of inline) {
    const meta = require(extra + '/package.json')
    const filename = join(extra, meta.typings || meta.types)
    const content = await fs.readFile(require.resolve(filename), 'utf8')
    source += [`declare module "${extra}" {`, ...content.split('\n')].join('\n    ') + '\n}\n'
  }

  const output = await bundle({ files, source })
  await fs.writeFile(destpath, output)
}
