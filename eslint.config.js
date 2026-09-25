// @ts-check
/**
 * ref-lib lint 配置（eslint flat config + typescript-eslint recommended）。
 *
 * 范围：src/、tests/、根目录构建配置（*.ts）；排除构建产物、隔离联调 home
 * （`.dsh-dev/`，内含 sk 与会话副本，见 scripts/dev-isolate.sh）与一次性事故工具脚本
 * （scripts/*.mjs 为独立 node 脚本，属 L4 工具，不纳入常规 lint）。
 */
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['lib/**', 'node_modules/**', '.pnpm-store/**', '.dsh-dev/**', 'scripts/**'],
  },
  ...tseslint.configs.recommended,
)
