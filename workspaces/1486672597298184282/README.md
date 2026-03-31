# AutoSprite Phase 2 MVP

这是第二阶段最小闭环实现，不是完整产品复刻。当前版本覆盖 Character、Animate、Preview、Spritesheets 四段工作流，生成链路默认接到 Neta。

当前能力如下。

- 上传角色图并创建角色
- 通过 prompt 直接生成角色并创建角色
- 通过 prompt 或上传图创建 Pose
- 配置并保存自定义动作
- 选择标准动作和自定义动作发起生成
- 页面内填入 Neta token 后即可使用远端生成
- 通过异步 Job 跟踪生成状态
- Animate 阶段右侧查看当前选择会带来的结果和队列影响
- 预览生成结果，支持 WASD 场景体验、loop 调整和版本对比
- 对单个动作 redo 新版本，并切换当前导出版本
- 下载 PNG spritesheet 和 JSON atlas
- 下载完整 character pack

当前刻意不做下面这些能力。

- 付费、credits、套餐分层
- 攻击武器这类分支参数的专门弹窗
- Advanced Mode

## Run

```bash
npm install
npm run dev
```

应用默认跑在 `http://localhost:3123`。

现在本地 `localhost` 也能直接走 Neta 真链路了。服务会在没有公网地址时，把本地角色图先上传到 Neta，再继续生成动作。

如果你已经有公开域名，也可以设置 `AUTOSPRITE_PUBLIC_BASE_URL`，这样服务会直接把自己的文件地址交给 Neta，不再额外上传本地图片。

默认只并发处理 1 个生成任务，后面的任务会排队。要调整上限，可以设置：

```bash
AUTOSPRITE_MAX_CONCURRENT_JOBS=2 npm run dev
```

如果要切回本地假生成链路做开发或测试，可以设置：

```bash
AUTOSPRITE_GENERATION_BACKEND=local npm run dev
```

## Local Neta Debug

如果先在 macmini 上调 Neta 真链路，可以直接跑：

```bash
npm run debug:local:neta
```

这条命令会同时启动本地服务和 `cloudflared` 临时公网隧道，然后打印一个 `trycloudflare.com` 地址。现在它主要用于给别人临时访问你的本地页面，不再是本地调 Neta 的前置条件。

如果想用真实 token 跑一遍从角色生成到动作表的烟测，可以直接跑：

```bash
NETA_TOKEN_CN=... npm run smoke:neta:local
```

烟测会严格校验下面这些结果都真的成立：

- token 能连上 Neta 当前账号
- 角色图确实由 Neta 生成
- 动作任务确实由 Neta 返回视频
- 本地落下来的源文件真的是 MP4，不是缩略图
- atlas 帧数和 spritesheet 帧数一致
- 导出包真能下载，manifest、sheet、atlas、base art 都在里面
- 输出文件会保存到 `runtime/smoke/<timestamp>/`

## Test

```bash
npm test
```

测试里把本地桩链路和 Neta 合同链路分开了。通过的标准不再只是文件生成成功，而是要验证角色图和视频帧确实来自远端返回的产物，远端下载失败时也必须明确报错，不能偷偷退回本地假生成。
