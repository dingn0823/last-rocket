# Devpost 提交内容（Last Rocket to the Moon）

提交页：https://devpost.com/submit-to/31137-hackwashu-fall-ai-build-challenge/manage/submissions/1197892/project-overview
截止：**周日 9/27 12:00 PM（美中时间）**。截止前可以随时改；截止后通常不能再改，视频链接一定要在截止前填上。

官方要求（来自 https://hackwashu-fall-ai-2026.devpost.com/ ）：
1. 能运行的 AI 项目：截图 + 在线演示或源代码仓库（二者至少一个，我们两个都有）。
2. 问题与方案：给谁用、他们遇到什么问题、为什么我们的方法有用。
3. 技术栈：AI 模型、API、数据集、库、框架。
4. 开发过程：比赛期间完成了什么、遇到的困难和意外、学到了什么、下一步做什么。
5. 清楚的致谢：用到的现成工具和开源资源，以及哪些是团队自己做的。

评分：Impact and Relevance / Technical Execution / Innovation and Creativity / User Experience and Presentation。
规则里**没有强制要求视频**，但强烈建议录一个 90 秒到 2 分钟的（YouTube 不公开链接）：评委看 Devpost 时我们的笔记本不一定开着，决赛现场出问题时也能直接播放。

下面每一块对应 Devpost 上的一个输入框，整块复制粘贴即可。**带 ⚠️ 的地方请队伍自己核对或补充。**

---

## Project name

```
Last Rocket to the Moon
```

## Elevator pitch（上限 200 字符，这段 170）

```
Earth has hours left and you can bring one real thing. Text a photo of it over iMessage, and AI rigs it into gear that changes your moves on a 5-stage flight to the Moon.
```

## About the project（支持 Markdown，整段粘贴）

```markdown
## Inspiration
"Fly Me to the Moon" made us ask one question: *if Earth ended tomorrow and you could bring one thing, what would it be?* Everyone has an answer, and it's usually something within arm's reach. We wanted a game where that answer actually matters: the real object next to you becomes your gear, changes your strategy, and shows up in your ending.

## Who it's for, and the problem
It's for anyone with an iPhone, and for rooms full of people (a hackathon, a class, a party) who want to play something together in a few minutes.
- Most games pull you away from the room you're in, and they start with a download and an account.
- Most AI-powered games let the model improvise freely, so outcomes feel random, unfair, or just wrong.

Our approach: **iMessage is the controller** (nothing to install, and everyone already knows how to use it), **your real object is the game piece**, and **the AI is boxed in**. It only recognizes things and understands words; the game rules decide every number. A shared big screen lets a whole room launch together.

## What it does
1. **Text the ship.** You message the ship AI over iMessage (a Photon Spectrum agent): *"Earth has hours left. You can bring one thing with you. Send me a photo of it."*
2. **Bring one real thing.** Snap a photo of anything nearby, and Gemini picks one of 12 fixed modifications for it. A scarf becomes an **Impact Pad**, a Coke can a **Fuel Side Pod**, house keys a **Hatch Repair Wrench**, a potted plant a **Water Recycler**.
3. **Fly 5 stages:** liftoff, the debris belt, deep space, lunar orbit and the landing. You manage fuel, oxygen and hull, pick 3 upgrades (12 upgrades, 4 combos, legendary drops) and face random events and interludes.
4. **Just say what to do.** From stage 2 on there are no menus. Type *"strap my scarf to the nose as a bumper"* and the ship understands. Your item unlocks moves other players don't get, including hidden ones you only find by trying them.
5. **A real choice.** In lunar orbit the ship breaks. Do you tear apart the thing you brought to survive, or keep it and take the riskier path?
6. **An ending that remembers.** Touchdown, adrift or lost: the ending says whether your item made it, you get a score card, and Gemini writes a short captain's log of *your* run.

The phone alone is enough to play the whole game. Everything below is optional:
- **Personal bridge:** a live web page (behind a random, unguessable link) on your laptop with your rocket, gauges, gear slots and a holographic scan of your item.
- **Big screen for events:** everyone who scans the QR code boards the same launch. There's a 30-second boarding countdown, a full-screen 3·2·1 LIFTOFF, then a 10-minute flight with a live mission feed and a best-landing leaderboard. A podium ceremony closes the round, and the next one starts on its own.
- **About 20 seconds to join:** open **dingn0823.github.io/moon**, type a nickname and your iPhone number, scan the QR code and hit send. The server registers you with Photon automatically, and the laptop page turns into your bridge as soon as your first text arrives.
- **English and Chinese:** texting "join" or "加入" picks the language for the whole run.

## How we built it
- **One TypeScript process on one laptop** (Node.js 24 with native type stripping) runs messaging, game state, the web server, live updates and the public tunnel.
- **Photon Spectrum** (`spectrum-ts`, iMessage provider) handles incoming texts and photos (HEIC), typing indicators, iMessage screen effects and proactive pushes. New players are registered through the Photon project API, and each one texts the shared number Photon assigns them.
- **A pure game engine:** `step(state, input)` returns the new state plus messages, and a seeded RNG lives in the save. Every number, rarity and outcome is in rules code and JSON content: 12 mods, 12 upgrades, 4 combos, 13 events, 6 interludes and 3 endings, in English and Chinese.
- **Gemini** (Gemini 3.5 Flash-Lite, falling back to 3.1 Flash-Lite) has exactly three jobs:
  - classify the photo into one of the 12 mods;
  - map free text onto one of the moves the content already defines;
  - narrate the ending.

  Every response is JSON, validated against the fixed lists, with hard timeouts (photo 10 s, parsing 3 s, narration 5 s). A rate-limited model is swapped for the next one, and if every model is limited the game shows numbered options instead.
- **Input understanding runs in a fixed order:** number, then keywords, then AI, then one clarifying question, then numbered options. Most replies never reach the AI, so a typical run makes only 4–5 Gemini calls.
- **Reliability:** per-player serial queues, message dedupe and state versions (duplicate or late messages are dropped), saving before sending, and pure-JS HEIC → JPEG conversion.
- **Web:** plain HTML, CSS, SVG and JavaScript, no framework. A Cloudflare quick tunnel gives the laptop a public https URL. A GitHub Pages short link follows the tunnel: the server rewrites it through the GitHub API whenever the tunnel URL changes.
- **Balance by simulation:** a script plays thousands of runs with three player styles. Random choices land about 34% of the time, and a careful player lands about 91%. 50 automated tests cover the engine, input parsing, dedupe, rounds and the big screen.

## What we built during the build window
Everything in the repo was built during the official build window (Sep 25–27). We started from a design doc after the prompt came out. The first commit landed Saturday afternoon, and by Saturday night friends were playing full runs on their own iPhones. We kept playtesting and building through the night: joining from a laptop, the bridge, the big screen with automatic rounds, the Chinese version and a rebalance.

## Challenges and surprises
- **Live updates vanished through the tunnel.** Server-Sent Events worked locally but never arrived through the Cloudflare quick tunnel, which buffers them. HTTP/2, turning off compression and padding didn't help. We rewrote every live view as long polling, and updates now arrive in about 0.2 s.
- **The public URL changes on every restart.** We built a short link on GitHub Pages that the server updates itself.
- **Email-based iMessage identities are rejected by Photon's shared numbers.** One tester's iPhone started new conversations from an email address, and none of their messages reached us. The join page now has a prominent tip telling people which setting to change.
- **iPhone photos arrive as HEIC**, so we decode them in pure JavaScript (this works on Windows).
- **Gemini setup:**
  - school Google accounts couldn't create API keys;
  - the 2.5 models returned 404 for new keys;
  - the free tier rate-limits fast, so we added per-model fallback.
- **The first version was too easy.** Our simulator landed about 96% of runs, and a playtester said every run felt the same. We rebalanced: a 100-point start with scaled costs, ±25% variance, a random stage-4 crisis and random interludes.
- **Keeping free text fair:** the AI can only choose moves that already exist in the content. Negation (*"don't swerve, punch it"*) is handled before anything reaches the AI.

## Accomplishments that we're proud of
- Friends and teammates played complete runs on their own iPhones over real iMessage. A brand-new number could join through the page and start playing right away.
- The object you bring genuinely changes the game: different moves, hidden options, and an ending that remembers it.
- It costs $0 to run: free tiers and one laptop.
- It's bilingual end to end, and automated tests check that a Chinese run never shows English and an English run never shows Chinese.

## What we learned
- Boxing in the AI (a fixed menu, validated JSON, no numbers from the model) made the game more reliable *and* more fun.
- Messaging is a great game controller: nothing to install, notifications built in, and everyone already knows how to use it.
- Test the network path on day one. SSE through tunnels cost us hours.

## What's next
- Android support over SMS/RCS.
- Group chats as crews that vote on each move.
- More items, events and combos, plus weekly missions.
- Cloud hosting, so the game doesn't depend on one laptop.

## Photon Bonus Track
The entire game is played by texting a Photon Spectrum agent over iMessage. Photos come in; typing indicators, iMessage effects and proactive pushes go out. Players are registered automatically through the Photon project API.

## Credits
- **Our team:** the concept, game design and design doc (rules, where the AI is and isn't allowed to decide, architecture), content direction, playtesting with friends on real iPhones, and every product decision.
- **AI tools:** Claude Code (Anthropic) was our AI pair programmer. It wrote most of the code and first drafts of the game text under our direction. Google Gemini runs inside the game.
- **Services:** Photon Spectrum (iMessage), Google Gemini API, Cloudflare Tunnel, GitHub Pages.
- **Open-source libraries:** spectrum-ts, qrcode, heic-decode, jpeg-js, TypeScript.
- **Art and data:** icons are system emoji, and everything else is hand-written CSS and SVG. No datasets were used.
```

⚠️ Credits 第一条"团队做了什么"请按你们四个人的实际分工改（比如谁负责设计、谁负责内容、谁负责测试）。规则要求"每个列出的成员都有实质贡献"，并且要写清哪些是团队自己做的。

## Built with（逐个输入，每输一个按回车）

```
typescript, node.js, photon, spectrum-ts, imessage, gemini, google-gemini-api, cloudflare, github-pages, html5, css3, javascript, svg, claude-code
```

## "Try it out" links

```
https://dingn0823.github.io/moon
https://github.com/dingn0823/last-rocket
```

第一个链接只有笔记本上的游戏在运行时才能玩，可以在 About 里或者视频里说明。

## Video demo link

⚠️ 录好后填 YouTube 链接（上传时 Visibility 选 **Unlisted / 不公开**）。

## Image gallery（桌面「Last Rocket - Devpost\gallery」文件夹，按顺序上传，3:2 比例）

| 文件 | 图片说明（Caption） |
|---|---|
| 1-cover.png | Last Rocket to the Moon: bring one real thing, fly it to the Moon over iMessage. |
| 2-bring-one-thing.png | Text the ship, bring one real thing: the AI rigs it into gear, then you just say what to do. |
| 3-bridge.png | Personal bridge: live rocket, gauges, a holographic scan of your cargo and your gear slots. |
| 4-big-screen.png | Big screen: everyone launches together, with a live mission feed. |
| 5-podium.png | A podium ceremony ends every 10-minute round; the next round starts on its own. |
| 6-ending.png | An ending that remembers your item, plus a captain's log written for your run. |
| 7-join.png | Joining takes about 20 seconds: nickname + iPhone number, scan, send. |

Thumbnail（封面小图）用 `1-cover.png`。

## Team members

⚠️ 在提交页的 team 区域用邮箱或 Devpost 用户名邀请队友，每个人要用自己的 Devpost 账号点接受。

## Tracks / prizes

Devpost 页面上只有一个主赛道。提交表里如果有 Photon 相关的勾选项或问题，就勾上 / 填 "Yes: the whole game is played by texting a Photon Spectrum agent over iMessage."
⚠️ Photon Bonus Track 如果需要另外报名（Discord 或单独表格），要问一下主办方或 Photon 的人。
