# Knowledge Workspace 微信小程序

Taro 4 + React + TypeScript 的微信小程序端。后端是独立部署的 FastAPI 服务
（`Knowledge-Workspace` 仓库的 `apps/web-service`），本仓库只通过 HTTP 契约对接，
不再与后端共用目录。

## 运行与验证

**小程序改动不要启本地 / H5 预览，也不要在模拟器里做 UI 验证。**
构建后上传新的微信体验版，由用户在真机上实测，并报告上传的版本号与描述。

```
npm run build:weapp     # 产物在 dist/，用微信开发者工具打开本目录
```

环境变量在 `.env.development` / `.env.test` / `.env.production`：

- `TARO_APP_API_MODE=direct` 直连 `TARO_APP_API_BASE`（开发者工具用）
- `TARO_APP_API_MODE=cloud` 走微信云函数网关 `cloudfunctions/apiGateway` 转发（体验版/线上用）

## 产品约定

- 产品名是 `KW`，全称 `Knowledge Workspace`。绝不使用 `知流`。
- 品牌方向是克制的浅色未来工作台：云白底、雾蓝为主色、淡紫用于 agent、冷灰做结构、
  纯白编辑画布。绿色只用于小面积语义化成功态。避免深色整页外壳、霓虹色、渐变和大面积亮绿。
- 文档编辑器要像原生移动端笔记：正文是**一整块连续富文本画布**，而不是一堆独立输入框；
  图片行内插入；标题永不裁切；格式/插入栏始终紧贴软键盘上沿。退格遵循正常文档语义
  （删字、边界处合并段落、删除选中的图片或嵌入块），不需要额外的块删除菜单。
- 文档与思维导图是两种独立内容类型。不要在顶栏放常驻的文档/导图切换；一篇文档可以在
  任意位置插入多个导图概览块。
- 思维导图画布必须支持拖拽平移、双指与按钮缩放、显示当前缩放百分比，并提供适应内容。
- 插入能力统一收敛到一个 `插入` 菜单，便于后续扩展表格等块类型。
- 可见控件要么执行有意义的动作，要么显式禁用并说明原因，不留惰性按钮。
  修改类操作要有加载反馈、连续编辑防抖、拒绝重复的在途请求。

## 两个已经踩过的坑

改样式和编辑器前务必先读这两条，都是排查成本很高的问题。

**1. `config/index.ts` 里关掉了 `postcss-html-transform`。**
该插件会把 `ul` / `li` / `img` / `input` 这类纯 HTML 标签选择器改写成 `.h5-ul` / `.h5-li`，
并且把任何含 `*` 的规则**整条删除**。它服务的是 Taro 渲染裸 HTML 的场景，本项目全部使用
`@tarojs/components`，用不到。但微信 `<editor>` 内部是 Quill 渲染的**真实 HTML**，
被改写后页面样式完全命不中——待办列表显示成一个圆点就是这么来的。
注意：关掉后含 `*` 的规则不再被自动剔除，而 WXSS 本身不支持通配符，**写样式时不要用 `*`**。

**2. `EditorContext.insertImage` 的 `src` 只接受 http(s) / base64 / 云图片 / 临时文件。**
`Taro.env.USER_DATA_PATH` 下的本地文件**不被接受**，会静默失败。导图预览必须走
`canvasToTempFilePath` 产出真正的临时文件（见 `src/services/mindMapPreview.ts`）。
另外 cloud 模式下图片要先压到微信 `callFunction` 的 event 体积上限以内，
否则报 `data exceed max size`（见 `src/services/api.ts` 的 `fitImageForCloudUpload`）。
