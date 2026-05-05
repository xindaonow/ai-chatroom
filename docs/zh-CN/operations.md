# 运维

## 脚本

```bash
bun run dev                # vite + bun --watch api server
bun run build:web          # 前端生产构建（dist/web）
bun run typecheck          # tsc --noEmit
bun test                   # 约 80 个单元测试，覆盖 modes、extractor、orchestrator、
                           #   repo、adapters、visibility、coalesce
bun run verify             # 全量推送前检查：fast + visibility + adapters + e2e
bun run verify:fast        # typecheck + 全部单元测试
bun run verify:visibility  # 专项：只跑 visibility resolver 测试
bun run verify:adapters    # 专项：只跑 provider adapter 测试
bun run verify:e2e         # 起 mock adapter 服务器，HTTP+SSE 跑 2 轮对话并校验 DB 状态
bun run verify:cache       # prompt 缓存前缀稳定性校验（改了 visibility / render /
                           #   coalesce 后跑；不在默认 chain 里）
```

`scripts/` 里还有独立的诊断脚本（跨上下文流、并行 agent 计时、smoke、端到端前端流程）。任何一个都可以 `bun run scripts/<name>.ts` 直接跑。

## 测试

| 文件 | 覆盖范围 |
|---|---|
| `modes.test.ts` | 各模式 prompt 构造（Free / Brainstorm / Consensus）、phase 切换、orchestrator state 注入、硬约束、final synthesis prompt |
| `consensus/extractor.test.ts` | `parseAgentSignals` 各种解析变体、`shouldStop` 启发式分支 |
| `orchestrator.test.ts` | per-message finalize 语义、独立 finalizedAt 时间戳、retry 生命周期、per-viewer rendered 快照 |
| `repo.test.ts` | listSessions 排序 / roundCount；deleteSession 跨 4 张表的级联；touchSession + setTitleIfMissing；repairOrphanStreams |
| `adapters/openrouter.test.ts` | 端点 URL、Authorization header、默认请求体（reasoning / verbosity / max_tokens）、Anthropic cache_control routing、空消息过滤、role 合并、错误响应 |
| `adapters/coalesce.test.ts` | 朴素同 role 合并 + peer-aware 合并（user 先序、peer-only header、多 peer 顺序保持） |
| `adapters/mock.test.ts` | 确定性 mock adapter |
| `visibility/resolver.test.ts` | 跨轮透明 / 同轮隔离规则、rendered 构建 |

## 部署与安全

服务器默认设计为**单用户本地使用**。生成端点会消耗 `OPENROUTER_API_KEY`（以及可选的 `ARK_API_KEY`）的预算——而且**没有 auth 也没有 rate-limit**。在加上这两层之前，不要把 3000 端口直接暴露到公网。

- **CORS**：默认 `http://localhost:5173,http://127.0.0.1:5173`。如果通过反向代理从其他 origin 访问（Tailscale、自建域名），用 `CORS_ORIGINS=https://your-host`（多个用逗号分隔）。**绝对不要**在公开部署中设置 `CORS_ORIGINS=*`。
- **TLS 验证**：服务器默认走正常 TLS 验证。如果在 macOS Bun 上访问 openrouter.ai 时遇到 `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR`，可以在 `.env.local` 里加 `INSECURE_TLS=1` 临时绕开 —— **仅限本地开发**，因为这会禁用所有出站 HTTPS 的证书验证。长期方案：升级 Bun 或 `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem`。

## 环境变量

| 变量 | 必需 | 说明 |
|---|---|---|
| `OPENROUTER_API_KEY` | 是 | <https://openrouter.ai/keys> 申请。picker 里除 `doubao/...` 外所有模型都用它 |
| `ARK_API_KEY` | 仅 Doubao | 火山方舟 ARK key |
| `CORS_ORIGINS` | 否 | 逗号分隔白名单。默认本地开发 origins |
| `INSECURE_TLS` | 否 | `1` 禁用出站 TLS 验证（仅本地） |
| `DB_PATH` | 否 | 覆盖 SQLite 路径，默认 `./data/dev.db` |
| `PORT` | 否 | 覆盖服务端口，默认 `3000` |
