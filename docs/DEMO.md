# 演示清单（Last Rocket to the Moon）

所有链接都以控制页为准：**http://localhost:3000/host**（只能在跑服务器的笔记本上打开）。
对外永远只说短网址：**dingn0823.github.io/moon**（服务器重启后约 20 秒自动指向新地址）。

## 一分钟上手

1. 笔记本插电，双击桌面 **「Last Rocket - 启动游戏」**。黑色窗口一直开着；浏览器会自动打开控制页。
2. 等控制页的状态都变绿（iMessage connected、Public URL online），**再等 1–2 分钟**让短网址切换到新地址。
3. 给别人的链接永远只有一个：**dingn0823.github.io/moon**（海报、幻灯片上都写这个）。
4. 评委桌前：控制页点绿色的 **🧑‍⚖️ Open join page on this laptop**。
5. 决赛投屏：控制页点 **👥 event mode**、**🔁 auto rounds**、**📺 Open big screen**，把大屏窗口拖到投影上按 F11。

## 演示前 30 分钟

- [ ] 笔记本**必须插电**。插电时的"自动睡眠 / 屏幕关闭 / 合盖睡眠"已在 9/26 关掉（用电池时仍会 4 分钟睡眠）。赛后想改回原样：双击 `last-rocket\tools\restore-power-settings.cmd`。关掉系统更新提醒。
- [ ] 连好 Wi-Fi；准备一部手机开热点作为备用网络。
- [ ] 启动服务器：**双击桌面上的「Last Rocket - 启动游戏」**（等同于 `last-rocket` 文件夹里的 `Start game.cmd`）。会出现一个黑色窗口，几秒后浏览器自动打开控制页。**这个黑色窗口要一直开着**，关掉它游戏就停了。（重启没问题，只是公开网址会变，短网址 20 秒后自动跟上。）如果窗口里提示 "Port 3000 is already in use"，说明游戏已经在运行，直接用现有的就行。
- [ ] 控制页检查状态：
  - iMessage connection：connected（显示 ERROR 时看黑色窗口里的报错，或重开一次）
  - Public URL：online
  - iMessage auto-registration：ready（显示 x/100 名额）。如果显示 OFF，在终端运行 `npx @photon-ai/cli login` 重新登录
  - Gemini：on
  - Mode：评委桌前用 free text（自由打字，人数不限）；决赛人多时点 **Switch to event mode**
- [ ] 用团队的 iPhone 发一条"再来一局"或"again"，确认能收到回复（iMessage 链路正常）。
- [ ] 手机浏览器打开短网址，确认能跳到加入页。

## 场合一：评委到桌前（周日 12:30–16:00）

在控制页点绿色按钮 **🧑‍⚖️ Open join page on this laptop**，笔记本上就会打开加入页。每来一位新评委，就回到控制页再点一次。

1. 开场白（英文）：*"Earth has hours left. You can bring one thing with you. What would it be?"*
2. 请评委在笔记本上填昵称和**他 iPhone 的号码**。提醒他看输入框下方显示的号码，确认没打错。
3. 评委用 iPhone 相机扫笔记本上的二维码，点发送。笔记本自动变成他的**个人舰桥**。
4. 请评委给身边任意一样东西拍张照片发过去。舰桥上会播放全息扫描动画，然后出现装备卡。
5. 第 2 关起可以直接打字。提示评委："Just tell it what to do, in your own words." 能点给他看的亮点：
   - 他带的东西会解锁专属选项（比如软物品可以当缓冲垫，工具可以修东西）；
   - 隐藏选项：遇到漏气时说 "use my scarf to plug the leak"；
   - 组合技、传说装备、着陆时 iPhone 会有全屏特效，舰桥上也有动画。
6. 结局会提到他带的东西是保住了还是牺牲了，然后发战绩卡。指着分数讲一句：*"Your score is 200 for landing, plus everything left in your tanks, 40 per combo, and 60 because your [item] made it. Speed doesn't count."*（着陆 200 + 剩余燃料/氧气/船体 + 每个组合技 40 + 物品保住 60；不比速度，只有成功着陆的局上排行榜。）

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
| 加入页显示 "Too many tries" | 同一个网络地址 10 分钟内已经登记了 100 次，一般碰不到。让他关掉 Wi-Fi 用手机流量重新打开加入页，或者等几分钟 |
| 加入页显示 "The rocket is full" | Photon 的 100 个名额（全天共用，评委和观众都算）用完了。递上团队已登记好的备用 iPhone |
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
2. 倒计时最后 3 秒大屏全屏 3·2·1 **LIFTOFF!**，名单上所有人同时开局，**5 分钟**飞行倒计时开始（最后 1 分钟变橙，最后 10 秒变红闪烁）。
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
5. 如果讲解时间短于 5 分钟，讲完点 **🏁 End round now** 直接颁奖。

**提前录好一段演示视频**，现场网络或 iMessage 出问题时直接放视频。

## 彩排大屏

双击 `last-rocket` 文件夹里的 **`Rehearse big screen.cmd`**（或运行 `node scripts/screen-demo.ts 14 3`），会在 http://localhost:3100/screen 启动一个独立的彩排服务器，浏览器自动打开大屏；关掉黑色窗口即停止。它（14 个机器人，每场飞行 3 分钟，自动场次），可以完整看到候机 → 倒数发射 → 飞行 → 颁奖 → 下一场。控制页是 http://localhost:3100/host。不连 Photon、不用隧道，也不碰真实存档，可以用来练习投屏和讲解。

## Devpost 和演示视频（周日 12:00 PM 截止）

- 每一栏的英文文案在 `docs/DEVPOST.md`，展示图在桌面「Last Rocket - Devpost\gallery」（3:2，按编号上传）。
- 截图可以重新生成：先双击 `Rehearse big screen.cmd`，再运行 `node scripts/devpost-shots.ts <输出文件夹>`（临时服务器、虚构号码，不碰真实存档，也不连 Photon）。
- 规则没有强制要视频，但建议录一个 90 秒–2 分钟的（评委看 Devpost 时笔记本不一定开着；决赛翻车时直接播放）。
- **已经自动录好一版（9/27 凌晨）**：桌面「Last Rocket - DevpostLast Rocket to the Moon - demo.webm」，2 分 35 秒，1080p，英文字幕 + 原创背景音乐 + AI 英文讲解（Gemini TTS 的 Puck 声音，讲解时音乐自动压低）。重点镜头是用真实的保温杯照片做的 AI 扫描特写；多人大屏是一镜到底（登船 → 发射 → 整轮飞行 → 颁奖，视频里这一轮压缩成 35 秒）。早期版本（打字说物品）在「older versions」子文件夹。内容：加入页 → 一条短信配对 → 物品变装备 → 第 1 关和升级 → 自由打字的隐藏选项 → 组合技和传说装备 → 第 4 关抉择 → 着陆和船长日志 → 大屏一起发射、飞行、颁奖 → 原理 → 网址。手机画面是网页版 iMessage 模拟器（同一套游戏和服务器），物品是一张真实的保温杯照片，由 Gemini 现场识别。
- 重录（改了界面或文案之后）：`PHOTO="<照片.jpg>" node scripts/demo-video.ts "<输出文件.webm>"`，全自动，约 10 分钟，不碰真实存档和 Photon，也不影响正在运行的游戏和彩排。它会挑一个能展示全部功能（隐藏选项、组合技、传说装备、成功着陆）的随机种子，然后像认真的玩家一样打字玩完一局，无聊的等待自动暂停不录。有 PHOTO 时手机发这张真实照片，镜头推近到舰桥的全息扫描面板，拍下"等待扫描 → 扫描中 → Gemini 识别出结果"的全过程（视频的重点）；不给 PHOTO 就改成打字说物品。我们用的照片是桌面「Last Rocket - Devpost」文件夹里的「scan-photo (thermos).jpg」（按规定不放进仓库）。讲解词在 `scripts/demo-video.ts` 的 `LINES`；换声音加 `VOICE=Kore` 之类，不要讲解加 `NARRATION=0`。生成过的语音缓存在系统临时文件夹，重录不会再消耗 Gemini 额度。
- 想自己拍真机版本，可以用下面的分镜：

**最省事的拍法**：另一部手机横着拍，一镜到底，画面里同时有笔记本和 iPhone；最后接一段大屏彩排的录屏。

| 时间 | 画面 | 旁白（英文） |
|---|---|---|
| 0:00–0:08 | 笔记本上的加入页 | "Earth has hours left. You can bring one thing with you. What would it be?" |
| 0:08–0:20 | 填昵称和号码 → 扫码 → iMessage 点发送 → 笔记本变成舰桥 | "Join from any laptop: a nickname, your iPhone number, scan, send. No app to install." |
| 0:20–0:40 | 给身边一样东西拍照发过去 → 舰桥全息扫描 → 装备卡 | "Snap one real thing. Gemini picks one of twelve fixed mods. My scarf becomes an Impact Pad." |
| 0:40–1:05 | 第 1 关回数字；第 2 关直接打字（例：strap my scarf to the nose as a bumper） | "From stage two there are no menus. Just say what you'd do, and your item unlocks moves nobody else gets." |
| 1:05–1:20 | 第 4 关的抉择 → 着陆 → 战绩卡和船长日志 | "Tear it apart to survive, or keep it and risk it? The ending remembers." |
| 1:20–1:40 | 大屏彩排录屏：3·2·1 LIFTOFF → 一群火箭在飞 → 颁奖台 | "At events, everyone launches together on the big screen, with a podium every round." |
| 1:40–1:55 | 结尾字卡：dingn0823.github.io/moon 和 GitHub 地址 | "iMessage through Photon Spectrum. The AI never touches the numbers. One laptop, zero dollars. Last Rocket to the Moon." |

- 录电脑屏幕：Windows 11 自带「截图工具」，按 **Win + Shift + R**，框选区域后点"开始"。
- 剪辑：开始菜单搜 **Clipchamp**（Windows 自带），把片段拖进去、剪掉多余部分、加结尾字卡，导出 1080p。
- 上传：youtube.com → 右上角「创建」→「上传视频」→ 可见性选 **不公开（Unlisted）** → 复制链接，贴到 Devpost 的 Video demo link。
