#!/usr/bin/env node

import { build } from './build.js'

const cwd = process.cwd()
const args = process.argv.slice(2)

build(cwd, args)
