#!/usr/bin/env node

import spawn from 'cross-spawn'
import fs from 'fs-extra'
import json5 from 'json5'
import { createRequire } from 'module'
import { CompilerOptions } from 'typescript'
import { join } from 'path'
import { bundle } from '.'

const cwd = process.cwd()
const args = process.argv.slice(2)

export function spawnAsync(args: string[]) {
  const child = spawn(args[0], args.slice(1), { cwd, stdio: 'inherit' })
  return new Promise<number>((resolve) => {
    child.on('close', resolve)
  })
}

export async function compile(args: string[]) {
  const code = await spawnAsync(['tsc', ...args])
  if (code) process.exit(code)
}

export async function compileToFile(filename: string) {
  filename = filename.replace(/\.d\.ts$/, '') + '.tmp.d.ts'
  await compile(['--outFile', filename, ...args])
  const content = await fs.readFile(filename, 'utf8')
  await fs.rm(filename)
  return content
}

export async function getModules(path: string, prefix = ''): Promise<string[]> {
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

(async () => {
  const cwd = process.cwd()
  const require = createRequire(cwd + '/')
  const config = json5.parse(await fs.readFile(join(cwd, 'tsconfig.json'), 'utf8'))
  const { outFile, rootDir } = config.compilerOptions as CompilerOptions
  if (!outFile) return compile(args)

  const srcpath = `${cwd.replace(/\\/g, '/')}/${rootDir}`
  const destpath = join(cwd, outFile)
  const [files, input] = await Promise.all([
    getModules(srcpath),
    compileToFile(destpath),
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
})()
