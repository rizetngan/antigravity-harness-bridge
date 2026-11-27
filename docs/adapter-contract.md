# Harness Adapter Contract（设计草案）

本文件定义 Phase 1 / Phase 3 的目标接口，不代表 V1.1.2 已经实现了完整 Adapter SDK。

## 1. 设计原则

- 一个上游 Runtime，多种宿主 Adapter。
- Adapter 只负责宿主差异，不重复启动和实现 ACP 协议。
- 每个 Adapter 声明能力，不默认假设宿主支持所有功能。
- 事件、权限、会话和上下文都使用明确的标准结构。
- 适配器必须提供版本检测和恢复策略。

## 2. 目标对象

### AgentRuntime

负责 Antigravity 上游连接：

- getStatus()
- listModels()
- createSession()
- resumeSession()
- prompt()
- cancelTurn()
- closeSession()
- subscribe()

### HarnessAdapter

负责把宿主 API 接入统一 Runtime：

- detectHost()
- getCapabilities()
- connect(runtime)
- readVisibleContext(session)
- publishEvent(event)
- requestPermission(request)
- install() / restore()
- dispose()

### HostCapabilities

至少声明：

| 能力 | 说明 |
|---|---|
| modelPicker | 是否支持动态原生模型选择器 |
| streaming | 是否支持文本和事件流 |
| toolEvents | 是否能呈现工具调用与结果 |
| diffs | 是否能呈现文件变更 |
| permissions | 是否支持逐次权限请求 |
| sessionResume | 是否支持恢复会话 |
| contextRead | 是否能读取用户可见上下文 |
| attachments | 是否支持图片和文件附件 |
| cancel | 是否支持取消当前执行 |
| recovery | 是否具备可靠的安装回滚能力 |

## 3. 标准事件

| 事件 | 用途 |
|---|---|
| assistant.delta | 流式文本 |
| tool.started | 工具开始 |
| tool.updated | 工具状态或输出增量 |
| tool.completed | 工具完成 |
| permission.requested | 等待用户授权 |
| permission.resolved | 授权决策完成 |
| diff.updated | 文件 Diff |
| session.state | 会话状态 |
| turn.completed | 当前轮完成 |
| turn.cancelled | 当前轮取消 |
| turn.failed | 当前轮失败 |
| model.catalogue.updated | 模型目录更新 |
| runtime.error | 上游错误 |

## 4. 上下文契约

Context Adapter 只提供宿主用户可见内容：

- 按原顺序提供用户消息和可见助手回复；
- 工具内容采用受控摘要；
- 排除隐藏推理和系统提示词；
- 保留必要的文件引用和工作区信息；
- 支持增量同步和上下文预算；
- 对图片、文件和二进制附件使用显式引用，不把原始大对象写进日志。

## 5. 权限契约

- ACP 发出权限请求时，Adapter 必须能映射到宿主的 Allow / Deny / Cancel。
- 不支持的权限类型不得自动批准。
- 用户取消、宿主关闭和连接断开必须产生确定的终止状态。
- 不能把工具执行结果伪装成用户批准。

## 6. Adapter 目录建议

~~~text
src/
  core/
    contracts/
    events/
    session/
    catalog/
    context/
    permissions/
  upstream/
    antigravity-acp/
  adapters/
    cursor/
    <host-id>/
  platform/
    process/
    storage/
    logging/
~~~

先在单仓库内完成模块隔离。第二个 Native Adapter 稳定后，再决定是否拆成多 package。
