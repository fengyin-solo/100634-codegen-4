/**
 * 打包并执行标识台账口径验收用例：
 *   node scripts/run-signage-tests.mjs
 * esbuild 把 TS 测试入口和 signage 数据层打成单个 ESM（同一模块图，故障注入对得上），
 * 写到临时文件后动态 import，退出码反映成败。
 */
import { build } from 'esbuild'
import { rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = join(tmpdir(), 'signage-tests.bundle.mjs')

try {
  await build({
    entryPoints: ['scripts/signage-tests.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    logLevel: 'silent',
  })
  await import(pathToFileURL(out).href)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  try {
    rmSync(out, { force: true })
  } catch {
    // 临时文件清理失败不影响结论
  }
}
