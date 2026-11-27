# 客户端兼容性矩阵

状态区分为：**当前项目已验证**、**官方 ACP 路径已提供**、**待评估**。官方支持不等于本项目已经完成真机验收。

## ACP-native 客户端

| 客户端 | 官方接入路径 | 当前状态 | 备注 |
|---|---|---|---|
| Cursor | 本项目原生 Workbench Adapter | **项目已验证** | V1.2.0；Windows x64 / macOS Apple Silicon；Cursor 3.28.7 |
| Zed | agent_servers 注册 agy acp | 官方 ACP 路径 | 无需重复开发协议适配器 |
| JetBrains IDEs | AI Assistant / ~/.jetbrains/acp.json | 官方 ACP 路径 | 通过 ACP 使用外部 Agent |
| Android Studio | ACP Registry | 官方 ACP 路径 | 以官方 Registry 指引为准 |
| Xcode | Settings → Intelligence → Agents | 官方 ACP 路径 | 配置 agy，参数 acp |
| VS Code | 社区 ACP Client 扩展 | 官方文档路径 | VS Code 本身不原生支持 ACP；扩展由社区维护 |
| 其他 ACP clients | 启动 agy acp | 按客户端验证 | 客户端必须实现 ACP client 角色 |

## 非 ACP Harness

| 类型 | 当前状态 | 适配策略 |
|---|---|---|
| 具有公开 Provider / Agent 插件 API 的客户端 | 待评估 | 实现轻量 Native Adapter |
| 仅支持 MCP 工具的客户端 | 不等同于 Agent 接入 | MCP 可扩展工具，不替代模型、会话和 Agent 执行协议 |
| 只接受 OpenAI-compatible API 的客户端 | 待评估 / 独立模式 | 需要单独评估 ACP 语义损失，不作为默认方案 |
| 具有私有模型选择器或内部执行协议的客户端 | 高成本候选 | 先验证内部兼容层是否值得维护 |

## 模型可见性

Google 当前 ACP 文档说明：

- Gemini 模型可在所有 ACP 客户端使用。
- 第三方模型仅在指定客户端开放，包括 JetBrains IDEs、Android Studio、Android Performance Analyzer、Zed 和 Xcode。
- 不能仅凭“客户端支持 ACP”推断它一定能显示账号中的全部第三方模型。

因此，模型目录需要同时记录：

- 上游 ACP 返回的模型和参数；
- 客户端支持的模型选择方式；
- 当前账号实际可用模型；
- 客户端对第三方模型的可见性限制。

## 官方参考

- [Antigravity CLI ACP](https://antigravity.google/docs/cli/acp)
- [Google — Other editors (ACP)](https://antigravity.google/docs/ide/extensions/acp)
- [Agent Client Protocol](https://agentclientprotocol.com/)
