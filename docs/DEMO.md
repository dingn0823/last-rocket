# 演示清单（Last Rocket to the Moon）

所有链接都以控制页为准：**http://localhost:3000/host**（只能在跑服务器的笔记本上打开）。
对外永远只说短网址：**dingn0823.github.io/moon**（服务器重启后约 20 秒自动指向新地址）。

## 演示前 30 分钟

- [ ] 笔记本插电；Windows 设置里关掉睡眠、屏保、自动锁屏；关掉系统更新提醒。
- [ ] 连好 Wi-Fi；准备一部手机开热点作为备用网络。
- [ ] 启动服务器：在 `last-rocket` 文件夹运行 `npm start`。启动后**不要再重启**（重启没问题，只是公开网址会变，短网址 20 秒后跟上）。
- [ ] 控制页检查四个状态：
  - Public URL：online
  - iMessage auto-registration：ready（显示 x/100 名额）。如果显示 OFF，在终端运行 `npx @photon-ai/cli login` 重新登录
  - Gemini：on
  - Mode：评委桌前用 single player；决赛人多时点 **Switch to event mode**
- [ ] 用团队的 iPhone 发一条"再来一局"或"again"，确认能收到回复（iMessage 链路正常）。
- [ ] 手机浏览器打开短网址，确认能跳到加入页。

## 场合一：评委到桌前（周日 12:30–16:00）

笔记本屏幕开着**加入页**（控制页二维码下面的链接，或短网址）。

1. 开场白（英文）：*"Earth has hours left. You can bring one thing with you. What would it be?"*
2. 请评委在笔记本上填昵称和**他 iPhone 的号码**。提醒他看输入框下方显示的号码，确认没打错。
3. 评委用 iPhone 相机扫笔记本上的二维码，点发送。笔记本自动变成他的**个人舰桥**。
4. 请评委给身边任意一样东西拍张照片发过去。舰桥上会播放全息扫描动画，然后出现装备卡。
5. 第 2 关起可以直接打字。提示评委："Just tell it what to do, in your own words." 能点给他看的亮点：
   - 他带的东西会解锁专属选项（比如软物品可以当缓冲垫，工具可以修东西）；
   - 隐藏选项：遇到漏气时说 "use my scarf to plug the leak"；
   - 组合技、传说装备、着陆时 iPhone 会有全屏特效，舰桥上也有动画。
6. 结局会提到他带的东西是保住了还是牺牲了，然后发战绩卡。

**要讲的三句话**
- 现实中的一样东西 → 变成这一局的装备 → 改变你能做的选择 → 出现在你的结局里。
- 全程在 iMessage 里完成（Photon Spectrum），电脑只是可选的第二块屏幕。
- AI（Gemini）只负责看照片和理解你说的话，所有数值都由游戏规则决定，所以不会乱编，也不会作弊。

**兜底**
| 情况 | 办法 |
|---|---|
| 评委没有 iPhone / 不想用自己的手机 | 递上团队已登记好的 iPhone |
| 发了"加入 xxxx"收到 Photon 的英文拒收回复 | 多半是号码填错，或者 iMessage 用的是邮箱身份。按加入页黄色提示检查：设置 › App › 信息 › 发送与接收 › "开始新对话时使用"选手机号；删掉对话重发 |
| 40 秒没反应 | 加入页会自动提示"改号码"；点它重新填 |
| 照片识别失败 | 游戏会让他回复 1 重试，或者直接打字说物品名 |
| 网络断了 | 切到手机热点；服务器不用重启 |
| iMessage 整体不通 | 打开 http://localhost:3000/phone 用网页模拟器演示同一套游戏 |

## 场合二：决赛上台（周日 17:00–18:30）

**接线**：笔记本接投影，Windows 设置 › 显示 › 选"**扩展**这些显示器"（不要选"复制"）。
- 大屏：控制页点 **📺 Open big screen**，把新窗口拖到投影屏，按 F11 全屏。
- 笔记本屏幕：留着控制页。

**开场前**
- [ ] 控制页点 **👥 Switch to event mode**（几十人同时玩时，自由回答改成编号选项，避免 Gemini 免费额度被用完）。
- [ ] 控制页点 **🔁 Turn on auto rounds**（自动场次）。之后一切自动运转，不用再点任何东西。
- [ ] 确认名额够用：控制页显示的 x/100。

**自动场次怎么走（全自动）**
1. 大屏显示 NEXT LAUNCH · READY。第一个人扫码加入后，自动开始 **30 秒登船倒计时**，这段时间扫码的人都在同一班，名字围着地球出现。
2. 倒计时最后 3 秒大屏全屏 3·2·1 **LIFTOFF!**，名单上所有人同时开局，**10 分钟**飞行倒计时开始（最后 1 分钟变橙，最后 10 秒变红闪烁）。
3. 中途扫码的人直接开玩，计入本场。
4. 时间到自动播放**颁奖典礼**（🥇🥈🥉 领奖台、彩纸），约 45 秒。手机不发名次，只看大屏。
5. 然后自动开下一场，大屏清零。
- 应急按钮：**🚀 Launch now**（人齐了不想等）、**🏁 End round now**（时间不够提前颁奖）。
- 时长在 `.env` 改：`ROUND_BOARDING_SECONDS`、`ROUND_MINUTES`、`ROUND_CEREMONY_SECONDS`；`ROUNDS=auto` 让服务器一启动就进入自动场次。

**流程（约 3–4 分钟的讲解）**
1. 开场问全场：*"If Earth ended tomorrow and you could bring one thing, what would it be?"*
2. 指向大屏："Scan the code with your iPhone camera, or go to **dingn0823.github.io/moon**. We launch together in 30 seconds."
3. 观众在手机上填号码 → 点"打开信息"→ 发送 → 收到"你已进入发射名单"。
4. 一起看 3·2·1 LIFTOFF，然后讲解时让大屏自己跑：火箭沿航线飞，谁触发组合技、拿到传说装备、着陆，他的名字会亮起来并有特效。
5. 如果讲解时间短于 10 分钟，讲完点 **🏁 End round now** 直接颁奖。

**提前录好一段演示视频**，现场网络或 iMessage 出问题时直接放视频。

## 彩排大屏

`node scripts/screen-demo.ts 14 3` 会在 http://localhost:3100/screen 启动一个独立的彩排服务器（14 个机器人，每场飞行 3 分钟，自动场次），可以完整看到候机 → 倒数发射 → 飞行 → 颁奖 → 下一场。控制页是 http://localhost:3100/host。不连 Photon、不用隧道，也不碰真实存档，可以用来练习投屏和讲解。
