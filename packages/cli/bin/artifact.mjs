#!/usr/bin/env node
/**
 * npx 入口：先注册 tsx（从本包自己的依赖里解析，不受用户当前目录影响），再跑 src/index.ts。
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { register } = await import(pathToFileURL(require.resolve('tsx/esm/api')).href)
register()

const { main } = await import(new URL('../src/index.ts', import.meta.url).href)
await main(process.argv.slice(2))
