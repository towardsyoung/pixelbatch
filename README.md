# PixelBatch

PixelBatch 是面向电商运营与视觉团队的本地优先 AI 图片批处理桌面应用。当前 MVP 聚焦一条完整、可验证的主链路：

> 导入商品图 → 套用或编写修图提示词 → 选择图片模型 → 批量处理 → 查看任务进度 → 前后对比 → 把好用的提示词和样片沉淀为配方

## 当前能力

- 单张、多张、文件夹导入（PNG / JPG / JPEG / WEBP）
- AI 修图批任务，应用内 2 路并发队列
- OpenAI GPT Image 2（`gpt-image-2`）
- Google Nano Banana 2（`gemini-3.1-flash-image`）
- 模型 URL、API Key、模型名、启用状态和默认模型可配置
- 任务列表、子项状态、失败信息、失败项重试
- 完成结果的拖动式前后对比与本地文件定位
- 结果大图查看，支持缩放、拖动、旋转与适应窗口
- 将任务内所有成功结果批量另存到指定目录，同名文件自动安全重命名
- 从任务结果保存提示词 + 前后样片
- 手动保存提示词 + 封面图
- SQLite 本地持久化；API Key 优先使用 Electron `safeStorage` 加密
- 异常退出恢复：处理中项目重置为等待状态

## 产品边界

当前版本只把 **AI 修图** 做成真实调用链路。抠图和换背景已作为后续能力纳入信息架构，但没有用占位逻辑伪装为可用功能。建议后续按以下顺序演进：

1. 增加任务暂停/取消、并发数和失败重试策略。
2. 增加模型连接测试与单张预估成本。
3. 实现智能抠图 provider，并支持透明 PNG 输出。
4. 实现换背景工作流：背景模板、阴影策略、画布比例和安全区。
5. 增加批次级导出、命名规则、商品 SKU 映射。
6. 增加多轮精修版本树，而不是覆盖已有结果。

## 技术架构

```text
React Renderer
    │ typed IPC
Electron Main
    ├── SQLite repositories
    ├── TaskRunner (queue / recovery / retry)
    ├── ImageProvider interface
    │   ├── OpenAI adapter
    │   └── Gemini adapter
    └── local file protocol + system dialogs
```

任务系统只依赖统一的 `ImageProvider.edit()` 接口。接入新的图片服务时，实现该接口并在 provider factory 注册即可，任务、提示词库和结果页都不需要修改。

## 本地运行

要求 Node.js 22+。

```bash
npm install
npm run dev
```

打开“模型设置”，为至少一个模型配置 API Key，然后回到“批量创作”创建任务。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

## 打包

```bash
npm run package
```

Electron Builder 会在 `release/` 生成当前操作系统对应的安装包。若要正式分发，还需补充应用图标、macOS/Windows 代码签名和自动更新配置。

## 数据位置

- SQLite：Electron `userData` 目录下的 `pixelbatch.sqlite`
- 处理结果：系统“图片”目录下的 `PixelBatch/<task-id>/`
- 原图：只读，不覆盖、不移动

删除提示词只删除数据库记录，不会删除原图或任务结果。删除已被历史任务引用的模型配置会被阻止，可将其停用。
