# DSH Smoothly Chat（思磨力讯）

同一局域网内多台 DeepSeek Harness 实例之间的文本与文件互通。每台机器维护自己的
**机器级信箱**：消息进的是面板，不进任何会话、不进提示词、也不产生 token 消耗。

- **入口**：左侧栏一个带未读红点的信封图标，点开是整页信箱（对端列表、分对端
  会话流、输入框、附件）。
- **天生双向**：配对一次即双向可用；每对设备一把独立密钥，任意两台配对过的
  机器都能互发。一对多、多对一、多对多共用同一套数据模型（每对端一个队列 +
  一条线程）。
- **广播**：一次发给全部对端——实现为 N 条独立消息（共享 `batchId` 仅用于
  界面归组），一个死对端堵不住其他对端。
- **绝不触碰会话**：不创建、不追加、不恢复任何会话，模型看不到这些消息。

## 安装

```sh
dsh plugin --profile web add dsh-smoothly-chat
```

装完必须**重启 `dsh web`**（新增 bundle 只在启动时加载），然后点左栏的信封图标。

从 Git 安装（不必先发 npm）：DSH 的 **Plugins** 页 → 添加插件 → 填仓库地址，
例如 `https://github.com/karoc/dsh-smoothly-chat`。仓库随源码提交了构建产物
`lib/`（带源码哈希戳），因此目标机器无需 Node 工具链、也无需构建。

本地开发安装：把 `"dsh-smoothly-chat": "link:/path/to/dsh-smoothly-chat"` 加进
profile 的 `package.json` 依赖，并把 `dsh-smoothly-chat` 加进
`dsh.profile.bundles`，重新安装依赖后重启。

## 配对（每两台机器做一次）

1. A 机器：**添加对端 → 生成本机邀请串**，复制 `dsh-peer://…`。
2. B 机器：**添加对端 → 粘贴** → 配对。

B 用邀请密钥对确认请求签名，A 验签通过即把 B 记入对端表——所以一次粘贴，
双向立刻可用；A 不需要人工点同意（持有密钥本身就是授权）。邀请 24 小时有效。
解除配对会立刻移除本机这一侧并通知对方；对端离线时，它会在下次发送时得知
（请求被拒、消息标为失败）。

## 网络

- 信箱默认监听 **47811** 端口（可用 `DSH_SMOOTHLY_CHAT_PORT`、`_BIND`、
  `_DIR`、`_NAME` 覆盖）。
- 绑所有本机接口，这样多地址的机器（WSL 镜像网络、VPN、多网卡）都能被访问；
  对外只暴露四个验签端点，DSH 自己的 web 服务完全不动。
- 每台机器都必须能被**入站**访问到信箱端口。默认 NAT 模式的 WSL2 不行：需要
  在 Windows 侧做 `netsh interface portproxy` 端口转发并放行防火墙。面板会列出
  用于配对的地址与端口，并在找不到私有局域网地址时给出警告。
- 防火墙：在每台机器放行入站 TCP 47811。

## 安全模型

- 每个请求用**每对设备**的 HMAC-SHA256 密钥签名，覆盖方法、路径、时间戳、
  nonce 与正文摘要；±90 秒时钟窗；nonce 只接受一次。C 的消息无法重放给 B
  （密钥不同），抓到的请求也无法重发或改指向。
- 传输是明文 HTTP：签名防伪造、防重放，**不防**同网段抓包。把局域网当可信
  环境，或用 VPN。
- 信箱服务只能存/取消息与文件，不能启动会话、不能执行工具、不能读会话。
- 文件流式落盘、校验 SHA-256 后原子改名；文件名被压成单段（`../` 无法越狱），
  单文件默认上限 200MB。
- 配对密钥永不离开宿主机：面板 API 的所有响应都会剔除密钥字段。

## 数据布局

`$DSH_HOME/smoothly-chat/`（默认 `~/.dsh/smoothly-chat`；目录 `0700`，`config.json` `0600`）：

```
config.json           设备身份、对端表（含密钥）、邀请
state.json            每个对端的已读位置
threads/<peer>.jsonl  追加写的消息与投递状态
files/<msgId>/<name>  收到的文件
outbox/<msgId>.json   待投递记录（重启后继续）
```

## 投递语义

- 出站消息先落盘再发，重启后自动续发。
- 传输失败按指数退避重试（1 秒起，封顶 60 秒）。
- 永久失败（鉴权被拒、端点不存在、体积超限）停止重试，在消息上标为失败。
- 验签通过的入站请求会顺手更新对端地址，DHCP 换 IP 后下次通信自动恢复。

## v0.1.0 不做

群聊房间、中继/hub 模式（要求每台机器都能被直连）、TLS、mDNS 自动发现、已读
回执、消息编辑/撤回，以及把消息转发进 agent 会话（有意隔离）。

## 开发

```sh
npm install
npm run bundle    # 重新构建 lib/ 并刷新 lib/build-stamp.json（两者一并提交）
npm test          # 协议 E2E + UI API + 宿主适配器，均不需要 DSH 进程
npm run typecheck
npm run release:check
```

`lib/core.js` 是不依赖 DSH 的核心（验证脚本直接 import）；`lib/index.js` 是
宿主半区；`lib/client.js` 是浏览器包。除 GUI 验收外，验证脚本都不需要 DSH 进程。

真机 GUI 验收（使用正在运行的实例，不会另起服务）：

```sh
DSH_WEB_URL='http://127.0.0.1:3080/?token=…' npm run verify:gui       # 左栏入口 + 面板渲染
DSH_WEB_URL='http://127.0.0.1:3080/?token=…' npm run verify:gui:live  # 与脚本节点互发文本与文件
```
