#!/usr/bin/env node

import spawn from 'cross-spawn'
import fs from 'fs-extra'
import json5 from 'json5'
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

export async function compile(filename: string) {
  const code = await spawnAsync(['tsc', '-b', ...args])
  if (code) process.exit(code)
  return fs.readFile(filename, 'utf8')
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
  const meta = require(join(cwd, 'package.json'))
  const config = json5.parse(await fs.readFile(join(cwd, 'tsconfig.json'), 'utf8'))
  const { outFile, rootDir } = config.compilerOptions as CompilerOptions
  const { inline = [] } = config.dtsc || {}

  const srcpath = `${cwd.replace(/\\/g, '/')}/${rootDir}`
  const [files, input] = await Promise.all([
    getModules(srcpath),
    compile(join(cwd, outFile)),
  ])
  files.push(...inline)
  let source = input
  for (let extra of inline) {
    const meta = require(extra + '/package.json')
    const filename = join(extra, meta.typings || meta.types)
    const content = await fs.readFile(require.resolve(filename), 'utf8')
    source += [`declare module "${extra}" {`, ...content.split('\n')].join('\n    ') + '\n}\n'
  }
  let output = await bundle({ files, source })
  await fs.writeFile(join(cwd, meta.typings || meta.types), output)
})()
