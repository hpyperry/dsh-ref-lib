/**
 * ref-lib client bundle 构建（简化版 clientBundle，参照 core
 * `packages/client/tsdown.client.ts` 的要点，自包含不依赖 core 构建脚本）。
 *
 * 产物 lib/client.js：CJS + banner/footer 包装成
 * `window.__ModuleLoader__.load({ id, factory })` 闭包工厂；
 * 平台模块（@deepseek-ai/*、react）保持 external（运行时由 loader 模块表
 * 提供），其余依赖全部内联。
 */

import type { UserConfig } from 'tsdown'

/** 平台模块（loader 模块表条目）：运行时提供，禁止内联。v17：`dsh-client-runtime` 包
 * 在 0.1.2 删除、引用全为 type-only（擦除）——已移出该表，防误引入 value import。
 * v18：移除 `@deepseek-ai/dsh-client-locale/client`——它从来不在宿主 seed 表
 * （`packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES`）里，只是因为该 import
 * 是 `import type {}`（构建期擦除）才一直无害；一旦有人写成 value import，bundle 会发出
 * `require('@deepseek-ai/dsh-client-locale/client')` 并在宿主模块表未命中处抛错。 */
const PLATFORM_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
]

// 备忘（0.1.5-rc.2 / 0.1.7-rc.2 seed 表共 9 词）：react、react/jsx-runtime、react-dom、
// react-dom/client、@deepseek-ai/cordis、@deepseek-ai/dsh-client-store、
// @deepseek-ai/dsh-client-ui-slots、@deepseek-ai/dsh-client-ui-primitives、
// @deepseek-ai/dsh-client-ui-dockkit。将来引入其中任一新词的 value import 时，
// 必须同步加入本表；dockkit 自述 "not as a stable API"，勿依赖。
// package.json 的 `dsh.client.external: []` 显式声明"基线之外无额外模块请求"。

const PLUGIN_ID = '@hpyperry/dsh-ref-lib'

const config: UserConfig = {
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  // tsdown ≥0.22：deprecated 的 external/noExternal 由 deps.neverBundle/alwaysBundle 取代。
  deps: {
    // 平台模块保持 external（运行时由 loader 模块表提供），禁止内联。
    neverBundle: [...PLATFORM_EXTERNALS],
    // 其余（本包内部模块、内联依赖）全部打包；本包无 dependencies 字段，
    // 默认即全量打包，这里显式声明以防 tsdown 默认行为变化。
    alwaysBundle: (id: string): boolean => !PLATFORM_EXTERNALS.includes(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default config
