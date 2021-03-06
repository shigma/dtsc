import spawn from 'cross-spawn'
import fs from 'fs-extra'
import json5 from 'json5'
import { createRequire } from 'module'
import { CompilerOptions } from 'typescript'
import { join, resolve } from 'path'
import { bundle } from './bundle'
import { SpawnOptions } from 'child_process'

function spawnAsync(args: string[], options: SpawnOptions) {
  const child = spawn(args[0], args.slice(1), { ...options, stdio: 'inherit' })
  return new Promise<number>((resolve) => {
    child.on('close', resolve)
  })
}

async function compile(args: string[], options: SpawnOptions) {
  const code = await spawnAsync(['tsc', ...args], options)
  if (code) process.exit(code)
}

async function compileToFile(filename: string, args: string[], options: SpawnOptions) {
  filename = filename.replace(/\.d\.ts$/, '') + '.tmp.d.ts'
  takeArg(args, ['--composite'])
  takeArg(args, ['--incremental'])
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

function takeArg(args: string[], names: string[], fallback?: () => string, preserve = false) {
  const index = args.findIndex(arg => names.some(name => arg.toLowerCase() === name))
  if (index < 0) return fallback?.()
  const value = args[index + 1]
  if (!preserve) {
    args.splice(index, 2)
  }
  return value
}

export async function build(cwd: string, args: string[] = []) {
  const require = createRequire(cwd + '/')
  const filename = takeArg(args, ['-p', '--project'], () => {
    args.push('-p', '.')
    return 'tsconfig.json'
  }, true)

  const config = json5.parse(await fs.readFile(resolve(cwd, filename), 'utf8'))
  const { outFile, rootDir } = config.compilerOptions as CompilerOptions
  if (!outFile) return compile(args, { cwd })

  const srcpath = `${cwd.replace(/\\/g, '/')}/${rootDir}`
  const destpath = resolve(cwd, takeArg(args, ['--outfile'], () => outFile))
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
